import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {closeDatabase, digest, json, scoped, transaction} from './db.mjs';
import {configuredSecret} from './catalog.mjs';
import {assets, seedRuntime} from './runtime/index.mjs';
import {seedDemoRelease} from './releases.mjs';

const accounts = [
  ['admin', '学校管理员', 'SCHOOL_ADMIN'],
  ['owner', '业务负责人', 'SERVICE_OWNER'],
  ['integrator', '集成工程师', 'INTEGRATOR'],
  ['approver', '独立发布审批人', 'RELEASE_APPROVER'],
  ['operator', '服务操作员', 'OPERATOR'],
  ['auditor', '审计员', 'AUDITOR'],
  ['student', '学生体验账号', 'END_USER']
];

export const demoSecretName = (school, pkg) =>
  'FOUNDATION_CALLBACK_' + school.toUpperCase() + '_' + pkg.replace(/^demo-/, '').replaceAll('-', '_').toUpperCase();

export async function seed() {
  if (process.env.APP_MODE !== 'demo') throw new Error('Demo seeding requires APP_MODE=demo');
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('campus_foundation:migrate'))");
    const prior = await client.query('SELECT version FROM foundation_demo_seed WHERE singleton');
    if (prior.rowCount) return {seeded: false, schools: 2};
    const packageIds = new Map();
    const contractIds = new Map();
    for (const pkg of assets.packages) {
      const id = randomUUID();
      await client.query(`
        INSERT INTO adapter_packages(id,code,version,manifest,manifest_digest,status)
        VALUES($1,$2,$3,$4,$5,'PUBLISHED')
      `, [id,pkg.code,pkg.version,json(pkg.manifest),digest(pkg.manifest)]);
      packageIds.set(pkg.code,id);
    }
    for (const contract of assets.contracts) {
      const id = randomUUID();
      const {code,version,inputSchema,outputSchema,manifest} = contract;
      await client.query(`
        INSERT INTO capability_contracts(id,code,version,input_schema,output_schema,manifest,digest,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED')
      `, [id,code,version,json(inputSchema),json(outputSchema),json(manifest),digest({inputSchema,outputSchema,manifest})]);
      contractIds.set(code,id);
    }
    for (const [schoolCode, schoolName] of [['alpha','云栖演示学院'],['beta','星港演示学院']]) {
      const schoolId = randomUUID();
      const environmentId = randomUUID();
      const ids = Object.create(null);
      await client.query("INSERT INTO schools(id,code,name,status) VALUES($1,$2,$3,'ACTIVE')", [schoolId,schoolCode,schoolName]);
      await client.query("INSERT INTO environments(id,school_id,code,mode) VALUES($1,$2,'demo','DEMO')", [environmentId,schoolId]);
      for (const [account, displayName, role] of accounts) {
        const userId = randomUUID();
        ids[account] = userId;
        await client.query('INSERT INTO users(id,school_id,campus_id,display_name) VALUES($1,$2,$3,$4)', [userId,schoolId,account,displayName]);
        await client.query('INSERT INTO demo_accounts(school_id,user_id,account,default_role) VALUES($1,$2,$3,$4)', [schoolId,userId,account,role]);
        if (role !== 'OPERATOR') {
          await client.query('INSERT INTO memberships(id,school_id,user_id,role_code) VALUES($1,$2,$3,$4)', [randomUUID(),schoolId,userId,role]);
        }
      }
      // Deliberately give the owner a second role to exercise the distinct-person approval gate.
      await client.query("INSERT INTO memberships(id,school_id,user_id,role_code) VALUES($1,$2,$3,'RELEASE_APPROVER')", [randomUUID(),schoolId,ids.owner]);
      const ctx = {
        schoolId, schoolCode, environmentId, environmentCode: 'demo', environmentMode: 'DEMO',
        userId: ids.owner, role: 'SERVICE_OWNER', scopes: [{type:'SCHOOL',id:'*'}]
      };
      const query = scoped(client,ctx);
      const connectionIds = new Map();
      for (const pkg of assets.packages) {
        const secretRef = demoSecretName(schoolCode,pkg.code);
        if (!configuredSecret(secretRef)) throw new Error('DEMO callback reference must be configured for each connection');
        const id = randomUUID();
        await query(`
          INSERT INTO connections(school_id,environment_id,id,name,adapter_package_id,mode,config,secret_ref,status)
          VALUES($1,$2,$3,$4,$5,'DEMO','{}',$6,'ACTIVE')
        `, [id,pkg.manifest.name ?? pkg.code,packageIds.get(pkg.code),secretRef]);
        connectionIds.set(pkg.code,id);
      }
      for (const contract of assets.contracts) {
        const {packageCode,retryClass} = contract.manifest;
        await query(`
          INSERT INTO capability_bindings(school_id,environment_id,id,contract_id,connection_id,support,retry_class)
          VALUES($1,$2,$3,$4,$5,'SUPPORTED',$6)
        `, [randomUUID(),contractIds.get(contract.code),connectionIds.get(packageCode),retryClass]);
      }
      for (const template of assets.templates) {
        const {rows:[service]} = await client.query(`
          INSERT INTO services(id,school_id,code,name,scenario_code,business_owner_id,technical_owner_id,authority_policy,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE') RETURNING *
        `, [randomUUID(),schoolId,template.code,template.name,template.scenarioCode ?? template.code,ids.owner,ids.integrator,json(template.authorityPolicy)]);
        await client.query(`
          INSERT INTO memberships(id,school_id,user_id,role_code,scope_type,scope_id) VALUES($1,$2,$3,'OPERATOR','SERVICE',$4)
        `, [randomUUID(),schoolId,ids.operator,service.id]);
        await seedDemoRelease(client,ctx,service,template.definition,ids.approver);
      }
      await seedRuntime(client,{...ctx,userId:ids.student,role:'END_USER'});
    }
    await client.query('INSERT INTO foundation_demo_seed(singleton,version) VALUES(true,1)');
    return {seeded: true, schools: 2};
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await seed();
    console.log(result.seeded ? 'Created two DEMO schools' : 'DEMO seeds already applied');
  } finally {
    await closeDatabase();
  }
}
