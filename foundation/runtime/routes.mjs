import {randomUUID} from 'node:crypto';
import {audit, digest, enqueue, fail, scoped, transaction} from '../db.mjs';
import {advance,createOperation,getInstance,markNode,move} from './flow.mjs';
import {getOperation} from './operations.mjs';
import {demoTariff,equalBytes,inScope,once,openCase,parcelToken,requireRole,validate,validId} from './shared.mjs';
import {faults} from './assets.mjs';

function notFound() {
  fail(404,'NOT_FOUND','记录不存在');
}

function isOperator(ctx, serviceId) {
  return ctx.role === 'OPERATOR' && inScope(ctx,'SERVICE',serviceId);
}

function canInspect(ctx, row) {
  return (ctx.role === 'END_USER' && row.subject_user_id === ctx.userId)
    || (['OPERATOR','INTEGRATOR','SERVICE_OWNER'].includes(ctx.role) && inScope(ctx,'SERVICE',row.service_id)
      && (ctx.role !== 'SERVICE_OWNER' || row.business_owner_id === ctx.userId));
}

const exactObject = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    fail(422,'INVALID_INPUT','请求包含不支持的字段');
  }
};

function instanceView(row) {
  const {id,status,current_node,service_id,service_code,release_id,version,created_at,ended_at,context} = row;
  return {id,status,current_node,service_id,service_code,release_id,version,created_at,ended_at,outcome:context.outcome ?? null};
}

function operationView(row) {
  const {id,action_code,instance_id,side_effect,retry_class,status,result,external_id,error_class,attempts,created_at,updated_at} = row;
  return {id,action_code,instance_id,side_effect,retry_class,status,result,external_id,error_class,attempts,created_at,updated_at};
}

async function withPage(client,ctx,url,select,params = []) {
  const page = Number(url?.searchParams.get('page') ?? 1);
  const pageSize = Number(url?.searchParams.get('pageSize') ?? 20);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    fail(422,'INVALID_PAGE','分页参数无效');
  }
  const query = scoped(client,ctx);
  const index = params.length + 3;
  const {rows:[count]} = await query('SELECT count(*) AS total FROM (' + select + ') page_rows',params);
  const {rows} = await query(select + ' ORDER BY created_at DESC,id LIMIT $' + index + ' OFFSET $' + (index+1),[...params,pageSize,(page-1)*pageSize]);
  const total = Number(count.total);
  return {data:rows,meta:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}};
}

async function beginInstance(client,ctx,code,form,{directAction=false}={}) {
  const query = scoped(client,ctx);
  const {rows:[release]} = await query(`
    SELECT r.*,s.code AS service_code
    FROM services s JOIN releases r ON r.school_id=s.school_id AND r.service_id=s.id AND r.environment_id=$2
    JOIN environments e ON e.school_id=s.school_id AND e.id=r.environment_id
    WHERE s.school_id=$1 AND s.code=$3 AND s.status='ACTIVE' AND r.status='ACTIVE'
      AND e.mode='DEMO' AND e.status='ACTIVE'
    FOR SHARE OF s
  `, [code]);
  if (!release) fail(409,'SERVICE_NOT_PUBLISHED','当前环境暂无已发布服务');
  validate(release.definition.form,form);
  const actionCodes = release.definition.workflow.nodes.filter(node => node.type === 'action').map(node => node.bindingCode);
  if (actionCodes.some(code => code.startsWith('energy.') || code.startsWith('parcel.')) && !directAction) {
    fail(422,'DOMAIN_ENTRY_REQUIRED','请从充电或取件专用入口提交');
  }
  const identity = {subjectId:ctx.userId};
  if (actionCodes.includes('library.reservation.create')) {
    const {rows:mappings} = await client.query(`
      SELECT subject FROM identity_mappings WHERE school_id=$1 AND user_id=$2 AND provider='demo-library' AND status='ACTIVE'
      LIMIT 2
    `, [ctx.schoolId,ctx.userId]);
    if (mappings.length !== 1) fail(403,'READER_MAPPING_REQUIRED','账号需绑定唯一的本校演示读者身份');
    identity.subjectId = mappings[0].subject;
  }
  const id = randomUUID();
  const context = {form,identity,outputs:{},system:{
    schoolId:ctx.schoolId,environmentId:ctx.environmentId,serviceId:release.service_id,releaseId:release.id,
  }};
  await query(`
    INSERT INTO process_instances(id,school_id,environment_id,service_id,release_id,subject_user_id,status,current_node,context)
    VALUES($3,$1,$2,$4,$5,$6,'RUNNING',$7,$8)
  `, [id,release.service_id,release.id,ctx.userId,release.definition.workflow.start,context]);
  await audit(client,ctx,{action:'INSTANCE_STARTED',type:'Instance',id,metadata:{serviceCode:code}});
  let instance = await getInstance(client,ctx,id,true);
  if (directAction) {
    const operation = await advance(client,ctx,instance);
    if (!operation) fail(409,'DOMAIN_ACTION_REQUIRED','发布版本未以对应业务动作开始');
    instance = await getInstance(client,ctx,id);
    return {instance,operation};
  }
  await enqueue(client,ctx,{type:'INSTANCE_TICK',key:'tick:' + id + ':1',payload:{instanceId:id}});
  return {instance};
}

