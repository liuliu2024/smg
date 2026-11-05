import Decimal from 'decimal.js';
import {randomUUID} from 'node:crypto';
import {audit, enqueue, scoped} from '../db.mjs';
import {getInstance, matchSubscription} from './flow.mjs';
import {eventLock,openCase,uuidPattern} from './shared.mjs';


function validMeter(data) {
  return typeof data.meterId === 'string' && data.meterId.length > 0 && data.meterId.length <= 100
    && typeof data.epoch === 'string' && data.epoch.length > 0 && data.epoch.length <= 100
    && typeof data.value === 'string' && /^\d{1,12}(\.\d{1,6})?$/.test(data.value)
    && ['Wh','kWh'].includes(data.unit);
}

async function saveReading(client,ctx,session,event,kind) {
  const data = event.payload.data;
  if (!validMeter(data) || data.meterId !== session.resource_config?.meterId) return;
  const value = new Decimal(data.value).mul(data.unit === 'kWh' ? 1000 : 1).toFixed();
  await scoped(client,ctx)(`
    INSERT INTO meter_readings(id,school_id,environment_id,resource_id,session_id,meter_id,meter_epoch,measurand,
      value,unit,sampled_at,source_sequence,source_event_id,evidence)
    VALUES($3,$1,$2,$4,$5,$6,$7,'ENERGY_IMPORT_TOTAL',$8,'Wh',$9,$10,$11,$12)
    ON CONFLICT DO NOTHING
  `, [randomUUID(),session.resource_id,session.id,data.meterId,data.epoch,value,event.occurred_at,event.aggregate_version,
    event.external_event_id,{mode:'DEMO',kind,originalUnit:data.unit,originalValue:data.value,inboxId:event.id}]);
}

async function calculateBill(client,ctx,session,operationId) {
  const query = scoped(client,ctx);
  const {rows:readings} = await query(`
    SELECT id,meter_id,meter_epoch,value,evidence FROM meter_readings
    WHERE school_id=$1 AND environment_id=$2 AND session_id=$3 ORDER BY sampled_at,received_at,id
  `, [session.id]);
  const {rows:[prior]} = await query(`
    SELECT id,revision,status FROM bills WHERE school_id=$1 AND environment_id=$2 AND session_id=$3
    ORDER BY revision DESC LIMIT 1
  `, [session.id]);
  if (prior?.status === 'CONFIRMED') return;
  const initial = readings.find(row => row.evidence.kind === 'START');
  const final = readings.findLast(row => row.evidence.kind === 'FINAL');
  const delta = initial && final && initial.meter_id === final.meter_id && initial.meter_epoch === final.meter_epoch
    ? new Decimal(final.value).sub(initial.value) : null;
  const confirmed = delta !== null && delta.gte(0);
  if (prior?.status === 'PENDING_EVIDENCE' && !confirmed) return;
  const electricityMinor = confirmed ? delta.mul(session.tariff_snapshot.electricityPerKwh).div(10).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toNumber() : null;
  const serviceMinor = confirmed ? delta.mul(session.tariff_snapshot.servicePerKwh).div(10).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toNumber() : null;
  const id = randomUUID();
  await query(`
    INSERT INTO bills(id,school_id,environment_id,session_id,revision,status,components,amount_minor,evidence_refs,supersedes_id)
    VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10)
  `, [id,session.id,(prior?.revision ?? 0)+1,confirmed ? 'CONFIRMED' : 'PENDING_EVIDENCE',
    {mode:'DEMO',electricityMinor,serviceMinor,energyWh:confirmed ? delta.toFixed() : null},
    confirmed ? electricityMinor+serviceMinor : null,JSON.stringify([initial?.id,final?.id].filter(Boolean)),prior?.id ?? null]);
  if (!confirmed) {
    await openCase(client,ctx,{operationId,category:'ENERGY_METER_EVIDENCE',reason:'缺少有效最终读数或读数不属于同一计量周期'});
  }
  await audit(client,ctx,{action:'DEMO_BILL_RECORDED',type:'Bill',id,metadata:{status:confirmed ? 'CONFIRMED' : 'PENDING_EVIDENCE'}});
}

async function energyEvent(client,ctx,event) {
  const query = scoped(client,ctx);
  const data = event.payload.data;
  if (!uuidPattern.test(data.sessionId ?? '')) return false;
  const starting = event.event_type === 'energy.session.started';
  const ending = event.event_type === 'energy.session.ended';
  const opColumn = starting ? 'start_operation_id' : 'stop_operation_id';
  const {rows:[session]} = await query(`
    SELECT ds.*,o.id AS operation_id,r.config AS resource_config
    FROM device_sessions ds
    JOIN operations o ON o.school_id=ds.school_id AND o.environment_id=ds.environment_id AND o.id=ds.${opColumn}
    JOIN resources r ON r.school_id=ds.school_id AND r.environment_id=ds.environment_id AND r.id=ds.resource_id
    WHERE ds.school_id=$1 AND ds.environment_id=$2 AND ds.id=$3
      AND o.binding_snapshot->>'connectionId'=$4 AND o.status IN ('DISPATCHING','SENT','SUCCEEDED','UNKNOWN')
    FOR UPDATE OF ds
  `, [data.sessionId,event.connection_id]);
  if (!session || event.aggregate_id !== (session.external_session_id ?? session.id)
    || (session.last_authority_at && event.occurred_at < session.last_authority_at)) return false;
  const {rows:[higher]} = await query(`
    SELECT id FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND connection_id=$3 AND aggregate_id=$4
      AND status='PROCESSED' AND aggregate_version >= $5 LIMIT 1
  `, [event.connection_id,event.aggregate_id,event.aggregate_version]);
  if (higher) return false;

  if (starting) {
    if (!['REQUESTED','STARTING'].includes(session.domain_state)) return false;
    await saveReading(client,ctx,session,event,'START');
    await query(`
      UPDATE device_sessions SET domain_state='ACTIVE',observation_state='CURRENT',external_session_id=$4,
        started_at=$5,last_authority_at=$5,version=version+1 WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [session.id,event.aggregate_id,event.occurred_at]);
    return true;
  }
  if (ending) {
    if (session.domain_state !== 'STOPPING') return false;
    await saveReading(client,ctx,session,event,'FINAL');
    await query(`
      UPDATE device_sessions SET domain_state='ENDED',observation_state='CURRENT',ended_at=$4,
        last_authority_at=$4,version=version+1 WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [session.id,event.occurred_at]);
    await query("UPDATE resources SET status='AVAILABLE' WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='BUSY'", [session.resource_id]);
    await calculateBill(client,ctx,session,session.operation_id);
    return true;
  }
  if (session.domain_state !== 'ENDED' || !validMeter(data)) return false;
  await saveReading(client,ctx,session,event,'FINAL');
  await calculateBill(client,ctx,session,session.operation_id);
  return true;
}

