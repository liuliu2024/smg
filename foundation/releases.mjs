import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {z} from 'zod';
import {audit, digest, enqueue, fail, json, pageParams, requireRole, requireVersion, scoped, transaction, uuid} from './db.mjs';
import {configuredSecret, parse, readService, requireOwner, serviceAccess, serviceScopeIds} from './catalog.mjs';
import {assets, validateDefinition} from './runtime/index.mjs';

const staff = ['SCHOOL_ADMIN', 'SERVICE_OWNER', 'INTEGRATOR', 'RELEASE_APPROVER', 'AUDITOR'];
const approver = 'RELEASE_APPROVER';

function definitionInput(body) {
  return parse(z.strictObject({definition: z.record(z.string(), z.unknown())}), body).definition;
}

export async function resolveManifest(client, ctx, service, definition) {
  const report = validateDefinition(definition);
  const blockingErrors = [...report.blockingErrors];
  const warnings = [...report.warnings];
  if (blockingErrors.length) return {blockingErrors, warnings};
  if (definition.policy.authority !== service.authority_policy.authority) {
    blockingErrors.push({fieldPath: 'policy.authority', message: '流程与服务的数据权威必须一致'});
  }
  const query = scoped(client, ctx);
  const {rows} = await query(`
    SELECT b.id AS binding_id,b.version AS binding_version,b.retry_class,b.support,b.mapping,b.limitations,
      c.id AS contract_id,c.code,c.version AS contract_version,c.manifest,c.input_schema,c.output_schema,c.digest AS contract_digest,
      n.id AS connection_id,n.version AS connection_version,n.mode,n.status,n.authorization_expires_at,n.config,n.secret_ref,
      p.code AS package_code,p.version AS package_version,p.manifest_digest
    FROM capability_bindings b
    JOIN capability_contracts c ON c.id=b.contract_id AND c.status='PUBLISHED'
    JOIN connections n ON n.id=b.connection_id AND n.school_id=b.school_id AND n.environment_id=b.environment_id
    JOIN adapter_packages p ON p.id=n.adapter_package_id AND p.status='PUBLISHED'
    WHERE b.school_id=$1 AND b.environment_id=$2 FOR SHARE OF b,c,n,p
  `);
  const actions = definition.workflow.nodes.filter(node => node.type === 'action');
  const required = definition.policy.requiredBindings ?? [];
  if (!Array.isArray(required) || required.length > 10 || required.some(key => typeof key !== 'string')) {
    return {blockingErrors: [{fieldPath: 'policy.requiredBindings', message: '额外依赖必须是有效能力编号'}], warnings};
  }
  const bindingCodes = [...new Set([...actions.map(node => node.bindingCode), ...required])];
  const bindings = Object.create(null);
  for (const key of bindingCodes) {
    const matches = rows.filter(row => row.code === key && row.support === 'SUPPORTED');
    const source = matches[0];
    const nodeId = actions.find(node => node.bindingCode === key)?.id;
    if (matches.length !== 1 || source.status !== 'ACTIVE' || source.mode !== 'DEMO' ||
        ctx.environmentMode === 'PRODUCTION' || !configuredSecret(source.secret_ref) ||
        (source.authorization_expires_at && source.authorization_expires_at <= new Date()) ||
        source.manifest.packageCode !== source.package_code || source.manifest.retryClass !== source.retry_class ||
        source.manifest.authority !== definition.policy.authority) {
      blockingErrors.push({nodeId, fieldPath: 'bindingCode', message: `能力 ${key} 缺少唯一且有效的演示绑定`});
      continue;
    }
    const registered = assets.contracts.find(contract => contract.code === key && contract.version === source.contract_version);
    if (!registered || !assets.packages.some(pkg => pkg.code === source.package_code && pkg.version === source.package_version)) {
      blockingErrors.push({nodeId, fieldPath: 'bindingCode', message: '能力或适配包版本未注册'});
      continue;
    }
    for (const node of actions.filter(item => item.bindingCode === key)) {
      const fields = Object.keys(node.input || {});
      if ((source.input_schema.required || []).some(field => !fields.includes(field)) ||
          (source.input_schema.additionalProperties === false && fields.some(field => !Object.hasOwn(source.input_schema.properties || {}, field)))) {
        blockingErrors.push({nodeId: node.id, fieldPath: 'input', message: '节点输入映射与能力合同字段不匹配'});
      }
      const effect = source.manifest.sideEffect;
      const unknown = definition.workflow.nodes.find(item => item.id === node.onUnknown);
      if (effect !== 'NONE' && unknown?.type !== 'incident') {
        blockingErrors.push({nodeId: node.id, fieldPath: 'onUnknown', message: '有副作用的动作必须进入人工核查'});
      }
    }
    bindings[key] = {
      bindingId: source.binding_id, bindingVersion: source.binding_version,
      contractId: source.contract_id, contractVersion: source.contract_version, contractDigest: source.contract_digest,
      connectionId: source.connection_id, connectionVersion: source.connection_version,
      packageCode: source.package_code, packageVersion: source.package_version, packageDigest: source.manifest_digest,
      sideEffect: source.manifest.sideEffect, retryClass: source.retry_class,
      inputSchema: source.input_schema, outputSchema: source.output_schema, config: source.config
    };
  }
  if (blockingErrors.length) return {blockingErrors, warnings};
  const manifest = {
    schoolId: ctx.schoolId, environmentId: ctx.environmentId, serviceId: service.id,
    authority: service.authority_policy, owner: service.business_owner_id,
    technicalOwner: service.technical_owner_id, definitionDigest: digest(definition), bindings
  };
  return {blockingErrors, warnings, manifest, digest: digest(manifest)};
}

