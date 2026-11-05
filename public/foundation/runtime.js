import {
  $, esc, id, icon, val, label, status, fmtDate, title, panel, empty, info, facts, link, button, details, code,
  rows, get, post, state, field, selectField, area, form, schemaFields, schemaValues,
  bindForm, bindAction, listRows, recordLink, paging, filterForm, bindFilters, listing, toast, ask
} from './core.js';

const role = (...names) => names.includes(state.user.role);
const recordId = record => val(record,'id','instanceId','operationId','caseId','sessionId');
const updated = record => fmtDate(val(record,'updatedAt','updated_at','createdAt','created_at','timestamp'));
const faults = [
  ['NORMAL','正常办理'], ['BUSINESS_REJECT','业务拒绝'], ['TIMEOUT_AFTER_COMMIT','已受理但响应丢失'],
  ['DUPLICATE_CALLBACK','重复事件'], ['OUT_OF_ORDER','事件乱序']
];
const faultSelect = (choices = faults) => selectField('fault','模拟情形',choices,'NORMAL');
const actionsResult = '<div id="action-result" aria-live="polite"></div>';
const observationWindows = new Map();
const view = (heading, description, sections, action) => ({
  html: title(heading, description, action) + `<div class="stack">${sections.join('')}</div>`
});
const entityTitle = record => val(record,'name','title','serviceName','service_name','code','serviceCode','service_code') || '业务记录';
const dataList = async (endpoint, context, options) => {
  const {records,meta} = await listing(endpoint,context.query);
  return {
    ...view(options.heading,options.description,[
      panel('',filterForm(context.query,options) + listRows(records,options.columns,options.draw,'没有符合条件的记录。') +
        paging({route:options.route,query:context.query,meta,count:records.length}))
    ]),
    setup:() => bindFilters(context.go,options.route,context.query)
  };
};

function serviceKind(entry) {
  const code = entry.code || entry.serviceCode || '';
  if (code.includes('library')) return ['library','查询模拟馆藏并提交预约，由馆员确认待取。'];
  if (/energy|charg/.test(code)) return ['wallet','查看模拟端口、开始或结束会话及查看账单。'];
  if (/parcel|locker/.test(code)) return ['folder','查看本人模拟取件权益与柜体操作结果。'];
  return ['apps','使用当前环境已启用的办理版本。'];
}

async function services({parts,query,go,refresh}) {
  const [serviceCode, action, subId] = parts;
  if (serviceCode) {
    if (action === 'session' && subId) return energySession(serviceCode,subId,{refresh});
    if (action === 'operation' && subId) return operationDetail(subId,{refresh,back:'#/services/' + id(serviceCode),staff:false});
    const service = await get('services/' + id(serviceCode));
    const [kind] = serviceKind(service);
    if (kind === 'wallet') return energyService(service,{go,refresh});
    if (kind === 'folder') return parcelService(service,{go,refresh});
    return submitService(service,{go});
  }
  const allServices = rows(await get('services',{pageSize:'100'}));
  const q = (query.get('q') || '').toLowerCase();
  const records = allServices.filter(service => [service.name,service.code,service.description]
    .some(value => String(value ?? '').toLowerCase().includes(q)));
  const cards = records.map(service => {
    const [glyph,description] = serviceKind(service);
    return `<a class="tile panel" href="#/services/${id(service.code)}">
      <span class="icon-box">${icon(glyph)}</span>
      <div><h2>${esc(service.name)}</h2><p>${esc(service.description || description)}</p></div>
      <span class="go">进入办理 ${icon('arrow')}</span>
    </a>`;
  }).join('');
  return {
    ...view('校园服务','查找当前学校和环境可办理的服务。',[
      filterForm(query,{placeholder:'搜索图书、充电、取件等服务',allRecords:true}), cards ? `<div class="grid">${cards}</div>` : empty('暂无匹配的已发布服务。')
    ],link('#/instances','查看办理记录')),
    setup:() => bindFilters(go,'services',query)
  };
}

