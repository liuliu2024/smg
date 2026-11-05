import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {isolatedFoundation, missingFoundationTestDb, oneSuccessful} from './foundation-harness.mjs';

async function tenant(client, code, packageId, contractId) {
  const school = randomUUID();
  const environment = randomUUID();
  const user = randomUUID();
  const service = randomUUID();
  const connection = randomUUID();
  const binding = randomUUID();
  await client.query("INSERT INTO schools(id,code,name,status) VALUES($1,$2,'虚构测试学校','ACTIVE')", [school, code]);
  await client.query("INSERT INTO environments(id,school_id,code,mode) VALUES($1,$2,'demo','DEMO')", [environment, school]);
  await client.query("INSERT INTO users(id,school_id,campus_id,display_name) VALUES($1,$2,'tester','虚构测试用户')", [user, school]);
  await client.query(`INSERT INTO services(id,school_id,code,name,scenario_code,business_owner_id,technical_owner_id,authority_policy)
    VALUES($1,$2,'fixture','测试服务','FIXTURE',$3,$3,'{}')`, [service, school, user]);
  await client.query(`INSERT INTO connections(id,school_id,environment_id,name,adapter_package_id,mode,config)
    VALUES($1,$2,$3,'Fixture',$4,'DEMO','{}')`, [connection, school, environment, packageId]);
  await client.query(`INSERT INTO capability_bindings(id,school_id,environment_id,contract_id,connection_id,support,retry_class)
    VALUES($1,$2,$3,$4,$5,'SUPPORTED','READ_SAFE')`, [binding, school, environment, contractId, connection]);
  return {school, environment, user, service, connection, binding};
}

function insertRelease(client, tenant, status, number) {
  return client.query(`INSERT INTO releases(id,school_id,environment_id,service_id,release_number,status,definition,created_by)
    VALUES($1,$2,$3,$4,$5,$6,'{}',$7) RETURNING id`,
  [randomUUID(), tenant.school, tenant.environment, tenant.service, number, status, tenant.user]);
}

function insertEvent(client, tenant) {
  return client.query(`INSERT INTO event_inbox(id,school_id,environment_id,connection_id,external_event_id,event_type,payload,payload_hash,occurred_at)
    VALUES($1,$2,$3,$4,'event-fixture','FIXTURE','{}',$5,now())`,
  [randomUUID(), tenant.school, tenant.environment, tenant.connection, 'c'.repeat(64)]);
}

