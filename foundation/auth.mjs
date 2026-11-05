import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {audit, fail, transaction} from './db.mjs';

export const roles = [
  'SCHOOL_ADMIN', 'SERVICE_OWNER', 'INTEGRATOR', 'RELEASE_APPROVER', 'OPERATOR', 'AUDITOR', 'END_USER'
];
const cookieName = 'foundation_sid';
const loginBuckets = new Map();

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) fail(503, 'SESSION_NOT_CONFIGURED', '尚未配置底座会话密钥');
  return value;
}
const mac = (label, token) => createHmac('sha256', secret()).update(label + ':' + token).digest('hex');
const csrf = token => mac('csrf', token);
const tokenHash = token => mac('session', token);
function equals(left, right) {
  return typeof left === 'string' && left.length === right.length &&
    timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
function cookie(token, maxAge = 28800) {
  return `${cookieName}=${token}; Path=/api/v1/foundation; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.APP_MODE === 'production' ? '; Secure' : ''}`;
}

export function checkOrigin(request) {
  const expected = process.env.APP_BASE_URL || process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
  if (request.headers.origin !== expected) fail(403, 'INVALID_ORIGIN', '请求来源未获授权');
}

function checkLoginLimit(request) {
  const address = request.socket?.remoteAddress ?? 'local';
  const now = Date.now();
  for (const [key, entry] of loginBuckets) if (entry.until <= now) loginBuckets.delete(key);
  const item = loginBuckets.get(address) ?? {until: now + 60000, count: 0};
  item.count++;
  loginBuckets.set(address, item);
  if (item.count > 30) fail(429, 'LOGIN_RATE_LIMIT', '登录尝试过于频繁，请稍后再试');
}

export function requireDemo() {
  if (process.env.APP_MODE !== 'demo') {
    fail(503, 'SSO_NOT_CONNECTED', '学校统一身份尚未接入');
  }
}

export async function demoOptions() {
  requireDemo();
  return transaction(async client => {
    const {rows} = await client.query(`
      SELECT s.code,s.name,a.account,u.display_name,m.role_code
      FROM demo_accounts a
      JOIN schools s ON s.id=a.school_id AND s.status='ACTIVE'
      JOIN users u ON u.school_id=a.school_id AND u.id=a.user_id AND u.status='ACTIVE'
      JOIN memberships m ON m.school_id=a.school_id AND m.user_id=a.user_id AND m.role_code=a.default_role
      GROUP BY s.code,s.name,a.account,u.display_name,m.role_code
      ORDER BY s.code, a.account
    `);
    const schools = new Map();
    for (const row of rows) {
      if (!schools.has(row.code)) schools.set(row.code, {code: row.code, name: row.name, accounts: []});
      schools.get(row.code).accounts.push({account: row.account, displayName: row.display_name, role: row.role_code});
    }
    return {schools: [...schools.values()]};
  });
}

export async function demoLogin(body, request, response, requestId) {
  requireDemo();
  checkOrigin(request);
  checkLoginLimit(request);
  const {schoolCode, account} = body;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(schoolCode ?? '') || !/^[a-z][a-z0-9-]{0,63}$/.test(account ?? '')) {
    fail(422, 'ACCOUNT_INVALID', '请选择演示学校和账号');
  }
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  await transaction(async client => {
    const result = await client.query(`
      SELECT s.id AS school_id,u.id AS user_id,a.default_role
      FROM schools s JOIN demo_accounts a ON a.school_id=s.id
      JOIN users u ON u.id=a.user_id AND u.school_id=s.id
      WHERE s.code=$1 AND a.account=$2 AND s.status='ACTIVE' AND u.status='ACTIVE'
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.school_id=s.id AND m.user_id=u.id AND m.role_code=a.default_role)
    `, [schoolCode, account]);
    const row = result.rows[0];
    if (!row) fail(401, 'ACCOUNT_UNAVAILABLE', '演示账号不可用');
    await client.query(`
      INSERT INTO sessions(id,school_id,user_id,token_hash,active_role,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '8 hours')
    `, [randomUUID(), row.school_id, row.user_id, hash, row.default_role]);
    await audit(client, {schoolId: row.school_id, userId: row.user_id, role: row.default_role, requestId},
      {action: 'DEMO_LOGIN', type: 'USER', id: row.user_id});
  });
  const identity = await resolveSession(token, new URL('http://local'), requestId);
  response.setHeader('Set-Cookie', cookie(token));
  return publicIdentity(identity);
}