async function submitService(service,{go}) {
  const [glyph,description] = serviceKind(service);
  const schema = service.form || service.activeRelease?.definition?.form || {};
  const library = glyph === 'library';
  const restSchema = library ? {...schema,properties:Object.fromEntries(Object.entries(schema.properties || {}).filter(([key]) => !['bookId','fault'].includes(key)))} : schema;
  const books = library ? rows(await get('library/books')) : [];
  const book = library ? selectField('bookId','选择图书',[
    ['','请选择模拟馆藏'], ...books.map(entry => [entry.id,`${entry.title} · 可用 ${entry.available} 册`])
  ],'',{required:true}) : '';
  const result = view(service.name,description,[
    info('本次办理使用演示学校与虚构数据。'),
    panel(library ? '提交图书预约' : '填写申请', library && !books.length ? empty('当前学校暂无演示馆藏。')
      : form('instance-create',book + schemaFields(restSchema) + (library ? faultSelect() : ''),'提交申请'))
  ],link('#/services','返回校园服务'));
  result.setup = () => bindForm('#instance-create',async data => {
    const {fault,...values} = data;
    const body = {form:schemaValues(values,schema)};
    if (fault && fault !== 'NORMAL') body.form.fault = fault;
    const {data:created} = await post('services/' + id(service.code) + '/instances',body,{idempotent:true});
    toast('申请已提交，查看当前办理状态');
    go('instances/' + id(recordId(created.instance || created)));
  });
  return result;
}

function timeline(entries) {
  if (!entries.length) return empty('还没有办理事件，稍后可刷新。');
  return `<ol class="timeline">${entries.map(entry => `<li>
    <div class="inline"><b>${esc(label(val(entry,'title','eventType','event_type','action','kind','type','nodeId','node_id')))}</b>
    ${status(val(entry,'status','outcome'))}</div>
    <p class="muted">${esc(fmtDate(val(entry,'occurredAt','occurred_at','createdAt','created_at','started_at','timestamp','at')))}</p>
    ${entry.message ? `<p>${esc(entry.message)}</p>` : ''}
    ${entry.evidence ? details('查看本次证据',code(entry.evidence)) : ''}
  </li>`).join('')}</ol>`;
}

async function instances(context) {
  const [instanceId] = context.parts;
  if (instanceId) return instanceDetail(instanceId,context);
  return dataList(role('END_USER') ? 'instances' : 'admin/runtime/instances',context,{
    route:'instances',heading:'办理记录',description:'查看本人提交或岗位范围内的办理进度。',
    placeholder:'搜索服务或办理编号',statuses:['RUNNING','WAITING_TASK','COMPLETED','INCIDENT'],
    columns:['业务','状态','时间','详情'],
    draw:record => [
      `${recordLink('instances/' + id(recordId(record)),entityTitle(record))}<p class="muted">${esc(recordId(record))}</p>`,
      status(val(record,'outcome','status')),esc(updated(record)),link('#/instances/' + id(recordId(record)),'查看进度','compact')
    ]
  });
}

