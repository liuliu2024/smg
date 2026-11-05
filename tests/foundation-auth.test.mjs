import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {isolatedFoundation, missingFoundationTestDb} from './foundation-harness.mjs';

const origin = 'http://localhost:3998';
const routeUrl = new URL(`${origin}/api/v1/foundation`);

async function fixture(client, code) {
  const school = randomUUID();
  const environment = randomUUID();
  const accounts = {};
  await client.query("INSERT INTO schools(id,code,name,status) VALUES($1,$2,$2,'ACTIVE')", [school, code]);
  await client.query("INSERT INTO environments(id,school_id,code,mode) VALUES($1,$2,$3,'DEMO')", [environment, school, `${code}-demo`]);
  for (const [account, role] of [['student','END_USER'], ['owner','SERVICE_OWNER'], ['integrator','INTEGRATOR']]) {
    const id = randomUUID();
    await client.query('INSERT INTO users(id,school_id,campus_id,display_name) VALUES($1,$2,$3,$3)', [id, school, account]);
    await client.query('INSERT INTO memberships(id,school_id,user_id,role_code) VALUES($1,$2,$3,$4)', [randomUUID(), school, id, role]);
    await client.query('INSERT INTO demo_accounts(school_id,user_id,account,default_role) VALUES($1,$2,$3,$4)', [school, id, account, role]);
    accounts[account] = id;
  }
  return {school, environment, accounts};
}

test('D03 and D04 real PostgreSQL session authorization and tenant catalog', {skip: missingFoundationTestDb}, async t => {
  const {migrate, transaction} = await isolatedFoundation(t);
  process.env.APP_MODE = 'demo';
  process.env.APP_BASE_URL = origin;
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  await migrate();
  const {demoLogin, authenticate, switchRole, logout} = await import('../foundation/auth.mjs');
  const {catalogRoute} = await import('../foundation/catalog.mjs');
  const [alpha, beta] = await transaction(async client => [await fixture(client, 'alpha'), await fixture(client, 'beta')]);

  async function login(schoolCode, account) {
    const headers = new Map();
    const identity = await demoLogin({schoolCode, account}, {headers: {origin}}, {
      setHeader(name, value) { headers.set(name, value); }
    }, randomUUID());
    const cookie = headers.get('Set-Cookie');
    assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=28800/);
    return {cookie: cookie.split(';')[0], csrf: identity.csrfToken, identity};
  }

  function context(session, method = 'GET', headers = {}, url = routeUrl) {
    return authenticate({method, headers: {cookie: session.cookie, origin, 'x-csrf-token': session.csrf, ...headers}}, url, randomUUID());
  }

  const student = await login('alpha', 'student');
  const owner = await login('alpha', 'owner');
  const betaOwner = await login('beta', 'owner');

  await t.test('session hash and lifetime, Origin and CSRF, and own-school environment', async () => {
    const {rows: [session]} = await transaction(client => client.query(`SELECT token_hash,
      EXTRACT(epoch FROM (expires_at-now()))::int AS remaining FROM sessions WHERE school_id=$1 AND user_id=$2`,
    [alpha.school, alpha.accounts.student]));
    assert.match(session.token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(session.token_hash, student.cookie.split('=')[1]);
    assert.ok(session.remaining > 28700 && session.remaining <= 28800);
    assert.equal((await context(student)).schoolId, alpha.school);
    await assert.rejects(context(student, 'POST', {origin: 'https://external.invalid'}), {status: 403, code: 'INVALID_ORIGIN'});
    await assert.rejects(context(student, 'POST', {'x-csrf-token': owner.csrf}), {status: 403, code: 'CSRF_INVALID'});
    const otherEnvironment = new URL(`${routeUrl}?environmentCode=beta-demo`);
    await assert.rejects(context(student, 'GET', {}, otherEnvironment), {status: 404, code: 'ENVIRONMENT_NOT_FOUND'});
    await assert.rejects(switchRole(await context(student, 'POST'), 'SCHOOL_ADMIN', routeUrl), {status: 403, code: 'ROLE_FORBIDDEN'});
  });

  await t.test('catalog writes reject students and cross-school owners, reads stay tenant-scoped', async () => {
    const body = {code: 'test-service', name: '测试服务', scenarioCode: 'library', businessOwnerId: alpha.accounts.owner,
      technicalOwnerId: alpha.accounts.integrator, authorityPolicy: {authority: 'DEMO'}};
    const request = {url: routeUrl};
    await assert.rejects(catalogRoute(await context(student, 'POST'), 'POST', ['admin','services'], body, request), {status: 403});
    const crossSchoolOwner = {...body, technicalOwnerId: beta.accounts.integrator};
    await assert.rejects(catalogRoute(await context(owner, 'POST'), 'POST', ['admin','services'], crossSchoolOwner, request),
      {status: 422, code: 'OWNER_INVALID'});
    const {data: service} = await catalogRoute(await context(owner, 'POST'), 'POST', ['admin','services'], body, request);
    assert.equal(service.school_id, alpha.school);
    const {data: services} = await catalogRoute(await context(betaOwner), 'GET', ['admin','services'], {}, request);
    assert.equal(services.length, 0);
    await assert.rejects(catalogRoute(await context(betaOwner), 'GET', ['admin','services',service.id], {}, request), {status: 404});
  });

  await t.test('role revocation, account disabling and logout affect current sessions immediately', async () => {
    await transaction(client => client.query("DELETE FROM memberships WHERE school_id=$1 AND user_id=$2 AND role_code='SERVICE_OWNER'",
      [alpha.school, alpha.accounts.owner]));
    await assert.rejects(context(owner), {status: 401, code: 'ROLE_REVOKED'});
    await transaction(client => client.query("UPDATE users SET status='DISABLED' WHERE school_id=$1 AND id=$2", [alpha.school, alpha.accounts.student]));
    await assert.rejects(context(student), {status: 401, code: 'SESSION_EXPIRED'});
    await logout(await context(betaOwner, 'POST'), {setHeader() {}});
    await assert.rejects(context(betaOwner), {status: 401, code: 'SESSION_EXPIRED'});
  });

  await t.test('production has no fallback to demo sign-in', async () => {
    process.env.APP_MODE = 'production';
    try {
      await assert.rejects(login('alpha', 'student'), {status: 503, code: 'SSO_NOT_CONNECTED'});
    } finally {
      process.env.APP_MODE = 'demo';
    }
  });
});
