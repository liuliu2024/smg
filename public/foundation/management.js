import {
  $, esc, id, val, label, status, fmtDate, title, panel, empty, info, facts, link, button, details, code,
  rows, get, post, patch, state, field, selectField, area, form, jsonField, parseJson, bindForm, bindAction,
  listRows, recordLink, paging, filterForm, bindFilters, listing, toast, ask
} from './core.js';

const role = (...names) => names.includes(state.user.role);
const identifier = record => val(record, 'id', 'releaseId');
const titleOf = record => val(record, 'name', 'title', 'code', 'id');
const updated = record => fmtDate(val(record,'updatedAt','updated_at','createdAt','created_at'));
const display = value => typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
const page = (heading, description, sections, action) => ({
  html: title(heading, description, action) + `<div class="stack">${sections.join('')}</div>`
});

function listPage({heading, description, route, query, go, meta, records, columns, draw, placeholder, statuses, actions = ''}) {
  return {
    ...page(heading, description, [
      panel('', filterForm(query, {placeholder, statuses}) +
        listRows(records, columns, draw, '没有符合条件的记录。') + paging({route, query, meta, count: records.length}))
    ], actions),
    setup: () => bindFilters(go, route, query)
  };
}

async function catalog(context) {
  const [serviceId, action] = context.parts;
  if (serviceId === 'new') return editService(context);
  if (serviceId) return serviceDetail(serviceId, action, context);
  const {records, meta} = await listing('admin/services', context.query);
  return listPage({
    ...context, records, meta, route:'catalog', heading:'服务目录', description:'在本校环境内管理服务责任、依赖与版本。',
    columns:['服务','负责人','生命周期','详情'], placeholder:'按名称或编号搜索',
    statuses:['DRAFT','ACTIVE','SUSPENDED'],
    actions: role('SCHOOL_ADMIN','SERVICE_OWNER') ? link('#/catalog/new', '新建服务草稿', 'primary') : '',
    draw: service => [
      `${recordLink('catalog/' + id(service.id), service.name)}<p class="muted">${esc(service.code)}</p>`,
      esc(val(service,'businessOwnerName','businessOwnerId','business_owner_id')),
      status(val(service,'lifecycle','status')),
      link('#/catalog/' + id(service.id), '查看服务', 'compact')
    ]
  });
}

async function editService({go}, service) {
  const editing = Boolean(service);
  const current = service || {};
  const users = rows(await get('admin/users',{pageSize:100}));
  const choices = position => [['','请选择'], ...users.filter(user => user.status === 'ACTIVE' && user.roles?.includes(position))
    .map(user => [user.id, val(user,'displayName','display_name','name')])];
  const result = page(editing ? '编辑服务资料' : '新建服务草稿', editing ? current.name : '草稿保存后可以绑定能力、创建发布版本。', [
    panel('服务基础资料', form('new-service',
      field('name','服务名称',{required:true,maxlength:120,value:current.name}) +
      field('code','服务编号',{required:true,maxlength:64,pattern:'[a-z][a-z0-9-]*',placeholder:'library-reservation',value:current.code,readonly:editing}) +
      field('scenarioCode','场景编号',{required:true,maxlength:64,pattern:'[A-Za-z][A-Za-z0-9_-]*',placeholder:'LIBRARY_RESERVATION',value:val(current,'scenarioCode','scenario_code')}) +
      selectField('businessOwnerId','业务负责人',choices('SERVICE_OWNER'),role('SERVICE_OWNER') ? state.user.userId : val(current,'businessOwnerId','business_owner_id'),
        {required:true,disabled:role('SERVICE_OWNER')}) +
      selectField('technicalOwnerId','技术负责人',choices('INTEGRATOR'),val(current,'technicalOwnerId','technical_owner_id'),{required:true}) +
      field('authority','权威系统',{required:true,maxlength:120,placeholder:'external-library',value:val(current,'authorityPolicy','authority_policy')?.authority}),
      editing ? '保存修改' : '保存服务草稿'))
  ], link(editing ? '#/catalog/' + id(current.id) : '#/catalog',editing ? '返回服务详情' : '返回服务目录'));
  result.setup = () => bindForm('#new-service', async data => {
    const {authority, ...fields} = data;
    const body = {...fields,authorityPolicy:{authority}};
    if (role('SERVICE_OWNER')) body.businessOwnerId = state.user.userId;
    const result = editing ? await patch('admin/services/' + id(current.id),body,current.version) : await post('admin/services',body);
    state.dirty = false;
    toast(editing ? '服务资料已保存' : '服务草稿已保存');
    go('catalog/' + id(result.data.id));
  }, {dirty:true});
  return result;
}

