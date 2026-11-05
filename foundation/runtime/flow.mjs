import {randomUUID} from 'node:crypto';
import {audit, digest, enqueue, fail, scoped} from '../db.mjs';
import {adapterRegistered} from './adapters.mjs';
import {evaluateCondition, readPath, resolveExpression} from './dsl.mjs';
import {callbackSecret, eventLock, openCase, validate} from './shared.mjs';

export async function getInstance(client,ctx,id,lock=false) {
  const {rows:[instance]} = await scoped(client,ctx)(`
    SELECT i.*,r.definition,r.resolved_manifest,s.code AS service_code,s.business_owner_id
    FROM process_instances i
    JOIN releases r ON r.school_id=i.school_id AND r.environment_id=i.environment_id AND r.id=i.release_id
    JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
    WHERE i.school_id=$1 AND i.environment_id=$2 AND i.id=$3
    ${lock ? 'FOR UPDATE OF i' : ''}
  `, [id]);
  return instance;
}

export async function move(client, ctx, instance, next, outputKey, output) {
  const query = scoped(client,ctx);
  const context = instance.context;
  if (outputKey) context.outputs[outputKey] = output;
  const {rows:[row]} = await query(`
    UPDATE process_instances SET status='RUNNING',current_node=$4,context=$5,version=version+1
    WHERE school_id=$1 AND environment_id=$2 AND id=$3 RETURNING version
  `, [instance.id,next,context]);
  await enqueue(client,ctx,{type:'INSTANCE_TICK',key:'tick:' + instance.id + ':' + row.version,payload:{instanceId:instance.id}});
}

export async function markNode(client, ctx, nodeExecutionId, status, output = null) {
  await scoped(client,ctx)(`
    UPDATE node_executions SET status=$4,output=$5,completed_at=now()
    WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [nodeExecutionId,status,output]);
}

export async function setWaiting(client, ctx, instanceId, status) {
  await scoped(client,ctx)(`
    UPDATE process_instances SET status=$4,version=version+1
    WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [instanceId,status]);
}

async function withIncidence(client,ctx,instance,node,reason) {
  await setWaiting(client,ctx,instance.id,'INCIDENT');
  await openCase(client,ctx,{instanceId:instance.id,category:node.category ?? 'WORKFLOW_CONFIGURATION',reason});
}

export async function currentBinding(client,ctx,snapshot,lock=false) {
  const {rows:[binding]} = await scoped(client,ctx)(`
    SELECT b.id,b.support,b.contract_id,b.connection_id,c.mode,c.status,c.secret_ref,c.authorization_expires_at,
      p.code AS package_code,p.version AS package_version,cc.code AS contract_code,cc.version AS contract_version,e.mode AS environment_mode
    FROM capability_bindings b
    JOIN connections c ON c.school_id=b.school_id AND c.environment_id=b.environment_id AND c.id=b.connection_id
    JOIN adapter_packages p ON p.id=c.adapter_package_id
    JOIN capability_contracts cc ON cc.id=b.contract_id
    JOIN environments e ON e.school_id=b.school_id AND e.id=b.environment_id
    WHERE b.school_id=$1 AND b.environment_id=$2 AND b.id=$3 AND e.status='ACTIVE'
    ${lock ? 'FOR SHARE OF b,c,e' : ''}
  `, [snapshot.bindingId]);
  const now = new Date();
  if (!binding || binding.connection_id !== snapshot.connectionId || binding.contract_id !== snapshot.contractId
    || binding.package_code !== snapshot.packageCode || binding.package_version !== snapshot.packageVersion
    || binding.contract_version !== snapshot.contractVersion || binding.support !== 'SUPPORTED'
    || binding.environment_mode !== 'DEMO' || binding.mode !== 'DEMO' || binding.status !== 'ACTIVE'
    || !callbackSecret(binding.secret_ref)
    || (binding.authorization_expires_at && binding.authorization_expires_at <= now)) return null;
  return binding;
}