async function instanceDetail(instanceId,{refresh}) {
  const data = await get('instances/' + id(instanceId));
  const record = data.instance || data;
  const events = val(data,'timeline','events','nodeExecutions','nodes','history') || [];
  const linked = val(data,'operations','relatedOperations') || [];
  const stateLabel = val(record,'outcome','status');
  const result = view(entityTitle(record),'查看源业务状态、固定版本与实际办理记录。',[
    panel('办理状态',`<div class="inline">${status(stateLabel)}${button('refresh-instance','刷新进度')}</div>` +
      facts([['办理编号',instanceId],['发布版本',val(record,'releaseNumber','release_number','releaseId','release_id')],
        ['当前环节',val(record,'currentNode','current_node')],['最近更新',updated(record)]]) +
      (stateLabel === 'READY_FOR_PICKUP' ? info('馆员已确认备书，请按图书馆安排到馆取书。') : '')),
    panel('办理时间线',timeline(events)),
    linked.length && !role('END_USER') ? panel('关联操作',listRows(linked,['操作','结果','时间',''],entry => [
      recordLink('operations/' + id(recordId(entry)),val(entry,'action','action_code','bindingCode','binding_code') || '查看操作'),
      status(entry.status),esc(updated(entry)),''
    ],'暂无关联操作。')) : ''
  ],link('#/instances','返回办理记录'));
  result.setup = () => {
    bindAction('refresh-instance',async () => {
      observationWindows.delete(instanceId);
      await refresh();
    });
    if (!['RUNNING','WAITING_TASK','WAITING_OPERATION','WAITING_EVENT','WAITING_TIMER'].includes(record.status)) {
      observationWindows.delete(instanceId);
      return;
    }
    const start = observationWindows.get(instanceId) || Date.now();
    observationWindows.set(instanceId,start);
    const section = $('#main');
    const poll = () => {
      if (Date.now() - start > 30000) return;
      setTimeout(async () => {
        if (!section.isConnected || document.hidden) return;
        try {
          const latest = await get('instances/' + id(instanceId));
          if (!section.isConnected) return;
          const next = latest.instance || latest;
          if (next.version !== record.version || next.status !== record.status) await refresh();
          else poll();
        } catch { /* The refresh control stays available. */ }
      },2400);
    };
    poll();
  };
  return result;
}

const taskAvailable = task => ['OPEN','PENDING','AVAILABLE','READY'].includes(task.status);
const taskClaimed = task => task.status === 'CLAIMED' && (!val(task,'assigneeId','assignee_id','assigneeUserId','assignee_user_id') ||
  val(task,'assigneeId','assignee_id','assigneeUserId','assignee_user_id') === state.user.userId);
const taskLabel = task => val(task,'title','serviceName','service_name') || (task.form?.properties?.ready ? '图书预约处理' : '业务办理任务');

async function tasks(context) {
  const [taskId] = context.parts;
  if (taskId) return taskDetail(taskId,context);
  return dataList('admin/tasks',context,{
    route:'tasks',heading:'业务待办',description:'领取当前岗位范围内的任务，核对源业务后完成。',
    columns:['任务','状态','办理时限','详情'],statuses:['OPEN','CLAIMED','COMPLETED'],
    draw:task => [
      recordLink('tasks/' + id(task.id),taskLabel(task)),status(task.status),
      esc(fmtDate(val(task,'dueAt','due_at','deadline'))),link('#/tasks/' + id(task.id),'查看待办','compact')
    ]
  });
}

async function taskDetail(taskId,{refresh}) {
  const path = 'admin/tasks/' + id(taskId);
  const data = await get(path);
  const task = data.task || data;
  const schema = val(task,'form','formSchema','form_schema','outputSchema','output_schema') || {
    properties:{ready:{type:'boolean'},reason:{type:'string',maxLength:500}},required:['ready']
  };
  const instanceId = val(task,'instanceId','instance_id');
  const result = view(taskLabel(task),'按岗位范围核对申请，并记录办理结果。',[
    panel('任务详情',`<div class="inline">${status(task.status)}${taskAvailable(task) ? button('claim','领取办理任务','primary') : ''}</div>` +
      facts([['任务编号',taskId],['办理时限',fmtDate(val(task,'dueAt','due_at','deadline'))],['最近更新',updated(task)]]) +
      (instanceId ? `<div>${link('#/instances/' + id(instanceId),'查看关联办理记录')}</div>` : '') + actionsResult),
    taskClaimed(task) ? panel('填写办理结果',form('task-complete',schemaFields(schema),'提交办理结果')) : ''
  ],link('#/tasks','返回待办'));
  result.setup = () => {
    bindAction('claim',async () => {
      await post(path + '/claim',{}, {version:task.version,idempotent:true});
      toast('已领取任务');
      await refresh();
    });
    bindForm('#task-complete',async data => {
      await post(path + '/complete',{output:schemaValues(data,schema)}, {version:task.version,idempotent:true});
      toast('办理结果已提交');
      await refresh();
    });
  };
  return result;
}

