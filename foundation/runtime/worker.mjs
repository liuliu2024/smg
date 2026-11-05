import {randomUUID} from 'node:crypto';
import {audit, enqueue, scoped, transaction} from '../db.mjs';
import {insertEvent} from './adapters.mjs';
import {matchEvent, processInbox} from './events.mjs';
import {advance,getInstance,nodeTimeout,setWaiting} from './flow.mjs';
import {executeOperationJob,expireOperationJob,leaseHeld} from './operations.mjs';
import {openCase} from './shared.mjs';

const knownTypes = ['INSTANCE_TICK','EXECUTE_OPERATION','QUERY_OPERATION','NODE_TIMEOUT',
  'PROCESS_EVENT','MATCH_EVENT','DEMO_EMIT_EVENT','AUDIT_OUTBOX'];

function workerContext(row) {
  return {schoolId:row.school_id,environmentId:row.environment_id,userId:null,role:'SYSTEM',scopes:[],requestId:randomUUID()};
}

async function recoverExpired(client,types) {
  const {rows:[job]} = await client.query(`
    SELECT * FROM jobs WHERE status='RUNNING' AND lease_until<=now() AND job_type=ANY($1::text[])
    ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 1
  `, [types]);
  if (!job) return;
  const ctx = workerContext(job);
  const query = scoped(client,ctx);
  const result = ['EXECUTE_OPERATION','QUERY_OPERATION'].includes(job.job_type)
    ? await expireOperationJob(client,ctx,job) : 'PENDING';
  const status = result === 'QUERY_REQUIRED' ? 'COMPLETED'
    : result === 'PENDING' && job.attempts >= job.max_attempts ? 'FAILED' : result;
  await query(`
    UPDATE jobs SET status=$4,locked_by=NULL,lease_until=NULL,last_error='WORKER_LEASE_EXPIRED'
    WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [job.id,status]);
  if (result === 'QUERY_REQUIRED') {
    const operationId = job.payload.operationId;
    await enqueue(client,ctx,{type:'QUERY_OPERATION',key:'recovery-query:' + operationId,payload:{operationId}});
  }
}

async function dispatchOutbox(client) {
  const {rows:[event]} = await client.query(`
    SELECT id,school_id,environment_id FROM outbox WHERE dispatched_at IS NULL
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  `);
  if (!event) return;
  const ctx = workerContext(event);
  await enqueue(client,ctx,{type:'AUDIT_OUTBOX',key:'outbox:' + event.id,payload:{eventId:event.id}});
  await scoped(client,ctx)(`
    UPDATE outbox SET dispatched_at=now() WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [event.id]);
}

async function claim(client, workerId, types) {
  await recoverExpired(client,types);
  await dispatchOutbox(client);
  const {rows:[job]} = await client.query(`
    WITH next_job AS (
      SELECT j.id FROM jobs j WHERE j.status='PENDING' AND j.run_at<=now() AND j.attempts<j.max_attempts
        AND j.job_type=ANY($1::text[])
      ORDER BY j.run_at,j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE jobs j SET status='RUNNING',locked_by=$2,locked_at=now(),
      lease_until=now()+interval '60 seconds',attempts=j.attempts+1
    FROM next_job WHERE j.id=next_job.id RETURNING j.*
  `, [types,workerId]);
  return job;
}

async function finishJob(client,ctx,job,error) {
  if (!(await leaseHeld(client,job))) return;
  const query = scoped(client,ctx);
  let status = !error ? 'COMPLETED' : job.attempts >= job.max_attempts ? 'FAILED' : 'PENDING';
  if (error && ['EXECUTE_OPERATION','QUERY_OPERATION'].includes(job.job_type)) {
    const recovery = await expireOperationJob(client,ctx,job);
    if (recovery === 'QUERY_REQUIRED') {
      const {operationId} = job.payload;
      await enqueue(client,ctx,{type:'QUERY_OPERATION',key:'recovery-query:' + operationId,payload:{operationId}});
      status = 'COMPLETED';
    } else if (recovery === 'COMPLETED') status = 'COMPLETED';
  }
  const runAt = new Date(Date.now()+[1000,5000,15000][Math.min(job.attempts-1,2)]);
  await query(`
    UPDATE jobs SET status=$4,locked_by=NULL,lease_until=NULL,last_error=$5,run_at=$6
    WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [job.id,status,error ? (/^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'HANDLER_ERROR') : null,runAt]);
  if (status === 'FAILED') {
    await audit(client,ctx,{action:'JOB_FAILED',type:'Job',id:job.id,outcome:'FAILURE',metadata:{type:job.job_type}});
    if (job.job_type === 'INSTANCE_TICK') {
      const instance = await getInstance(client,ctx,job.payload.instanceId,true);
      if (instance?.status === 'RUNNING') {
        await setWaiting(client,ctx,instance.id,'INCIDENT');
        await openCase(client,ctx,{instanceId:instance.id,category:'WORKFLOW_STEP_FAILED',reason:'流程步骤配置或依赖未满足'});
      }
    }
  }
}

async function localJob(client,ctx,job) {
  if (job.job_type === 'INSTANCE_TICK') {
    return advance(client,ctx,await getInstance(client,ctx,job.payload.instanceId,true));
  }
  if (job.job_type === 'NODE_TIMEOUT') return nodeTimeout(client,ctx,job.payload);
  if (job.job_type === 'PROCESS_EVENT') return processInbox(client,ctx,job.payload.eventId);
  if (job.job_type === 'MATCH_EVENT') return matchEvent(client,ctx,job.payload.eventId);
  if (job.job_type === 'DEMO_EMIT_EVENT') return insertEvent(client,ctx,job.payload.connectionId,job.payload.event);
  if (job.job_type === 'AUDIT_OUTBOX') {
    const {rows:[event]} = await scoped(client,ctx)(`
      SELECT event_type,payload FROM outbox WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [job.payload.eventId]);
    if (event) await audit(client,ctx,{action:'OUTBOX_DELIVERED_LOCAL',type:'OutboxEvent',id:job.payload.eventId,
      metadata:{eventType:event.event_type,operationId:event.payload.operationId}});
  }
}

export async function tickWorker(workerId, handlers = {}) {
  if (typeof workerId !== 'string' || !workerId || workerId.length > 100) throw Error('Invalid WORKER_ID');
  const types = [...knownTypes,...Object.keys(handlers).filter(type => !knownTypes.includes(type))];
  const job = await transaction(client => claim(client,workerId,types));
  if (!job) return false;
  const ctx = workerContext(job);
  let error;
  let renewal;
  try {
    if (job.job_type === 'EXECUTE_OPERATION' || job.job_type === 'QUERY_OPERATION' || handlers[job.job_type]) {
      renewal = setInterval(() => transaction(async client => {
        if (!(await leaseHeld(client,job))) return;
        await scoped(client,ctx)(`
          UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE school_id=$1 AND environment_id=$2 AND id=$3
        `,[job.id]);
      }).catch(() => {}),20000);
      renewal.unref();
      if (job.job_type === 'EXECUTE_OPERATION') await executeOperationJob(ctx,job,'EXECUTE');
      else if (job.job_type === 'QUERY_OPERATION') await executeOperationJob(ctx,job,'QUERY');
      else await handlers[job.job_type](job,ctx);
    } else {
      await transaction(async client => {
        if (!(await leaseHeld(client,job))) return;
        await localJob(client,ctx,job);
        await finishJob(client,ctx,job);
      });
      return true;
    }
  } catch (cause) { error = cause; }
  finally { clearInterval(renewal); }
  await transaction(client => finishJob(client,ctx,job,error));
  return true;
}