function inspectFixtures(manifest) {
  const ajv = new Ajv({allErrors: true, strict: true, addUsedSchema: false});
  return Object.entries(manifest.bindings).flatMap(([code, binding]) => {
    const contract = assets.contracts.find(item => item.code === code && item.version === binding.contractVersion);
    const input = ajv.compile(binding.inputSchema);
    const output = ajv.compile(binding.outputSchema);
    return [
      {case: code + ':valid-input', passed: input(contract?.fixtureInput) === true},
      {case: code + ':invalid-input', passed: input(null) === false},
      {case: code + ':valid-output', passed: output(contract?.fixtureOutput) === true},
      {case: code + ':invalid-output', passed: output(null) === false}
    ];
  });
}

async function currentManifest(client, ctx, release, service) {
  const current = await resolveManifest(client, ctx, service, release.definition);
  if (current.digest !== release.digest || current.blockingErrors.length) {
    fail(409, 'RELEASE_DEPENDENCIES_CHANGED', '发布依赖已改变，请退回草稿重新校验与测试');
  }
  return current;
}

async function readRelease(client, ctx, id, lock = false) {
  const {rows} = await scoped(client, ctx)(
    'SELECT * FROM releases WHERE school_id=$1 AND environment_id=$2 AND id=$3' + (lock ? ' FOR UPDATE' : ''), [uuid(id)]);
  if (!rows[0]) fail(404, 'RELEASE_NOT_FOUND', '发布版本不存在');
  return rows[0];
}
async function updateStage(client, ctx, release, status) {
  const {rows} = await scoped(client, ctx)(`
    UPDATE releases SET status=$4,version=version+1
    WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$5 RETURNING *
  `, [release.id, status, release.version]);
  if (!rows[0]) fail(409, 'VERSION_CONFLICT', '发布版本已更新');
  return rows[0];
}
function expectStatus(release, status) {
  if (release.status !== status) fail(409, 'RELEASE_TRANSITION_INVALID', '当前发布状态不支持此操作');
}
async function requirePassingTest(client, ctx, release) {
  const passed = await scoped(client, ctx)(`
    SELECT id FROM test_runs WHERE school_id=$1 AND environment_id=$2 AND release_id=$3
      AND digest=$4 AND release_generation=$5 AND status='PASSED'
  `, [release.id, release.digest, release.generation]);
  if (!passed.rowCount) fail(409, 'MATCHING_TEST_REQUIRED', '当前发布版本缺少匹配的通过记录');
}

async function insertDraft(client,ctx,service,definition,source = null) {
  const query = scoped(client,ctx);
  const {rows:[sequence]} = await query(`
    SELECT coalesce(max(release_number),0)+1 AS next FROM releases
    WHERE school_id=$1 AND environment_id=$2 AND service_id=$3
  `,[service.id]);
  const {rows:[release]} = await query(`
    INSERT INTO releases(school_id,environment_id,id,service_id,release_number,definition,created_by,rollback_source_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `,[randomUUID(),service.id,sequence.next,json(definition),ctx.userId,source?.id ?? null]);
  await audit(client,ctx,{action:source ? 'RELEASE_ROLLBACK_DRAFT' : 'RELEASE_DRAFT',
    type:'RELEASE',id:release.id,metadata:source ? {sourceId:source.id} : {}});
  return release;
}