const releaseStates = ['DRAFT','VALIDATED','TEST_PASSED','PENDING_APPROVAL','APPROVED','ACTIVE'];
const releaseName = release => '发布版本 ' + (val(release, 'number', 'releaseVersion', 'release_version', 'version') || '');
const releaseRow = release => [
  `${recordLink('releases/' + id(identifier(release)), releaseName(release))}<p class="muted">${esc(val(release,'serviceName','service_name'))}</p>`,
  status(release.status), esc(updated(release)), link('#/releases/' + id(identifier(release)), '查看版本', 'compact')
];

async function serviceDetail(serviceId, action, context) {
  const [service, releases] = await Promise.all([
    get('admin/services/' + id(serviceId)), get('admin/releases', {serviceId,pageSize:100})
  ]);
  const versions = rows(releases);
  if (action === 'new-release') return newRelease(service, versions, context);
  if (action === 'edit') return editService(context,service);
  const authority = val(service,'authorityPolicy','authority_policy');
  const canManage = role('SCHOOL_ADMIN','SERVICE_OWNER');
  const result = page(service.name, '查看服务基础信息、数据责任与各发布版本。', [
    panel('基础资料', facts([
      ['服务编号', service.code], ['场景', val(service,'scenarioCode','scenario_code')],
      ['业务负责人', val(service,'businessOwnerName','businessOwnerId','business_owner_id')],
      ['技术负责人', val(service,'technicalOwnerName','technicalOwnerId','technical_owner_id')],
      ['权威来源', authority?.authority || display(authority)],
      ['生命周期', label(val(service,'lifecycle','status'))]
    ]) + (canManage ? `<div class="inline">${link('#/catalog/' + id(serviceId) + '/edit','编辑基础资料')}
      ${service.status === 'ACTIVE' ? button('suspend-service','暂停新办理','danger') : ''}
      ${service.status === 'SUSPENDED' ? button('resume-service','恢复新办理','primary') : ''}</div><div id="action-result" aria-live="polite"></div>` : '')),
    panel('发布版本', listRows(versions,['版本','状态','更新时间','详情'],releaseRow,'尚未创建发布版本。'))
  ], `<div class="inline">${link('#/catalog','返回目录')}
    ${role('SERVICE_OWNER') ? link('#/catalog/' + id(serviceId) + '/new-release','新建发布草稿','primary') : ''}</div>`);
  result.setup = () => {
    for (const [action,heading,message] of [
      ['suspend','暂停新办理','暂停后，本校该服务将停止接受新申请。已有办理记录仍可查看。'],
      ['resume','恢复新办理','恢复后，本校已发布该服务的环境可以接受新申请。']
    ]) {
      bindAction(action+'-service',async () => {
        const body = await ask({heading,message,fields:area('reason','操作原因','',{required:true,maxlength:500}),confirm:heading});
        if (!body) return;
        await post('admin/services/' + id(serviceId) + '/' + action,body,{version:service.version});
        toast(heading+'已保存');
        await context.refresh();
      });
    }
  };
  return result;
}

const minimumDefinition = {
  schemaVersion:1, form:{type:'object',properties:{},required:[],additionalProperties:false},
  policy:{authority:'demo',maxSteps:5},
  workflow:{start:'done',nodes:[{id:'done',type:'end',outcome:'COMPLETED'}]}
};

async function newRelease(service, releases, {go}) {
  const current = releases.find(release => release.status === 'ACTIVE');
  let definition = minimumDefinition;
  if (current) {
    const source = await get('admin/releases/' + id(identifier(current)));
    definition = val(source,'definition','sourceDefinition','source_definition') || definition;
  }
  const result = page('新建发布草稿', service.name, [
    panel('流程定义', form('release-new', jsonField('definition','表单、规则和流程 JSON', definition), '保存发布草稿',
      current ? '已载入当前生效版本的定义，可修改后另存草稿。' : '以下为最小演示定义。按服务的实际权威来源、表单和节点调整。'))
  ], link('#/catalog/' + id(service.id),'返回服务详情'));
  result.setup = () => bindForm('#release-new', async data => {
    const {data: draft} = await post('admin/services/' + id(service.id) + '/releases', {definition:parseJson(data.definition,'definition')});
    state.dirty = false;
    toast('发布草稿已保存');
    go('releases/' + id(identifier(draft)));
  }, {dirty:true});
  return result;
}

