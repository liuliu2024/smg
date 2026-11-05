import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {audit, fail, json, pageParams, requireRole, requireVersion, scoped, transaction, uuid} from './db.mjs';
import {parse, readService, requireOwner, serviceScopeIds} from './catalog.mjs';

const stages = ['DISCOVERY','RESPONSIBILITY','AUTHORIZATION','CONTRACT','CONFIGURATION',
  'TESTING','BUSINESS_ACCEPTANCE','PILOT','LIVE','EXIT'];
const text = z.string().trim().min(1).max(1500);
const stageFields = {
  DISCOVERY: {system: text, workflow: text, provider: text},
  RESPONSIBILITY: {authority: text, accountableParty: text, incidentContact: text},
  AUTHORIZATION: {reference: text, expiresAt: z.iso.datetime({offset:true}),
    actions: z.array(text).min(1).max(30), fields: z.array(text).min(1).max(30)},
  CONTRACT: {contracts: z.array(text).min(1).max(30), queryPolicy: text},
  CONFIGURATION: {connectionId: z.uuid()},
  TESTING: {testRunId: z.uuid()},
  BUSINESS_ACCEPTANCE: {confirmation: text},
  PILOT: {scope: text, rollback: text, contact: text}
};
const reviewRoles = {
  DISCOVERY: 'SERVICE_OWNER', RESPONSIBILITY: 'SERVICE_OWNER', AUTHORIZATION: 'RELEASE_APPROVER',
  CONTRACT: 'SERVICE_OWNER', CONFIGURATION: 'INTEGRATOR', TESTING: 'INTEGRATOR',
  BUSINESS_ACCEPTANCE: 'SERVICE_OWNER', PILOT: 'RELEASE_APPROVER'
};

async function validateEvidence(client, ctx, project, gate, evidence) {
  const data = parse(z.strictObject(stageFields[gate]),evidence);
  const query = scoped(client,ctx);
  if (gate === 'AUTHORIZATION' && new Date(data.expiresAt) <= new Date()) {
    fail(422,'AUTHORIZATION_EXPIRED','授权期限已过');
  }
  if (gate === 'CONFIGURATION') {
    const result = await query(`
      SELECT id FROM connections WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND status='ACTIVE'
        AND (authorization_expires_at IS NULL OR authorization_expires_at>now())
    `,[data.connectionId]);
    if (!result.rowCount) fail(422,'CONFIGURATION_UNVERIFIED','请选择本环境有效连接');
  }
  if (gate === 'TESTING') {
    const result = await query(`
      SELECT t.id FROM test_runs t JOIN releases r ON r.school_id=t.school_id AND r.environment_id=t.environment_id AND r.id=t.release_id
      WHERE t.school_id=$1 AND t.environment_id=$2 AND t.id=$3 AND r.service_id=$4
        AND t.status='PASSED' AND r.digest=t.digest AND r.generation=t.release_generation
    `,[data.testRunId,project.service_id]);
    if (!result.rowCount) fail(422,'TEST_EVIDENCE_INVALID','需要本服务当前版本通过的测试记录');
  }
  return data;
}

