import {lucideIcons} from '/icons.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const all = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
export const id = value => encodeURIComponent(value ?? '');
export const icon = name => lucideIcons[name] || lucideIcons.apps;
export const roles = {
  SCHOOL_ADMIN: '学校管理员', SERVICE_OWNER: '服务负责人', INTEGRATOR: '集成工程师',
  RELEASE_APPROVER: '发布审批员', OPERATOR: '业务操作员', AUDITOR: '审计员', END_USER: '学生'
};
const labels = {
  DEMO: '模拟', TEST: '测试', PRODUCTION: '生产', LIVE: '正式连接', MANUAL: '人工办理',
  DRAFT: '草稿', VALIDATED: '已校验', TEST_PASSED: '测试通过', PENDING_APPROVAL: '待审批',
  APPROVED: '已批准', ACTIVE: '已启用', SUPERSEDED: '已被新版替代', DISABLED: '停用', SUSPENDED: '暂停新办理',
  PASSED: '通过', FAILED: '失败', PENDING: '待办理', OPEN: '待处理', AVAILABLE: '可用', CLAIMED: '已领取',
  COMPLETED: '流程已完成', SUCCEEDED: '已确认成功', REJECTED: '已拒绝', RUNNING: '处理中',
  WAITING_TASK: '等待人工办理', WAITING_OPERATION: '等待操作结果', WAITING_EVENT: '等待业务事件',
  WAITING_TIMER: '等待到期', INCIDENT: '待核查', UNKNOWN: '结果未知', TECHNICAL_FAILED: '技术失败',
  BUSINESS_REJECTED: '业务拒绝', READY_FOR_PICKUP: '待取书', CANCELLED: '已取消',
  ASSIGNED: '已指派', RESOLVED: '已解决', CLOSED: '已关闭', INVESTIGATING: '核查中',
  SUPPORTED: '支持', CONDITIONAL: '有条件支持', UNSUPPORTED: '不支持', UNVERIFIED: '未验证',
  CURRENT: '当前有效', STALE: '数据滞后', DISPUTED: '有争议', ENDED: '已结束',
  HEALTHY: '正常', UP: '可用', NOT_CONNECTED: '未接入', DEMO_CONFIGURED: '演示配置可用',
  REQUESTED: '已请求', STARTING: '等待启动证据', STOPPING: '等待停止证据',
  CONFIRMED: '已确认', PENDING_EVIDENCE: '待补齐证据', CALCULATING: '计费处理中',
  IN_PROGRESS: '进行中', WAITING_MATERIAL: '等待材料', BLOCKED: '受阻',
  WAITING_EXTERNAL: '等待外部核实', DECISION_PENDING: '待现场处理', STILL_UNKNOWN: '结果仍待核实', ON_SITE_REQUIRED: '需现场处理',
  ELIGIBLE: '可取件', OPEN_CONFIRMED: '柜门已开', COLLECTED: '已取件', PARCEL_COLLECTED: '已取件'
};
export const label = value => labels[value] || roles[value] || value || '—';
export const val = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== undefined && value !== null);
export const status = value => {
  if (!value) return '<span class="muted">—</span>';
  const tone = ['ACTIVE','APPROVED','SUCCEEDED','TEST_PASSED','PASSED','SUPPORTED','READY_FOR_PICKUP'].includes(value)
    ? 'good'
    : ['FAILED','TECHNICAL_FAILED','UNKNOWN','INCIDENT','PRODUCTION','DISABLED'].includes(value)
      ? 'bad'
      : ['PENDING_APPROVAL','DRAFT','WAITING_TASK','DEMO','TEST','UNVERIFIED'].includes(value) ? 'warn' : '';
  return `<span class="status ${tone}">${esc(label(value))}</span>`;
};
export const fmtDate = value => {
  const date = new Date(value || NaN);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
};
export const json = value => JSON.stringify(value ?? {}, null, 2);
export const code = value => `<pre class="code">${esc(json(value))}</pre>`;
export const link = (url, text, style = '') => `<a class="button ${style}" href="${esc(url)}">${esc(text)}</a>`;
export const button = (key, text, style = '') => `<button class="button ${style}" type="button" data-action="${esc(key)}">${esc(text)}</button>`;
export const title = (text, description, action = '') => `
  <header class="page-title">
    <div><p class="eyebrow">云栖校园 / FOUNDATION</p><h1>${esc(text)}</h1><p class="muted">${esc(description)}</p></div>
    ${action}
  </header>`;