async function instances(client,ctx,method,segments,body,request,admin=false) {
  const query = scoped(client,ctx);
  const id = segments[0];
  if (method !== 'GET') return null;
  if (id) {
    const row = await getInstance(client,ctx,validId(id));
    if (!row || !canInspect(ctx,row)) notFound();
    const {rows:nodes} = await query(`
      SELECT id,node_id,status,created_at,completed_at FROM node_executions
      WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3 ORDER BY created_at,id
    `, [id]);
    const {rows:ops} = await query(`
      SELECT * FROM operations WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3 ORDER BY created_at,id
    `, [id]);
    return {data:{...instanceView(row),nodes,operations:ops.map(operationView)}};
  }
  const staff = ['OPERATOR','INTEGRATOR','SERVICE_OWNER'].includes(ctx.role);
  if (admin && !staff) fail(403,'FORBIDDEN','当前岗位没有运行实例权限');
  if (!admin) requireRole(ctx,'END_USER');
  const all = admin && inScope(ctx,'SCHOOL','*');
  const allowedServices = ctx.scopes.filter(scope => scope.type === 'SERVICE').map(scope => scope.id);
  const rows = await withPage(client,ctx,request.url,`
    SELECT i.id,i.status,i.current_node,i.service_id,s.code AS service_code,i.release_id,i.version,i.created_at,i.ended_at,
      i.context->>'outcome' AS outcome FROM process_instances i
    JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
    WHERE i.school_id=$1 AND i.environment_id=$2 AND
    ${admin ? '($3::boolean OR i.service_id::text=ANY($4::text[])) AND ($5::uuid IS NULL OR s.business_owner_id=$5)' : 'i.subject_user_id=$3'}
  `, admin ? [all,allowedServices,ctx.role === 'SERVICE_OWNER' ? ctx.userId : null] : [ctx.userId]);
  return rows;
}