async function releases(context) {
  const [releaseId] = context.parts;
  if (releaseId) return releaseDetail(releaseId, context);
  const {records, meta} = await listing('admin/releases', context.query);
  return listPage({
    ...context, records, meta, route:'releases', heading:'发布变更',
    description:'查看版本进度，按岗位完成校验、测试、独立审批和启用。',
    columns:['发布版本','状态','更新时间','详情'], draw:releaseRow,
    statuses:[...releaseStates,'SUPERSEDED'], placeholder:'按服务或发布编号搜索',
    actions: role('SERVICE_OWNER') ? link('#/catalog','到服务目录创建草稿') : ''
  });
}

const releaseActions = {
  DRAFT: [['validate','校验发布草稿',['SERVICE_OWNER','INTEGRATOR']]],
  VALIDATED: [['test-runs','运行模拟测试',['INTEGRATOR']]],
  TEST_PASSED: [['submit','提交发布审批',['SERVICE_OWNER']]],
  PENDING_APPROVAL: [['approve','批准发布',['RELEASE_APPROVER']],['reject','退回发布',['RELEASE_APPROVER']]],
  APPROVED: [['activate','启用此版本',['RELEASE_APPROVER']]]
};
const nodeKinds = {
  action:'调用能力', human:'人工办理', condition:'条件判断', waitEvent:'等待事件',
  timer:'定时等待', incident:'转人工核查', end:'流程终点'
};

