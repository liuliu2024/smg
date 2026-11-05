import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {parse} from './catalog.mjs';
import {audit, fail, hasScope, json, requireRole, requireVersion, scoped, transaction, uuid} from './db.mjs';

const note = z.string().trim().min(1).max(1000);

export async function caseRoute(ctx,method,path,body,req) {
  const [group,area,resource,caseId,action] = path;
  if (group !== 'admin' || area !== 'runtime' || resource !== 'cases' || !caseId ||
      (method !== 'GET' && method !== 'POST') || (method === 'GET' && action) ||
      (method === 'POST' && !['claim','evidence','decisions'].includes(action))) return null;
  requireRole(ctx,'OPERATOR','SERVICE_OWNER','INTEGRATOR','AUDITOR');
  return transaction(async client => {
    const query = scoped(client,ctx);
    const {rows:[item]} = await query(`
      SELECT c.*,i.service_id,s.business_owner_id
      FROM cases c LEFT JOIN process_instances i
        ON i.school_id=c.school_id AND i.environment_id=c.environment_id AND i.id=c.instance_id
      LEFT JOIN services s ON s.school_id=i.school_id AND s.id=i.service_id
      WHERE c.school_id=$1 AND c.environment_id=$2 AND c.id=$3
    ` + (method === 'POST' ? ' FOR UPDATE OF c' : ''),[uuid(caseId)]);
    const scopedAccess = item && hasScope(ctx,'SERVICE',item.service_id);
    const owner = scopedAccess && ctx.role === 'SERVICE_OWNER' && item.business_owner_id === ctx.userId;
    const operator = scopedAccess && ctx.role === 'OPERATOR';
    const oversight = scopedAccess && ['AUDITOR','INTEGRATOR'].includes(ctx.role);
    if (!owner && !operator && !oversight) fail(404,'CASE_NOT_FOUND','核查案件不存在');
    const unresolved = !['RESOLVED','CLOSED'].includes(item.status);
    const allowedActions = [];
    if (unresolved && operator && !item.assigned_user_id) allowedActions.push('claim');
    if (unresolved && (owner || (operator && item.assigned_user_id === ctx.userId))) allowedActions.push('evidence');
    if (unresolved && owner && item.evidence.length) allowedActions.push('decisions');
    if (method === 'GET') {
      const {school_id,environment_id,business_owner_id,evidence,...safe} = item;
      if (ctx.role === 'AUDITOR') {
        const {reason,...decision} = safe.decision ?? {};
        return {data:{...safe,reason:undefined,decision:safe.decision ? decision : null,
          evidence:evidence.map(({id,actorId,recordedAt})=>({id,actorId,recordedAt})),allowedActions}};
      }
      return {data:{...safe,evidence,allowedActions}};
    }
    if (!allowedActions.includes(action)) fail(403,'CASE_ACTION_FORBIDDEN','当前岗位或案件状态不允许该操作');
    requireVersion(req.version,item);
    let status = item.status;
    let assignee = item.assigned_user_id;
    let evidence = item.evidence;
    let decision = item.decision;
    if (action === 'claim') {
      parse(z.strictObject({}),body);
      status = 'ASSIGNED';
      assignee = ctx.userId;
    } else if (action === 'evidence') {
      const entry = parse(z.strictObject({reference:note.max(160),summary:note}),body);
      evidence = [...evidence,{id:randomUUID(),...entry,actorId:ctx.userId,recordedAt:new Date().toISOString()}];
      status = 'INVESTIGATING';
    } else {
      const fields = parse(z.strictObject({disposition:z.enum(['STILL_UNKNOWN','ON_SITE_REQUIRED']),
        evidenceId:z.uuid(),reason:note}),body);
      if (!evidence.some(entry=>entry.id === fields.evidenceId)) fail(422,'CASE_EVIDENCE_REQUIRED','请选择已记录的核查证据');
      decision = {...fields,actorId:ctx.userId,recordedAt:new Date().toISOString()};
      status = fields.disposition === 'STILL_UNKNOWN' ? 'WAITING_EXTERNAL' : 'DECISION_PENDING';
    }
    const {rows:[saved]} = await query(`
      UPDATE cases SET status=$4,assigned_user_id=$5,evidence=$6,decision=$7,version=version+1
      WHERE school_id=$1 AND environment_id=$2 AND id=$3 AND version=$8 RETURNING id,status,version
    `,[caseId,status,assignee,json(evidence),decision === null ? null : json(decision),item.version]);
    await audit(client,ctx,{action:'CASE_'+action.toUpperCase(),type:'CASE',id:caseId,metadata:{status}});
    return {data:saved};
  });
}