async function tasks(client,ctx,method,segments,body,request) {
  requireRole(ctx,'OPERATOR');
  const query = scoped(client,ctx);
  const id = segments[0];
  const base = `
    SELECT id,instance_id,node_execution_id,role_code,scope_type,scope_id,assignee_id,status,due_at,version,created_at
    FROM human_tasks WHERE school_id=$1 AND environment_id=$2 AND role_code=$3
      AND ($4::boolean OR (scope_type || ':' || scope_id)=ANY($5::text[]))
      AND (assignee_id IS NULL OR assignee_id=$6)
  `;
  const params = [ctx.role,inScope(ctx,'SCHOOL','*'),ctx.scopes.map(scope => scope.type+':'+scope.id),ctx.userId];
  if (!id && method === 'GET') return withPage(client,ctx,request.url,base,params);
  if (!id) return null;
  validId(id);
  const {rows:[seen]} = await query(base+' AND id=$7',[...params,id]);
  if (!seen) notFound();
  const instance = await getInstance(client,ctx,seen.instance_id,method === 'POST');
  const {rows:[task]} = await query(base+' AND id=$7'+(method === 'POST' ? ' FOR UPDATE' : ''),[...params,id]);
  if (!instance || !task) notFound();
  const {rows:[execution]} = await query(`
    SELECT node_id FROM node_executions WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND instance_id=$4
  `, [task.node_execution_id,instance.id]);
  const node = instance.definition.workflow.nodes.find(item => item.id === execution?.node_id);
  if (method === 'GET') return {data:{...task,form:node?.form ?? null}};
  if (method !== 'POST' || !['claim','complete'].includes(segments[1])) return null;
  return once(client,ctx,'tasks:'+id+':'+segments[1],request.key,{body,version:request.version},async () => {
    if (request.version === undefined) fail(428,'VERSION_REQUIRED','请提供任务版本');
    if (task.version !== request.version) fail(409,'VERSION_CONFLICT','任务已更新，请刷新后重试');
    if (instance.status !== 'WAITING_TASK' || node?.type !== 'human' || instance.current_node !== node.id || task.due_at <= new Date()) {
      fail(409,'TASK_NOT_ACTIONABLE','任务已超时或实例已继续');
    }
    if (segments[1] === 'claim') {
      exactObject(body,[]);
      if (task.status !== 'OPEN') fail(409,'TASK_ALREADY_CLAIMED','任务已被领取');
      const {rows:[claimed]} = await query(`
        UPDATE human_tasks SET status='CLAIMED',assignee_id=$4,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='OPEN' RETURNING *
      `, [id,ctx.userId]);
      await audit(client,ctx,{action:'TASK_CLAIMED',type:'HumanTask',id});
      return {data:claimed};
    }
    exactObject(body,['output']);
    if (task.status !== 'CLAIMED' || task.assignee_id !== ctx.userId) fail(409,'TASK_NOT_CLAIMED','请先领取本人任务');
    validate(node.form,body.output);
    const {rows:[completed]} = await query(`
      UPDATE human_tasks SET status='COMPLETED',completed_by=$4,output=$5,version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='CLAIMED' RETURNING *
    `, [id,ctx.userId,body.output]);
    await markNode(client,ctx,task.node_execution_id,'COMPLETED',body.output);
    await move(client,ctx,instance,node.onComplete,node.outputKey,body.output);
    await audit(client,ctx,{action:'TASK_COMPLETED',type:'HumanTask',id});
    return {data:completed};
  });
}

