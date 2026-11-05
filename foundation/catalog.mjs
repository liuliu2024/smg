import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {audit, fail, hasScope, json, pageParams, requireRole, requireVersion, scoped, transaction, uuid} from './db.mjs';

const code = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const name = z.string().trim().min(1).max(120);
const uuidValue = z.uuid();
const serviceInput = z.strictObject({
  code, name, scenarioCode: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  businessOwnerId: uuidValue, technicalOwnerId: uuidValue,
  authorityPolicy: z.strictObject({authority: name, reservation: name.optional(), pickup: name.optional(),
    session: name.optional(), billing: name.optional(), door: name.optional(), handover: name.optional()})
});
const connectionInput = z.strictObject({
  name: name.max(100), adapterPackageId: uuidValue, mode: z.enum(['DEMO', 'MANUAL', 'TEST', 'LIVE']),
  config: z.strictObject({}), secretRef: z.string().max(128).nullish(),
  authorizationExpiresAt: z.iso.datetime({offset: true}).nullish()
});
const bindingInput = z.strictObject({
  contractId: uuidValue, connectionId: uuidValue,
  support: z.enum(['SUPPORTED', 'CONDITIONAL', 'UNSUPPORTED', 'UNVERIFIED']),
  retryClass: z.enum(['READ_SAFE', 'WRITE_IDEMPOTENT_VERIFIED', 'QUERY_BEFORE_RETRY', 'MANUAL_ONLY']),
  mapping: z.strictObject({}).default({}),
  limitations: z.record(z.string().max(64), z.string().max(500)).default({})
});

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    fail(422, 'VALIDATION_FAILED', '请检查标记的字段',
      Object.fromEntries(result.error.issues.map(issue => [issue.path.join('.') || 'body', issue.message])));
  }
  return result.data;
}

export function requireOwner(ctx, service) {
  if (ctx.role !== 'SERVICE_OWNER' || service.business_owner_id !== ctx.userId) {
    fail(403, 'OWNER_REQUIRED', '仅该服务的业务负责人可执行');
  }
}
export function serviceAccess(ctx, service) {
  if (ctx.role === 'SERVICE_OWNER') return service.business_owner_id === ctx.userId && hasScope(ctx,'SERVICE',service.id);
  if (['OPERATOR','INTEGRATOR'].includes(ctx.role)) return hasScope(ctx,'SERVICE',service.id);
  return ctx.role !== 'END_USER';
}
export function serviceScopeIds(ctx) {
  if (!['OPERATOR','INTEGRATOR','SERVICE_OWNER'].includes(ctx.role) || hasScope(ctx,'SCHOOL','*')) return null;
  return ctx.scopes.filter(scope=>scope.type === 'SERVICE').map(scope=>scope.id);
}
export async function readService(client, ctx, id, lock = false) {
  const {rows} = await client.query(
    'SELECT * FROM services WHERE school_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''),
    [ctx.schoolId, uuid(id)]);
  if (!rows[0] || !serviceAccess(ctx, rows[0])) fail(404, 'SERVICE_NOT_FOUND', '服务不存在');
  return rows[0];
}
const nonEndUser = ['SCHOOL_ADMIN', 'SERVICE_OWNER', 'INTEGRATOR', 'RELEASE_APPROVER', 'OPERATOR', 'AUDITOR'];
function paginate(rows, url) {
  const {page, pageSize, offset} = pageParams(url);
  return {data: rows.slice(offset, offset + pageSize), meta: {page, pageSize, total: rows.length}};
}

