import {randomUUID} from 'node:crypto';
import {audit, digest, enqueue, scoped, transaction} from '../db.mjs';
import {currentBinding} from './flow.mjs';
import {demoTariff} from './shared.mjs';

export async function seedRuntime(client, ctx) {
  const query = scoped(client, ctx);
  await query(`
    INSERT INTO demo_library_titles(id,school_id,environment_id,code,title,available)
    VALUES($3,$1,$2,'demo-book','校园图书馆演示藏书',1)
    ON CONFLICT(school_id,environment_id,code) DO NOTHING
  `, [randomUUID()]);
  await client.query(`
    INSERT INTO identity_mappings(id,school_id,user_id,provider,subject)
    VALUES($1,$2,$3,'demo-library',$4)
    ON CONFLICT(school_id,provider,subject) DO NOTHING
  `, [randomUUID(),ctx.schoolId,ctx.userId,'demo-reader-' + ctx.userId]);
  for (const [code,type,authority,config] of [
    ['DEMO-PORT-01','CHARGE_PORT','demo-energy',{label:'演示充电端口',meterId:'meter-01',mode:'DEMO'}],
    ['DEMO-LOCKER-01','LOCKER_COMPARTMENT','demo-locker',{label:'演示取件格口',mode:'DEMO'}],
  ]) {
    await query(`
      INSERT INTO resources(id,school_id,environment_id,code,resource_type,authority,config)
      VALUES($3,$1,$2,$4,$5,$6,$7)
      ON CONFLICT(school_id,environment_id,code) DO NOTHING
    `, [randomUUID(),code,type,authority,config]);
  }
  const {rows:[locker]} = await query(`
    SELECT id FROM resources WHERE school_id=$1 AND environment_id=$2 AND code='DEMO-LOCKER-01'
  `);
  await query(`
    INSERT INTO demo_parcel_pickups(id,school_id,environment_id,resource_id,user_id,parcel_code,status)
    VALUES($3,$1,$2,$4,$5,'DEMO-PARCEL-01','ELIGIBLE')
    ON CONFLICT(school_id,environment_id,parcel_code) DO NOTHING
  `, [randomUUID(),locker.id,ctx.userId]);
}

export async function insertEvent(client, ctx, connectionId, event) {
  const query = scoped(client, ctx);
  const hash = digest(event);
  const {rows:[row]} = await query(`
    INSERT INTO event_inbox(id,school_id,environment_id,connection_id,external_event_id,event_type,aggregate_id,aggregate_version,payload,payload_hash,occurred_at)
    VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(school_id,environment_id,connection_id,external_event_id) DO NOTHING RETURNING id
  `, [randomUUID(),connectionId,event.eventId,event.eventType,event.aggregateId,event.version ?? null,event,hash,event.occurredAt]);
  if (row) {
    await enqueue(client,ctx,{type:'PROCESS_EVENT',key:'inbox:' + row.id,payload:{eventId:row.id}});
    return {id:row.id, duplicate:false};
  }
  const {rows:[existing]} = await query(`
    SELECT id,payload_hash FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND connection_id=$3 AND external_event_id=$4
  `, [connectionId,event.eventId]);
  if (existing.payload_hash !== hash) {
    await audit(client,ctx,{action:'EVENT_ID_CONFLICT',type:'InboxEvent',id:existing.id,outcome:'REJECTED'});
    return {id:existing.id,conflict:true};
  }
  return {id:existing.id,duplicate:true};
}

function success(data) {
  return {kind:'success',data,evidence:{source:'SIMULATED_AUTHORITY',mode:'DEMO'}};
}
function rejected(code) {
  return {kind:'rejected',code,evidence:{source:'SIMULATED_AUTHORITY',mode:'DEMO'}};
}
function unknown(reason) {
  return {kind:'unknown',reason,evidence:{source:'SIMULATED_AUTHORITY',mode:'DEMO'}};
}
function eventFor(op, eventType, aggregateId, version, data, suffix = '') {
  return {eventId:op.id + ':' + eventType + suffix,eventType,aggregateId,version,occurredAt:new Date().toISOString(),data};
}