export const panel = (heading, content, extra = '') => `<section class="panel stack ${extra}">${heading ? `<h2>${esc(heading)}</h2>` : ''}${content}</section>`;
export const empty = text => `<div class="empty">${esc(text)}</div>`;
export const info = (text, type = '') => `<p class="callout ${type}"${type === 'error' ? ' role="alert"' : ''}>${esc(text)}</p>`;
export const facts = items => `<dl class="specs">${items.map(([name, value]) =>
  `<div><dt>${esc(name)}</dt><dd>${esc(value ?? '—')}</dd></div>`).join('')}</dl>`;
export const details = (name, content) => `<details><summary>${esc(name)}</summary>${content}</details>`;
export const rows = data => Array.isArray(data) ? data : data?.records || data?.items || [];
export const selectOptions = (values, current) => values.map(([value, name]) =>
  `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(name)}</option>`).join('');

export function field(name, caption, attributes = {}, body = '') {
  const element = Object.entries(attributes).map(([key, value]) => value === true
    ? ` ${key}` : value === false || value == null ? '' : ` ${key}="${esc(value)}"`).join('');
  return `<div class="field ${body ? 'wide' : ''}">
    <label for="field-${esc(name)}">${esc(caption)}</label>
    ${body ? body.replace('<%field%>', `id="field-${esc(name)}" name="${esc(name)}" aria-describedby="error-${esc(name)}"${element}`)
      : `<input id="field-${esc(name)}" name="${esc(name)}" aria-describedby="error-${esc(name)}"${element}>`}
    <small id="error-${esc(name)}" class="field-error" data-field-error="${esc(name)}"></small>
  </div>`;
}
export const area = (name, caption, value = '', attrs = {}) =>
  field(name, caption, attrs, `<textarea <%field%>>${esc(value)}</textarea>`);
export const selectField = (name, caption, values, current, attrs = {}) =>
  field(name, caption, attrs, `<select <%field%>>${selectOptions(values, current)}</select>`);
export const jsonField = (name, caption, value) => area(name, caption, json(value), {class: 'json', required: true, spellcheck: false});
export function parseJson(value, fieldName) {
  try { return JSON.parse(value); }
  catch { throw Object.assign(new Error('请检查 JSON 格式。'), {fieldErrors: {[fieldName]: '此处需要有效的 JSON。'}}); }
}
export const form = (key, fields, submit, subtitle = '') => `<form id="${esc(key)}" class="stack">
  ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}<div class="fields">${fields}</div>
  <div class="inline"><button class="button primary" type="submit">${esc(submit)}</button></div>
  <div data-form-error role="alert"></div>
</form>`;

export function schemaFields(schema) {
  return Object.entries(schema?.properties || {}).map(([name, property]) => {
    const caption = property.title || ({bookId:'选择图书',ready:'办理结果',reason:'办理说明',portId:'端口',parcelId:'包裹'}[name]) || name;
    const required = schema.required?.includes(name);
    if (property.enum) return selectField(name, caption, [['', '请选择'], ...property.enum.map(v => [String(v), label(v)])], '', {required});
    if (property.type === 'boolean') return selectField(name, caption, [['', '请选择'], ['true', name === 'ready' ? '已备妥，等待领取' : '是'], ['false', name === 'ready' ? '无法备妥' : '否']], '', {required});
    return field(name, caption, {required, type: ['integer','number'].includes(property.type) ? 'number' : 'text',
      step: property.type === 'integer' ? 1 : property.type === 'number' ? 'any' : undefined,
      maxlength: property.maxLength, minlength: property.minLength, min: property.minimum, max: property.maximum,
      value: property.default, placeholder: property.description});
  }).join('');
}
export function schemaValues(values, schema) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => {
    const type = schema?.properties?.[key]?.type;
    return [key, type === 'boolean' ? value === 'true' : ['integer','number'].includes(type) ? Number(value) : value];
  }));
}