async function operations(context) {
  const [operationId] = context.parts;
  if (operationId) return operationDetail(operationId,{...context,staff:true,back:'#/operations'});
  return dataList('admin/runtime/operations',context,{
    route:'operations',heading:'操作追踪',description:'检查外部操作的状态、证据和已执行的尝试。',
    columns:['操作','状态','时间','详情'],statuses:['UNKNOWN','SUCCEEDED','BUSINESS_REJECTED','TECHNICAL_FAILED'],
    draw:operation => [
      recordLink('operations/' + id(recordId(operation)),val(operation,'action','action_code','bindingCode','binding_code','type') || '业务操作'),
      status(operation.status),esc(updated(operation)),link('#/operations/' + id(recordId(operation)),'查看证据','compact')
    ]
  });
}

async function operationDetail(operationId,{refresh,go,staff,back}) {
  const readPath = (staff ? 'admin/' : '') + 'operations/' + id(operationId);
  const writePath = 'admin/operations/' + id(operationId);
  const data = await get(readPath);
  const record = data.operation || data;
  const allowed = val(data,'allowedActions','allowed_actions') || val(record,'allowedActions','allowed_actions');
  const inState = action => Array.isArray(allowed) && allowed.includes(action);
  const unknown = record.status === 'UNKNOWN';
  const query = staff && (allowed ? inState('query-result') : unknown && role('INTEGRATOR','OPERATOR'));
  const createCase = staff && (allowed ? inState('create-case') || inState('cases') : unknown && role('OPERATOR','INTEGRATOR'));
  const attempts = val(data,'attemptHistory','attempts') || val(record,'attemptHistory','attempts') || [];
  const evidence = val(data,'evidence') || val(record,'evidence','resultEvidence','result_evidence','result');
  const result = view('操作详情','查看实际结果、调用尝试和允许的处置动作。',[
    panel('当前操作',`<div class="inline">${status(record.status)}${button('refresh-operation','刷新结果')}</div>` +
      facts([['操作编号',operationId],['能力',val(record,'action','action_code','bindingCode','binding_code')],
        ['重试规则',val(record,'retryClass','retry_class')],['外部编号',val(record,'externalId','external_id')]]) +
      (unknown ? info('外部结果尚未确认。请先核实事实，再决定是否需要后续操作。','warn') : '') +
      `<div class="inline">${query ? button('query-result','查询外部结果','primary') : ''}
      ${createCase ? button('create-case','创建核查案件') : ''}</div>` + actionsResult),
    panel('执行尝试',Array.isArray(attempts) && attempts.length ? timeline(attempts) : empty('暂无可显示的执行尝试。')),
    evidence ? panel('结果证据',code(evidence)) : ''
  ],link(back,'返回列表'));
  result.setup = () => {
    bindAction('refresh-operation',refresh);
    bindAction('query-result',async () => {
      const {data} = await post(writePath + '/query-result',{}, {version:record.version,idempotent:true});
      $('#action-result').innerHTML = info('查询请求已受理。可刷新查看证据。') + code(data);
    });
    bindAction('create-case',async () => {
      const body = await ask({heading:'创建核查案件',message:'请记录需要核实的情况。',fields:area('reason','原因','',{required:true,maxlength:500}),confirm:'创建案件'});
      if (!body) return;
      const {data} = await post(writePath + '/cases',body,{version:record.version,idempotent:true});
      const caseId = val(data,'caseId','id');
      if (go && caseId) go('cases/' + id(caseId));
      else $('#action-result').innerHTML = info('案件已记录。') + code(data);
    });
  };
  return result;
}

async function cases(context) {
  const [caseId] = context.parts;
  if (caseId) return caseDetail(caseId,context);
  return dataList('admin/runtime/cases',context,{
    route:'cases',heading:'核查案件',description:'查看授权范围内待核实、处理中和已关闭的案件。',
    columns:['案件','状态','时间','详情'],statuses:['OPEN','ASSIGNED','INVESTIGATING','RESOLVED','CLOSED'],
    draw:entry => [
      recordLink('cases/' + id(recordId(entry)),val(entry,'title','category','reason') || '业务核查'),
      status(entry.status),esc(updated(entry)),link('#/cases/' + id(recordId(entry)),'查看案件','compact')
    ]
  });
}

