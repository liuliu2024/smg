import {randomUUID} from 'node:crypto';
import {audit, scoped, transaction} from '../db.mjs';
import {invokeAdapter} from './adapters.mjs';
import {schemaErrors} from './dsl.mjs';
import {currentBinding,getInstance,markNode,move} from './flow.mjs';
import {openCase} from './shared.mjs';

export async function getOperation(client,ctx,id,lock=false) {
  const {rows:[operation]} = await scoped(client,ctx)(`
    SELECT * FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3
    ${lock ? 'FOR UPDATE' : ''}
  `, [id]);
  return operation;
}

export async function leaseHeld(client,job) {
  const {rows:[row]} = await client.query(`
    SELECT id FROM jobs WHERE id=$1 AND school_id=$2 AND environment_id=$3
      AND status='RUNNING' AND locked_by=$4 AND attempts=$5 AND lease_until>now()
    FOR UPDATE
  `, [job.id,job.school_id,job.environment_id,job.locked_by,job.attempts]);
  return Boolean(row);
}

function stateOf(outcome) {
  return {
    success:'SUCCEEDED',
    rejected:'BUSINESS_REJECTED',
    not_executed:'TECHNICAL_FAILED',
    unknown:'UNKNOWN',
  }[outcome.kind] ?? 'UNKNOWN';
}

async function updateDomain(client,ctx,op,status,outcome) {
  const query = scoped(client,ctx);
  if (op.action_code.startsWith('energy.session.')) {
    const start = op.action_code.endsWith('.start');
    const column = start ? 'start_operation_id' : 'stop_operation_id';
    const {rows:[session]} = await query(`
      SELECT * FROM device_sessions WHERE school_id=$1 AND environment_id=$2 AND ${column}=$3 FOR UPDATE
    `, [op.id]);
    if (!session) return;
    if (status === 'UNKNOWN' && ['REQUESTED','STARTING','STOPPING'].includes(session.domain_state)) {
      await query(`
        UPDATE device_sessions SET observation_state='UNKNOWN',version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3
      `, [session.id]);
    }
    if (start && status === 'SUCCEEDED' && ['REQUESTED','STARTING'].includes(session.domain_state)) {
      await query(`
        UPDATE device_sessions SET domain_state='STARTING',external_session_id=$4,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3
      `, [session.id,outcome.data.externalSessionId]);
    }
    if (start && ['TECHNICAL_FAILED','BUSINESS_REJECTED'].includes(status) && ['REQUESTED','STARTING'].includes(session.domain_state)) {
      await query(`
        UPDATE device_sessions SET domain_state='START_FAILED',ended_at=now(),version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3
      `, [session.id]);
      await query("UPDATE resources SET status='AVAILABLE' WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='BUSY'", [session.resource_id]);
    }
    if (!start && ['TECHNICAL_FAILED','BUSINESS_REJECTED'].includes(status) && session.domain_state === 'STOPPING') {
      await query(`
        UPDATE device_sessions SET domain_state='ACTIVE',stop_operation_id=NULL,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3
      `, [session.id]);
      await openCase(client,ctx,{operationId:op.id,instanceId:op.instance_id,category:'ENERGY_STOP_FAILED',reason:'停止请求未执行，需确认现场状态'});
    }
  }
  if (op.action_code === 'parcel.compartment.unlock') {
    if (status === 'SUCCEEDED') {
      await query(`
        UPDATE demo_parcel_pickups SET status='OPEN_CONFIRMED'
        WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND status='UNLOCK_PENDING'
      `, [op.id]);
    }
    if (['TECHNICAL_FAILED','BUSINESS_REJECTED'].includes(status)) {
      await query(`
        UPDATE demo_parcel_pickups SET status='ELIGIBLE',operation_id=NULL
        WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND status='UNLOCK_PENDING'
      `, [op.id]);
    }
  }
}

export async function applyOutcome(client,ctx,op,outcome) {
  const query = scoped(client,ctx);
  const instance = op.node_execution_id && op.instance_id
    ? await getInstance(client,ctx,op.instance_id,true) : null;
  if (outcome.kind === 'success' && schemaErrors(op.binding_snapshot.outputSchema,outcome.data).length) {
    outcome = {kind:'unknown',reason:'INVALID_PROVIDER_OUTPUT',evidence:{mode:'DEMO'}};
  }
  const status = stateOf(outcome);
  await query(`
    UPDATE operations SET status=$4,result=$5,external_id=COALESCE($6,external_id),error_class=$7,updated_at=now()
    WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [op.id,status,outcome,
    outcome.data?.reservationId ?? outcome.data?.externalSessionId ?? outcome.data?.pickupId ?? null,
    outcome.reason ?? outcome.code ?? null]);
  await updateDomain(client,ctx,op,status,outcome);
  await query(`
    INSERT INTO outbox(id,school_id,environment_id,event_key,event_type,payload)
    VALUES($3,$1,$2,$4,'operation.result',$5)
    ON CONFLICT(school_id,environment_id,event_key) DO NOTHING
  `, [randomUUID(), 'operation:' + op.id + ':' + status, {operationId:op.id,status}]);
  await audit(client,ctx,{action:'OPERATION_RESULT',type:'Operation',id:op.id,outcome:status,metadata:{actionCode:op.action_code}});

  if (status === 'UNKNOWN') {
    await openCase(client,ctx,{operationId:op.id,instanceId:op.instance_id,category:'OPERATION_RESULT_UNKNOWN',reason:'外部执行结果未知，等待权威查询'});
  } else if (op.status === 'UNKNOWN') {
    await query(`
      UPDATE cases SET status='RESOLVED',decision=$4,closed_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND status NOT IN ('RESOLVED','CLOSED')
    `, [op.id,{source:'SIMULATED_AUTHORITY_QUERY',status}]);
  }
  if (!instance) return status;
  const {rows:[execution]} = await query(`
    SELECT node_id,status FROM node_executions WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND instance_id=$4
  `, [op.node_execution_id,instance.id]);
  const node = instance.definition.workflow.nodes.find(item => item.id === execution?.node_id);
  if (!node || node.type !== 'action') return status;
  const initial = instance.status === 'WAITING_OPERATION' && instance.current_node === node.id && execution.status === 'RUNNING';
  const recovery = instance.status === 'INCIDENT' && instance.current_node === node.onUnknown && execution.status === 'UNKNOWN';
  if (!initial && !recovery) return status;
  if (status === 'UNKNOWN') {
    await markNode(client,ctx,op.node_execution_id,'UNKNOWN');
    await query(`
      UPDATE process_instances SET current_node=$4,status='INCIDENT',version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [instance.id,node.onUnknown]);
    return status;
  }
  await markNode(client,ctx,op.node_execution_id,status,outcome.data ?? null);
  const next = {SUCCEEDED:node.onSuccess,BUSINESS_REJECTED:node.onRejected,TECHNICAL_FAILED:node.onFailure}[status];
  await move(client,ctx,instance,next,status === 'SUCCEEDED' ? node.outputKey : undefined,outcome.data);
  return status;
}