export const state = {user: null, environmentCode: '', loginOptions: null, dirty: false};
const prefix = '/api/v1/foundation';
const retries = new Map();
export async function request(path, options = {}) {
  const {method = 'GET', body, version, idempotent = false, query, auth = true} = options;
  const params = new URLSearchParams(query);
  if (auth && state.environmentCode && !path.startsWith('auth/')) params.set('environmentCode', state.environmentCode);
  const url = `${prefix}/${path}${params.size ? '?' + params : ''}`;
  const headers = {Accept:'application/json'};
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && auth && state.user?.csrfToken) headers['X-CSRF-Token'] = state.user.csrfToken;
  if (version != null) headers['If-Match'] = String(version);
  const fingerprint = `${state.user?.userId || ''}|${method}|${url}|${version ?? ''}|${payload || ''}`;
  if (idempotent) {
    if (!retries.has(fingerprint)) retries.set(fingerprint, crypto.randomUUID());
    headers['Idempotency-Key'] = retries.get(fingerprint);
  }
  const response = await fetch(url, {method, headers, body: payload});
  const payloadJson = await response.json().catch(() => ({}));
  if (response.ok || (response.status >= 400 && response.status < 500)) retries.delete(fingerprint);
  if (!response.ok) {
    const error = payloadJson.error || {};
    throw Object.assign(new Error(error.message || `请求失败（${response.status}）`), error, {status: response.status});
  }
  return {data: payloadJson.data, meta: payloadJson.meta, status: response.status};
}
export const get = async (path, query) => (await request(path, {query})).data;
export const post = async (path, body = {}, options = {}) => request(path, {...options, body, method:'POST'});
export const patch = async (path, body, version) => request(path, {body, version, method:'PATCH'});
export function clearSession() {
  state.user = null;
  state.environmentCode = '';
  state.dirty = false;
  retries.clear();
}
export function errorMarkup(error) {
  const hint = {
    401:'会话已失效，请重新登录。',403:'当前身份无此权限。',404:'此记录不存在，或当前身份无法查看。',
    409:'记录状态或版本已变化，请刷新后重试。',422:'请检查输入字段。',428:'缺少当前版本，请刷新后重试。',
    429:'请求过于频繁，请稍后重试。',503:'该服务暂不可用。'
  }[error.status];
  return `<div class="callout error" role="alert">${esc(error.message)}${hint ? `<div>${esc(hint)}</div>` : ''}
    ${error.requestId ? `<small>请求编号 ${esc(error.requestId)}</small>` : ''}</div>`;
}

export function bindForm(selector, handler, {dirty = false} = {}) {
  const target = $(selector);
  if (!target) return;
  if (dirty) target.addEventListener('input', () => { state.dirty = true; });
  target.addEventListener('submit', async event => {
    event.preventDefault();
    const submitter = target.querySelector('button[type="submit"]');
    const feedback = $('[data-form-error]', target);
    submitter.disabled = true;
    feedback.innerHTML = '';
    all('[data-field-error]', target).forEach(node => { node.textContent = ''; });
    all('[aria-invalid]', target).forEach(node => node.removeAttribute('aria-invalid'));
    try {
      await handler(Object.fromEntries(new FormData(target)), target);
    } catch (error) {
      feedback.innerHTML = errorMarkup(error);
      const fields = error.fieldErrors || {};
      const pairs = Array.isArray(fields) ? fields.map(item => [item.field || item.path, item.message]) : Object.entries(fields);
      let first;
      for (const [key, messages] of pairs) {
        const name = Array.isArray(key) ? key.at(-1) : String(key).split(/[./]/).at(-1);
        const input = target.elements.namedItem(name);
        const message = all('[data-field-error]', target).find(node => node.dataset.fieldError === name);
        if (!input || !message) continue;
        input.setAttribute('aria-invalid', 'true');
        message.textContent = Array.isArray(messages) ? messages.join('，') : String(messages);
        first ||= input;
      }
      first?.focus();
    } finally {
      submitter.disabled = false;
    }
  });
}