async function caseDetail(caseId,{refresh}) {
  const path = 'admin/runtime/cases/' + id(caseId);
  const data = await get(path);
  const entry = data.case || data;
  const operationId = val(entry,'operationId','operation_id');
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const decisions = data.decisions || entry.decisions || (entry.decision ? [entry.decision] : []);
  const allowed = new Set(data.allowedActions || entry.allowedActions || []);
  const result = view('核查案件详情','核对权威证据并记录需要的后续处理。',[
    panel('案件信息',`<div class="inline">${status(entry.status)}${allowed.has('claim') ? button('claim-case','领取核查案件','primary') : ''}</div>` +
      facts([['案件编号',caseId],['类别',entry.category],['原因',entry.reason],
        ['办理人',entry.assigned_user_id === state.user.userId ? '本人' : entry.assigned_user_id ? '已分配' : '未分配']]) +
      (operationId ? `<div>${link('#/operations/' + id(operationId),'查看关联操作')}</div>` : '') + actionsResult),
    panel('已记录证据',listRows(evidence,['证据依据','记录时间','说明',''],item => [
      esc(item.reference),esc(fmtDate(item.recordedAt)),esc(item.summary),''
    ],'暂无证据。')),
    allowed.has('evidence') ? panel('追加核查证据',form('case-evidence',
      field('reference','证据编号或来源',{required:true,maxlength:160}) +
      area('summary','证据说明','',{required:true,maxlength:1000}),'保存核查证据')) : '',
    allowed.has('decisions') ? panel('记录处置结论',form('case-decision',
      selectField('disposition','处置结论',[['','请选择'],['STILL_UNKNOWN','结果仍待核实'],['ON_SITE_REQUIRED','需现场处理']], '', {required:true}) +
      selectField('evidenceId','依据证据',[['','请选择'],...evidence.map(item => [item.id,item.reference])], '', {required:true}) +
      area('reason','处置说明','',{required:true,maxlength:1000}),'保存处置结论')) : '',
    panel('决议记录',decisions.length ? decisions.map(decision => facts([
      ['结论',label(decision.disposition || decision.status)],['依据',evidence.find(item => item.id === decision.evidenceId)?.reference],
      ['说明',decision.reason],['记录时间',fmtDate(decision.recordedAt)]
    ]) + details('查看决议记录',code(decision))).join('') : empty('暂无决议。'))
  ],link('#/cases','返回案件列表'));
  const update = async (action,body,message) => {
    await post(path + '/' + action,body,{version:entry.version});
    state.dirty = false;
    toast(message);
    await refresh();
  };
  result.setup = () => {
    bindAction('claim-case',() => update('claim',{},'已领取核查案件'));
    bindForm('#case-evidence',body => update('evidence',body,'核查证据已记录'),{dirty:true});
    bindForm('#case-decision',body => update('decisions',body,'处置结论已记录'),{dirty:true});
  };
  return result;
}

const energyFaults = [
  ['NORMAL','正常会话'],['ACK_ONLY','设备仅回执受理'],['STARTED_RESPONSE_LOST','启动后响应丢失'],
  ['STOP_UNKNOWN','停机结果未知'],['METER_RESET','计量重置'],['FINAL_READING_LATE','终止读数迟到'],['DUPLICATE_EVENT','重复设备事件']
];
const money = amount => Number.isFinite(Number(amount)) ? '¥' + (Number(amount) / 100).toFixed(2) : '—';