async function operations(client,ctx,method,segments,body,request,admin=false) {
  const query = scoped(client,ctx);
  const id = segments[0];
  if (!id) {
    if (!admin || method !== 'GET') return null;
    requireRole(ctx,'OPERATOR','INTEGRATOR','SERVICE_OWNER','AUDITOR');
    return withPage(client,ctx,request.url,`
      SELECT o.id,o.action_code,o.instance_id,o.side_effect,o.retry_class,o.status,o.error_class,o.attempts,o.created_at,o.updated_at
      FROM operations o JOIN process_instances i
        ON i.school_id=o.school_id AND i.environment_id=o.environment_id AND i.id=o.instance_id
      JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
      WHERE o.school_id=$1 AND o.environment_id=$2 AND ($3::boolean OR i.service_id::text=ANY($4::text[]))
        AND ($5::uuid IS NULL OR s.business_owner_id=$5)
    `, [inScope(ctx,'SCHOOL','*'),ctx.scopes.filter(scope => scope.type === 'SERVICE').map(scope => scope.id),
      ctx.role === 'SERVICE_OWNER' ? ctx.userId : null]);
  }
  const op = await getOperation(client,ctx,validId(id),method === 'POST');
  if (!op) notFound();
  const instance = await getInstance(client,ctx,op.instance_id);
  const auditor = admin && ctx.role === 'AUDITOR' && inScope(ctx,'SERVICE',instance?.service_id);
  if (!instance || (!canInspect(ctx,{...op,service_id:instance.service_id,business_owner_id:instance.business_owner_id}) && !auditor)) notFound();
  if (method === 'GET') {
    const {rows:attemptHistory} = await query(`
      SELECT attempt_number,kind,status,evidence,started_at,ended_at FROM operation_attempts
      WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 ORDER BY attempt_number
    `, [op.id]);
    const view = operationView(op);
    if (auditor) {
      delete view.result;
      delete view.external_id;
    }
    return {data:{...view,attemptHistory}};
  }
  if (method !== 'POST' || !admin) return null;
  requireRole(ctx,'OPERATOR','INTEGRATOR');
  if (segments[1] === 'query-result') return once(client,ctx,'operation-query:'+id,request.key,body,async () => {
    exactObject(body,[]);
    if (op.status !== 'UNKNOWN') fail(409,'QUERY_NOT_REQUIRED','只有未知结果可以进入核查');
    const {rows:[pending]} = await query(`
      SELECT id FROM jobs WHERE school_id=$1 AND environment_id=$2 AND job_type='QUERY_OPERATION'
        AND status IN ('PENDING','RUNNING') AND payload->>'operationId'=$3 LIMIT 1
    `, [id]);
    if (!pending) await enqueue(client,ctx,{type:'QUERY_OPERATION',key:'query:' + id + ':' + randomUUID(),payload:{operationId:id}});
    await audit(client,ctx,{action:'OPERATION_QUERY_QUEUED',type:'Operation',id});
    return {status:202,data:{operationId:id,status:'QUERY_QUEUED'}};
  });
  if (segments[1] === 'cases') return once(client,ctx,'operation-case:'+id,request.key,body,async () => {
    exactObject(body,['reason']);
    if (op.status !== 'UNKNOWN') fail(409,'CASE_NOT_REQUIRED','当前操作无需未知结果核查');
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
      fail(422,'REASON_REQUIRED','请输入 1 至 500 字核查依据');
    }
    const created = await openCase(client,ctx,{operationId:id,instanceId:op.instance_id,category:'OPERATION_RESULT_UNKNOWN',reason:body.reason.trim()});
    const {rows:[prior]} = created ? {rows:[created]} : await query(`
      SELECT id FROM cases WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3
        AND status NOT IN ('RESOLVED','CLOSED')
    `, [id]);
    return {status:created ? 201 : 200,data:{caseId:prior.id,operationId:id}};
  });
  if (segments[1] === 'retry') fail(409,'UNSAFE_RETRY','该模拟写操作只允许查证原操作结果');
  return null;
}

async function sessionView(client,ctx,id) {
  const query = scoped(client,ctx);
  const {rows:[session]} = await query(`
    SELECT ds.*,i.service_id,i.id AS instance_id,s.business_owner_id FROM device_sessions ds
    JOIN operations o ON o.school_id=ds.school_id AND o.environment_id=ds.environment_id AND o.id=ds.start_operation_id
    JOIN process_instances i ON i.school_id=o.school_id AND i.environment_id=o.environment_id AND i.id=o.instance_id
    JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
    WHERE ds.school_id=$1 AND ds.environment_id=$2 AND ds.id=$3
  `, [validId(id)]);
  if (!session || !canInspect(ctx,session)) notFound();
  const {rows:readings} = await query(`
    SELECT id,meter_id,meter_epoch,value,unit,sampled_at,source_sequence,quality_flags,evidence FROM meter_readings
    WHERE school_id=$1 AND environment_id=$2 AND session_id=$3 ORDER BY sampled_at,id
  `, [session.id]);
  const {rows:[bill]} = await query(`
    SELECT id,revision,status,components,amount_minor,currency,evidence_refs,supersedes_id,created_at FROM bills
    WHERE school_id=$1 AND environment_id=$2 AND session_id=$3 ORDER BY revision DESC LIMIT 1
  `, [session.id]);
  const {subject_user_id,school_id,environment_id,business_owner_id,...safe} = session;
  return {...safe,readings,bill:bill ?? null,mode:'DEMO'};
}