export async function runReleaseTest(job, ctx) {
  const {testRunId} = job.payload;
  await transaction(async client => {
    const query = scoped(client, ctx);
    const {rows: [run]} = await query(`
      SELECT * FROM test_runs WHERE school_id=$1 AND environment_id=$2 AND id=$3 FOR UPDATE
    `, [testRunId]);
    if (!run || run.status !== 'RUNNING') return;
    const release = await readRelease(client, ctx, run.release_id, true);
    const service = await readService(client, ctx, release.service_id);
    let results;
    if (release.status !== 'VALIDATED' || release.digest !== run.digest || release.generation !== run.release_generation) {
      results = [{case: 'release-generation-current', passed: false}];
    } else {
      try {
        const {manifest} = await currentManifest(client, ctx, release, service);
        results = [{case: 'definition-and-binding-seal', passed: true}, ...inspectFixtures(manifest)];
      } catch {
        results = [{case: 'definition-and-binding-seal', passed: false}];
      }
    }
    const passed = results.every(result => result.passed);
    await query(`
      UPDATE test_runs SET status=$4,results=$5,finished_at=now()
      WHERE school_id=$1 AND environment_id=$2 AND id=$3
    `, [testRunId, passed ? 'PASSED' : 'FAILED', json(results)]);
    if (passed) await updateStage(client, ctx, release, 'TEST_PASSED');
    await audit(client, ctx, {action: 'RELEASE_TEST_FINISH', type: 'RELEASE', id: release.id, outcome: passed ? 'SUCCESS' : 'FAILURE'});
  });
}

export async function seedDemoRelease(client, ctx, service, definition, approvedBy) {
  if (ctx.environmentMode !== 'DEMO' || approvedBy === ctx.userId) throw new Error('Invalid DEMO seed actors');
  const validation = await resolveManifest(client, ctx, service, definition);
  if (validation.blockingErrors.length) throw new Error('Invalid DEMO release template: ' + JSON.stringify(validation.blockingErrors));
  const results = inspectFixtures(validation.manifest);
  if (!results.length || results.some(item => !item.passed)) throw new Error('DEMO contract fixtures failed');
  const releaseId = randomUUID();
  const generation = randomUUID();
  const query = scoped(client, ctx);
  await query(`
    INSERT INTO releases(school_id,environment_id,id,service_id,release_number,status,definition,resolved_manifest,digest,
      validation_report,created_by,submitted_by,approved_by,generation,activated_at)
    VALUES($1,$2,$3,$4,1,'ACTIVE',$5,$6,$7,$8,$9,$9,$10,$11,now())
  `, [releaseId, service.id, json(definition), json(validation.manifest), validation.digest,
    json({blockingErrors: [], warnings: validation.warnings}), ctx.userId, approvedBy, generation]);
  await query(`
    INSERT INTO test_runs(school_id,environment_id,id,release_id,digest,status,results,created_by,release_generation,finished_at)
    VALUES($1,$2,$3,$4,$5,'PASSED',$6,$7,$8,now())
  `, [randomUUID(), releaseId, validation.digest, json(results), ctx.userId, generation]);
  await audit(client, ctx, {action: 'DEMO_TEMPLATE_INSTALL', type: 'RELEASE', id: releaseId});
  return releaseId;
}