async function releaseDetail(releaseId, {refresh,go}) {
  const path = 'admin/releases/' + id(releaseId);
  const release = await get(path);
  const definition = val(release,'definition','sourceDefinition','source_definition') || {};
  const tests = val(release,'testRuns','test_runs') || [];
  const validation = val(release,'validation','validationResult','validation_result','validation_report');
  const runningTest = tests.some(test => test.status === 'RUNNING');
  const selfSubmitted = val(release,'submittedBy','submitted_by') === state.user.userId;
  const visibleActions = (releaseActions[release.status] || []).filter(([key, , allowed]) =>
    role(...allowed) && !(selfSubmitted && ['approve','reject','activate'].includes(key)) && !(runningTest && key === 'test-runs'));
  if (role('SERVICE_OWNER') && ['VALIDATED','TEST_PASSED','REJECTED'].includes(release.status) && !runningTest) {
    visibleActions.push(['reopen','重新编辑为草稿',['SERVICE_OWNER']]);
  }
  const rollbackSource = val(release,'rollbackSourceId','rollback_source_id');
  const canRollback = release.status === 'SUPERSEDED' && role('SERVICE_OWNER');
  const editable = release.status === 'DRAFT' && role('SERVICE_OWNER') && !rollbackSource;
  const result = page(releaseName(release), '同一版本按顺序校验、测试、审批并启用。', [
    panel('发布进度', `<div class="inline">${status(release.status)}</div>
      <ol class="stepper">${releaseStates.map((stage, index) => `<li class="${stage === release.status ? 'active' : ''}"
        ${stage === release.status ? 'aria-current="step"' : ''}><span class="num">${index + 1}</span>${esc(label(stage))}</li>`).join('')}</ol>
      ${facts([['服务',val(release,'serviceName','serviceId','service_id')],['版本校验指纹',release.digest],['最近更新',updated(release)]])}
      <div class="inline">${visibleActions.map(([key,text]) => button(key,text,'primary')).join('') ||
        (canRollback ? '' : '<p class="muted">此版本目前无可用操作。</p>')}
        ${canRollback ? button('rollback','创建回退草稿','primary') : ''}${button('refresh-release','刷新状态')}</div>
      <div id="action-result" aria-live="polite"></div>`),
    rollbackSource ? panel('回退来源',info('此草稿采用历史版本的固定定义。启用前仍需重新校验、测试和独立审批。','warn') +
      `<div>${link('#/releases/' + id(rollbackSource),'查看历史来源版本')}</div>`) : '',
    panel('表单与流程节点',
      listRows(definition.workflow?.nodes || [],['节点','节点类型','能力或结果',''],node => [
        esc(node.id),esc(nodeKinds[node.type] || node.type),esc(node.bindingCode || label(node.outcome) || '—'),''
      ],'此版本暂无可显示的节点。') +
      details('表单字段',code(definition.form)) + details('查看原始定义',code(definition))),
    validation ? panel('校验证据',code(validation)) : '',
    tests.length ? panel('测试记录',listRows(tests,['测试记录','结果','时间','证据'], test => [
      esc(val(test,'name','fixtureSet','id')),status(test.status),esc(updated(test)),test.results ? details('查看测试证据',code(test.results)) : ''
    ],'尚无测试记录。')) : '',
    editable ? panel('编辑发布草稿', form('release-edit',jsonField('definition','流程定义 JSON',definition),'保存修改',
      '保存草稿后需要按版本重新校验与测试。')) : ''
  ], link('#/releases','返回发布列表'));
  result.setup = () => {
    bindAction('refresh-release', async () => {
      if (state.dirty) $('#action-result').innerHTML = info('请先保存草稿修改，再刷新状态。','warn');
      else await refresh();
    });
    bindForm('#release-edit', async data => {
      await patch(path,{definition:parseJson(data.definition,'definition')},release.version);
      state.dirty = false;
      toast('草稿修改已保存');
      await refresh();
    }, {dirty:true});
    bindAction('rollback',async () => {
      const body = await ask({heading:'创建回退草稿',message:'以当前历史版本为来源创建新草稿。现行发布保持有效，待新草稿完成审批并启用后才会切换。',
        fields:area('reason','回退原因','',{required:true,maxlength:500}),confirm:'创建回退草稿'});
      if (!body) return;
      const {data} = await post(path + '/rollback-request',body,{version:release.version});
      toast('已创建回退草稿');
      go('releases/' + id(identifier(data)));
    });
    for (const [action, caption] of visibleActions) bindAction(action, async () => {
      if (state.dirty) {
        $('#action-result').innerHTML = info('请先保存草稿修改，再运行发布操作。','warn');
        return;
      }
      let body = {};
      if (['approve','reject'].includes(action)) {
        body = await ask({heading:caption,message:'审批意见将进入审计记录。',
          fields:area('reason','审批意见','',{required:true,maxlength:500}),confirm:caption});
        if (!body) return;
      }
      if (['submit','activate','reopen'].includes(action)) {
        const confirmation = await ask({heading:caption, message:action === 'activate'
          ? '此版本将用于当前学校环境的新申请。已有办理记录继续使用各自的原版本。'
          : action === 'reopen' ? '恢复为草稿后，此版本需要重新校验和测试。' : '将当前已测试版本提交给独立审批员。', confirm:caption});
        if (!confirmation) return;
      }
      const {data} = await post(path + '/' + action, body, {version:release.version});
      if (action === 'validate' && (data?.blockingErrors?.length || data?.errors?.length)) {
        toast('校验发现阻断项，请查看校验证据');
        await refresh();
        return;
      }
      toast(action === 'test-runs' ? '已记录测试请求，请查看测试结果。' : '发布记录已更新');
      await refresh();
    });
  };
  return result;
}

async function capabilities(context) {
  const {records,meta} = await listing('admin/capabilities', context.query);
  return listPage({
    ...context, records, meta, route:'capabilities', heading:'能力合同',
    description:'查阅能力版本、允许的副作用和安全重试策略。',columns:['能力','版本','副作用','合同'],
    draw:contract => [
      `<b>${esc(titleOf(contract))}</b><p class="muted">${esc(contract.code)}</p>`,
      esc(contract.version), esc(val(contract,'sideEffect','side_effect') || contract.manifest?.sideEffect), details('查看合同', code(contract))
    ]
  });
}

const canConfigureSharedAssets = () => role('INTEGRATOR','SCHOOL_ADMIN') &&
  (state.user?.scopes || []).some(scope => scope.type === 'SCHOOL' && scope.id === '*');

const dateInput = value => value && !Number.isNaN(Date.parse(value))
  ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0,16) : '';

async function connections(context) {
  const [connectionId] = context.parts;
  if (connectionId) return connectionDetail(connectionId, context);
  const {records,meta} = await listing('admin/connections', context.query);
  return listPage({
    ...context, records, meta, route:'connections', heading:'连接管理',
    description:'连接按学校和环境隔离，界面只显示凭证配置状态。',columns:['连接','模式','授权有效期','详情'],
    actions:canConfigureSharedAssets() ? link('#/connections/new','新增连接','primary') : '',
    draw:record => [
      recordLink('connections/' + id(record.id),titleOf(record)),status(record.mode),
      esc(fmtDate(val(record,'authorizationExpiresAt','authorization_expires_at'))),
      link('#/connections/' + id(record.id),'查看连接','compact')
    ]
  });
}

