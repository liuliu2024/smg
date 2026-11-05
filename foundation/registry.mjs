import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {roles} from './auth.mjs';
import {parse} from './catalog.mjs';
import {audit, fail, requireRole, requireVersion, transaction, uuid} from './db.mjs';

const membership = z.strictObject({
  role: z.enum(roles), type: z.enum(['SCHOOL','SERVICE']), id: z.string().min(1).max(128)
});
async function saveMemberships(client, ctx, target, supplied) {
  const memberships = parse(z.array(membership).max(40),supplied);
  const seen = new Set();
  for (const entry of memberships) {
    const key = [entry.role,entry.type,entry.id].join(':');
    if (seen.has(key)) fail(422,'MEMBERSHIP_DUPLICATE','岗位范围重复');
    seen.add(key);
    if (entry.type === 'SCHOOL') {
      if (entry.id !== '*' || entry.role === 'OPERATOR') fail(422,'SCOPE_INVALID','操作员须指定业务范围');
    } else {
      if (!['OPERATOR','SERVICE_OWNER','INTEGRATOR'].includes(entry.role)) fail(422,'SCOPE_INVALID','该岗位不接受服务范围');
      const matching = await client.query('SELECT id FROM services WHERE school_id=$1 AND id=$2', [ctx.schoolId,uuid(entry.id)]);
      if (!matching.rowCount) fail(404,'SERVICE_NOT_FOUND','服务不存在');
    }
  }
  if (!memberships.some(item => item.role === 'SCHOOL_ADMIN') && target.status === 'ACTIVE') {
    const remaining = await client.query(`
      SELECT 1 FROM memberships m JOIN users u ON u.school_id=m.school_id AND u.id=m.user_id
      WHERE m.school_id=$1 AND m.user_id<>$2 AND m.role_code='SCHOOL_ADMIN' AND u.status='ACTIVE' LIMIT 1
    `,[ctx.schoolId,target.id]);
    if (!remaining.rowCount) fail(409,'LAST_ADMIN','学校须保留一名启用的管理员');
  }
  await client.query('DELETE FROM memberships WHERE school_id=$1 AND user_id=$2',[ctx.schoolId,target.id]);
  for (const entry of memberships) {
    await client.query(`
      INSERT INTO memberships(id,school_id,user_id,role_code,scope_type,scope_id) VALUES($1,$2,$3,$4,$5,$6)
    `,[randomUUID(),ctx.schoolId,target.id,entry.role,entry.type,entry.id]);
  }
  await client.query(`
    DELETE FROM sessions WHERE school_id=$1 AND user_id=$2 AND NOT (active_role=ANY($3::text[]))
  `,[ctx.schoolId,target.id,[...new Set(memberships.map(item=>item.role))]]);
  return memberships;
}

export async function registryRoute(ctx,method,path,body,req) {
  if (path[0] !== 'admin') return null;
  const [,section,id,action] = path;
  const users = section === 'users' && id && !action;
  if (section !== 'schools' && !users) return null;
  requireRole(ctx,'SCHOOL_ADMIN');
  return transaction(async client => {
    if (section === 'schools') {
      if (!id && method === 'GET') {
        const {rows} = await client.query('SELECT id,code,name,status FROM schools WHERE id=$1',[ctx.schoolId]);
        return {data:rows};
      }
      if (uuid(id) !== ctx.schoolId) fail(404,'SCHOOL_NOT_FOUND','学校不存在');
      if (action !== 'environments') return null;
      if (method === 'GET') {
        const {rows} = await client.query('SELECT id,code,mode,status FROM environments WHERE school_id=$1 ORDER BY code',[ctx.schoolId]);
        return {data:rows};
      }
      if (method !== 'POST') return null;
      const {code,mode} = parse(z.strictObject({
        code:z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), mode:z.enum(['DEMO','TEST'])
      }),body);
      const {rows:[environment]} = await client.query(`
        INSERT INTO environments(id,school_id,code,mode) VALUES($1,$2,$3,$4) RETURNING id,code,mode,status
      `,[randomUUID(),ctx.schoolId,code,mode]);
      await audit(client,ctx,{action:'ENVIRONMENT_CREATE',type:'ENVIRONMENT',id:environment.id,metadata:{mode}});
      return {status:201,data:environment};
    }
    if (!['GET','PATCH'].includes(method)) return null;
    if (method === 'PATCH') {
      // Serialize changes that could remove the last administrator.
      await client.query('SELECT id FROM schools WHERE id=$1 FOR UPDATE',[ctx.schoolId]);
    }
    const {rows:[target]} = await client.query(`
      SELECT id,display_name,status,version FROM users WHERE school_id=$1 AND id=$2
    ` + (method === 'PATCH' ? ' FOR UPDATE' : ''),[ctx.schoolId,uuid(id)]);
    if (!target) fail(404,'USER_NOT_FOUND','账号不存在');
    const readMemberships = async () => (await client.query(`
      SELECT role_code AS role,scope_type AS type,scope_id AS id
      FROM memberships WHERE school_id=$1 AND user_id=$2 ORDER BY role_code,scope_type,scope_id
    `,[ctx.schoolId,id])).rows;
    if (method === 'GET') return {data:{...target,memberships:await readMemberships()}};
    requireVersion(req.version,target);
    const data = parse(z.strictObject({
      status:z.enum(['ACTIVE','DISABLED']).optional(), memberships:z.array(membership).max(40).optional()
    }).refine(value=>value.status !== undefined || value.memberships !== undefined),body);
    const memberships = data.memberships === undefined ? await readMemberships()
      : await saveMemberships(client,ctx,target,data.memberships);
    if (data.status === 'DISABLED' && memberships.some(item=>item.role === 'SCHOOL_ADMIN')) {
      const remaining = await client.query(`
        SELECT 1 FROM memberships m JOIN users u ON u.school_id=m.school_id AND u.id=m.user_id
        WHERE m.school_id=$1 AND m.user_id<>$2 AND m.role_code='SCHOOL_ADMIN' AND u.status='ACTIVE' LIMIT 1
      `,[ctx.schoolId,id]);
      if (!remaining.rowCount) fail(409,'LAST_ADMIN','学校须保留一名启用的管理员');
    }
    const {rows:[saved]} = await client.query(`
      UPDATE users SET status=$3,version=version+1 WHERE school_id=$1 AND id=$2 AND version=$4
      RETURNING id,display_name,status,version
    `,[ctx.schoolId,id,data.status ?? target.status,target.version]);
    if (saved.status === 'DISABLED') await client.query('DELETE FROM sessions WHERE school_id=$1 AND user_id=$2',[ctx.schoolId,id]);
    await audit(client,ctx,{action:'USER_ACCESS_UPDATE',type:'USER',id,metadata:{status:saved.status}});
    return {data:{...saved,memberships}};
  });
}