let toastTimer;
export function toast(message) {
  $('#live').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#live').textContent = ''; }, 4700);
}
export function ask({heading, message, fields = '', confirm = '确认'}) {
  const dialog = $('#dialog');
  const previous = document.activeElement;
  return new Promise(resolve => {
    dialog.innerHTML = `<form method="dialog" class="stack">
      <h2 id="dialog-title">${esc(heading)}</h2><p>${esc(message)}</p>${fields}
      <div class="inline"><button class="button" type="button" data-cancel>取消</button>
      <button class="button primary" value="confirm">${esc(confirm)}</button></div>
    </form>`;
    dialog.returnValue = '';
    $('[data-cancel]', dialog).onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'confirm'
        ? Object.fromEntries(new FormData(dialog.querySelector('form'))) : null;
      previous?.focus();
      resolve(result);
    }, {once: true});
    dialog.showModal();
  });
}

export function listRows(items, columns, draw, message) {
  if (!items.length) return empty(message);
  return `<div class="list">
    <div class="list-row column-head" aria-hidden="true">${columns.map(text => `<span>${esc(text)}</span>`).join('')}</div>
    ${items.map(item => `<article class="list-row">${draw(item).map(cell => `<div>${cell}</div>`).join('')}</article>`).join('')}
  </div>`;
}

export const recordLink = (path, caption) => `<a class="record-title" href="#/${esc(path)}">${esc(caption)}</a>`;

export function paging({route, query, meta, count}) {
  const page = Number(meta?.page || query.get('page') || 1);
  const total = meta?.total ?? count;
  const pages = Math.max(1, Number(meta?.totalPages || Math.ceil(total / (meta?.pageSize || 20))));
  const target = next => `#/${route}?${new URLSearchParams({...Object.fromEntries(query), page:String(next)})}`;
  return `<div class="pager inline spaced"><span class="muted">共 ${total} 条 · 第 ${page} / ${pages} 页</span>
    <div class="inline">${page > 1 ? link(target(page - 1), '上一页', 'compact') : ''}
      ${page < pages ? link(target(page + 1), '下一页', 'compact') : ''}</div></div>`;
}

export function filterForm(query, {placeholder = '搜索', statuses = [], allRecords = false} = {}) {
  return `<form class="toolbar" id="filters">
    <input type="search" name="q" maxlength="100" value="${esc(query.get('q'))}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
    ${statuses.length ? `<select name="status" aria-label="状态">${selectOptions([['','全部状态'], ...statuses.map(s => [s,label(s)])], query.get('status') || '')}</select>` : ''}
    <button class="button" type="submit">${allRecords ? '筛选' : '筛选本页'}</button>
  </form>`;
}

export function bindFilters(go, route, query) {
  const target = $('#filters');
  if (!target) return;
  target.onsubmit = event => {
    event.preventDefault();
    const params = new URLSearchParams(query);
    for (const [key,value] of new FormData(target)) {
      if (String(value).trim()) params.set(key, String(value).trim());
      else params.delete(key);
    }
    go(route + (params.size ? '?' + params : ''));
  };
}

export async function listing(path, query) {
  const params = new URLSearchParams({page:query.get('page') || '1',pageSize:'20'});
  if (query.has('serviceId')) params.set('serviceId',query.get('serviceId'));
  const {data, meta} = await request(path, {query: params});
  const records = rows(data);
  const q = (query.get('q') || '').toLowerCase();
  const desiredStatus = query.get('status');
  return {
    records:records.filter(item => (!q || JSON.stringify(item).toLowerCase().includes(q)) &&
      (!desiredStatus || val(item,'status','lifecycle','domain_state') === desiredStatus)),
    meta:meta || data?.meta
  };
}

export function bindAction(key, handler) {
  const control = all('[data-action]').find(el => el.dataset.action === key);
  if (!control) return;
  control.addEventListener('click', async () => {
    control.disabled = true;
    const area = $('#action-result');
    if (area) area.innerHTML = '';
    try { await handler(); }
    catch (error) {
      if (area) area.innerHTML = errorMarkup(error);
      else toast(error.message);
    } finally { control.disabled = false; }
  });
}