async function connectionDetail(connectionId, {go, refresh}) {
  const isNew = connectionId === 'new';
  if (isNew && !canConfigureSharedAssets()) throw Object.assign(new Error('当前身份无权配置连接。'),{status:403});
  const path = 'admin/connections/' + id(connectionId);
  const connection = isNew ? {} : await get(path);
  const writable = canConfigureSharedAssets();
  const adapters = writable ? rows(await get('admin/adapters')) : [];
  const editor = form('connection-form',
    field('name','连接名称',{value:connection.name,required:true,maxlength:100}) +
    selectField('adapterPackageId','适配器版本',[['','请选择'], ...adapters.map(a => [a.id,`${titleOf(a)} · ${a.version || ''}`])],
      val(connection,'adapterPackageId','adapter_package_id'),{required:true}) +
    selectField('mode','连接模式',['DEMO','TEST','LIVE','MANUAL'].map(mode => [mode,`${mode} · ${label(mode)}`]),connection.mode || 'DEMO',{required:true}) +
    field('authorizationExpiresAt','授权到期（北京时间）',{type:'datetime-local',value:dateInput(val(connection,'authorizationExpiresAt','authorization_expires_at'))}) +
    field('secretRef','凭证引用（可选）',{placeholder:'由部署管理员提供的引用名称',maxlength:120}) +
    jsonField('config','非秘密连接配置 JSON',connection.config || {}),
    isNew ? '保存连接' : '保存连接修改', '凭证字段只填引用名称。请勿粘贴密码、令牌或密钥。');
  const result = page(isNew ? '新增连接' : titleOf(connection), '配置当前环境的适配器与授权。', [
    isNew ? '' : panel('连接状态',`<div class="inline">${status(connection.mode)}${status(connection.status)}</div>` +
      facts([['凭证配置',val(connection,'secretConfigured','secret_configured') ? '已配置引用' : '未配置引用'],
        ['授权到期',fmtDate(val(connection,'authorizationExpiresAt','authorization_expires_at'))],['更新时间',updated(connection)]]) +
      (writable ? `<div class="inline">${connection.mode === 'DEMO' ? button('test-read','验证演示连接') : ''}${connection.status !== 'DISABLED' && connection.enabled !== false
        ? button('disable','停用连接','danger') : ''}</div>` : '') + '<div id="action-result" aria-live="polite"></div>'),
    writable ? panel('连接配置',editor) : ''
  ], link('#/connections','返回连接列表'));
  result.setup = () => {
    bindForm('#connection-form', async data => {
      const body = {name:data.name,adapterPackageId:data.adapterPackageId,mode:data.mode,config:parseJson(data.config,'config')};
      if (data.secretRef) body.secretRef = data.secretRef;
      if (data.authorizationExpiresAt) body.authorizationExpiresAt = new Date(data.authorizationExpiresAt + ':00+08:00').toISOString();
      const response = isNew ? await post('admin/connections',body) : await patch(path,body,connection.version);
      state.dirty = false;
      toast('连接配置已保存');
      if (isNew) go('connections/' + id(response.data.id));
      else await refresh();
    }, {dirty:true});
    bindAction('test-read', async () => {
      if (state.dirty) {
        $('#action-result').innerHTML = info('请先保存当前连接配置。','warn');
        return;
      }
      const {data} = await post(path + '/test-read', {}, {version:connection.version});
      toast(data.testOutcome === 'DEMO_CONFIG_VALID' ? '演示连接配置已通过校验' : '连接校验已记录');
      await refresh();
    });
    bindAction('disable', async () => {
      if (state.dirty) {
        $('#action-result').innerHTML = info('请先保存或离开当前修改。','warn');
        return;
      }
      const confirmation = await ask({heading:'停用此连接',message:'停用后将阻止通过此连接发起新的外部操作。',confirm:'停用连接'});
      if (!confirmation) return;
      await post(path + '/disable',{}, {version:connection.version});
      toast('已停用连接');
      await refresh();
    });
  };
  return result;
}