export async function onboardingRoute(ctx, method, path, body, req) {
  if (path[0] !== 'admin' || path[1] !== 'onboarding-projects') return null;
  requireRole(ctx,'SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR');
  const [, , id, gateSegment, gate, action] = path;
  return transaction(async client => {
    const query = scoped(client,ctx);
    if (method === 'GET' && !id) {
      const {page,pageSize,offset} = pageParams(req.url);
      const {rows} = await query(`
        SELECT p.id,p.service_id,p.stage,p.working_status,p.version,p.created_at,s.name AS service_name,count(*) OVER() AS total
        FROM integration_projects p JOIN services s ON s.school_id=p.school_id AND s.id=p.service_id
        WHERE p.school_id=$1 AND p.environment_id=$2 AND ($3::uuid IS NULL OR s.business_owner_id=$3)
          AND ($4::text[] IS NULL OR p.service_id::text=ANY($4))
        ORDER BY p.created_at DESC LIMIT $5 OFFSET $6
      `,[ctx.role === 'SERVICE_OWNER' ? ctx.userId : null,serviceScopeIds(ctx),pageSize,offset]);
      return {data:rows.map(({total,...row})=>row),meta:{page,pageSize,total:Number(rows[0]?.total ?? 0)}};
    }
    if (!id && method === 'POST') {
      requireRole(ctx,'SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR');
      const {serviceId} = parse(z.strictObject({serviceId:z.uuid()}),body);
      const service = await readService(client,ctx,serviceId);
      if (ctx.role === 'SERVICE_OWNER') requireOwner(ctx,service);
      const {rows:[project]} = await query(`
        INSERT INTO integration_projects(school_id,environment_id,id,service_id)
        VALUES($1,$2,$3,$4) RETURNING *
      `,[randomUUID(),serviceId]);
      await audit(client,ctx,{action:'ONBOARDING_CREATE',type:'PROJECT',id:project.id});
      return {status:201,data:project};
    }
    if (!id) return null;
    const {rows:[project]} = await query(
      'SELECT * FROM integration_projects WHERE school_id=$1 AND environment_id=$2 AND id=$3' + (method === 'POST' ? ' FOR UPDATE' : ''),
      [uuid(id)]);
    if (!project) fail(404,'PROJECT_NOT_FOUND','接入项目不存在');
    const service = await readService(client,ctx,project.service_id);
    if (method === 'GET' && !gateSegment) {
      const {rows:reviews} = await query(`
        SELECT gate,decision,actor_id,reason,evidence,created_at FROM gate_reviews
        WHERE school_id=$1 AND environment_id=$2 AND project_id=$3 ORDER BY created_at,id
      `,[id]);
      return {data:{...project,reviews}};
    }
    if (method !== 'POST' || gateSegment !== 'gates' || !['submit','review'].includes(action)) return null;
    requireVersion(req.version,project);
    if (gate !== project.stage) fail(409,'GATE_OUT_OF_ORDER','请先完成当前接入阶段');
    if (!stageFields[gate]) fail(503,'LIVE_NOT_CONNECTED','需要校方真实授权及供应商联调');
    let decision, reason, evidence;
    const material = {...project.material};
    if (action === 'submit') {
      requireRole(ctx,'SERVICE_OWNER','INTEGRATOR','SCHOOL_ADMIN');
      reason = parse(text,body.reason);
      evidence = await validateEvidence(client,ctx,project,gate,body.material);
      decision = 'SUBMIT';
      material[gate] = {evidence,submittedBy:ctx.userId,status:'PENDING'};
    } else {
      requireRole(ctx,reviewRoles[gate]);
      if (ctx.role === 'SERVICE_OWNER') requireOwner(ctx,service);
      const submitted = material[gate];
      if (submitted?.status !== 'PENDING') fail(409,'GATE_SUBMISSION_REQUIRED','请先提交该阶段材料');
      ({decision,reason} = parse(z.strictObject({decision:z.enum(['APPROVE','RETURN']),reason:text}),body));
      evidence = decision === 'APPROVE' ? await validateEvidence(client,ctx,project,gate,submitted.evidence) : submitted.evidence;
      material[gate] = {...submitted,status:decision === 'APPROVE' ? 'APPROVED' : 'RETURNED'};
    }
    await query(`
      INSERT INTO gate_reviews(school_id,environment_id,id,project_id,gate,decision,actor_id,reason,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,[randomUUID(),id,gate,decision,ctx.userId,reason,json(evidence)]);
    const stage = decision === 'APPROVE' ? stages[stages.indexOf(gate)+1] : gate;
    const status = stage === 'LIVE' ? 'WAITING_MATERIAL' : decision === 'RETURN' ? 'WAITING_MATERIAL' : 'IN_PROGRESS';
    const {rows:[updated]} = await query(`
      UPDATE integration_projects SET stage=$4,working_status=$5,material=$6,version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$7 RETURNING *
    `,[id,stage,status,json(material),project.version]);
    await audit(client,ctx,{action:'GATE_'+decision,type:'PROJECT',id,metadata:{gate}});
    return {data:updated};
  });
}
