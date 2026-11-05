import pg from 'pg';
import {createHash, randomUUID} from 'node:crypto';

let pool;
export function fail(status, code, message, fieldErrors) {
  throw Object.assign(new Error(message), {status, code, fieldErrors});
}
export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
function getPool() {
  if (!databaseConfigured()) fail(503, 'DATABASE_NOT_CONFIGURED', '尚未配置底座数据库');
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=campus_foundation',
    connectionTimeoutMillis: 4000,
    statement_timeout: 12000,
    max: 10
  });
  pool.on('error', error => {
    // An idle socket can fail during a database restart. Never print the attached client.
    console.error('Foundation database idle connection lost', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'CONNECTION_LOST');
  });
  return pool;
}

export async function transaction(work) {
  const client = await getPool().connect();
  let rollbackError;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(cause => {rollbackError = cause});
    throw error;
  } finally {
    client.release(rollbackError);
  }
}
export async function closeDatabase() {
  const current = pool;
  pool = undefined;
  await current?.end();
}

export function scoped(client, {schoolId, environmentId}) {
  if (!schoolId || !environmentId) throw new Error('School and environment context are required');
  return (sql, values = []) => client.query(sql, [schoolId, environmentId, ...values]);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const json = value => JSON.stringify(value);

export async function enqueue(client, ctx, {type, key, payload = {}, runAt = new Date(), maxAttempts = 3}) {
  const query = scoped(client, ctx);
  await query(`
    INSERT INTO jobs(id,school_id,environment_id,job_type,dedupe_key,payload,run_at,max_attempts)
    VALUES($3,$1,$2,$4,$5,$6,$7,$8)
    ON CONFLICT(school_id,environment_id,dedupe_key) DO NOTHING
  `, [randomUUID(), type, key, json(payload), runAt, maxAttempts]);
}

export async function audit(client, ctx, {action, type, id, outcome = 'SUCCESS', metadata = {}}) {
  await client.query(`
    INSERT INTO audit_logs(id,school_id,environment_id,actor_id,active_role,action,resource_type,resource_id,outcome,request_id,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [randomUUID(), ctx.schoolId, ctx.environmentId ?? null, ctx.userId ?? null,
    ctx.role ?? 'SYSTEM', action, type, id, outcome, ctx.requestId ?? randomUUID(), json(metadata)]);
}

export function requireRole(ctx, ...roles) {
  if (!roles.includes(ctx.role)) fail(403, 'FORBIDDEN', '当前岗位没有此操作权限');
}
export function hasScope(ctx, type, id) {
  return ctx.scopes.some(scope =>
    (scope.type === 'SCHOOL' && scope.id === '*') || (scope.type === type && scope.id === id));
}

export function requireVersion(expected, row) {
  if (expected === undefined) fail(428, 'VERSION_REQUIRED', '更新前请重新读取版本');
  if (expected !== row.version) fail(409, 'VERSION_CONFLICT', '记录已更新，请刷新后重试');
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    fail(404, 'NOT_FOUND', '记录不存在');
  }
  return value;
}
export function pageParams(url) {
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    fail(422, 'PAGINATION_INVALID', '分页参数无效');
  }
  return {page, pageSize, offset: (page - 1) * pageSize};
}
