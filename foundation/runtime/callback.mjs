import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {audit, fail, transaction} from '../db.mjs';
import {insertEvent} from './adapters.mjs';
import {callbackSecret, equalBytes, openCase, validId} from './shared.mjs';

const schema = z.strictObject({
  eventId:z.string().min(1).max(160),
  eventType:z.string().min(1).max(140),
  aggregateId:z.string().min(1).max(160),
  version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  occurredAt:z.iso.datetime({offset:true}),
  data:z.record(z.string(),z.unknown()),
});
const eventTypes = {
  'demo-library':['library.reservation.ready'],
  'demo-energy':['energy.session.started','energy.session.ended','energy.meter.final'],
  'demo-locker':['parcel.collected'],
};
const allowedData = {
  'library.reservation.ready':['reservationId','bookId'],
  'energy.session.started':['sessionId','meterId','epoch','value','unit'],
  'energy.session.ended':['sessionId','meterId','epoch','value','unit'],
  'energy.meter.final':['sessionId','meterId','epoch','value','unit'],
  'parcel.collected':['pickupId'],
};

function header(headers,name) {
  return typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
}

export async function receiveCallback(connectionId,raw,headers,requestId) {
  if (process.env.APP_MODE !== 'demo') fail(503,'NOT_CONNECTED','真实外部回调尚未接入');
  validId(connectionId);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (!bytes.length || bytes.length > 65536) fail(422,'INVALID_EVENT','回调正文大小无效');
  const timestamp = header(headers,'x-campus-timestamp');
  const signature = header(headers,'x-campus-signature');
  const given = typeof signature === 'string' ? signature.replace(/^sha256=/,'') : undefined;
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)*1000) > 300000
    || typeof given !== 'string' || !/^[0-9a-f]{64}$/i.test(given)) fail(401,'EVENT_SIGNATURE_INVALID','回调签名无效');
  const result = await transaction(async client => {
    // Connection id is an unguessable callback selector. Its trusted school and environment establish scope after verification.
    const {rows:[connection]} = await client.query(`
      SELECT c.id,c.school_id,c.environment_id,c.secret_ref,c.authorization_expires_at,p.code AS package_code
      FROM connections c JOIN adapter_packages p ON p.id=c.adapter_package_id
      JOIN environments e ON e.school_id=c.school_id AND e.id=c.environment_id
      WHERE c.id=$1 AND c.mode='DEMO' AND c.status='ACTIVE' AND e.mode='DEMO' AND e.status='ACTIVE'
    `, [connectionId]);
    const secret = callbackSecret(connection?.secret_ref);
    if (!secret || (connection.authorization_expires_at && connection.authorization_expires_at <= new Date())) {
      fail(401,'EVENT_SIGNATURE_INVALID','回调签名无效');
    }
    const expected = createHmac('sha256',secret).update(timestamp+'.').update(bytes).digest('hex');
    if (!equalBytes(expected,given.toLowerCase())) fail(401,'EVENT_SIGNATURE_INVALID','回调签名无效');
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); }
    catch { fail(422,'INVALID_EVENT','回调 JSON 无效'); }
    const checked = schema.safeParse(data);
    if (!checked.success || !eventTypes[connection.package_code]?.includes(checked.data.eventType)
      || Object.entries(checked.data.data).some(([key,value]) => !allowedData[checked.data.eventType].includes(key)
        || typeof value !== 'string' || value.length > 160)) fail(422,'INVALID_EVENT','回调字段或事件类型无效');
    const ctx = {schoolId:connection.school_id,environmentId:connection.environment_id,userId:null,role:'SYSTEM',scopes:[],requestId};
    const event = await insertEvent(client,ctx,connection.id,checked.data);
    if (event.conflict) {
      await openCase(client,ctx,{category:'EVENT_ID_CONFLICT',reason:'同一外部事件编号重复提交了不同内容'});
    } else if (!event.duplicate) {
      await audit(client,ctx,{action:'CALLBACK_ACCEPTED',type:'InboxEvent',id:event.id});
    }
    return event;
  });
  if (result.conflict) fail(409,'EVENT_ID_CONFLICT','外部事件编号已用于不同内容');
  return {status:202,data:{eventId:result.id,duplicate:result.duplicate}};
}
