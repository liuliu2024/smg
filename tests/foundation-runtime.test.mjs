import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {missingFoundationTestDb} from './foundation-harness.mjs';
import {demoFoundation} from './foundation-demo-fixtures.mjs';

const prefix = '/api/v1/foundation/';

test('D06–D08 real PostgreSQL worker and three DEMO workflows', {skip: missingFoundationTestDb}, async t => {
  const {transaction} = await demoFoundation(t);
  const {foundationHandler} = await import('../foundation/http.mjs');
  const {tickWorker} = await import('../foundation/runtime/index.mjs');
  const {processInbox} = await import('../foundation/runtime/events.mjs');
  const server = createServer((request, response) => foundationHandler(request, response));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_BASE_URL = origin;

  async function request(path, {method = 'GET', actor, body, key, version} = {}) {
    const headers = {origin, 'content-type': 'application/json'};
    if (actor) Object.assign(headers, {cookie: actor.cookie, 'x-csrf-token': actor.csrf});
    if (key) headers['idempotency-key'] = key;
    if (version !== undefined) headers['if-match'] = String(version);
    const response = await fetch(origin + prefix + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, headers: response.headers, ...await response.json()};
  }
  function success(result) {
    assert.ok(result.status >= 200 && result.status < 300, `Unexpected HTTP ${result.status} (${result.error?.code ?? 'no code'})`);
    return result.data;
  }
  async function login(schoolCode, account) {
    const result = await request('auth/demo-login', {method: 'POST', body: {schoolCode, account}});
    const identity = success(result);
    return {...identity, cookie: result.headers.get('set-cookie').split(';')[0], csrf: identity.csrfToken};
  }
  const post = (path, actor, body, key = randomUUID(), version) => request(path, {method: 'POST', actor, body, key, version});
  const get = (path, actor) => request(path, {actor});
  async function drain() {
    let idle = 0;
    for (let count = 0; count < 100; count++) {
      if (await tickWorker('foundation-integration-worker')) idle = 0;
      else if (++idle >= 3) return;
      else await delay(20);
    }
    assert.fail('Worker still has due jobs after 100 ticks');
  }
  async function row(sql, values) {
    return (await transaction(client => client.query(sql, values))).rows[0];
  }
  const [student, operator, betaStudent, betaOperator] = await Promise.all([
    login('alpha','student'), login('alpha','operator'), login('beta','student'), login('beta','operator')
  ]);
  const bookPath = 'services/library-reservation/instances';
  const scope = actor => [actor.schoolId, actor.environmentId];
  const createBook = (actor, key, fault) => post(bookPath, actor, {form: {bookId: 'demo-book', ...(fault ? {fault} : {})}}, key);

  await t.test('library idempotency, last copy competition, own instance and human pickup workflow', async () => {
    const key = randomUUID();
    const sameKey = await Promise.all([createBook(student, key), createBook(student, key)]);
    const first = success(sameKey[0]);
    const instanceId = first.instanceId ?? first.id;
    assert.equal(success(sameKey[1]).instanceId ?? success(sameKey[1]).id, instanceId);
    assert.equal((await createBook(student, key, 'BUSINESS_REJECT')).status, 409);
    assert.equal((await get(`instances/${instanceId}`, betaStudent)).status, 404);
    success(await createBook(student, randomUUID()));
    await drain();
    const {rows: operations} = await transaction(client => client.query(`SELECT status,instance_id FROM operations
      WHERE school_id=$1 AND environment_id=$2 AND action_code='library.reservation.create'`, scope(student)));
    assert.deepEqual(operations.map(item => item.status).sort(), ['BUSINESS_REJECTED','SUCCEEDED']);
    const winner = operations.find(item => item.status === 'SUCCEEDED');
    const task = await row('SELECT * FROM human_tasks WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3', [...scope(student), winner.instance_id]);
    assert.ok(task);
    assert.equal((await post(`admin/tasks/${task.id}/claim`, betaOperator, {}, randomUUID(), task.version)).status, 404);
    const claimed = success(await post(`admin/tasks/${task.id}/claim`, operator, {}, randomUUID(), task.version));
    const completes = await Promise.all([1,2].map(() => post(`admin/tasks/${task.id}/complete`, operator, {output:{ready:true}}, randomUUID(), claimed.version)));
    assert.deepEqual(completes.map(item => item.status).sort(),[200,409]);
    await transaction(async client => {
      await client.query('UPDATE human_tasks SET due_at=now() WHERE school_id=$1 AND environment_id=$2 AND id=$3',[...scope(student),task.id]);
      await client.query("UPDATE jobs SET run_at=now() WHERE school_id=$1 AND environment_id=$2 AND job_type='NODE_TIMEOUT' AND payload->>'taskId'=$3",[...scope(student),task.id]);
    });
    await drain();
    const terminal = await row('SELECT status,context FROM process_instances WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(student), winner.instance_id]);
    assert.equal(terminal.status, 'COMPLETED');
    assert.equal(JSON.stringify(terminal.context).includes('READY_FOR_PICKUP'), true);
  });

  await t.test('lost response recovery reads the existing receipt without executing twice', async () => {
    const created = success(await createBook(betaStudent, randomUUID(), 'TIMEOUT_AFTER_COMMIT'));
    const instanceId = created.instanceId ?? created.id;
    await drain();
    const operation = await row('SELECT * FROM operations WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3', [...scope(betaStudent), instanceId]);
    assert.equal(operation.status, 'UNKNOWN');
    const betaOwner = await login('beta','owner');
    const record = await row('SELECT id FROM cases WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3',
      [...scope(betaStudent),operation.id]);
    const casePath = 'admin/runtime/cases/' + record.id;
    assert.equal((await get(casePath,operator)).status,404);
    const open = success(await get(casePath,betaOperator));
    const assigned = success(await post(casePath+'/claim',betaOperator,{},randomUUID(),open.version));
    const investigated = success(await post(casePath+'/evidence',betaOperator,
      {reference:'DEMO-RECONCILE-01',summary:'已核对本地模拟请求记录，等待权威结果'},randomUUID(),assigned.version));
    const details = success(await get(casePath,betaOwner));
    const resolved = success(await post(casePath+'/decisions',betaOwner,
      {disposition:'STILL_UNKNOWN',evidenceId:details.evidence[0].id,reason:'先查询原操作'},randomUUID(),investigated.version));
    assert.equal(resolved.status,'WAITING_EXTERNAL');
    assert.equal((await row('SELECT status FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3',
      [...scope(betaStudent),operation.id])).status,'UNKNOWN');
    success(await post(`admin/operations/${operation.id}/query-result`, betaOperator, {}, randomUUID()));
    await drain();
    const updated = await row('SELECT status FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(betaStudent), operation.id]);
    assert.equal(updated.status, 'SUCCEEDED');
    assert.equal(success(await get(casePath,betaOwner)).status,'RESOLVED');
    const {count} = await row('SELECT count(*)::int AS count FROM demo_adapter_receipts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3', [...scope(betaStudent), operation.id]);
    assert.equal(count, 1);
    const {rows: attempts} = await transaction(client => client.query('SELECT kind FROM operation_attempts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 ORDER BY attempt_number', [...scope(betaStudent), operation.id]));
    assert.deepEqual(attempts.map(item => item.kind), ['EXECUTE','QUERY']);
    const {available} = await row("SELECT available FROM demo_library_titles WHERE school_id=$1 AND environment_id=$2 AND code='demo-book'", scope(betaStudent));
    assert.equal(available, 0);
  });

  async function energy(actor, fault) {
    const resources = success(await get('energy/resources', actor));
    const portId = resources[0].id;
    const tariff = success(await post('energy/quotes', actor, {portId}));
    return success(await post('energy/session-requests', actor, {portId, quoteId: tariff.quoteId ?? tariff.id, ...(fault ? {fault} : {})}));
  }
  function energyState(actor, id) {
    return row('SELECT domain_state FROM device_sessions WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(actor), id]);
  }
  await t.test('charging starts only on authoritative event and normal readings produce a simulated bill', async () => {
    const session = await energy(student);
    await drain();
    assert.equal((await energyState(student, session.sessionId)).domain_state, 'ACTIVE');
    success(await post(`energy/sessions/${session.sessionId}/stop-requests`, student, {}));
    await drain();
    assert.equal((await energyState(student, session.sessionId)).domain_state, 'ENDED');
    const bill = await row('SELECT status,amount_minor,evidence_refs FROM bills WHERE school_id=$1 AND environment_id=$2 AND session_id=$3 ORDER BY revision DESC LIMIT 1', [...scope(student), session.sessionId]);
    assert.ok(bill && Number(bill.amount_minor) > 0);
    assert.ok(bill.evidence_refs);
    assert.equal((await get(`energy/sessions/${session.sessionId}`, betaStudent)).status, 404);
    const ack = await energy(betaStudent, 'ACK_ONLY');
    await drain();
    assert.equal((await energyState(betaStudent, ack.sessionId)).domain_state, 'STARTING');
  });

  await t.test('meter epoch reset withholds a confirmed amount', async () => {
    const session = await energy(student,'METER_RESET');
    await drain();
    assert.equal((await energyState(student,session.sessionId)).domain_state,'ACTIVE');
    success(await post(`energy/sessions/${session.sessionId}/stop-requests`,student,{}));
    await drain();
    assert.equal((await energyState(student,session.sessionId)).domain_state,'ENDED');
    const bill = await row('SELECT status,amount_minor FROM bills WHERE school_id=$1 AND environment_id=$2 AND session_id=$3 ORDER BY revision DESC LIMIT 1',[...scope(student),session.sessionId]);
    assert.equal(bill.status,'PENDING_EVIDENCE');
    assert.equal(bill.amount_minor,null);
  });
  await t.test('locker signed early handover matches later wait, open alone does not sign off', async () => {
    const pickupFor = async actor => success(await get('parcel/pickups', actor)).find(item => item.entitlementToken);
    const openOnly = await pickupFor(student);
    const unlockPath = id => `parcel/pickups/${id}/unlock-requests`;
    const requestBody = {entitlementToken: openOnly.entitlementToken, fault: 'OPEN_NO_COLLECTION'};
    const key = randomUUID();
    const unlocked = success(await post(unlockPath(openOnly.id), student, requestBody, key));
    assert.deepEqual(success(await post(unlockPath(openOnly.id), student, requestBody, key)), unlocked);
    assert.equal(await tickWorker('it-locker-open'), true);
    const stillOpen = await row('SELECT status FROM demo_parcel_pickups WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(student), openOnly.id]);
    assert.notEqual(stillOpen.status, 'COLLECTED');
    assert.equal((await post(unlockPath(openOnly.id), betaStudent, requestBody)).status, 404);
    const {count: subscriptionsBefore} = await row('SELECT count(*)::int AS count FROM event_subscriptions WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3', [...scope(student), unlocked.instanceId]);
    assert.equal(subscriptionsBefore, 0);
    const connection = await row(`SELECT c.id,c.secret_ref FROM operations o JOIN connections c
      ON c.school_id=o.school_id AND c.environment_id=o.environment_id AND c.id=(o.binding_snapshot->>'connectionId')::uuid
      WHERE o.school_id=$1 AND o.environment_id=$2 AND o.id=$3`, [...scope(student), unlocked.operationId]);
    const event = {eventId: randomUUID(),eventType:'parcel.collected',aggregateId:openOnly.id,version:1,occurredAt:new Date().toISOString(),data:{pickupId:openOnly.id}};
    const timestamp = String(Math.floor(Date.now()/1000));
    async function callback(data, invalidSignature = false) {
      const raw = JSON.stringify(data);
      const signature = invalidSignature ? '0'.repeat(64) : createHmac('sha256', process.env[connection.secret_ref]).update(timestamp + '.').update(raw).digest('hex');
      const response = await fetch(origin + prefix + 'callbacks/' + connection.id, {method:'POST',headers:{'content-type':'application/json','x-campus-timestamp':timestamp,'x-campus-signature':signature},body:raw});
      return {status:response.status,...await response.json()};
    }
    assert.equal((await callback(event,true)).status,401);
    const early = success(await callback(event));
    assert.equal(early.duplicate,false);
    assert.equal(success(await callback(event)).duplicate,true);
    assert.equal((await callback({...event,version:2})).status,409);
    const eventContext = {...student,role:'SYSTEM',userId:null,requestId:randomUUID()};
    await transaction(client => processInbox(client,eventContext,early.eventId));
    const inbox = await row('SELECT status FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(student), early.eventId]);
    assert.equal(inbox.status,'PROCESSED');
    await drain();
    const match = await row('SELECT matched_event_id FROM event_subscriptions WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3', [...scope(student), unlocked.instanceId]);
    assert.equal(match.matched_event_id,early.eventId);
    const collected = await pickupFor(betaStudent);
    const outcome = success(await post(unlockPath(collected.id), betaStudent, {entitlementToken: collected.entitlementToken, fault: 'DUPLICATE_HANDOVER'}));
    await drain();
    const final = await row('SELECT status,operation_id FROM demo_parcel_pickups WHERE school_id=$1 AND environment_id=$2 AND id=$3', [...scope(betaStudent), collected.id]);
    assert.equal(final.status, 'COLLECTED');
    assert.equal(final.operation_id, outcome.operationId);
    const {count} = await row("SELECT count(*)::int AS count FROM event_inbox WHERE school_id=$1 AND environment_id=$2 AND event_type='parcel.collected' AND aggregate_id=$3", [...scope(betaStudent), collected.id]);
    assert.equal(count, 1);
  });

  await t.test('expired physical dispatch is queried instead of replayed', async () => {
    const started = await energy(student,'ACK_ONLY');
    await transaction(async client => {
      await client.query("UPDATE operations SET status='DISPATCHING',attempts=1 WHERE school_id=$1 AND environment_id=$2 AND id=$3",[...scope(student),started.operationId]);
      await client.query(`INSERT INTO operation_attempts(id,school_id,environment_id,operation_id,attempt_number,kind,status,started_at)
        VALUES($1,$2,$3,$4,1,'EXECUTE','RUNNING',now()-interval '2 minutes')`,[randomUUID(),...scope(student),started.operationId]);
      await client.query(`UPDATE jobs SET status='RUNNING',locked_by='lost-physical-worker',locked_at=now()-interval '2 minutes',
        lease_until=now()-interval '1 minute',attempts=1 WHERE school_id=$1 AND environment_id=$2
        AND job_type='EXECUTE_OPERATION' AND payload->>'operationId'=$3`,[...scope(student),started.operationId]);
    });
    await drain();
    const status = await row('SELECT status FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3',[...scope(student),started.operationId]);
    assert.equal(status.status,'UNKNOWN');
    const {rows: attempts} = await transaction(client => client.query('SELECT kind FROM operation_attempts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 ORDER BY attempt_number',[...scope(student),started.operationId]));
    assert.deepEqual(attempts.map(item=>item.kind),['EXECUTE','QUERY']);
    const {count} = await row('SELECT count(*)::int AS count FROM demo_adapter_receipts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3',[...scope(student),started.operationId]);
    assert.equal(count,0);
    assert.notEqual((await energyState(student,started.sessionId)).domain_state,'ACTIVE');
  });
  await t.test('worker resumes after committed unsent job loses its lease and later revocation blocks another send', async () => {
    const integrator = await login('alpha','integrator');
    async function prepareBook(code) {
      await transaction(client => client.query(`INSERT INTO demo_library_titles(id,school_id,environment_id,code,title,available)
        VALUES($1,$2,$3,$4,'演示故障验收书',1)`, [randomUUID(), ...scope(student), code]));
      const instance = success(await post(bookPath,student,{form:{bookId:code}}));
      for (let count = 0; count < 20; count++) {
        const worked = await tickWorker('it-prepare-operation');
        const op = await row('SELECT id,status,binding_snapshot FROM operations WHERE school_id=$1 AND environment_id=$2 AND instance_id=$3', [...scope(student),instance.id]);
        if (op) {
          assert.equal(op.status,'CREATED');
          return op;
        }
        if (!worked) await delay(20);
      }
      assert.fail('Operation was not prepared after 20 ticks');
    }
    const recover = await prepareBook('crash-fixture');
    await transaction(client => client.query(`UPDATE jobs SET status='RUNNING',locked_by='crashed-worker',
      locked_at=now()-interval '2 minutes',lease_until=now()-interval '1 minute',attempts=1
      WHERE school_id=$1 AND environment_id=$2 AND job_type='EXECUTE_OPERATION' AND payload->>'operationId'=$3`, [...scope(student),recover.id]));
    await drain();
    assert.equal((await row('SELECT status FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3',[...scope(student),recover.id])).status,'SUCCEEDED');
    const {count: executes} = await row("SELECT count(*)::int AS count FROM operation_attempts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3 AND kind='EXECUTE'",[...scope(student),recover.id]);
    assert.equal(executes,1);
    const revoked = await prepareBook('revoked-fixture');
    const path = 'admin/connections/' + revoked.binding_snapshot.connectionId;
    const connection = success(await get(path,integrator));
    success(await post(path+'/disable',integrator,{},randomUUID(),connection.version));
    await drain();
    const blocked = await row('SELECT status,error_class FROM operations WHERE school_id=$1 AND environment_id=$2 AND id=$3',[...scope(student),revoked.id]);
    assert.equal(blocked.status,'TECHNICAL_FAILED');
    assert.equal(blocked.error_class,'CONNECTION_REVOKED_UNSENT');
    const {count: receipts} = await row('SELECT count(*)::int AS count FROM demo_adapter_receipts WHERE school_id=$1 AND environment_id=$2 AND operation_id=$3',[...scope(student),revoked.id]);
    assert.equal(receipts,0);
  });

  await t.test('HTTP registry protects last admin, rejects cross-school writes, and revokes current sessions', async () => {
    const admin = await login('alpha','admin');
    const otherUser = await get('admin/users/'+betaStudent.userId,admin);
    assert.equal(otherUser.status,404);
    const forbiddenEnv = await post('admin/schools/'+betaStudent.schoolId+'/environments',admin,{code:'foreign-test',mode:'TEST'});
    assert.equal(forbiddenEnv.status,404);
    const environments = 'admin/schools/'+admin.schoolId+'/environments';
    const env = success(await post(environments,admin,{code:'it-registry',mode:'TEST'}));
    assert.equal(env.mode,'TEST');
    assert.equal(success(await get('auth/me?environmentCode=it-registry',admin)).environmentId,env.id);
    assert.equal((await post(environments,admin,{code:'blocked-production',mode:'PRODUCTION'})).status,422);
    const last = success(await get('admin/users/'+admin.userId,admin));
    const patch = (path, body, version) => request(path,{method:'PATCH',actor:admin,body,version});
    assert.equal((await patch('admin/users/'+admin.userId,{status:'DISABLED'},last.version)).status,409);
    const operatorPath = 'admin/users/'+operator.userId;
    const user = success(await get(operatorPath,admin));
    assert.equal((await patch(operatorPath,{memberships:[{role:'OPERATOR',type:'SCHOOL',id:'*'}]},user.version)).status,422);
    success(await patch(operatorPath,{memberships:[]},user.version));
    assert.equal((await get('auth/me',operator)).status,401);
    assert.equal((await get('auth/me',betaOperator)).status,200);
  });
});