async function energy(client,ctx,method,segments,body,request) {
  const query = scoped(client,ctx);
  const [area,id,action] = segments;
  if (method === 'GET' && area === 'resources') {
    requireRole(ctx,'END_USER');
    const {rows} = await query(`
      SELECT id,code,status,config FROM resources
      WHERE school_id=$1 AND environment_id=$2 AND resource_type='CHARGE_PORT' ORDER BY code
    `);
    return {data:rows};
  }
  if (method === 'POST' && area === 'quotes') {
    requireRole(ctx,'END_USER');
    exactObject(body,['portId']);
    return once(client,ctx,'energy-quote',request.key,body,async () => {
      const {rows:[port]} = await query(`
        SELECT id,status FROM resources WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND resource_type='CHARGE_PORT'
      `, [validId(body.portId)]);
      if (!port) notFound();
      if (port.status !== 'AVAILABLE') fail(409,'PORT_BUSY','端口当前不可用');
      const {rows:[quote]} = await query(`
        INSERT INTO demo_tariff_quotes(id,school_id,environment_id,resource_id,user_id,snapshot,expires_at)
        VALUES($3,$1,$2,$4,$5,$6,now()+interval '10 minutes') RETURNING id,expires_at,snapshot
      `, [randomUUID(),port.id,ctx.userId,demoTariff]);
      return {status:201,data:quote};
    });
  }
  if (method === 'POST' && area === 'session-requests') {
    requireRole(ctx,'END_USER');
    exactObject(body,['portId','quoteId','fault']);
    return once(client,ctx,'energy-start',request.key,body,async () => {
      const {instance,operation} = await beginInstance(client,ctx,'energy-charge',body,{directAction:true});
      if (operation.action_code !== 'energy.session.start'
        || operation.request.portId !== body.portId || operation.request.quoteId !== body.quoteId) {
        fail(409,'DOMAIN_ACTION_REQUIRED','发布版本的起始动作不匹配');
      }
      const {rows:[session]} = await query(`
        SELECT id FROM device_sessions WHERE school_id=$1 AND environment_id=$2 AND start_operation_id=$3
      `, [operation.id]);
      return {status:202,data:{instanceId:instance.id,operationId:operation.id,sessionId:session.id}};
    });
  }
  if (area === 'sessions' && id && method === 'GET') {
    const session = await sessionView(client,ctx,id);
    return {data:action === 'bill' ? session.bill : session};
  }
  if (area === 'sessions' && id && action === 'stop-requests' && method === 'POST') {
    exactObject(body,[]);
    return once(client,ctx,'energy-stop:'+id,request.key,body,async () => {
      const session = await sessionView(client,ctx,id);
      if (ctx.role !== 'END_USER' && !isOperator(ctx,session.service_id)) fail(403,'FORBIDDEN','当前岗位不能发起停止');
      const instance = await getInstance(client,ctx,session.instance_id,true);
      const {rows:[current]} = await query(`
        SELECT * FROM device_sessions WHERE school_id=$1 AND environment_id=$2 AND id=$3 FOR UPDATE
      `, [session.id]);
      if (current.domain_state !== 'ACTIVE' || current.stop_operation_id) fail(409,'SESSION_NOT_ACTIVE','会话当前不能发起停止');
      const form = {externalSessionId:current.external_session_id};
      if (instance.context.form.fault) form.fault = instance.context.form.fault;
      const operation = await createOperation(client,ctx,instance,{},null,form,'energy.session.stop');
      await query(`
        UPDATE device_sessions SET domain_state='STOPPING',stop_operation_id=$4,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3
      `, [current.id,operation.id]);
      return {status:202,data:{sessionId:current.id,operationId:operation.id}};
    });
  }
  return null;
}