export async function executeOperationJob(ctx,job,kind) {
  const operationId = job.payload.operationId;
  const claimed = await transaction(async client => {
    if (!(await leaseHeld(client,job))) return;
    const query = scoped(client,ctx);
    const op = await getOperation(client,ctx,operationId,true);
    if (!op || (kind === 'EXECUTE' ? op.status !== 'CREATED' : op.status !== 'UNKNOWN')) return;
    const authorization = await currentBinding(client,ctx,op.binding_snapshot);
    if (!authorization || (kind === 'EXECUTE' && op.deadline_at <= new Date())) {
      if (kind === 'EXECUTE') {
        await applyOutcome(client,ctx,op,{kind:'not_executed',reason:authorization ? 'DEADLINE_EXPIRED_UNSENT' : 'CONNECTION_REVOKED_UNSENT',evidence:{sent:false}});
      } else await audit(client,ctx,{action:'OPERATION_QUERY_BLOCKED',type:'Operation',id:op.id,outcome:'REJECTED'});
      return;
    }
    const {rows:[ongoing]} = await query(`
      SELECT id FROM operation_attempts WHERE school_id=$1 AND environment_id=$2
        AND operation_id=$3 AND status='RUNNING'
    `, [op.id]);
    if (ongoing) return;
    const attemptId = randomUUID();
    await query(`
      UPDATE operations SET attempts=attempts+1,status=$4,updated_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [op.id,kind === 'EXECUTE' ? 'DISPATCHING' : op.status]);
    await query(`
      INSERT INTO operation_attempts(id,school_id,environment_id,operation_id,attempt_number,kind,status,started_at)
      VALUES($3,$1,$2,$4,$5,$6,'RUNNING',now())
    `, [attemptId,op.id,op.attempts+1,kind]);
    return {op,attemptId};
  });
  if (!claimed) return;
  let outcome;
  try { outcome = await invokeAdapter(ctx,claimed.op,kind); }
  catch { outcome = {kind:'unknown',reason:'ADAPTER_INVOCATION_UNCERTAIN',evidence:{mode:'DEMO'}}; }
  await transaction(async client => {
    if (!(await leaseHeld(client,job))) return;
    const query = scoped(client,ctx);
    const op = await getOperation(client,ctx,operationId,true);
    if (!op || (kind === 'EXECUTE' ? op.status !== 'DISPATCHING' : op.status !== 'UNKNOWN')) return;
    const status = await applyOutcome(client,ctx,op,outcome);
    await query(`
      UPDATE operation_attempts SET status=$4,evidence=$5,ended_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [claimed.attemptId,status,{source:outcome.evidence?.source ?? 'PLATFORM',kind:outcome.kind}]);
  });
}

export async function expireOperationJob(client,ctx,job) {
  const op = await getOperation(client,ctx,job.payload.operationId,true);
  if (!op) return 'COMPLETED';
  if (job.job_type === 'EXECUTE_OPERATION' && ['DISPATCHING','SENT','UNKNOWN'].includes(op.status)) {
    if (op.status !== 'UNKNOWN') await applyOutcome(client,ctx,op,{kind:'unknown',reason:'DISPATCH_LEASE_EXPIRED',evidence:{sent:'POSSIBLE'}});
    await scoped(client,ctx)(`
      UPDATE operation_attempts SET status='UNKNOWN',ended_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND status='RUNNING'
    `, [op.id]);
    return 'QUERY_REQUIRED';
  }
  if (job.job_type === 'QUERY_OPERATION') {
    await scoped(client,ctx)(`
      UPDATE operation_attempts SET status='UNKNOWN',ended_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND kind='QUERY' AND status='RUNNING'
    `, [op.id]);
    return op.status === 'UNKNOWN' ? 'PENDING' : 'COMPLETED';
  }
  return op.status === 'CREATED' ? 'PENDING' : 'COMPLETED';
}