export async function createOperation(client, ctx, instance, node, executionId, request, bindingCode = node.bindingCode) {
  const snapshot = instance.resolved_manifest?.bindings?.[bindingCode];
  if (!snapshot?.bindingId || !snapshot.inputSchema || !snapshot.outputSchema
    || !adapterRegistered(snapshot.packageCode,snapshot.packageVersion,bindingCode)) {
    fail(409,'BINDING_UNAVAILABLE','发布版本缺少受支持的模拟能力');
  }
  validate(snapshot.inputSchema,request);
  if (!(await currentBinding(client,ctx,snapshot))) fail(503,'NOT_CONNECTED','模拟连接已停用、变更或授权到期');
  const id = randomUUID();
  const key = executionId ? instance.id + ':' + executionId : instance.id + ':stop:' + id;
  const query = scoped(client,ctx);
  const {rows:[operation]} = await query(`
    INSERT INTO operations(id,school_id,environment_id,binding_id,instance_id,node_execution_id,subject_user_id,actor_id,
      action_code,business_key,idempotency_key,request_hash,request,binding_snapshot,side_effect,retry_class,status,deadline_at)
    VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,'CREATED',now()+interval '60 seconds')
    RETURNING *
  `, [id,snapshot.bindingId,instance.id,executionId,instance.subject_user_id,ctx.userId ?? instance.subject_user_id,
    bindingCode,key,digest(request),request,snapshot,snapshot.sideEffect,snapshot.retryClass]);
  await audit(client,ctx,{action:'OPERATION_CREATED',type:'Operation',id,metadata:{actionCode:bindingCode}});
  await enqueue(client,ctx,{type:'EXECUTE_OPERATION',key:'execute:' + id,payload:{operationId:id}});
  return operation;
}

async function reserveDomain(client,ctx,instance,operation) {
  const query = scoped(client,ctx);
  if (operation.action_code === 'energy.session.start') {
    const {portId,quoteId} = operation.request;
    const {rows:[port]} = await query(`
      SELECT id,status FROM resources WHERE school_id=$1 AND environment_id=$2 AND id=$3
        AND resource_type='CHARGE_PORT' FOR UPDATE
    `, [portId]);
    if (!port) fail(404,'NOT_FOUND','充电端口不存在');
    if (port.status !== 'AVAILABLE') fail(409,'PORT_BUSY','端口当前不可用');
    const {rows:[quote]} = await query(`
      UPDATE demo_tariff_quotes SET consumed_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND resource_id=$4 AND user_id=$5
        AND expires_at>now() AND consumed_at IS NULL RETURNING snapshot
    `, [quoteId,portId,instance.subject_user_id]);
    if (!quote) fail(409,'QUOTE_INVALID','报价已到期、已使用或不属于本人');
    await query(`
      INSERT INTO device_sessions(id,school_id,environment_id,resource_id,subject_user_id,start_operation_id,domain_state,tariff_snapshot)
      VALUES($3,$1,$2,$4,$5,$6,'REQUESTED',$7)
    `, [randomUUID(),portId,instance.subject_user_id,operation.id,quote.snapshot]);
    await query("UPDATE resources SET status='BUSY' WHERE school_id=$1 AND environment_id=$2 AND id=$3", [portId]);
  }
  if (operation.action_code === 'parcel.compartment.unlock') {
    const {rowCount} = await query(`
      UPDATE demo_parcel_pickups SET status='UNLOCK_PENDING',operation_id=$5
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND user_id=$4 AND status='ELIGIBLE'
    `, [operation.request.pickupId,instance.subject_user_id,operation.id]);
    if (!rowCount) fail(409,'PICKUP_NOT_ELIGIBLE','当前取件权益不可再开柜');
  }
}

export async function matchSubscription(client,ctx,instance,subscription,event,node) {
  const query = scoped(client,ctx);
  const {rowCount} = await query(`
    UPDATE event_subscriptions SET status='MATCHED',matched_event_id=$4
    WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='WAITING' AND deadline_at>= $5
  `, [subscription.id,event.id,event.received_at]);
  if (!rowCount) return false;
  const output = event.payload.data;
  await markNode(client,ctx,subscription.node_execution_id,'COMPLETED',output);
  await move(client,ctx,instance,node.onEvent,node.outputKey,output);
  return true;
}