async function executeLibrary(client, ctx, op) {
  const query = scoped(client,ctx);
  const {bookId,subjectId,fault} = op.request;
  if (fault === 'BUSINESS_REJECT') return rejected('DEMO_READER_INELIGIBLE');
  const {rows:[reader]} = await client.query(`
    SELECT id FROM identity_mappings WHERE school_id=$1 AND user_id=$2
      AND provider='demo-library' AND subject=$3 AND status='ACTIVE'
  `, [ctx.schoolId,op.subject_user_id,subjectId]);
  if (!reader) return rejected('READER_MAPPING_MISSING');
  const {rowCount} = await query(`
    UPDATE demo_library_titles SET available=available-1
    WHERE school_id=$1 AND environment_id=$2 AND code=$3 AND available>0
  `, [bookId]);
  if (!rowCount) return rejected('BOOK_UNAVAILABLE');
  const reservationId = randomUUID();
  if (['DUPLICATE_CALLBACK','OUT_OF_ORDER'].includes(fault)) {
    const connectionId = op.binding_snapshot.connectionId;
    const event = eventFor(op,'library.reservation.ready',reservationId,2,{reservationId,bookId});
    await insertEvent(client,ctx,connectionId,event);
    if (fault === 'DUPLICATE_CALLBACK') await insertEvent(client,ctx,connectionId,event);
    else {
      const stale = {...event,eventId:event.eventId+':stale',version:1};
      await enqueue(client,ctx,{type:'DEMO_EMIT_EVENT',key:'library-stale:'+op.id,payload:{connectionId,event:stale},runAt:new Date(Date.now()+200)});
    }
  }
  return success({reservationId,bookId,state:'RESERVED'});
}

async function executeEnergy(client, ctx, op) {
  const query = scoped(client,ctx);
  const start = op.action_code === 'energy.session.start';
  const {rows:[session]} = await query(`
    SELECT ds.id,ds.resource_id,ds.external_session_id,ds.started_at,r.config
    FROM device_sessions ds
    JOIN resources r ON r.school_id=ds.school_id AND r.environment_id=ds.environment_id AND r.id=ds.resource_id
    WHERE ds.school_id=$1 AND ds.environment_id=$2
      AND (CASE WHEN $4::boolean THEN ds.start_operation_id ELSE ds.stop_operation_id END)=$3
  `, [op.id,start]);
  if (!session) return rejected('SESSION_NOT_FOUND');
  const externalSessionId = session.external_session_id ?? session.id;
  const result = success({externalSessionId,accepted:true});
  const {fault} = op.request;
  const connectionId = op.binding_snapshot.connectionId;
  const meterId = session.config.meterId;
  if (start && fault !== 'ACK_ONLY') {
    const event = eventFor(op,'energy.session.started',externalSessionId,1,{sessionId:session.id,meterId,epoch:'epoch-1',value:'1.000',unit:'kWh'});
    await insertEvent(client,ctx,connectionId,event);
    if (fault === 'DUPLICATE_EVENT') await insertEvent(client,ctx,connectionId,event);
  }
  if (!start && fault !== 'STOP_UNKNOWN') {
    const end = eventFor(op,'energy.session.ended',externalSessionId,2,{sessionId:session.id,
      meterId,epoch:fault === 'METER_RESET' ? 'epoch-2' : 'epoch-1',
      ...(fault === 'FINAL_READING_LATE' ? {} : {value:'2.200',unit:'kWh'})});
    await insertEvent(client,ctx,connectionId,end);
    if (fault === 'DUPLICATE_EVENT') await insertEvent(client,ctx,connectionId,end);
    if (fault === 'FINAL_READING_LATE') {
      const meter = eventFor(op,'energy.meter.final',externalSessionId,3,{sessionId:session.id,meterId,epoch:'epoch-1',value:'2.200',unit:'kWh'});
      await enqueue(client,ctx,{type:'DEMO_EMIT_EVENT',key:'demo-late:' + op.id,payload:{connectionId,event:meter},runAt:new Date(Date.now()+2000)});
    }
  }
  return !start && fault === 'STOP_UNKNOWN' ? unknown('DEMO_STOP_NOT_VERIFIABLE') : result;
}