async function parcelEvent(client,ctx,event) {
  const query = scoped(client,ctx);
  const pickupId = event.payload.data.pickupId;
  if (!uuidPattern.test(pickupId ?? '') || pickupId !== event.aggregate_id) return false;
  const {rowCount} = await query(`
    UPDATE demo_parcel_pickups p SET status='COLLECTED'
    FROM operations o JOIN demo_adapter_receipts receipt ON receipt.school_id=o.school_id
      AND receipt.environment_id=o.environment_id AND receipt.operation_id=o.id
    WHERE p.school_id=$1 AND p.environment_id=$2 AND p.id=$3 AND p.status IN ('UNLOCK_PENDING','OPEN_CONFIRMED')
      AND o.school_id=p.school_id AND o.environment_id=p.environment_id AND o.id=p.operation_id
      AND o.binding_snapshot->>'connectionId'=$4 AND receipt.outcome->>'kind'='success'
  `, [pickupId,event.connection_id]);
  return Boolean(rowCount);
}

async function libraryEvent(client,ctx,event) {
  const {rowCount} = await scoped(client,ctx)(`
    SELECT r.id FROM demo_adapter_receipts r JOIN operations o ON o.school_id=r.school_id
      AND o.environment_id=r.environment_id AND o.id=r.operation_id
    WHERE r.school_id=$1 AND r.environment_id=$2 AND r.action_code='library.reservation.create'
      AND r.outcome->'data'->>'reservationId'=$3 AND o.binding_snapshot->>'connectionId'=$4
      AND NOT EXISTS (SELECT 1 FROM event_inbox e WHERE e.school_id=$1 AND e.environment_id=$2
        AND e.connection_id=$4::uuid AND e.aggregate_id=$3 AND e.status='PROCESSED' AND e.aggregate_version >= $5)
  `, [event.aggregate_id,event.connection_id,event.aggregate_version]);
  return Boolean(rowCount);
}

export async function processInbox(client,ctx,eventId) {
  const query = scoped(client,ctx);
  const {rows:[event]} = await query(`
    SELECT * FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND id=$3 FOR UPDATE
  `, [eventId]);
  if (!event || event.status !== 'RECEIVED') return;
  await eventLock(client,ctx,event.event_type,event.aggregate_id);
  let accepted = false;
  if (event.event_type.startsWith('energy.')) accepted = await energyEvent(client,ctx,event);
  if (event.event_type === 'parcel.collected') accepted = await parcelEvent(client,ctx,event);
  if (event.event_type === 'library.reservation.ready') accepted = await libraryEvent(client,ctx,event);
  await query(`
    UPDATE event_inbox SET status=$4,error=$5 WHERE school_id=$1 AND environment_id=$2 AND id=$3
  `, [event.id,accepted ? 'PROCESSED' : 'IGNORED',accepted ? null : '不满足关联、顺序或领域状态约束']);
  if (accepted) await enqueue(client,ctx,{type:'MATCH_EVENT',key:'match:' + event.id,payload:{eventId:event.id}});
  await audit(client,ctx,{action:'EVENT_PROCESSED',type:'InboxEvent',id:event.id,outcome:accepted ? 'SUCCESS' : 'IGNORED',
    metadata:{eventType:event.event_type}});
}

export async function matchEvent(client,ctx,eventId) {
  const query = scoped(client,ctx);
  const {rows:[event]} = await query(`
    SELECT * FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='PROCESSED'
  `, [eventId]);
  if (!event) return;
  const {rows:subscriptions} = await query(`
    SELECT s.*,n.node_id FROM event_subscriptions s JOIN node_executions n
      ON n.school_id=s.school_id AND n.environment_id=s.environment_id AND n.id=s.node_execution_id
    WHERE s.school_id=$1 AND s.environment_id=$2 AND s.status='WAITING' AND s.event_type=$3
      AND s.correlation_key=$4 AND s.deadline_at >= $5
    ORDER BY s.instance_id
  `, [event.event_type,event.aggregate_id,event.received_at]);
  for (const subscription of subscriptions) {
    const instance = await getInstance(client,ctx,subscription.instance_id,true);
    if (!instance || instance.status !== 'WAITING_EVENT' || instance.current_node !== subscription.node_id
      || event.occurred_at < instance.created_at) continue;
    const node = instance.definition.workflow.nodes.find(candidate => candidate.id === instance.current_node);
    await matchSubscription(client,ctx,instance,subscription,event,node);
  }
}
