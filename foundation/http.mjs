import {randomUUID} from 'node:crypto';
import {audit, databaseConfigured, fail, transaction} from './db.mjs';
import {authenticate, demoLogin, demoOptions, logout, publicIdentity, requireDemo, switchRole} from './auth.mjs';
import {catalogRoute} from './catalog.mjs';
import {releaseRoute} from './releases.mjs';
import {runtimeRoute, receiveCallback} from './runtime/index.mjs';
import {onboardingRoute} from './onboarding.mjs';
import {registryRoute} from './registry.mjs';
import {caseRoute} from './cases.mjs';

const prefix = '/api/v1/foundation';

async function readBytes(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 128 * 1024) fail(413, 'BODY_TOO_LARGE', '请求超过128KB');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function readObject(bytes) {
  if (!bytes.length) return {};
  try {
    const body = JSON.parse(bytes.toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    fail(422, 'INVALID_JSON', '请求必须是JSON对象');
  }
}

function expectedVersion(header) {
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^(?:[1-9]\d*|"[1-9]\d*")$/.test(header)) {
    fail(422, 'VERSION_INVALID', 'If-Match必须是正整数版本');
  }
  const version = Number(header.replaceAll('"',''));
  if (!Number.isSafeInteger(version)) fail(422, 'VERSION_INVALID', '版本号无效');
  return version;
}
function requestKey(header) {
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(header)) {
    fail(422, 'IDEMPOTENCY_KEY_INVALID', '幂等键须为1至128个可见ASCII字符');
  }
  return header;
}

function resultError(error) {
  if (Number.isInteger(error.status)) return error;
  if (['23505','40001','40P01'].includes(error.code)) {
    return {status:409,code:'CONCURRENT_CONFLICT',message:'操作与其他提交冲突，请刷新后重试'};
  }
  if (error.code === '23503') return {status:422,code:'REFERENCE_INVALID',message:'关联记录无效'};
  if (['ECONNREFUSED','ECONNRESET','EPIPE','ENOTFOUND','28P01','57P01','42P01','3D000','ETIMEDOUT'].includes(error.code)) {
    return {status:503,code:'DATABASE_UNAVAILABLE',message:'底座数据库不可用，请检查配置与迁移'};
  }
  console.error('Foundation request error', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'INTERNAL');
  return {status:500,code:'INTERNAL_ERROR',message:'底座请求暂时无法完成'};
}

export async function foundationHandler(request, response, parsedUrl) {
  const requestId = randomUUID();
  const url = parsedUrl ?? new URL(request.url,'http://localhost');
  const method = request.method;
  const path = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const route = path.join('/');
  let ctx;
  const send = (status, body) => {
    response.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId});
    response.end(JSON.stringify(body));
  };
  try {
    if (method === 'GET' && route === 'health') return send(200,{data:{status:'ok'}});
    requireDemo();
    if (!databaseConfigured()) fail(503,'DATABASE_NOT_CONFIGURED','尚未配置底座数据库');
    if (!['GET','POST','PATCH','PUT'].includes(method)) fail(405,'METHOD_NOT_ALLOWED','不支持此请求方法');
    const bytes = method === 'GET' ? Buffer.alloc(0) : await readBytes(request);
    if (path[0] === 'callbacks' && method === 'POST' && path.length === 2) {
      const result = await receiveCallback(path[1],bytes,request.headers,requestId);
      return send(result?.status ?? 202,{data:result?.data ?? result ?? {accepted:true}});
    }
    const body = readObject(bytes);
    if (method === 'GET' && route === 'auth/options') return send(200,{data:await demoOptions()});
    if (method === 'POST' && route === 'auth/demo-login') return send(200,{data:await demoLogin(body,request,response,requestId)});
    if (['schoolId','school_id','environmentId','environment_id','actorId','subjectUserId'].some(key => Object.hasOwn(body,key))) {
      fail(422,'CLIENT_IDENTITY_FORBIDDEN','身份和学校范围由服务端会话决定');
    }
    if (Object.hasOwn(body,'environmentCode')) {
      const requested = body.environmentCode;
      const selected = url.searchParams.get('environmentCode');
      if (path[0] !== 'services' || path[2] !== 'instances' || typeof requested !== 'string' ||
          (selected && selected !== requested)) {
        fail(422,'ENVIRONMENT_INVALID','环境选择无效');
      }
      url.searchParams.set('environmentCode',requested);
      delete body.environmentCode;
    }
    ctx = await authenticate(request,url,requestId);
    if (method === 'GET' && route === 'auth/me') return send(200,{data:publicIdentity(ctx)});
    if (method === 'POST' && route === 'auth/logout') return send(200,{data:await logout(ctx,response)});
    if (method === 'POST' && route === 'auth/role') return send(200,{data:await switchRole(ctx,body.role,url)});
    const meta = {url,key:requestKey(request.headers['idempotency-key']),
      version:expectedVersion(request.headers['if-match']),requestId};
    const result = await releaseRoute(ctx,method,path,body,meta) ??
      await onboardingRoute(ctx,method,path,body,meta) ??
      await registryRoute(ctx,method,path,body,meta) ??
      await catalogRoute(ctx,method,path,body,meta) ??
      await caseRoute(ctx,method,path,body,meta) ??
      await runtimeRoute(ctx,method,path,body,meta);
    if (!result) fail(404,'ROUTE_NOT_FOUND','底座接口不存在');
    return send(result.status ?? 200,{data:result.data,...(result.meta ? {meta:result.meta} : {})});
  } catch (originalError) {
    const error = resultError(originalError);
    if (ctx && method !== 'GET') {
      await transaction(client => audit(client,ctx,{
        action:'REQUEST_REJECTED',type:'HTTP',id:path.slice(0,2).join('/').slice(0,120),
        outcome:'FAILURE',metadata:{code:error.code,status:error.status}
      })).catch(() => {});
    }
    return send(error.status,{error:{code:error.code,message:error.message,requestId,
      ...(error.fieldErrors ? {fieldErrors:error.fieldErrors} : {})}});
  }
}