export async function advance(client,ctx,instance) {
  const query = scoped(client,ctx);
  if (!instance || instance.status !== 'RUNNING') return;
  const node = instance.definition.workflow.nodes.find(candidate => candidate.id === instance.current_node);
  if (!node || instance.step_count >= instance.definition.policy.maxSteps) {
    await withIncidence(client,ctx,instance,{},'节点配置无效或达到最大步数');
    return;
  }
  const executionId = randomUUID();
  await query(`
    INSERT INTO node_executions(id,school_id,environment_id,instance_id,node_id,status)
    VALUES($3,$1,$2,$4,$5,'RUNNING')
  `, [executionId,instance.id,node.id]);
  await query(`
    UPDATE process_instances SET step_count=step_count+1 WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [instance.id]);

  if (node.type === 'action') {
    const input = Object.fromEntries(Object.entries(node.input).map(([key,mapping]) =>
      [key,resolveExpression(instance.context,mapping)]).filter(([,value]) => value !== undefined));
    const operation = await createOperation(client,ctx,instance,node,executionId,input);
    await reserveDomain(client,ctx,instance,operation);
    await setWaiting(client,ctx,instance.id,'WAITING_OPERATION');
    return operation;
  }
  if (node.type === 'condition') {
    let matches;
    try { matches = evaluateCondition(instance.context,node); }
    catch {
      await markNode(client,ctx,executionId,'FAILED');
      return withIncidence(client,ctx,instance,node,'条件路径不存在或比较类型不匹配');
    }
    await markNode(client,ctx,executionId,'COMPLETED',{matched:matches});
    return move(client,ctx,instance,matches ? node.whenTrue : node.whenFalse);
  }
  if (node.type === 'end') {
    instance.context.outcome = node.outcome;
    await markNode(client,ctx,executionId,'COMPLETED',{outcome:node.outcome});
    await query(`
      UPDATE process_instances SET status='COMPLETED',ended_at=now(),context=$4,version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [instance.id,instance.context]);
    await audit(client,ctx,{action:'INSTANCE_COMPLETED',type:'Instance',id:instance.id,metadata:{outcome:node.outcome}});
    return;
  }
  if (node.type === 'incident') {
    await markNode(client,ctx,executionId,'INCIDENT');
    return withIncidence(client,ctx,instance,node,'流程等待核查');
  }
  if (node.type === 'human') {
    const id = randomUUID();
    const scopeId = resolveExpression(instance.context,node.scope.id);
    if (typeof scopeId !== 'string' || !scopeId || scopeId.length > 128) {
      await markNode(client,ctx,executionId,'FAILED');
      return withIncidence(client,ctx,instance,node,'人工任务范围无法解析');
    }
    const {rows:[assignee]} = await client.query(`
      SELECT m.id FROM memberships m
      JOIN users u ON u.school_id=m.school_id AND u.id=m.user_id
      WHERE m.school_id=$1 AND m.role_code=$2 AND u.status='ACTIVE'
        AND ((m.scope_type=$3 AND m.scope_id=$4) OR (m.scope_type='SCHOOL' AND m.scope_id='*'))
      LIMIT 1
    `, [ctx.schoolId,node.role,node.scope.type,scopeId]);
    if (!assignee) {
      await markNode(client,ctx,executionId,'FAILED');
      return withIncidence(client,ctx,instance,node,'没有符合岗位和业务范围的处理人');
    }
    const due = new Date(Date.now()+node.timeoutSeconds*1000);
    await query(`
      INSERT INTO human_tasks(id,school_id,environment_id,instance_id,node_execution_id,role_code,scope_type,scope_id,due_at)
      VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9)
    `, [id,instance.id,executionId,node.role,node.scope.type,scopeId,due]);
    await enqueue(client,ctx,{type:'NODE_TIMEOUT',key:'human-timeout:' + id,payload:{instanceId:instance.id,executionId,taskId:id},runAt:due});
    return setWaiting(client,ctx,instance.id,'WAITING_TASK');
  }
  if (node.type === 'waitEvent') {
    const correlationKey = readPath(instance.context,node.correlationPath);
    if (typeof correlationKey !== 'string' || !correlationKey || correlationKey.length > 160) {
      await markNode(client,ctx,executionId,'FAILED');
      return withIncidence(client,ctx,instance,node,'事件关联值无效');
    }
    const id = randomUUID();
    const deadline = new Date(Date.now()+node.timeoutSeconds*1000);
    await eventLock(client,ctx,node.eventType,correlationKey);
    await query(`
      INSERT INTO event_subscriptions(id,school_id,environment_id,instance_id,node_execution_id,event_type,correlation_key,deadline_at)
      VALUES($3,$1,$2,$4,$5,$6,$7,$8)
    `, [id,instance.id,executionId,node.eventType,correlationKey,deadline]);
    const {rows:[prior]} = await query(`
      SELECT * FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND event_type=$3
        AND aggregate_id=$4 AND status='PROCESSED' AND occurred_at>= $5 AND received_at <= $6
      ORDER BY received_at,id LIMIT 1
    `, [node.eventType,correlationKey,instance.created_at,deadline]);
    if (prior && await matchSubscription(client,ctx,instance,{id,node_execution_id:executionId},prior,node)) return;
    await enqueue(client,ctx,{type:'NODE_TIMEOUT',key:'wait-timeout:' + id,payload:{instanceId:instance.id,executionId,subscriptionId:id},runAt:deadline});
    return setWaiting(client,ctx,instance.id,'WAITING_EVENT');
  }
  if (node.type === 'timer') {
    await enqueue(client,ctx,{type:'NODE_TIMEOUT',key:'timer:' + executionId,payload:{instanceId:instance.id,executionId},runAt:new Date(Date.now()+node.delaySeconds*1000)});
    return setWaiting(client,ctx,instance.id,'WAITING_TIMER');
  }
  return withIncidence(client,ctx,instance,node,'节点类型未注册');
}