async function parcel(client,ctx,method,segments,body,request) {
  if (segments[0] !== 'pickups') return null;
  requireRole(ctx,'END_USER');
  const query = scoped(client,ctx);
  if (method === 'GET' && segments.length === 1) {
    const {rows} = await query(`
      SELECT id,parcel_code,resource_id,status,operation_id FROM demo_parcel_pickups
      WHERE school_id=$1 AND environment_id=$2 AND user_id=$3 ORDER BY parcel_code
    `, [ctx.userId]);
    return {data:rows.map(row => ({...row,...(row.status === 'ELIGIBLE' ? {entitlementToken:parcelToken(ctx,row.id)} : {})}))};
  }
  if (method === 'POST' && segments[2] === 'unlock-requests') {
    exactObject(body,['entitlementToken','fault']);
    const pickupId = validId(segments[1]);
    return once(client,ctx,'parcel-unlock:'+pickupId,request.key,{fault:body.fault,entitlementDigest:typeof body.entitlementToken === 'string'
      ? digest(body.entitlementToken) : null},async () => {
      const {rows:[pickup]} = await query(`
        SELECT id FROM demo_parcel_pickups WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND user_id=$4
      `, [pickupId,ctx.userId]);
      if (!pickup || typeof body.entitlementToken !== 'string' || body.entitlementToken.length > 128
        || !equalBytes(body.entitlementToken,parcelToken(ctx,pickupId))) notFound();
      const form = {pickupId};
      if (body.fault !== undefined) form.fault = body.fault;
      const {instance,operation} = await beginInstance(client,ctx,'parcel-pickup',form,{directAction:true});
      if (operation.action_code !== 'parcel.compartment.unlock' || operation.request.pickupId !== pickupId) {
        fail(409,'DOMAIN_ACTION_REQUIRED','发布版本的起始动作不匹配');
      }
      return {status:202,data:{instanceId:instance.id,operationId:operation.id,pickupId}};
    });
  }
  return null;
}

async function operationalLists(client,ctx,method,area,id,request) {
  if (method !== 'GET') return null;
  const roles = ['OPERATOR','INTEGRATOR','SERVICE_OWNER','AUDITOR'];
  requireRole(ctx,...roles);
  const query = scoped(client,ctx);
  const all = inScope(ctx,'SCHOOL','*');
  const services = ctx.scopes.filter(scope => scope.type === 'SERVICE').map(scope => scope.id);
  const owner = ctx.role === 'SERVICE_OWNER' ? ctx.userId : null;
  if (area === 'sessions') {
    if (id) return {data:await sessionView(client,ctx,id)};
    return withPage(client,ctx,request.url,`
      SELECT ds.id,ds.resource_id,ds.domain_state,ds.observation_state,ds.started_at,ds.ended_at,o.created_at
      FROM device_sessions ds JOIN operations o ON o.school_id=ds.school_id AND o.environment_id=ds.environment_id AND o.id=ds.start_operation_id
      JOIN process_instances i ON i.school_id=o.school_id AND i.environment_id=o.environment_id AND i.id=o.instance_id
      JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
      WHERE ds.school_id=$1 AND ds.environment_id=$2 AND ($3::boolean OR i.service_id::text=ANY($4::text[]))
        AND ($5::uuid IS NULL OR s.business_owner_id=$5)
    `, [all,services,owner]);
  }
  if (area === 'cases') {
    const base = `
      SELECT c.id,c.operation_id,c.instance_id,c.category,c.status,
        CASE WHEN $6::boolean THEN NULL ELSE c.reason END AS reason,
        CASE WHEN $6::boolean THEN c.decision-'reason' ELSE c.decision END AS decision,c.created_at,c.closed_at
      FROM cases c LEFT JOIN process_instances i ON i.school_id=c.school_id AND i.environment_id=c.environment_id AND i.id=c.instance_id
      LEFT JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
      WHERE c.school_id=$1 AND c.environment_id=$2 AND ($3::boolean OR i.service_id::text=ANY($4::text[]))
        AND ($5::uuid IS NULL OR s.business_owner_id=$5)
    `;
    if (!id) return withPage(client,ctx,request.url,base,[all,services,owner,ctx.role === 'AUDITOR']);
    const {rows:[row]} = await query(base+' AND c.id=$7',[all,services,owner,ctx.role === 'AUDITOR',validId(id)]);
    if (!row) notFound();
    return {data:row};
  }
  if (area === 'metering') return withPage(client,ctx,request.url,`
    SELECT m.id,m.session_id,m.meter_id,m.meter_epoch,m.value,m.unit,m.sampled_at,m.received_at AS created_at,m.source_sequence,m.quality_flags
    FROM meter_readings m JOIN device_sessions ds ON ds.school_id=m.school_id AND ds.environment_id=m.environment_id AND ds.id=m.session_id
    JOIN operations o ON o.school_id=ds.school_id AND o.environment_id=ds.environment_id AND o.id=ds.start_operation_id
    JOIN process_instances i ON i.school_id=o.school_id AND i.environment_id=o.environment_id AND i.id=o.instance_id
    JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
    WHERE m.school_id=$1 AND m.environment_id=$2 AND ($3::boolean OR i.service_id::text=ANY($4::text[]))
      AND ($5::uuid IS NULL OR s.business_owner_id=$5)
  `, [all,services,owner]);
  if (!all || !['INTEGRATOR','AUDITOR'].includes(ctx.role)) fail(403,'FORBIDDEN','当前岗位不能查看全环境队列');
  if (area === 'jobs') return withPage(client,ctx,request.url,`
    SELECT id,job_type,status,attempts,max_attempts,run_at,locked_at,lease_until,last_error,created_at
    FROM jobs WHERE school_id=$1 AND environment_id=$2
  `);
  if (area === 'events') return withPage(client,ctx,request.url,`
    SELECT id,event_type,status,aggregate_version,occurred_at,received_at AS created_at,error
    FROM event_inbox WHERE school_id=$1 AND environment_id=$2
  `);
  return null;
}