async function bindings(context) {
  const [bindingId] = context.parts;
  if (bindingId) return bindingDetail(bindingId, context);
  const {records,meta} = await listing('admin/bindings', context.query);
  return listPage({
    ...context, records, meta, route:'bindings', heading:'能力绑定',
    description:'将合同版本绑定到当前环境的供应商连接。',columns:['能力','支持状态','重试策略','详情'],
    actions:canConfigureSharedAssets() ? link('#/bindings/new','新增能力绑定','primary') : '',
    draw:record => [
      recordLink('bindings/' + id(record.id),val(record,'code','name','contractCode','contract_code','contract_id','contractId','id')),
      status(record.support),esc(val(record,'retryClass','retry_class')),link('#/bindings/' + id(record.id),'查看绑定','compact')
    ]
  });
}

async function bindingDetail(bindingId, {go, refresh}) {
  const isNew = bindingId === 'new';
  const writable = canConfigureSharedAssets();
  if (isNew && !writable) throw Object.assign(new Error('当前身份无权配置绑定。'),{status:403});
  const path = 'admin/bindings/' + id(bindingId);
  const binding = isNew ? {} : await get(path);
  const [contractData, connectionData] = writable ? await Promise.all([get('admin/capabilities'), get('admin/connections')]) : [[],[]];
  const asChoices = data => [['','请选择'], ...rows(data).map(x => [x.id,`${titleOf(x)}${x.version ? ' · ' + x.version : ''}`])];
  const editor = form('binding-form',
    selectField('contractId','能力合同版本',asChoices(contractData),val(binding,'contractId','contract_id'),{required:true,disabled:!isNew}) +
    selectField('connectionId','当前环境连接',asChoices(connectionData),val(binding,'connectionId','connection_id'),{required:true}) +
    selectField('support','支持状态',['SUPPORTED','CONDITIONAL','UNSUPPORTED','UNVERIFIED'].map(s => [s,label(s)]),binding.support || 'UNVERIFIED') +
    selectField('retryClass','重试策略',['READ_SAFE','WRITE_IDEMPOTENT_VERIFIED','QUERY_BEFORE_RETRY','MANUAL_ONLY']
      .map(s => [s,({READ_SAFE:'安全读取',WRITE_IDEMPOTENT_VERIFIED:'已验证幂等写入',QUERY_BEFORE_RETRY:'先核实再决定',MANUAL_ONLY:'仅人工'})[s]]),
      val(binding,'retryClass','retry_class') || 'MANUAL_ONLY') +
    jsonField('limitations','限制与适用条件 JSON',binding.limitations || {}) +
    jsonField('mapping','字段映射 JSON',binding.mapping || {}),isNew ? '保存绑定' : '保存绑定修改');
  const result = page(isNew ? '新增能力绑定' : '能力绑定详情', '查看并配置本环境中能力执行约束。', [
    isNew ? '' : panel('有效配置',facts([
      ['合同',val(binding,'contractCode','contractId','contract_id')],['连接',val(binding,'connectionName','connectionId','connection_id')],
      ['支持状态',label(binding.support)],['重试策略',val(binding,'retryClass','retry_class')],['限制',display(binding.limitations)]
    ]) + details('字段映射',code(binding.mapping))),
    writable ? panel('绑定配置',editor) : ''
  ], link('#/bindings','返回绑定列表'));
  result.setup = () => bindForm('#binding-form', async data => {
    const body = {...data,contractId:data.contractId || val(binding,'contractId','contract_id'),
      mapping:parseJson(data.mapping,'mapping'),limitations:parseJson(data.limitations,'limitations')};
    const response = isNew ? await post('admin/bindings',body) : await patch(path,body,binding.version);
    state.dirty = false;
    toast('能力绑定已保存');
    if (isNew) go('bindings/' + id(response.data.id));
    else await refresh();
  }, {dirty:true});
  return result;
}

async function audit(context) {
  const {records,meta} = await listing('admin/audit', context.query);
  return listPage({
    ...context, records, meta, route:'audit', heading:'审计记录',
    description:'按当前学校环境查阅已记录的身份、动作、目标及结果。',
    columns:['动作与对象','执行人','时间','详情'],placeholder:'搜索动作、对象或执行人',
    draw:entry => [
      `<b>${esc(entry.action)}</b><p class="muted">${esc(val(entry,'targetType','target_type','resource_type'))} · ${esc(val(entry,'targetId','target_id','resource_id'))}</p>`,
      esc(val(entry,'actorName','actorId','actor_id','actorUserId','actor_user_id')),esc(updated(entry)),details('审计详情',code(entry))
    ]
  });
}