async function executeLocker(client, ctx, op) {
  const query = scoped(client,ctx);
  const {pickupId,fault} = op.request;
  if (fault === 'WRONG_COMPARTMENT') return rejected('DEMO_COMPARTMENT_MISMATCH');
  const {rows:[pickup]} = await query(`
    SELECT id,status FROM demo_parcel_pickups WHERE school_id=$1 AND environment_id=$2
      AND id=$3 AND operation_id=$4 FOR UPDATE
  `, [pickupId,op.id]);
  if (!pickup || pickup.status !== 'UNLOCK_PENDING') return rejected('PICKUP_NOT_ELIGIBLE');
  if (fault !== 'OPEN_NO_COLLECTION') {
    const event = eventFor(op,'parcel.collected',pickupId,1,{pickupId});
    await insertEvent(client,ctx,op.binding_snapshot.connectionId,event);
    if (fault === 'DUPLICATE_HANDOVER') await insertEvent(client,ctx,op.binding_snapshot.connectionId,event);
  }
  return success({pickupId,state:'OPEN_CONFIRMED'});
}

const staticHandlers = {
  'demo-library':{'library.reservation.create':executeLibrary},
  'demo-energy':{'energy.session.start':executeEnergy,'energy.session.stop':executeEnergy},
  'demo-locker':{'parcel.compartment.unlock':executeLocker},
};
export function adapterRegistered(packageCode, version, action) {
  return version === '1.0.0' && Object.hasOwn(staticHandlers,packageCode)
    && Object.hasOwn(staticHandlers[packageCode],action);
}

export async function invokeAdapter(ctx, op, kind) {
  const snapshot = op.binding_snapshot;
  if (!adapterRegistered(snapshot.packageCode,snapshot.packageVersion,op.action_code)) {
    return {kind:'not_executed',reason:'DEMO_ADAPTER_NOT_REGISTERED',evidence:{mode:'DEMO'}};
  }
  const outcome = await transaction(async client => {
    const query = scoped(client,ctx);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['simulator-operation:' + op.id]);
    if (!(await currentBinding(client,ctx,snapshot,true))) {
      return kind === 'QUERY' ? unknown('CONNECTION_REVOKED_DURING_QUERY')
        : {kind:'not_executed',reason:'CONNECTION_REVOKED_UNSENT',evidence:{sent:false}};
    }
    const {rows:[existing]} = await query(`
      SELECT outcome FROM demo_adapter_receipts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3
    `, [op.id]);
    if (existing) return existing.outcome;
    if (kind === 'QUERY') return unknown('DEMO_NO_AUTHORITY_RECEIPT');
    const handler = staticHandlers[snapshot.packageCode][op.action_code];
    const result = await handler(client,ctx,op);
    await query(`
      INSERT INTO demo_adapter_receipts(id,school_id,environment_id,operation_id,action_code,outcome)
      VALUES($3,$1,$2,$4,$5,$6)
    `, [randomUUID(),op.id,op.action_code,result]);
    return result;
  });
  if (kind === 'EXECUTE' && outcome.kind === 'success'
    && ['TIMEOUT_AFTER_COMMIT','STARTED_RESPONSE_LOST','OPEN_RESPONSE_LOST'].includes(op.request.fault)) {
    return unknown('DEMO_RESPONSE_LOST_AFTER_COMMIT');
  }
  return outcome;
}
export { demoTariff };
