import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {audit, digest, fail, scoped} from '../db.mjs';
import {schemaErrors} from './dsl.mjs';

export const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail(404, 'NOT_FOUND', '记录不存在');
  return value;
}

export function validate(schema, value) {
  const errors = schemaErrors(schema, value);
  if (errors.length) fail(422, 'INVALID_INPUT', '请检查提交字段', errors);
}

export function requireRole(ctx, ...roles) {
  if (!roles.includes(ctx.role)) fail(403, 'FORBIDDEN', '当前岗位没有此操作权限');
}

export function inScope(ctx, type, id) {
  return ctx.scopes?.some(scope => (scope.type === 'SCHOOL' && scope.id === '*')
    || (scope.type === type && scope.id === String(id)));
}

export function exactKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
    fail(422, 'IDEMPOTENCY_KEY_REQUIRED', '请提供有效的 Idempotency-Key');
  }
}

export async function once(client, ctx, operation, key, body, callback) {
  exactKey(key);
  const query = scoped(client, ctx);
  const lock = [ctx.schoolId,ctx.environmentId,ctx.userId,operation,key].join(':');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lock]);
  const params = [ctx.userId, operation, key];
  const {rows:[prior]} = await query(`
    SELECT request_hash, response_code, response_body, expires_at
    FROM idempotency_records
    WHERE school_id=$1 AND environment_id=$2 AND user_id=$3 AND operation_name=$4 AND key=$5
  `, params);
  const hash = digest(body);
  if (prior && prior.expires_at > new Date()) {
    if (prior.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他提交内容');
    return {status:prior.response_code,data:prior.response_body};
  }
  if (prior) await query(`
    DELETE FROM idempotency_records WHERE school_id=$1 AND environment_id=$2
      AND user_id=$3 AND operation_name=$4 AND key=$5
  `, params);
  const result = await callback();
  await query(`
    INSERT INTO idempotency_records(id,school_id,environment_id,user_id,operation_name,key,request_hash,response_code,response_body,expires_at)
    VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,now()+interval '24 hours')
  `, [randomUUID(),...params,hash,result.status ?? 200,JSON.stringify(result.data)]);
  return result;
}

export function equalBytes(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function callbackSecret(reference) {
  if (typeof reference !== 'string' || !/^FOUNDATION_CALLBACK_[A-Z0-9_]+$/.test(reference)) return;
  const allowlist = (process.env.ADAPTER_SECRET_ALLOWLIST ?? '').split(',').map(name => name.trim());
  const secret = allowlist.includes(reference) ? process.env[reference] : undefined;
  return secret?.length >= 32 ? secret : undefined;
}

export function parcelToken(ctx, id) {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) fail(503, 'DEMO_KEY_MISSING', '尚未配置演示凭证密钥');
  return createHmac('sha256', secret).update([ctx.schoolId,ctx.environmentId,ctx.userId,id].join(':')).digest('base64url');
}

export async function openCase(client, ctx, {operationId = null, instanceId = null, category, reason}) {
  const query = scoped(client, ctx);
  const {rows:[created]} = await query(`
    INSERT INTO cases(id,school_id,environment_id,operation_id,instance_id,category,assigned_role,reason)
    VALUES($3,$1,$2,$4,$5,$6,'OPERATOR',$7)
    ON CONFLICT DO NOTHING RETURNING id
  `, [randomUUID(),operationId,instanceId,category,reason]);
  if (created) await audit(client, ctx, {action:'CASE_OPENED',type:'Case',id:created.id,metadata:{category}});
  return created;
}

export const demoTariff = Object.freeze({
  mode:'DEMO', currency:'CNY', electricityPerKwh:'0.60', servicePerKwh:'0.20',
});

export function eventLock(client,ctx,type,key) {
  const name = ['event',ctx.schoolId,ctx.environmentId,type,key].join(':');
  return client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [name]);
}