async function system({refresh}) {
  const data = await get('admin/system');
  const summary = Object.entries(data).filter(([,value]) => typeof value !== 'object').map(([key,value]) => [
    ({version:'系统版本',mode:'运行模式',database:'数据库',worker:'后台任务',environmentCode:'环境',status:'状态'})[key] || key, label(value)
  ]);
  return {
    ...page('系统健康','当前环境的运行、配置与外部连接状态。',[
      panel('系统状态',(summary.length ? facts(summary) : '') + code(data))
    ],button('refresh-system','重新检查')),
    setup:() => bindAction('refresh-system',refresh)
  };
}

const gateNames = {
  DISCOVERY:'调研', RESPONSIBILITY:'责任确认', AUTHORIZATION:'授权', CONTRACT:'合同',
  CONFIGURATION:'配置', TESTING:'测试', BUSINESS_ACCEPTANCE:'业务验收', PILOT:'试点',
  LIVE:'正式接入', EXIT:'退出'
};
const gateReviewers = {
  DISCOVERY:'SERVICE_OWNER',RESPONSIBILITY:'SERVICE_OWNER',AUTHORIZATION:'RELEASE_APPROVER',CONTRACT:'SERVICE_OWNER',
  CONFIGURATION:'INTEGRATOR',TESTING:'INTEGRATOR',BUSINESS_ACCEPTANCE:'SERVICE_OWNER',PILOT:'RELEASE_APPROVER'
};
const canSubmitMaterial = () => role('SCHOOL_ADMIN','SERVICE_OWNER','INTEGRATOR');

async function projectMaterial(stage, serviceId, previous = {}) {
  const texts = (...fields) => fields.map(([key,caption]) => area(key,caption,previous[key] || '',{required:true,maxlength:1500})).join('');
  const lines = (key,caption) => area(key,caption,previous[key]?.join('\n') || '',{required:true,maxlength:3000});
  if (stage === 'DISCOVERY') return texts(['system','现有系统与版本'],['workflow','正常及异常办理步骤'],['provider','供应商及联系人']);
  if (stage === 'RESPONSIBILITY') return texts(['authority','数据权威'],['accountableParty','业务责任方'],['incidentContact','异常联系与值守']);
  if (stage === 'AUTHORIZATION') return texts(['reference','校方授权依据']) +
    field('expiresAt','授权到期（北京时间）',{type:'datetime-local',required:true,value:dateInput(previous.expiresAt)}) +
    lines('actions','获准的动作（每行一个）') + lines('fields','获准的数据字段（每行一个）');
  if (stage === 'CONTRACT') return lines('contracts','能力合同版本（每行一个）') + texts(['queryPolicy','查询与重试规则']);
  if (stage === 'CONFIGURATION') {
    const connections = rows(await get('admin/connections',{pageSize:100})).filter(c => c.status === 'ACTIVE');
    return selectField('connectionId','有效连接',[['','请选择'],...connections.map(c => [c.id,c.name])],previous.connectionId,{required:true});
  }
  if (stage === 'TESTING') {
    const releases = rows(await get('admin/releases',{serviceId,pageSize:100}));
    const detail = await Promise.all(releases.filter(r => ['TEST_PASSED','APPROVED','ACTIVE','PENDING_APPROVAL'].includes(r.status))
      .map(r => get('admin/releases/' + id(r.id))));
    const tests = detail.flatMap(r => (r.testRuns || []).filter(test => test.status === 'PASSED' && test.digest === r.digest)
      .map(test => [test.id,`${releaseName(r)} · ${fmtDate(test.finished_at)}`]));
    return selectField('testRunId','通过的本服务测试',[['','请选择'],...tests],previous.testRunId,{required:true});
  }
  if (stage === 'BUSINESS_ACCEPTANCE') return texts(['confirmation','业务方验收结论与依据']);
  if (stage === 'PILOT') return texts(['scope','试点范围'],['rollback','回退与存量处理'],['contact','试点值守联系人']);
  return '';
}