async function energyService(service,{go}) {
  const resources = rows(await get('energy/resources'));
  const selectable = resources.filter(resource => !['BUSY','OFFLINE','QUARANTINED','RETIRED'].includes(resource.status));
  const result = view(service.name,'模拟端口、会话与计量证据。',[
    info('此场景只使用模拟设备。账单为演示金额，未发生真实收款。','warn'),
    panel('端口状态',listRows(resources,['端口','状态','位置',''],resource => [
      esc(resource.config?.label || val(resource,'name','code','id')),status(resource.status),esc(resource.location),''
    ],'当前环境没有模拟端口。')),
    selectable.length ? panel('开始模拟会话',form('energy-quote',
      selectField('portId','选择端口',[['','请选择'],...selectable.map(resource => [resource.id,resource.config?.label || val(resource,'name','code','id')])],'',{required:true}) +
      faultSelect(energyFaults),'查看模拟报价') + '<div id="energy-quote-result"></div>') : ''
  ],link('#/services','返回校园服务'));
  result.setup = () => {
    $('#energy-quote')?.addEventListener('input', () => { $('#energy-quote-result').innerHTML = ''; });
    bindForm('#energy-quote',async values => {
      const {portId,fault} = values;
      const {data} = await post('energy/quotes',{portId},{idempotent:true});
      const quoteId = val(data,'quoteId','id');
      const outlet = $('#energy-quote-result');
      const snapshot = data.snapshot || {};
      outlet.innerHTML = `<div class="stack">${info('以下报价仅用于模拟会话，未发生真实收款。')}
        ${facts([['电费（元/千瓦时）',snapshot.electricityPerKwh],['服务费（元/千瓦时）',snapshot.servicePerKwh],
          ['有效期',fmtDate(val(data,'expiresAt','expires_at'))]])}
        ${details('查看模拟费率与报价依据',code(data))}
        <div>${button('start-energy','确认开始模拟会话','primary')}</div>${actionsResult}</div>`;
      bindAction('start-energy',async () => {
        if (Date.parse(val(data,'expiresAt','expires_at')) <= Date.now()) throw new Error('模拟报价已到期，请重新获取。');
        const body = {portId,quoteId};
        if (fault !== 'NORMAL') body.fault = fault;
        const {data:created} = await post('energy/session-requests',body,{idempotent:true});
        const sessionId = val(created,'sessionId','session_id') || recordId(created.session || created);
        toast('开始请求已受理，请查看实际会话状态');
        go('services/' + id(service.code) + '/session/' + id(sessionId));
      });
    });
  };
  return result;
}

async function energySession(serviceCode,sessionId,{refresh,staff = false}) {
  const path = 'energy/sessions/' + id(sessionId);
  const data = await get(staff ? 'admin/runtime/sessions/' + id(sessionId) : path);
  const session = data.session || data;
  let bill = data.bill || session.bill;
  if (!bill && !staff) {
    try { bill = await get(path + '/bill'); }
    catch (error) { if (![404,409].includes(error.status)) throw error; }
  }
  const domain = val(session,'domainState','domain_state','status');
  const observation = val(session,'observationState','observation_state','observation');
  const result = view('模拟充电会话','分别展示设备业务状态、观测状态与账单证据。',[
    info('模拟设备会话，未发生真实收款。','warn'),
    panel('会话状态',facts([['会话编号',sessionId],['业务状态',label(domain)],['观测状态',label(observation)],
      ['端口',val(session,'portId','port_id','resource_id')],['最近更新',updated(session)]]) +
      `<div class="inline">${button('refresh-energy','刷新会话')}${domain === 'ACTIVE' && role('END_USER','OPERATOR') ? button('stop-energy','请求停止模拟会话','primary') : ''}</div>` + actionsResult),
    panel('模拟账单',bill ? facts([
      ['账单状态',label(bill.status)],['模拟金额',money(val(bill,'amountMinor','amount_minor','amountCents'))],
      ['累计用量（Wh）',val(bill,'consumedWh','consumed_wh','energyWh','energy_wh')]
    ]) + details('账单计算证据',code(bill)) : empty('会话结束并取得完整计量证据后生成模拟账单。')),
    panel('计量读数',readings(data.readings || session.readings || []))
  ],link(staff ? '#/sessions' : '#/services/' + id(serviceCode),staff ? '返回设备会话' : '返回充电服务'));
  result.setup = () => {
    bindAction('refresh-energy',refresh);
    bindAction('stop-energy',async () => {
      if (!await ask({heading:'请求停止会话',message:'设备确认停止后，会话才会显示已结束。',confirm:'提交停止请求'})) return;
      await post(path + '/stop-requests',{}, {idempotent:true});
      toast('停止请求已受理');
      await refresh();
    });
  };
  return result;
}