export function configuredSecret(reference) {
  if (typeof reference !== 'string' || !/^FOUNDATION_CALLBACK_[A-Z0-9_]{1,108}$/.test(reference)) return false;
  return (process.env.ADAPTER_SECRET_ALLOWLIST || '').split(',').map(s => s.trim()).includes(reference) &&
    (process.env[reference]?.length ?? 0) >= 32;
}
function publicConnection({secret_ref, ...fields}) {
  return {...fields, secretConfigured: configuredSecret(secret_ref),
    connectionStatus: fields.mode === 'DEMO' && fields.status === 'ACTIVE' ? 'DEMO_CONFIGURED' : 'NOT_CONNECTED'};
}
async function selectedConnection(client, ctx, id, lock = false) {
  const {rows} = await scoped(client, ctx)(
    'SELECT * FROM connections WHERE school_id=$1 AND environment_id=$2 AND id=$3' + (lock ? ' FOR UPDATE' : ''), [uuid(id)]);
  if (!rows[0]) fail(404, 'CONNECTION_NOT_FOUND', '连接不存在');
  return rows[0];
}

async function serviceRoutes(client, ctx, method, id, action, body, req) {
  if (method === 'GET') {
    requireRole(ctx, ...nonEndUser);
    if (id) return {data: await readService(client, ctx, id)};
    const {rows} = await client.query('SELECT * FROM services WHERE school_id=$1 ORDER BY code', [ctx.schoolId]);
    return paginate(rows.filter(row => serviceAccess(ctx, row)), req.url);
  }
  if (['suspend','resume'].includes(action) && method === 'POST') {
    const service = await readService(client, ctx, id, true);
    if (ctx.role !== 'SCHOOL_ADMIN') requireOwner(ctx, service);
    requireVersion(req.version, service);
    const reason = parse(z.string().trim().min(1).max(500), body.reason);
    const suspending = action === 'suspend';
    if (service.status !== (suspending ? 'ACTIVE' : 'SUSPENDED')) fail(409,'SERVICE_STATE_INVALID','当前服务状态不支持此操作');
    const {rows} = await client.query(`
      UPDATE services SET status=$4,version=version+1,updated_at=now()
      WHERE school_id=$1 AND id=$2 AND version=$3 RETURNING *
    `, [ctx.schoolId, service.id, service.version, suspending ? 'SUSPENDED' : 'ACTIVE']);
    await audit(client, ctx, {action: suspending ? 'SERVICE_SUSPEND' : 'SERVICE_RESUME', type: 'SERVICE', id, metadata: {reason}});
    return {data: rows[0]};
  }
  if (!((method === 'POST' && !id) || (method === 'PATCH' && id && !action))) return null;
  requireRole(ctx, 'SCHOOL_ADMIN', 'SERVICE_OWNER');
  const prior = id ? await readService(client, ctx, id, true) : null;
  if (prior) requireVersion(req.version, prior);
  const data = parse(serviceInput, body);
  if (ctx.role === 'SERVICE_OWNER' && data.businessOwnerId !== ctx.userId) {
    fail(403, 'OWNER_REQUIRED', '业务负责人只能创建本人负责的服务');
  }
  if (prior && prior.code !== data.code) fail(409, 'SERVICE_CODE_IMMUTABLE', '服务编号创建后保持稳定');
  const owners = await client.query(`
    SELECT u.id, m.role_code FROM users u JOIN memberships m ON m.user_id=u.id AND m.school_id=u.school_id
    WHERE u.school_id=$1 AND u.id=ANY($2::uuid[]) AND u.status='ACTIVE'
  `, [ctx.schoolId, [data.businessOwnerId, data.technicalOwnerId]]);
  if (!owners.rows.some(row => row.id === data.businessOwnerId && row.role_code === 'SERVICE_OWNER') ||
      !owners.rows.some(row => row.id === data.technicalOwnerId && row.role_code === 'INTEGRATOR')) {
    fail(422, 'OWNER_INVALID', '负责人必须属于本校且具备对应岗位');
  }
  const serviceId = id || randomUUID();
  const fields = [ctx.schoolId, serviceId, data.code, data.name, data.scenarioCode,
    data.businessOwnerId, data.technicalOwnerId, json(data.authorityPolicy)];
  const saved = prior
    ? await client.query(`
      UPDATE services SET name=$4,scenario_code=$5,business_owner_id=$6,technical_owner_id=$7,
        authority_policy=$8,version=version+1,updated_at=now()
      WHERE school_id=$1 AND id=$2 AND code=$3 AND version=$9 RETURNING *
    `, [...fields, prior.version])
    : await client.query(`
      INSERT INTO services(school_id,id,code,name,scenario_code,business_owner_id,technical_owner_id,authority_policy)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, fields);
  await audit(client, ctx, {action: prior ? 'SERVICE_UPDATE' : 'SERVICE_CREATE', type: 'SERVICE', id: serviceId});
  return {status: prior ? 200 : 201, data: saved.rows[0]};
}

async function connectionRoutes(client, ctx, method, id, action, body, req) {
  const query = scoped(client, ctx);
  if (method === 'GET') {
    requireRole(ctx, 'SCHOOL_ADMIN', 'SERVICE_OWNER', 'INTEGRATOR', 'RELEASE_APPROVER', 'AUDITOR');
    if (id) return {data: publicConnection(await selectedConnection(client, ctx, id))};
    const {rows} = await query('SELECT * FROM connections WHERE school_id=$1 AND environment_id=$2 ORDER BY name');
    return paginate(rows.map(publicConnection), req.url);
  }
  requireRole(ctx, 'INTEGRATOR', 'SCHOOL_ADMIN');
  if (!hasScope(ctx,'SCHOOL','*')) fail(403,'SCHOOL_SCOPE_REQUIRED','环境连接需校级配置权限');
  const prior = id ? await selectedConnection(client, ctx, id, true) : null;
  if (prior) requireVersion(req.version, prior);
  if (prior && method === 'POST' && ['test-read', 'disable'].includes(action)) {
    const disabling = action === 'disable';
    if (!disabling && prior.mode !== 'DEMO') fail(503, 'NOT_CONNECTED', '真实连接尚未接入');
    if (!disabling && (!configuredSecret(prior.secret_ref) ||
        (prior.authorization_expires_at && prior.authorization_expires_at <= new Date()))) {
      fail(409, 'CONNECTION_INCOMPLETE', '连接缺少有效授权或回调密钥');
    }
    const {rows} = await query(`
      UPDATE connections SET status=$4,version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$5 RETURNING *
    `, [id, disabling ? 'DISABLED' : 'ACTIVE', prior.version]);
    await audit(client, ctx, {action: disabling ? 'CONNECTION_DISABLE' : 'CONNECTION_DEMO_CHECK', type: 'CONNECTION', id});
    return {data: {...publicConnection(rows[0]), ...(disabling ? {} : {testOutcome: 'DEMO_CONFIG_VALID'})}};
  }
  if (!((method === 'POST' && !id) || (method === 'PATCH' && id && !action))) return null;
  const data = parse(connectionInput, body);
  const reference = data.secretRef === undefined ? prior?.secret_ref : data.secretRef;
  const prefix = 'FOUNDATION_CALLBACK_' + ctx.schoolCode.toUpperCase().replaceAll('-','_') + '_';
  if (reference && (!reference.startsWith(prefix) || !configuredSecret(reference))) {
    fail(422,'SECRET_REFERENCE_INVALID','请选择本校已配置且在允许列表中的密钥引用');
  }
  const adapter = await client.query("SELECT id FROM adapter_packages WHERE id=$1 AND status='PUBLISHED'", [data.adapterPackageId]);
  if (!adapter.rowCount) fail(422, 'ADAPTER_NOT_FOUND', '适配包版本不可用');
  const connectionId = id || randomUUID();
  const fields = [connectionId, data.name, data.adapterPackageId, data.mode,
    json(data.config), reference ?? null, data.authorizationExpiresAt ?? null];
  const saved = prior ? await query(`
    UPDATE connections SET name=$4,adapter_package_id=$5,mode=$6,config=$7,secret_ref=$8,
      authorization_expires_at=$9,status='DRAFT',version=version+1
    WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$10 RETURNING *
  `, [...fields, prior.version]) : await query(`
    INSERT INTO connections(school_id,environment_id,id,name,adapter_package_id,mode,config,secret_ref,authorization_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, fields);
  await audit(client, ctx, {action: prior ? 'CONNECTION_UPDATE' : 'CONNECTION_CREATE', type: 'CONNECTION', id: connectionId});
  return {status: prior ? 200 : 201, data: publicConnection(saved.rows[0])};
}

async function bindingRoutes(client, ctx, method, id, body, req) {
  const query = scoped(client, ctx);
  const read = async (lock = false) => {
    const {rows} = await query(
      'SELECT * FROM capability_bindings WHERE school_id=$1 AND environment_id=$2 AND id=$3' + (lock ? ' FOR UPDATE' : ''),
      [uuid(id)]);
    if (!rows[0]) fail(404, 'BINDING_NOT_FOUND', '能力绑定不存在');
    return rows[0];
  };
  requireRole(ctx, 'SCHOOL_ADMIN', 'SERVICE_OWNER', 'INTEGRATOR', 'RELEASE_APPROVER', 'AUDITOR');
  if (method === 'GET') {
    if (id) return {data: await read()};
    const {rows} = await query(`
      SELECT b.*, c.code AS contract_code, c.version AS contract_version, cn.name AS connection_name
      FROM capability_bindings b JOIN capability_contracts c ON c.id=b.contract_id
      JOIN connections cn ON cn.id=b.connection_id AND cn.school_id=b.school_id AND cn.environment_id=b.environment_id
      WHERE b.school_id=$1 AND b.environment_id=$2 ORDER BY c.code,c.version
    `);
    return paginate(rows, req.url);
  }
  if (!((method === 'POST' && !id) || (method === 'PATCH' && id))) return null;
  requireRole(ctx, 'INTEGRATOR', 'SCHOOL_ADMIN');
  if (!hasScope(ctx,'SCHOOL','*')) fail(403,'SCHOOL_SCOPE_REQUIRED','共享能力绑定需校级配置权限');
  const previous = id ? await read(true) : null;
  if (previous) requireVersion(req.version, previous);
  const data = parse(bindingInput, body);
  const connection = await selectedConnection(client, ctx, data.connectionId);
  const contract = await client.query(`
    SELECT c.manifest, p.code AS package_code FROM capability_contracts c
    JOIN adapter_packages p ON p.id=$2 WHERE c.id=$1 AND c.status='PUBLISHED'
  `, [data.contractId, connection.adapter_package_id]);
  const asset = contract.rows[0];
  if (!asset || asset.manifest.packageCode !== asset.package_code || asset.manifest.retryClass !== data.retryClass) {
    fail(422, 'BINDING_CONTRACT_MISMATCH', '适配包或重试策略与能力合同不一致');
  }
  if (previous && previous.contract_id !== data.contractId) fail(409, 'CONTRACT_IMMUTABLE', '绑定的能力版本不能修改');
  const bindingId = id || randomUUID();
  const fields = [bindingId, data.contractId, data.connectionId, data.support, data.retryClass,
    json(data.mapping), json(data.limitations)];
  const saved = previous ? await query(`
    UPDATE capability_bindings SET connection_id=$5,support=$6,retry_class=$7,mapping=$8,limitations=$9,version=version+1
    WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND contract_id=$4 AND version=$10 RETURNING *
  `, [...fields, previous.version]) : await query(`
    INSERT INTO capability_bindings(school_id,environment_id,id,contract_id,connection_id,support,retry_class,mapping,limitations)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, fields);
  await audit(client, ctx, {action: previous ? 'BINDING_UPDATE' : 'BINDING_CREATE', type: 'BINDING', id: bindingId});
  return {status: previous ? 200 : 201, data: saved.rows[0]};
}

export async function catalogRoute(ctx, method, path, body, req) {
  if (path[0] === 'services' && path.length <= 2 && method === 'GET') {
    return transaction(async client => {
      const {rows} = await scoped(client, ctx)(`
        SELECT s.id,s.code,s.name,s.scenario_code,r.release_number,r.definition->'form' AS form
        FROM services s JOIN releases r ON r.school_id=s.school_id AND r.service_id=s.id
        WHERE s.school_id=$1 AND r.environment_id=$2 AND s.status='ACTIVE' AND r.status='ACTIVE'
          AND ($3::text IS NULL OR s.code=$3)
        ORDER BY s.code
      `, [path[1] ?? null]);
      if (path[1]) {
        if (!rows[0]) fail(404, 'SERVICE_NOT_FOUND', '服务不存在');
        return {data: rows[0]};
      }
      return paginate(rows, req.url);
    });
  }
  if (path[0] !== 'admin') return null;
  const [, section, id, action] = path;
  const serviceRoute = section === 'services' && action !== 'releases';
  if (!(serviceRoute || ['connections', 'bindings', 'capabilities', 'adapters', 'users', 'workspace', 'system', 'audit'].includes(section))) {
    return null;
  }
  return transaction(async client => {
    if (serviceRoute) return serviceRoutes(client, ctx, method, id, action, body, req);
    if (section === 'connections') return connectionRoutes(client, ctx, method, id, action, body, req);
    if (section === 'bindings') return bindingRoutes(client, ctx, method, id, body, req);
    if (method !== 'GET') return null;
    if (section === 'users') {
      requireRole(ctx, 'SCHOOL_ADMIN', 'SERVICE_OWNER');
      const {rows} = await client.query(`
        SELECT u.id,u.display_name,u.status,array_agg(DISTINCT m.role_code) AS roles
        FROM users u JOIN memberships m ON m.school_id=u.school_id AND m.user_id=u.id
        WHERE u.school_id=$1 GROUP BY u.id ORDER BY u.display_name
      `, [ctx.schoolId]);
      return paginate(rows, req.url);
    }
    requireRole(ctx, ...nonEndUser);
    if (section === 'capabilities' || section === 'adapters') {
      const table = section === 'capabilities' ? 'capability_contracts' : 'adapter_packages';
      const {rows} = await client.query(`SELECT * FROM ${table} WHERE status='PUBLISHED' ORDER BY code,version`);
      if (id) {
        const row = rows.find(item => item.id === id);
        if (!row) fail(404, 'ASSET_NOT_FOUND', '资产不存在');
        return {data: row};
      }
      return paginate(rows, req.url);
    }
    if (section === 'audit') {
      requireRole(ctx, 'AUDITOR', 'SCHOOL_ADMIN');
      const {page, pageSize, offset} = pageParams(req.url);
      const {rows} = await scoped(client, ctx)(`
        SELECT id,actor_id,active_role,action,resource_type,resource_id,outcome,request_id,created_at,count(*) OVER() AS total
        FROM audit_logs WHERE school_id=$1 AND (environment_id IS NULL OR environment_id=$2)
        ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4
      `, [pageSize, offset]);
      return {data: rows.map(({total, ...row}) => row), meta: {page,pageSize,total:Number(rows[0]?.total ?? 0)}};
    }
    const heartbeat = (await client.query('SELECT max(seen_at) AS seen_at FROM worker_heartbeats')).rows[0].seen_at;
    const worker = {lastSeen: heartbeat, status: heartbeat && Date.now() - +heartbeat < 90000 ? 'HEALTHY' : 'STALE'};
    if (section === 'system') return {data: {version: 'Foundation 1.0', mode: ctx.environmentMode, database: 'UP', worker, liveStatus: 'NOT_CONNECTED'}};
    const query = scoped(client, ctx);
    const {rows: [totals]} = await query(`
      SELECT
        (SELECT count(*)::int FROM releases WHERE school_id=$1 AND environment_id=$2 AND status='PENDING_APPROVAL') AS "pendingApprovals",
        (SELECT count(*)::int FROM operations WHERE school_id=$1 AND environment_id=$2 AND status='UNKNOWN') AS "unknownOperations",
        (SELECT count(*)::int FROM device_sessions WHERE school_id=$1 AND environment_id=$2 AND domain_state IN ('REQUESTED','STARTING','ACTIVE','STOPPING')) AS "openSessions"
    `);
    return {data: {...totals, environments: ctx.environments, worker, mode: ctx.environmentMode}};
  });
}