export async function runtimeRoute(ctx,method,path,body,request) {
  const [group,area,id,action] = path;
  const run = callback => transaction(callback);
  if (group === 'services' && area && id === 'instances' && method === 'POST') {
    requireRole(ctx,'END_USER');
    exactObject(body,['form','environmentCode']);
    return run(client => once(client,ctx,'start:'+area,request.key,body,async () => {
      const {instance} = await beginInstance(client,ctx,area,body.form);
      return {status:201,data:instanceView(instance)};
    }));
  }
  if (group === 'library' && area === 'books' && method === 'GET') return run(async client => {
    requireRole(ctx,'END_USER');
    const {rows} = await scoped(client,ctx)(`
      SELECT code AS id,title,available FROM demo_library_titles WHERE school_id=$1 AND environment_id=$2 ORDER BY code
    `);
    return {data:rows};
  });
  if (group === 'instances') return run(client => instances(client,ctx,method,path.slice(1),body,request));
  if (group === 'operations') return run(client => operations(client,ctx,method,path.slice(1),body,request));
  if (group === 'energy') return run(client => energy(client,ctx,method,path.slice(1),body,request));
  if (group === 'parcel') return run(client => parcel(client,ctx,method,path.slice(1),body,request));
  if (group !== 'admin') return null;
  if (area === 'tasks') return run(client => tasks(client,ctx,method,path.slice(2),body,request));
  if (area === 'operations') return run(client => operations(client,ctx,method,path.slice(2),body,request,true));
  if (area !== 'runtime') return null;
  if (id === 'tasks') return run(client => tasks(client,ctx,method,path.slice(3),body,request));
  if (id === 'operations') return run(client => operations(client,ctx,method,path.slice(3),body,request,true));
  if (id === 'instances') return run(client => instances(client,ctx,method,path.slice(3),body,request,true));
  if (['sessions','cases','metering','events','jobs'].includes(id)) return run(client => operationalLists(client,ctx,method,id,action,request));
  return null;
}