async function resolveSession(token, url, requestId) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) fail(401, 'LOGIN_REQUIRED', '请先登录校园底座');
  return transaction(async client => {
    const session = await client.query(`
      SELECT s.id,s.school_id,s.user_id,s.active_role,u.display_name,sc.code,sc.name
      FROM sessions s JOIN users u ON u.school_id=s.school_id AND u.id=s.user_id
      JOIN schools sc ON sc.id=s.school_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE' AND sc.status='ACTIVE'
    `, [tokenHash(token)]);
    const row = session.rows[0];
    if (!row) fail(401, 'SESSION_EXPIRED', '会话已失效，请重新登录');
    const memberships = await client.query(`
      SELECT role_code,scope_type,scope_id FROM memberships WHERE school_id=$1 AND user_id=$2
    `, [row.school_id, row.user_id]);
    const allowedRoles = [...new Set(memberships.rows.map(m => m.role_code))].filter(r => roles.includes(r));
    if (!allowedRoles.includes(row.active_role)) fail(401, 'ROLE_REVOKED', '岗位权限已撤销，请重新登录');
    const environments = await client.query(`
      SELECT id,code,mode FROM environments WHERE school_id=$1 AND status='ACTIVE'
        AND mode IN ('DEMO','TEST') ORDER BY CASE WHEN mode='DEMO' THEN 0 ELSE 1 END, code
    `, [row.school_id]);
    const requestedEnvironment = url.searchParams.get('environmentCode');
    const selected = requestedEnvironment
      ? environments.rows.find(env => env.code === requestedEnvironment) : environments.rows[0];
    if (!selected) fail(404, 'ENVIRONMENT_NOT_FOUND', '当前学校无此可用环境');
    return {
      schoolId: row.school_id, schoolCode: row.code, schoolName: row.name,
      environmentId: selected.id, environmentCode: selected.code, environmentMode: selected.mode,
      environments: environments.rows, userId: row.user_id, displayName: row.display_name,
      role: row.active_role, roles: allowedRoles,
      scopes: memberships.rows.filter(m => m.role_code === row.active_role).map(m => ({type: m.scope_type, id: m.scope_id})),
      requestId, sessionId: row.id, csrfToken: csrf(token), token
    };
  });
}

export async function authenticate(request, url, requestId) {
  requireDemo();
  const token = request.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const ctx = await resolveSession(token, url, requestId);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    checkOrigin(request);
    const supplied = request.headers['x-csrf-token'];
    if (!/^[a-f0-9]{64}$/.test(supplied ?? '') || !equals(supplied, ctx.csrfToken)) {
      fail(403, 'CSRF_INVALID', '会话验证失败，请刷新后重试');
    }
  }
  return ctx;
}

export function publicIdentity({sessionId, token, requestId, ...publicFields}) {
  return publicFields;
}

export async function switchRole(ctx, role, url) {
  if (!ctx.roles.includes(role)) fail(403, 'ROLE_FORBIDDEN', '此账号未分配该岗位');
  await transaction(async client => {
    const updated = await client.query(`
      UPDATE sessions SET active_role=$3 WHERE school_id=$1 AND id=$2
      AND EXISTS(SELECT 1 FROM memberships WHERE school_id=$1 AND user_id=$4 AND role_code=$3)
    `, [ctx.schoolId, ctx.sessionId, role, ctx.userId]);
    if (!updated.rowCount) fail(403, 'ROLE_FORBIDDEN', '此账号未分配该岗位');
    await audit(client, ctx, {action: 'ROLE_SWITCH', type: 'USER', id: ctx.userId, metadata: {role}});
  });
  return publicIdentity(await resolveSession(ctx.token, url, ctx.requestId));
}

export async function logout(ctx, response) {
  await transaction(async client => {
    await client.query('DELETE FROM sessions WHERE school_id=$1 AND id=$2', [ctx.schoolId, ctx.sessionId]);
  });
  response.setHeader('Set-Cookie', cookie('', 0));
  return true;
}
