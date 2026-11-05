import {
  $, all, esc, icon, roles, state, get, post, clearSession, selectOptions, field, selectField, form,
  title, panel, status, link, button, empty, info, errorMarkup, bindForm, toast, ask, rows, val, facts
} from './core.js';
import {managementPages} from './management.js';
import {runtimePages} from './runtime.js';

const everyone = Object.keys(roles);
const staff = everyone.filter(role => role !== 'END_USER');
const pages = {
  home: ['工作概览', 'home', '工作台', everyone, '进入本校办理与治理工作。'],
  services: ['校园服务', 'apps', '校园服务', ['END_USER'], '查找当前环境已发布的服务。'],
  instances: ['办理记录', 'clipboard', '校园服务', ['END_USER','OPERATOR','SERVICE_OWNER','INTEGRATOR'], '查看自己提交或岗位负责的业务流程。'],
  catalog: ['服务目录', 'apps', '服务配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '查看负责人、权威来源与服务状态。'],
  releases: ['发布变更', 'award', '服务配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '校验、测试、独立审批及启用。'],
  capabilities: ['能力合同', 'document', '接入配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '了解能力版本、输入输出与重试约束。'],
  connections: ['连接管理', 'network', '接入配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '管理本环境的供应商连接及授权。'],
  bindings: ['能力绑定', 'key', '接入配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '检查能力与适配器的实际映射。'],
  onboarding: ['接入项目', 'briefcase', '接入配置', ['SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR','RELEASE_APPROVER','AUDITOR'], '跟踪接入材料与阶段审核。'],
  tasks: ['业务待办', 'clipboard', '运行处置', ['OPERATOR'], '领取并办理授权范围内的任务。'],
  operations: ['操作追踪', 'monitor', '运行处置', ['INTEGRATOR','OPERATOR','SERVICE_OWNER','AUDITOR'], '查阅适配调用、结果证据与尝试。'],
  cases: ['核查案件', 'shield', '运行处置', ['SERVICE_OWNER','INTEGRATOR','OPERATOR','AUDITOR'], '对不明确结果提交核查与记录证据。'],
  sessions: ['设备会话', 'monitor', '运行处置', ['INTEGRATOR','OPERATOR','SERVICE_OWNER','AUDITOR'], '查看设备状态、观测与模拟账单。'],
  metering: ['计量读数', 'database', '质量与运维', ['INTEGRATOR','OPERATOR','SERVICE_OWNER','AUDITOR'], '查阅保存的计量原始记录与质量。'],
  audit: ['审计记录', 'document', '质量与运维', ['SCHOOL_ADMIN','AUDITOR'], '查阅本校环境中的审计记录。'],
  system: ['系统健康', 'settings', '质量与运维', staff, '检查数据连接和后台任务运行情况。']
};

const permitted = key => pages[key]?.[3].includes(state.user?.role);
const environment = () => state.user?.environments?.find(env => env.code === state.environmentCode);
const url = key => '#/' + key;
let generation = 0;
let previousHash = '#/home';
let menuOpener;

function userSession(user) {
  state.user = user;
  const available = user.environments || [];
  if (!available.some(env => env.code === state.environmentCode)) {
    state.environmentCode = user.environmentCode || available[0]?.code || '';
  }
}

function resumeWorkspace() {
  const key = location.hash.split('/')[1]?.split('?')[0];
  if (key && permitted(key)) return render();
  return go('home');
}

function nav(key) {
  const groups = new Map();
  for (const [name, [caption, glyph, group]] of Object.entries(pages)) {
    if (!permitted(name)) continue;
    const markup = `<a class="nav-link" href="${url(name)}"${name === key ? ' aria-current="page"' : ''}>${icon(glyph)}${caption}</a>`;
    groups.set(group, (groups.get(group) || '') + markup);
  }
  return [...groups].map(([group, markup]) => `<div class="nav-caption">${group}</div>${markup}`).join('');
}

function brand() {
  return `<span class="brand-mark">${icon('library')}</span><span>云栖校园<small>SERVICE FOUNDATION</small></span>`;
}

function shell(key) {
  const {user} = state;
  const env = environment();
  const mode = env?.mode || user.environmentMode || 'DEMO';
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="side">
        <a class="brand" href="#/home">${brand()}</a>
        <button type="button" class="button menu-toggle" id="close-menu">关闭导航</button>
        <nav class="nav-scroll" aria-label="服务工作区">${nav(key)}</nav>
        <div class="sidebar-footer"><a href="/">${icon('arrow')} 返回校园首页</a><p>校园服务治理 · 演示底座</p></div>
      </aside>
      <div>
        <header class="topbar">
          <div class="environment">
            <button type="button" class="button compact menu-toggle" id="menu-toggle" aria-controls="side" aria-expanded="false">导航</button>
            <span class="school">${icon('building')} ${esc(user.schoolName || user.schoolCode)}</span>
            ${user.environments?.length > 1 ? `<select aria-label="环境" id="environment-select">
              ${selectOptions(user.environments.map(e => [e.code, e.name || e.code]), state.environmentCode)}
            </select>` : ''}
            <span class="mode ${mode === 'PRODUCTION' ? 'production' : ''}">${esc(mode)} · ${esc(env?.name || env?.code || user.environmentCode || '当前环境')}</span>
          </div>
          <div class="identity">
            <span class="avatar" aria-hidden="true">${esc(user.displayName?.slice(-1))}</span>
            <span class="name">${esc(user.displayName)}</span>
            <select id="role-select" aria-label="活动角色">${selectOptions((user.roles || [user.role]).map(role => [role, roles[role] || role]), user.role)}</select>
            <button class="button compact" id="logout" type="button">退出</button>
          </div>
        </header>
        <main class="main" id="main" tabindex="-1"><div class="initial" role="status">正在加载…</div></main>
      </div>
    </div>`;
  const layout = $('.layout');
  menuOpener = $('#menu-toggle');
  const closeMenu = () => {
    layout.classList.remove('menu-open');
    menuOpener.setAttribute('aria-expanded', 'false');
    menuOpener.focus();
  };
  menuOpener.onclick = () => {
    layout.classList.add('menu-open');
    menuOpener.setAttribute('aria-expanded', 'true');
    $('#close-menu').focus();
  };
  $('#close-menu').onclick = closeMenu;
  $('#side').onkeydown = event => { if (event.key === 'Escape') closeMenu(); };
  $('#side').onclick = event => {
    if (event.target.closest('a[href^="#/"]')?.hash === location.hash) closeMenu();
  };
  const selector = $('#environment-select');
  if (selector) selector.onchange = async () => {
    const next = selector.value;
    if (!await discardDraft()) { selector.value = state.environmentCode; return; }
    state.environmentCode = next;
    go('home');
  };
  $('#role-select').onchange = async event => {
    const select = event.currentTarget;
    if (!await discardDraft()) { select.value = state.user.role; return; }
    select.disabled = true;
    try {
      const result = await post('auth/role', {role: select.value});
      userSession(result.data?.role ? result.data : await get('auth/me'));
      resumeWorkspace();
    } catch (error) {
      select.value = state.user.role;
      toast(error.message);
    } finally { select.disabled = false; }
  };
  $('#logout').onclick = async () => {
    if (!await discardDraft()) return;
    const control = $('#logout');
    control.disabled = true;
    try {
      await post('auth/logout');
      clearSession();
      render();
    } catch (error) { toast(error.message); }
    finally { control.disabled = false; }
  };
}

async function discardDraft() {
  if (!state.dirty) return true;
  const result = await ask({heading:'离开未保存草稿', message:'刚才编辑的内容尚未保存。确认离开此页？', confirm:'离开页面'});
  if (result === null) return false;
  state.dirty = false;
  return true;
}

async function showLogin(token) {
  let data;
  let error;
  try {
    state.loginOptions ||= await get('auth/options');
    data = state.loginOptions;
  } catch (problem) { error = problem; }
  if (token !== generation) return;
  const schools = data?.schools || [];
  const available = schools.length > 0;
  $('#app').innerHTML = `
    <main class="login" id="main" tabindex="-1">
      <section class="login-intro">
        <div class="brand">${brand()}</div>
        <h1>校园服务治理工作台</h1>
        <p>按学校和环境管理校园服务，跟踪接入、发布和业务办理。</p>
        <div><span class="mode">DEMO · 虚构学校与业务数据</span></div>
      </section>
      <div class="login-body"><section class="panel stack">
        <div><p class="eyebrow">DEMO ACCESS</p><h2>选择演示身份</h2></div>
        <p class="muted">先选择学校，再选择岗位账号。登录后只显示该账号有权访问的记录。</p>
        ${available ? form('login-form',
          selectField('schoolCode', '演示学校', schools.map(s => [s.code, s.name]), schools[0].code, {required:true}) +
          selectField('account', '演示账号', [], '', {required:true}), '进入工作台')
          : error ? errorMarkup(error) : empty('暂无可用的演示学校。')}
        <a class="legacy-link" href="/">返回校园服务首页</a>
      </section></div>
    </main>`;
  if (!available) return;
  const schoolInput = $('#field-schoolCode');
  const account = $('#field-account');
  const updateAccounts = () => {
    const accounts = schools.find(s => s.code === schoolInput.value)?.accounts || [];
    const options = accounts.map(a => [a.account, `${a.displayName || a.account} · ${roles[a.role] || a.role || '演示账号'}`]);
    account.innerHTML = selectOptions([['', '请选择演示账号'], ...options], '');
  };
  schoolInput.onchange = updateAccounts;
  updateAccounts();
  bindForm('#login-form', async body => {
    const {data} = await post('auth/demo-login', body, {auth:false});
    userSession(data);
    if (!data.environments) userSession(await get('auth/me'));
    resumeWorkspace();
  });
}

async function home() {
  const user = state.user;
  const sections = Object.keys(pages).filter(key => key !== 'home' && permitted(key));
  const links = sections.map(key => {
    const [caption, glyph, , , description] = pages[key];
    return `<a class="tile panel" href="${url(key)}"><span class="icon-box">${icon(glyph)}</span>
      <div><h2>${caption}</h2><p>${description}</p></div><span class="go">打开 ${icon('arrow')}</span></a>`;
  }).join('');
  let overview = '';
  if (staff.includes(user.role)) {
    try {
      const data = await get('admin/workspace');
      const counters = data.counts || data.stats || data;
      const names = {
        pendingApprovals:'待审批发布', unknownOperations:'结果未知', openCases:'未结案件',
        openTasks:'待办任务', pendingTasks:'待办任务', activeSessions:'进行中的会话', openSessions:'未结设备会话',
        activeServices:'已发布服务', services:'服务', releases:'发布', cases:'核查案件', tasks:'业务待办'
      };
      const metrics = Object.entries(counters).filter(([key, count]) => names[key] && typeof count === 'number');
      overview = metrics.length ? `<div class="grid cards">${metrics.map(([key, count]) =>
        `<section class="panel"><p class="muted">${names[key]}</p><p class="metric">${count}</p></section>`).join('')}</div>` : '';
    } catch (error) {
      if (error.status !== 403) overview = errorMarkup(error);
    }
  }
  return {html: `
    ${title('工作概览', '在当前学校和环境下查看服务、发布与运行状态。')}
    <section class="hero"><div><p class="eyebrow">当前工作区</p><h2>${esc(user.schoolName || user.schoolCode)}</h2>
      <p>${esc(user.displayName)} · ${esc(roles[user.role] || user.role)}</p></div>
      <span class="mode ${environment()?.mode === 'PRODUCTION' ? 'production' : ''}">${esc(environment()?.mode || 'DEMO')} · ${esc(environment()?.name || state.environmentCode)}</span></section>
    ${overview}<div class="grid">${links}</div>`};
}

function route() {
  const locationHash = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
  const [path, query = ''] = locationHash.split('?');
  const [page, ...parts] = path.split('/').map(decodeURIComponent);
  return {page: page || 'home', parts, query: new URLSearchParams(query)};
}

export function go(path) {
  const hash = url(path);
  if (location.hash === hash) return render();
  location.hash = hash;
}

export async function render() {
  const token = ++generation;
  if (!state.user) return showLogin(token);
  let current;
  try { current = route(); }
  catch { current = {page:'missing', parts:[], query:new URLSearchParams()}; }
  const {page, parts, query} = current;
  shell(page);
  const main = $('#main');
  const handler = {home, ...managementPages, ...runtimePages}[page];
  if (!pages[page] || !handler) {
    main.innerHTML = title('页面不存在', '请从工作台导航选择页面。', link('#/home', '返回工作概览'));
    return;
  }
  if (!permitted(page)) {
    main.innerHTML = title('当前身份无访问权限', '可以在页面顶部选择其他已授权身份。', link('#/home', '返回工作概览'));
    return;
  }
  try {
    const content = await handler({parts, query, go, refresh:render});
    if (token !== generation) return;
    main.innerHTML = content.html;
    content.setup?.();
  } catch (error) {
    if (token !== generation) return;
    if (error.status === 401) {
      clearSession();
      await showLogin(token);
      return;
    }
    main.innerHTML = title(pages[page][0], '无法加载当前页面。') + errorMarkup(error) + `
      <div class="toolbar" style="margin-top:16px">${button('retry-page','重新加载')}${link('#/home','返回工作概览')}</div>`;
    $('[data-action="retry-page"]').onclick = render;
  }
}

async function boot() {
  try { userSession(await get('auth/me')); }
  catch { clearSession(); }
  previousHash = location.hash.startsWith('#/') ? location.hash : '#/home';
  await render();
}

window.addEventListener('hashchange', async () => {
  if (!location.hash.startsWith('#/')) return;
  if (!await discardDraft()) {
    history.replaceState(null, '', previousHash);
    return;
  }
  previousHash = location.hash;
  render();
});
window.addEventListener('beforeunload', event => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
$('.skip').onclick = event => { event.preventDefault(); $('#main')?.focus(); };
boot();