async function projectDetail(projectId,{refresh}) {
  const path = 'admin/onboarding-projects/' + id(projectId);
  const project = await get(path);
  const service = await get('admin/services/' + id(project.service_id));
  const stage = project.stage;
  const submitted = project.material?.[stage];
  const showMaterial = gateReviewers[stage] && canSubmitMaterial() && submitted?.status !== 'PENDING';
  const review = submitted?.status === 'PENDING' && role(gateReviewers[stage]);
  const workState = {IN_PROGRESS:'进行中',WAITING_MATERIAL:'等待材料',BLOCKED:'受阻',COMPLETED:'已完成'};
  const decisionState = {SUBMIT:'提交材料',APPROVE:'批准',RETURN:'退回'};
  const materials = showMaterial ? await projectMaterial(stage,project.service_id,submitted?.evidence) : '';
  const result = page(service.name + ' · 接入项目','逐阶段提交证据并由对应岗位审阅。',[
    panel('阶段进度',`<ol class="stepper">${Object.entries(gateNames).map(([key,name], index) =>
      `<li class="${key === stage ? 'active' : ''}"><span class="num">${index + 1}</span>${name}</li>`).join('')}</ol>` +
      facts([['当前阶段',gateNames[stage]],['办理状态',workState[project.working_status]],
        ['当前材料',submitted?.status === 'PENDING' ? '待审阅' : submitted?.status === 'RETURNED' ? '已退回' : '待提交']]) +
      (stage === 'LIVE' ? info('正式接入需真实校方授权和供应商联调。','warn') : '') +
      (submitted ? details('查看本阶段材料',code(submitted.evidence)) : '')),
    materials ? panel('提交本阶段材料',form('gate-submit',materials + area('reason','提交说明','',{required:true,maxlength:1500}),
      '提交阶段材料')) : '',
    review ? panel('审阅本阶段材料',form('gate-review',
      selectField('decision','审阅结果',[['','请选择'],['APPROVE','批准并进入下一阶段'],['RETURN','退回补充']], '', {required:true}) +
      area('reviewReason','审阅意见','',{required:true,maxlength:1500}),'保存审阅结果')) : '',
    panel('阶段记录',listRows(project.reviews || [],['阶段','处理结果','时间','详情'],entry => [
      esc(gateNames[entry.gate]),esc(decisionState[entry.decision]),esc(updated(entry)),
      details('查看审阅证据',`<p>${esc(entry.reason)}</p>${code(entry.evidence)}`)
    ],'尚无阶段记录。'))
  ],link('#/onboarding','返回项目列表'));
  const gatePath = path + '/gates/' + id(stage);
  result.setup = () => {
    bindForm('#gate-submit',async ({reason,...material}) => {
      for (const key of ['actions','fields','contracts']) {
        if (material[key]) material[key] = material[key].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      }
      if (material.expiresAt) material.expiresAt = new Date(material.expiresAt + ':00+08:00').toISOString();
      await post(gatePath + '/submit',{reason,material},{version:project.version});
      state.dirty = false;
      toast('阶段材料已提交');
      await refresh();
    },{dirty:true});
    bindForm('#gate-review',async ({decision,reviewReason}) => {
      await post(gatePath + '/review',{decision,reason:reviewReason},{version:project.version});
      state.dirty = false;
      toast('阶段审阅结果已保存');
      await refresh();
    },{dirty:true});
  };
  return result;
}

async function onboarding(context) {
  const [projectId] = context.parts;
  if (projectId === 'new') {
    const services = rows(await get('admin/services',{pageSize:100}));
    const result = page('新建接入项目','为本环境的服务建立一份分阶段接入记录。',[
      panel('选择服务',form('project-create',selectField('serviceId','关联服务',[
        ['','请选择'],...services.map(service => [service.id,service.name])
      ],'',{required:true}),'创建项目'))
    ],link('#/onboarding','返回项目列表'));
    result.setup = () => bindForm('#project-create',async body => {
      const {data} = await post('admin/onboarding-projects',body);
      toast('接入项目已创建');
      context.go('onboarding/' + id(data.id));
    });
    return result;
  }
  if (projectId) return projectDetail(projectId,context);
  const {records,meta} = await listing('admin/onboarding-projects',context.query);
  return listPage({
    ...context,records,meta,route:'onboarding',heading:'接入项目',description:'查看阶段记录、责任与已提交的证据。',
    columns:['项目','阶段','状态','详情'],
    actions:canSubmitMaterial() ? link('#/onboarding/new','新建接入项目','primary') : '',
    draw:record => [recordLink('onboarding/' + id(record.id),record.service_name || titleOf(record)),esc(gateNames[record.stage]),
      status(record.working_status),link('#/onboarding/' + id(record.id),'查看项目','compact')]
  });
}

export const managementPages = {catalog,releases,capabilities,connections,bindings,onboarding,audit,system};