const parcelFaults = [
  ['NORMAL','正常开柜与交接'],['OPEN_RESPONSE_LOST','开柜结果未知'],['OPEN_NO_COLLECTION','仅开柜未取件'],
  ['WRONG_COMPARTMENT','柜格不匹配'],['DUPLICATE_HANDOVER','重复交接事件']
];
async function parcelService(service,{go}) {
  const pickups = rows(await get('parcel/pickups'));
  const eligible = pickups.filter(item => val(item,'entitlementToken','entitlement_token'));
  const result = view(service.name,'查看本人的模拟包裹与可办理权益。',[
    info('柜体为演示模拟。只有确认交接后，才会记录已取件。','warn'),
    panel('我的模拟包裹',listRows(pickups,['包裹','状态','柜格',''],item => [
      esc(val(item,'name','parcelCode','parcel_code','id')),status(item.status),esc(val(item,'compartmentName','compartmentId','compartment_id','resource_id')),
      item.operation_id ? link('#/services/' + id(service.code) + '/operation/' + id(item.operation_id),'查看操作','compact') : ''
    ],'暂无模拟包裹。')),
    eligible.length ? panel('申请模拟开柜',form('parcel-unlock',
      selectField('pickupId','选择包裹',[['','请选择'], ...eligible.map(item => [item.id,val(item,'name','parcelCode','parcel_code','id')])],'',{required:true}) +
      faultSelect(parcelFaults),'请求开柜')) : ''
  ],link('#/services','返回校园服务'));
  result.setup = () => bindForm('#parcel-unlock',async values => {
    const item = eligible.find(item => item.id === values.pickupId);
    const body = {entitlementToken:val(item,'entitlementToken','entitlement_token')};
    if (values.fault !== 'NORMAL') body.fault = values.fault;
    const {data} = await post('parcel/pickups/' + id(item.id) + '/unlock-requests',body,{idempotent:true});
    toast('开柜请求已受理，请查看实际结果');
    go('services/' + id(service.code) + '/operation/' + id(val(data,'operationId','operation_id') || recordId(data.operation || data)));
  });
  return result;
}

const readingCells = reading => [
  esc(val(reading,'meterEpoch','meter_epoch','epoch')),esc(val(reading,'valueWh','value_wh','value')),
  esc(val(reading,'quality','qualityStatus','quality_status') || reading.quality_flags?.join('、') || '—'),
  esc(fmtDate(val(reading,'occurredAt','occurred_at','sampled_at','recordedAt','recorded_at','created_at')))
];
const readingColumns = ['计量周期','读数（Wh）','质量','时间'];
const readings = records => listRows(records,readingColumns,readingCells,'暂无已保存的计量读数。');

async function sessions(context) {
  const [sessionId] = context.parts;
  if (sessionId) return energySession('',sessionId,{...context,staff:true});
  return dataList('admin/runtime/sessions',context,{
    route:'sessions',heading:'设备会话',description:'查看当前环境的设备业务状态、观测状态与已确认计量。',
    columns:['会话','业务状态','观测状态','详情'],
    draw:session => [
      role('AUDITOR') ? esc(val(session,'resourceCode','resource_id','id')) : recordLink('sessions/' + id(recordId(session)),val(session,'resourceCode','resource_id','id')),
      status(val(session,'domainState','domain_state')),status(val(session,'observationState','observation_state')),
      role('AUDITOR') ? '' : link('#/sessions/' + id(recordId(session)),'查看会话','compact')
    ]
  });
}

async function metering(context) {
  return dataList('admin/runtime/metering',context,{
    route:'metering',heading:'计量读数',description:'查看已保存的原始读数、计量周期与证据质量。',
    columns:readingColumns,draw:readingCells
  });
}

export const runtimePages = {services,instances,tasks,operations,cases,sessions,metering};