export async function nodeTimeout(client,ctx,{instanceId,executionId,taskId,subscriptionId}) {
  const instance = await getInstance(client,ctx,instanceId,true);
  if (!instance) return;
  const node = instance.definition.workflow.nodes.find(candidate => candidate.id === instance.current_node);
  const query = scoped(client,ctx);
  const {rows:[execution]} = await query(`
    SELECT * FROM node_executions WHERE school_id=$1 AND environment_id=$2 AND id=$3
      AND instance_id=$4 AND node_id=$5 AND status='RUNNING'
  `, [executionId,instanceId,node.id]);
  if (!execution) return;
  if (taskId && instance.status === 'WAITING_TASK') {
    const {rowCount} = await query(`
      UPDATE human_tasks SET status='CANCELLED',version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status IN ('OPEN','CLAIMED') AND due_at<=now()
    `, [taskId]);
    if (!rowCount) return;
  } else if (subscriptionId && instance.status === 'WAITING_EVENT') {
    const {rows:[subscription]} = await query(`
      SELECT id,node_execution_id,event_type,correlation_key,deadline_at
      FROM event_subscriptions WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='WAITING'
    `, [subscriptionId]);
    if (!subscription) return;
    await eventLock(client,ctx,subscription.event_type,subscription.correlation_key);
    const {rows:[prior]} = await query(`
      SELECT * FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND event_type=$3
        AND aggregate_id=$4 AND status='PROCESSED' AND occurred_at >= $5 AND received_at <= $6
      ORDER BY received_at,id LIMIT 1
    `, [subscription.event_type,subscription.correlation_key,instance.created_at,subscription.deadline_at]);
    if (prior && await matchSubscription(client,ctx,instance,subscription,prior,node)) return;
    const {rowCount} = await query(`
      UPDATE event_subscriptions SET status='TIMED_OUT'
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='WAITING' AND deadline_at<=now()
    `, [subscriptionId]);
    if (!rowCount) return;
  } else if (node.type !== 'timer' || instance.status !== 'WAITING_TIMER') return;
  await markNode(client,ctx,executionId,node.type === 'timer' ? 'COMPLETED' : 'TIMED_OUT');
  return move(client,ctx,instance,node.type === 'timer' ? node.onFire : node.onTimeout);
}