export async function releaseRoute(ctx, method, path, body, req) {
  if (path[0] !== 'admin') return null;
  const [, section, id, action] = path;
  if (section === 'services' && id && action === 'releases' && method === 'POST') {
    return transaction(async client => {
      const service = await readService(client, ctx, id, true);
      requireOwner(ctx, service);
      return {status:201,data:await insertDraft(client,ctx,service,definitionInput(body))};
    });
  }
  if (section !== 'releases' && section !== 'test-runs') return null;
  requireRole(ctx, ...staff);
  return transaction(async client => {
    const query = scoped(client, ctx);
    if (section === 'test-runs') {
      if (method !== 'GET' || !id || action) return null;
      const {rows: [testRun]} = await query('SELECT * FROM test_runs WHERE school_id=$1 AND environment_id=$2 AND id=$3', [uuid(id)]);
      if (!testRun) fail(404, 'TEST_RUN_NOT_FOUND', '测试记录不存在');
      const release = await readRelease(client, ctx, testRun.release_id);
      await readService(client, ctx, release.service_id);
      return {data: testRun};
    }
    if (!id && method === 'GET') {
      const serviceId = req.url.searchParams.get('serviceId');
      if (serviceId) await readService(client, ctx, serviceId);
      const {page, pageSize, offset} = pageParams(req.url);
      const {rows} = await query(`
        SELECT r.id,r.service_id,r.release_number,r.status,r.digest,r.version,r.created_at,s.name AS service_name,count(*) OVER() AS total
        FROM releases r JOIN services s ON s.school_id=r.school_id AND s.id=r.service_id
        WHERE r.school_id=$1 AND r.environment_id=$2 AND ($3::uuid IS NULL OR r.service_id=$3)
          AND ($4::uuid IS NULL OR s.business_owner_id=$4)
          AND ($5::text[] IS NULL OR r.service_id::text=ANY($5))
        ORDER BY r.created_at DESC,r.id LIMIT $6 OFFSET $7
      `, [serviceId || null, ctx.role === 'SERVICE_OWNER' ? ctx.userId : null, serviceScopeIds(ctx), pageSize, offset]);
      return {data: rows.map(({total, ...row}) => row), meta: {page,pageSize,total:Number(rows[0]?.total ?? 0)}};
    }
    if (!id) return null;
    let release = await readRelease(client, ctx, id);
    // Acquire the service lock before a release lock so concurrent activation has one ordering.
    const service = await readService(client, ctx, release.service_id, method !== 'GET');
    if (!serviceAccess(ctx, service)) fail(404, 'RELEASE_NOT_FOUND', '发布版本不存在');
    if (method === 'GET' && !action) {
      const tests = await query(`
        SELECT id,status,digest,results,created_at,finished_at FROM test_runs
        WHERE school_id=$1 AND environment_id=$2 AND release_id=$3 ORDER BY created_at DESC LIMIT 20
      `, [id]);
      return {data: {...release, testRuns: tests.rows}};
    }
    release = await readRelease(client, ctx, id, true);
    requireVersion(req.version, release);
    if (method === 'POST' && action === 'rollback-request') {
      requireOwner(ctx,service);
      expectStatus(release,'SUPERSEDED');
      const reason = parse(z.string().trim().min(1).max(500),body.reason);
      await currentManifest(client,ctx,release,service);
      const draft = await insertDraft(client,ctx,service,release.definition,release);
      await audit(client,ctx,{action:'RELEASE_ROLLBACK_REQUEST',type:'RELEASE',id:draft.id,metadata:{reason,sourceId:release.id}});
      return {status:201,data:draft};
    }
    if ((method === 'PATCH' && !action) || (method === 'POST' && action === 'reopen')) {
      requireOwner(ctx, service);
      if (['ACTIVE', 'SUPERSEDED'].includes(release.status)) fail(409, 'RELEASE_IMMUTABLE', '已发布版本保留，修改请创建新版本');
      if (method === 'PATCH' && release.rollback_source_id) fail(409,'ROLLBACK_IMMUTABLE','回退草稿固定历史版本定义');
      if (method === 'PATCH') expectStatus(release, 'DRAFT');
      const definition = method === 'PATCH' ? definitionInput(body) : release.definition;
      const {rows: [updated]} = await query(`
        UPDATE releases SET definition=$4,status='DRAFT',resolved_manifest=NULL,digest=NULL,validation_report=NULL,
          submitted_by=NULL,approved_by=NULL,generation=NULL,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$5 RETURNING *
      `, [id, json(definition), release.version]);
      await audit(client, ctx, {action: 'RELEASE_DRAFT_UPDATE', type: 'RELEASE', id});
      return {data: updated};
    }
    if (method !== 'POST') return null;
    if (action === 'validate') {
      if (ctx.role !== 'INTEGRATOR') requireOwner(ctx, service);
      expectStatus(release, 'DRAFT');
      let {blockingErrors,warnings,manifest,digest: seal} = await resolveManifest(client, ctx, service, release.definition);
      if (release.rollback_source_id && manifest) {
        const source = await readRelease(client,ctx,release.rollback_source_id);
        if (source.digest !== seal) {
          blockingErrors = [{fieldPath:'rollbackSource',message:'历史版本的依赖已变化，无法安全回退'}];
          manifest = undefined;
          seal = undefined;
        }
      }
      const report = {blockingErrors,warnings};
      const {rows: [updated]} = await query(`
        UPDATE releases SET validation_report=$4,resolved_manifest=$5,digest=$6,status=$7,generation=$8,version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$9 RETURNING *
      `, [id, json(report), manifest ? json(manifest) : null, seal ?? null, manifest ? 'VALIDATED' : 'DRAFT',
        manifest ? randomUUID() : null, release.version]);
      await audit(client, ctx, {action: 'RELEASE_VALIDATE', type: 'RELEASE', id, outcome: manifest ? 'SUCCESS' : 'FAILURE'});
      return {data: {...updated,...report}};
    }
    if (action === 'test-runs') {
      requireRole(ctx, 'INTEGRATOR');
      expectStatus(release, 'VALIDATED');
      await currentManifest(client, ctx, release, service);
      const running = await query(`
        SELECT id FROM test_runs WHERE school_id=$1 AND environment_id=$2 AND release_id=$3
        AND release_generation=$4 AND status='RUNNING'
      `, [id, release.generation]);
      if (running.rowCount) return {status: 202, data: {id: running.rows[0].id, testRunId: running.rows[0].id, status: 'RUNNING'}};
      const testRunId = randomUUID();
      await query(`
        INSERT INTO test_runs(school_id,environment_id,id,release_id,digest,status,created_by,release_generation)
        VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7)
      `, [testRunId,id,release.digest,ctx.userId,release.generation]);
      await enqueue(client,ctx,{type:'RELEASE_TEST',key:'release-test:'+testRunId,payload:{testRunId}});
      await audit(client,ctx,{action:'RELEASE_TEST_QUEUE',type:'RELEASE',id});
      return {status: 202, data:{id:testRunId,testRunId,status:'RUNNING'}};
    }
    if (action === 'submit') {
      requireOwner(ctx, service);
      expectStatus(release, 'TEST_PASSED');
      await currentManifest(client, ctx, release, service);
      await requirePassingTest(client, ctx, release);
      await query('UPDATE releases SET submitted_by=$4 WHERE school_id=$1 AND environment_id=$2 AND id=$3', [id,ctx.userId]);
      const updated = await updateStage(client,ctx,release,'PENDING_APPROVAL');
      await audit(client,ctx,{action:'RELEASE_SUBMIT',type:'RELEASE',id});
      return {data: updated};
    }
    if (action === 'approve' || action === 'reject') {
      requireRole(ctx, approver);
      expectStatus(release, 'PENDING_APPROVAL');
      if (release.submitted_by === ctx.userId) fail(403,'SELF_APPROVAL_FORBIDDEN','提交人不得审批自己的发布');
      const reason = parse(z.string().trim().min(1).max(500),body.reason);
      if (action === 'approve') {
        await currentManifest(client, ctx, release, service);
        await requirePassingTest(client, ctx, release);
        await query('UPDATE releases SET approved_by=$4 WHERE school_id=$1 AND environment_id=$2 AND id=$3', [id,ctx.userId]);
      }
      const updated = await updateStage(client,ctx,release,action === 'approve' ? 'APPROVED' : 'REJECTED');
      await audit(client,ctx,{action:action === 'approve' ? 'RELEASE_APPROVE' : 'RELEASE_REJECT',type:'RELEASE',id,metadata:{reason}});
      return {data: updated};
    }
    if (action === 'activate') {
      requireRole(ctx, approver);
      expectStatus(release, 'APPROVED');
      if (ctx.environmentMode !== 'DEMO') fail(503,'ENVIRONMENT_NOT_CONNECTED','当前仅演示环境可激活运行');
      if (release.submitted_by === ctx.userId || !release.approved_by) fail(403,'INDEPENDENT_APPROVAL_REQUIRED','需由独立发布人审批和激活');
      if (service.status === 'RETIRED') fail(409,'SERVICE_RETIRED','退役服务不能激活版本');
      await currentManifest(client, ctx, release, service);
      await requirePassingTest(client, ctx, release);
      await query(`
        UPDATE releases SET status='SUPERSEDED',version=version+1
        WHERE school_id=$1 AND environment_id=$2 AND service_id=$3 AND status='ACTIVE'
      `, [service.id]);
      await query('UPDATE releases SET activated_at=now() WHERE school_id=$1 AND environment_id=$2 AND id=$3', [id]);
      const updated = await updateStage(client,ctx,release,'ACTIVE');
      await client.query("UPDATE services SET status='ACTIVE',version=version+1,updated_at=now() WHERE school_id=$1 AND id=$2 AND status='DRAFT'",
        [ctx.schoolId, service.id]);
      await audit(client,ctx,{action:'RELEASE_ACTIVATE',type:'RELEASE',id});
      return {data: updated};
    }
    return null;
  });
}