test('D02 real PostgreSQL migration and tenant constraints', {skip: missingFoundationTestDb}, async t => {
  const {migrate, transaction} = await isolatedFoundation(t);
  let applied;
  await t.test('empty database is UTF-8 and concurrent migration records each checksum once', async () => {
    const executions = await Promise.all([migrate(), migrate()]);
    applied = executions.flat();
    assert.ok(applied.length >= 2);
    assert.equal(new Set(applied).size, applied.length);
    assert.deepEqual(await migrate(), []);
    await transaction(async client => {
      assert.equal((await client.query('SHOW server_encoding')).rows[0].server_encoding, 'UTF8');
      const {rows} = await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name');
      assert.deepEqual(rows.map(row => row.name), [...applied].sort());
      for (const row of rows) assert.match(row.checksum, /^[a-f0-9]{64}$/);
    });
  });
  await t.test('changed recorded checksum rejects repeat migration', async () => {
    const name = applied[0];
    const {rows: [previous]} = await transaction(client => client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]));
    await transaction(client => client.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [name, '0'.repeat(64)]));
    try {
      await assert.rejects(migrate, /checksum mismatch/);
    } finally {
      await transaction(client => client.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [name, previous.checksum]));
    }
    assert.deepEqual(await migrate(), []);
  });

  const [alpha, beta] = await transaction(async client => {
    const packageId = randomUUID();
    const contractId = randomUUID();
    await client.query("INSERT INTO adapter_packages(id,code,version,manifest,manifest_digest) VALUES($1,'fixture','1','{}',$2)", [packageId, 'a'.repeat(64)]);
    await client.query(`INSERT INTO capability_contracts(id,code,version,input_schema,output_schema,manifest,digest)
      VALUES($1,'fixture','1','{}','{}','{}',$2)`, [contractId, 'b'.repeat(64)]);
    return [await tenant(client, 'alpha-fixture', packageId, contractId), await tenant(client, 'beta-fixture', packageId, contractId)];
  });

  await t.test('combined foreign keys reject cross-school actors and connection references', async () => {
    await assert.rejects(transaction(client => insertRelease(client, {...alpha, user: beta.user}, 'DRAFT', 1)), {code: '23503'});
    await assert.rejects(transaction(client => insertEvent(client, {...alpha, connection: beta.connection})), {code: '23503'});
  });
  await t.test('only one active release wins under competing transactions', async () => {
    const results = await Promise.allSettled([1, 2].map(number => transaction(client => insertRelease(client, alpha, 'ACTIVE', number))));
    oneSuccessful(results, '23505');
    await transaction(client => insertRelease(client, beta, 'ACTIVE', 1));
  });
  await t.test('task node and release-service relationships cannot mix school or service', async () => {
    const [alphaInstance, betaNode, otherService, alphaRelease] = await transaction(async client => {
      const instances = [];
      for (const tenant of [alpha,beta]) {
        const {rows:[release]} = await client.query("SELECT id FROM releases WHERE school_id=$1 AND environment_id=$2 AND status='ACTIVE'",[tenant.school,tenant.environment]);
        const instance = randomUUID();
        await client.query(`INSERT INTO process_instances(id,school_id,environment_id,service_id,release_id,subject_user_id,status,current_node,context)
          VALUES($1,$2,$3,$4,$5,$6,'RUNNING','sample','{}')`,[instance,tenant.school,tenant.environment,tenant.service,release.id,tenant.user]);
        instances.push({id:instance,releaseId:release.id});
      }
      const node = randomUUID();
      await client.query(`INSERT INTO node_executions(id,school_id,environment_id,instance_id,node_id,status)
        VALUES($1,$2,$3,$4,'sample','RUNNING')`,[node,beta.school,beta.environment,instances[1].id]);
      const service = randomUUID();
      await client.query(`INSERT INTO services(id,school_id,code,name,scenario_code,business_owner_id,technical_owner_id,authority_policy)
        VALUES($1,$2,'other-fixture','不同服务','OTHER',$3,$3,'{}')`,[service,alpha.school,alpha.user]);
      return [instances[0].id,node,service,instances[0].releaseId];
    });
    await assert.rejects(transaction(client => client.query(`INSERT INTO human_tasks(id,school_id,environment_id,instance_id,node_execution_id,role_code,scope_type,scope_id)
      VALUES($1,$2,$3,$4,$5,'OPERATOR','SERVICE',$6)`,[randomUUID(),alpha.school,alpha.environment,alphaInstance,betaNode,alpha.service])),{code:'23503'});
    await assert.rejects(transaction(client => client.query(`INSERT INTO process_instances(id,school_id,environment_id,service_id,release_id,subject_user_id,status,current_node,context)
      VALUES($1,$2,$3,$4,$5,$6,'RUNNING','sample','{}')`,[randomUUID(),alpha.school,alpha.environment,otherService,alphaRelease,alpha.user])),{code:'23503'});
  });
  await t.test('same external event ID is unique per connection under a race', async () => {
    oneSuccessful(await Promise.allSettled([1, 2].map(() => transaction(client => insertEvent(client, alpha)))), '23505');
    await transaction(client => insertEvent(client, beta));
  });
  await t.test('only one unclosed device session wins for a charging port', async () => {
    const resource = randomUUID();
    const operation = randomUUID();
    await transaction(async client => {
      await client.query(`INSERT INTO resources(id,school_id,environment_id,code,resource_type,authority,config)
        VALUES($1,$2,$3,'port-fixture','CHARGE_PORT','DEMO','{}')`, [resource, alpha.school, alpha.environment]);
      await client.query(`INSERT INTO operations(id,school_id,environment_id,binding_id,subject_user_id,actor_id,action_code,business_key,
        idempotency_key,request_hash,request,binding_snapshot,side_effect,retry_class,status,deadline_at)
        VALUES($1,$2,$3,$4,$5,$5,'charge.start','fixture','fixture',$6,'{}','{}','PHYSICAL','QUERY_BEFORE_RETRY','CREATED',now())`,
      [operation, alpha.school, alpha.environment, alpha.binding, alpha.user, 'd'.repeat(64)]);
    });
    const insert = state => transaction(client => client.query(`INSERT INTO device_sessions(id,school_id,environment_id,resource_id,subject_user_id,start_operation_id,domain_state,tariff_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,'{}')`, [randomUUID(), alpha.school, alpha.environment, resource, alpha.user, operation, state]));
    oneSuccessful(await Promise.allSettled([insert('STARTING'), insert('ACTIVE')]), '23505');
    await insert('ENDED');
  });
});
