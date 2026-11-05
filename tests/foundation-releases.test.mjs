import assert from 'node:assert/strict';
import {test} from 'node:test';
import {missingFoundationTestDb} from './foundation-harness.mjs';
import {demoFoundation} from './foundation-demo-fixtures.mjs';

test('D04 and D05 real PostgreSQL release governance', {skip: missingFoundationTestDb}, async t => {
  const {transaction, session, assets, seed, requestUrl} = await demoFoundation(t);
  const {releaseRoute, runReleaseTest, resolveManifest} = await import('../foundation/releases.mjs');
  const {catalogRoute} = await import('../foundation/catalog.mjs');
  const {tickWorker} = await import('../foundation/runtime/index.mjs');
  const [owner, approver, integrator, student, betaOwner] = await Promise.all([
    session('alpha','owner'), session('alpha','approver'), session('alpha','integrator'), session('alpha','student'), session('beta','owner')
  ]);
  const scope = await owner.context();
  const {rows: [service]} = await transaction(client => client.query("SELECT * FROM services WHERE school_id=$1 AND code='library-reservation'", [scope.schoolId]));
  const definition = assets.templates.find(item => item.code === 'library-reservation').definition;

  async function release(actor, method, path, body = {}, version) {
    return (await releaseRoute(await actor.context(), method, path, body, {url: requestUrl, version})).data;
  }
  function draft(actor, content = definition) {
    return release(actor, 'POST', ['admin','services',service.id,'releases'], {definition: content});
  }
  function action(actor, record, operation, body = {}) {
    return release(actor, 'POST', ['admin','releases',record.id,operation], body, record.version);
  }

  await t.test('seed is idempotent and secret refs are never exported', async () => {
    assert.deepEqual(await seed(), {seeded: false, schools: 2});
    const {data: connections} = await catalogRoute(await integrator.context(), 'GET', ['admin','connections'], {}, {url: requestUrl});
    assert.ok(connections.length > 0);
    assert.ok(connections.every(item => item.secretConfigured === true && !Object.hasOwn(item, 'secret_ref')));
    const publicJson = JSON.stringify(connections);
    assert.equal(publicJson.includes('FOUNDATION_CALLBACK_'), false);
    for (const reference of process.env.ADAPTER_SECRET_ALLOWLIST.split(',')) {
      assert.equal(publicJson.includes(process.env[reference]), false);
    }
    const item = connections[0];
    const payload = {name: item.name, adapterPackageId: item.adapter_package_id, mode: 'DEMO', config: {apiKey: 'forbidden'}};
    await assert.rejects(catalogRoute(await integrator.context(), 'POST', ['admin','connections'], payload, {url: requestUrl}), {status: 422});
    await assert.rejects(catalogRoute(await integrator.context(),'POST',['admin','connections'],
      {...payload,config:{},secretRef:'FOUNDATION_CALLBACK_BETA_LIBRARY'},{url:requestUrl}),
      {status:422,code:'SECRET_REFERENCE_INVALID'});
  });
  await t.test('validation rejects wrong authority and production with demo dependencies', async () => {
    const invalid = structuredClone(definition);
    invalid.policy.authority = 'other-authority';
    const invalidDraft = await draft(owner, invalid);
    const checked = await action(owner, invalidDraft, 'validate');
    assert.equal(checked.status, 'DRAFT');
    assert.ok(checked.blockingErrors.some(error => error.fieldPath === 'policy.authority'));
    const prod = await transaction(client => resolveManifest(client, {...scope, environmentMode: 'PRODUCTION'}, service, definition));
    assert.ok(prod.blockingErrors.some(error => error.fieldPath === 'bindingCode'));
    assert.equal(prod.manifest, undefined);
  });

  await t.test('tested matching release requires independent approval and activation supersedes old version', async () => {
    const created = await draft(owner);
    await assert.rejects(draft(student), {status: 404});
    await assert.rejects(release(betaOwner, 'GET', ['admin','releases',created.id]), {status: 404});
    await assert.rejects(release(owner, 'POST', ['admin','releases',created.id,'validate']), {status: 428});
    const validated = await action(owner, created, 'validate');
    assert.equal(validated.status, 'VALIDATED');
    assert.match(validated.digest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(validated).includes('FOUNDATION_CALLBACK_'), false);
    await assert.rejects(action(owner, validated, 'submit'), {status: 409});
    await assert.rejects(action(owner, created, 'validate'), {status: 409, code: 'VERSION_CONFLICT'});
    const queued = await action(integrator, validated, 'test-runs');
    assert.equal(queued.status, 'RUNNING');
    await tickWorker('it-release-worker', {RELEASE_TEST: runReleaseTest});
    const tested = await release(owner, 'GET', ['admin','releases',created.id]);
    assert.equal(tested.status, 'TEST_PASSED');
    assert.ok(tested.testRuns.some(run => run.status === 'PASSED' && run.digest === tested.digest));
    const pending = await action(owner, tested, 'submit');
    assert.equal(pending.status, 'PENDING_APPROVAL');
    await owner.switch('RELEASE_APPROVER');
    try {
      await assert.rejects(action(owner, pending, 'approve', {reason: '同一提交人切换岗位'}), {status: 403, code: 'SELF_APPROVAL_FORBIDDEN'});
    } finally {
      await owner.switch('SERVICE_OWNER');
    }
    const approved = await action(approver, pending, 'approve', {reason: '独立审批测试'});
    await assert.rejects(releaseRoute({...await approver.context(),environmentMode:'TEST'},'POST',
      ['admin','releases',approved.id,'activate'],{},{url:requestUrl,version:approved.version}),
      {status:503,code:'ENVIRONMENT_NOT_CONNECTED'});
    const {data:suspended} = await catalogRoute(await owner.context(),'POST',['admin','services',service.id,'suspend'],
      {reason:'暂停新预约进行版本验证'},{url:requestUrl,version:service.version});
    assert.equal(suspended.status,'SUSPENDED');
    const active = await action(approver, approved, 'activate');
    assert.equal(active.status, 'ACTIVE');
    const {data:stillSuspended} = await catalogRoute(await owner.context(),'GET',['admin','services',service.id],{}, {url:requestUrl});
    assert.equal(stillSuspended.status,'SUSPENDED');
    const {data:resumed} = await catalogRoute(await owner.context(),'POST',['admin','services',service.id,'resume'],
      {reason:'确认恢复新预约'},{url:requestUrl,version:stillSuspended.version});
    assert.equal(resumed.status,'ACTIVE');
    const {rows} = await transaction(client => client.query(`SELECT status FROM releases
      WHERE school_id=$1 AND environment_id=$2 AND service_id=$3 AND status IN ('ACTIVE','SUPERSEDED')`, [scope.schoolId,scope.environmentId,service.id]));
    assert.deepEqual(rows.map(row => row.status).sort(), ['ACTIVE','SUPERSEDED']);
    await assert.rejects(action(owner, active, 'reopen'), {status: 409, code: 'RELEASE_IMMUTABLE'});
    const {rows:[previous]} = await transaction(client => client.query(`SELECT * FROM releases
      WHERE school_id=$1 AND environment_id=$2 AND service_id=$3 AND status='SUPERSEDED'`,
      [scope.schoolId,scope.environmentId,service.id]));
    const rollback = await action(owner,previous,'rollback-request',{reason:'验证历史版本依赖仍有效'});
    assert.equal(rollback.status,'DRAFT');
    assert.equal(rollback.rollback_source_id,previous.id);
    assert.deepEqual(rollback.definition,previous.definition);
    await assert.rejects(release(owner,'PATCH',['admin','releases',rollback.id],{definition},rollback.version),
      {status:409,code:'ROLLBACK_IMMUTABLE'});
    const validatedRollback = await action(owner,rollback,'validate');
    assert.equal(validatedRollback.digest,previous.digest);
    await assert.rejects(action(approver,validatedRollback,'activate'),{status:409});
  });

  await t.test('a service-scoped integrator cannot inspect unrelated releases or mutate shared connections', async () => {
    const {rows:[unrelated]} = await transaction(client => client.query(`SELECT r.id FROM releases r JOIN services s
      ON s.school_id=r.school_id AND s.id=r.service_id WHERE r.school_id=$1 AND r.environment_id=$2 AND s.code='energy-charge'`,
      [scope.schoolId,scope.environmentId]));
    const scopedIntegrator = {...await integrator.context(),scopes:[{type:'SERVICE',id:service.id}]};
    const {data:list} = await releaseRoute(scopedIntegrator,'GET',['admin','releases'],{}, {url:requestUrl});
    assert.ok(list.length && list.every(item=>item.service_id===service.id));
    await assert.rejects(releaseRoute(scopedIntegrator,'GET',['admin','releases',unrelated.id],{}, {url:requestUrl}),{status:404});
    const {data:[connection]} = await catalogRoute(await integrator.context(),'GET',['admin','connections'],{}, {url:requestUrl});
    await assert.rejects(catalogRoute(scopedIntegrator,'POST',['admin','connections',connection.id,'disable'],{},
      {url:requestUrl,version:connection.version}),{status:403,code:'SCHOOL_SCOPE_REQUIRED'});
  });

  await t.test('onboarding gates require ordered evidence, scoped reviewer and If-Match', async () => {
    const {onboardingRoute} = await import('../foundation/onboarding.mjs');
    const url = requestUrl;
    const path = ['admin','onboarding-projects'];
    const {data: project} = await onboardingRoute(await integrator.context(), 'POST', path, {serviceId:service.id}, {url});
    const details = [...path,project.id];
    const discovery = [...details,'gates','DISCOVERY'];
    const submission = {reason:'演示接入材料',material:{system:'馆藏演示系统',workflow:'预约及馆员办理',provider:'模拟馆方'}};
    await assert.rejects(onboardingRoute(await betaOwner.context(), 'GET', details, {}, {url}), {status:404});
    await assert.rejects(onboardingRoute(await integrator.context(), 'POST', [...details,'gates','TESTING','submit'], submission, {url,version:project.version}), {status:409,code:'GATE_OUT_OF_ORDER'});
    await assert.rejects(onboardingRoute(await integrator.context(), 'POST', [...discovery,'submit'], submission, {url}), {status:428});
    const {data: submitted} = await onboardingRoute(await integrator.context(), 'POST', [...discovery,'submit'], submission, {url,version:project.version});
    const decision = {decision:'APPROVE',reason:'业务负责人核实材料'};
    await assert.rejects(onboardingRoute(await integrator.context(), 'POST', [...discovery,'review'], decision, {url,version:submitted.version}), {status:403});
    const {data: approved} = await onboardingRoute(await owner.context(), 'POST', [...discovery,'review'], decision, {url,version:submitted.version});
    assert.equal(approved.stage,'RESPONSIBILITY');
    const {data: history} = await onboardingRoute(await owner.context(), 'GET', details, {}, {url});
    assert.deepEqual(history.reviews.map(item => item.decision), ['SUBMIT','APPROVE']);
  });
  await t.test('test proof cannot authorize release after binding dependencies change', async () => {
    const validated = await action(owner, await draft(owner), 'validate');
    const queued = await action(integrator, validated, 'test-runs');
    const connectionId = validated.resolved_manifest.bindings['library.reservation.create'].connectionId;
    const ctx = await integrator.context();
    const {data: connection} = await catalogRoute(ctx, 'GET', ['admin','connections',connectionId], {}, {url: requestUrl});
    await catalogRoute(ctx, 'POST', ['admin','connections',connectionId,'test-read'], {}, {url: requestUrl, version: connection.version});
    await tickWorker('it-release-worker', {RELEASE_TEST: runReleaseTest});
    const failed = await release(integrator, 'GET', ['admin','test-runs',queued.id]);
    assert.equal(failed.status, 'FAILED');
    const refreshed = await release(owner, 'GET', ['admin','releases',validated.id]);
    assert.equal(refreshed.status, 'VALIDATED');
    await assert.rejects(action(owner, refreshed, 'submit'), {status: 409});
  });
});
