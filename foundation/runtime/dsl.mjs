import Ajv from 'ajv';

const ajv = new Ajv({ strict: true, allErrors: true });
const schemaCache = new Map();
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const roots = new Set(['form', 'identity', 'outputs', 'system']);
const nodeEdges = {
  action: ['onSuccess', 'onRejected', 'onUnknown', 'onFailure'],
  human: ['onComplete', 'onTimeout'],
  condition: ['whenTrue', 'whenFalse'],
  waitEvent: ['onEvent', 'onTimeout'],
  timer: ['onFire'],
  incident: [],
  end: [],
};
const operators = new Set(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists']);
const nodeProperties = {
  action:['bindingCode','input','outputKey'],
  human:['role','scope','form','outputKey','timeoutSeconds'],
  condition:['path','operator','value'],
  waitEvent:['eventType','correlationPath','outputKey','timeoutSeconds'],
  timer:['delaySeconds'],
  incident:['category','resumePolicy'],
  end:['outcome'],
};
const protectedInputs = {
  'library.reservation.create':{subjectId:'identity.subjectId'},
  'energy.session.start':{portId:'form.portId',quoteId:'form.quoteId'},
  'parcel.compartment.unlock':{pickupId:'form.pickupId'},
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compile(schema) {
  const key = JSON.stringify(schema);
  if (schemaCache.has(key)) return schemaCache.get(key);
  if (schemaCache.size >= 128) schemaCache.delete(schemaCache.keys().next().value);
  const validate = ajv.compile(schema);
  schemaCache.set(key, validate);
  return validate;
}

export function schemaErrors(schema, value) {
  const validate = compile(schema);
  if (validate(value)) return [];
  return validate.errors.map(error => ({
    fieldPath: error.instancePath || '/',
    message: error.message,
  }));
}

function safePath(path) {
  if (typeof path !== 'string') return false;
  const parts = path.split('.');
  return parts.length >= 2 && parts.length <= 8 && roots.has(parts[0])
    && parts.every(part => identifier.test(part) && !forbidden.has(part));
}

function checkTree(value, depth = 0) {
  if (depth > 20) return false;
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => checkTree(item, depth + 1));
  if (!object(value)) return true;
  return Object.keys(value).every(key => !forbidden.has(key) && checkTree(value[key], depth + 1));
}

function expression(value) {
  return object(value) && Object.keys(value).length === 1
    && (Object.hasOwn(value, 'path') ? safePath(value.path) : Object.hasOwn(value, 'literal') && checkTree(value.literal));
}

function seconds(value) {
  return Number.isInteger(value) && value > 0 && value <= 30 * 86400;
}

function keysAllowed(value, allowed) {
  return object(value) && Object.keys(value).every(key => allowed.includes(key));
}

const uuidSchemaPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const scalar = value => ['string','number','boolean'].includes(typeof value)
  && (typeof value !== 'string' || value.length <= 4000) && (typeof value !== 'number' || Number.isFinite(value));
const formKeywords = {
  object:['properties','required','additionalProperties'],
  array:['items','minItems','maxItems'],
  string:['minLength','maxLength','pattern'],
  number:['minimum','maximum'],
  integer:['minimum','maximum'],
  boolean:[],
};

function boundedSchema(schema, depth = 0, budget = {fields:0}) {
  if (depth > 4 || !object(schema) || !Object.hasOwn(formKeywords,schema.type)
    || !keysAllowed(schema,['type','title','description','enum','const',...formKeywords[schema.type]])) {
    throw Error('表单只接受白名单字段类型与限制');
  }
  for (const key of ['title','description']) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'string' || schema[key].length > 500)) throw Error('字段说明无效');
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length
    || schema.enum.length > 50 || !schema.enum.every(scalar))) throw Error('枚举选项须为 1 至 50 个标量');
  if (Object.hasOwn(schema,'const') && !scalar(schema.const)) throw Error('固定值必须为标量');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !object(schema.properties)) throw Error('对象必须声明字段且拒绝额外字段');
    const keys = Object.keys(schema.properties);
    budget.fields += keys.length;
    if (budget.fields > 30 || keys.some(key => !identifier.test(key) || forbidden.has(key))) throw Error('表单最多 30 个有效字段');
    if (schema.required !== undefined && (!Array.isArray(schema.required)
      || new Set(schema.required).size !== schema.required.length
      || schema.required.some(key => !Object.hasOwn(schema.properties,key)))) throw Error('必填字段必须已声明且不得重复');
    for (const field of Object.values(schema.properties)) boundedSchema(field,depth+1,budget);
  }
  if (schema.type === 'array') {
    if (!Number.isInteger(schema.maxItems) || schema.maxItems < 1 || schema.maxItems > 30
      || (schema.minItems !== undefined && (!Number.isInteger(schema.minItems) || schema.minItems < 0 || schema.minItems > schema.maxItems))) {
      throw Error('列表需声明不超过 30 项的上限');
    }
    boundedSchema(schema.items,depth+1,budget);
  }
  if (schema.type === 'string') {
    if (schema.pattern !== undefined && schema.pattern !== uuidSchemaPattern) throw Error('字段不接受自定义正则表达式');
    for (const bound of ['minLength','maxLength']) {
      if (schema[bound] !== undefined && (!Number.isInteger(schema[bound]) || schema[bound] < 0 || schema[bound] > 4000)) {
        throw Error('文本长度限制无效');
      }
    }
    if ((schema.minLength ?? 0) > (schema.maxLength ?? 4000)) throw Error('最小长度不能超过最大长度');
  }
  for (const bound of ['minimum','maximum']) {
    if (schema[bound] !== undefined && !Number.isFinite(schema[bound])) throw Error('数值限制无效');
  }
  if (schema.minimum > schema.maximum) throw Error('最小值不能超过最大值');
}

function declaredPath(path,form,outputs) {
  if (!safePath(path)) return false;
  const [root,...fields] = path.split('.');
  if (root === 'identity') return fields.length === 1 && fields[0] === 'subjectId';
  if (root === 'system') return fields.length === 1 && ['schoolId','environmentId','serviceId','releaseId'].includes(fields[0]);
  if (root === 'outputs') return outputs.has(fields[0]);
  let schema = form;
  for (const field of fields) {
    if (!schema?.properties || !Object.hasOwn(schema.properties,field)) return false;
    schema = schema.properties[field];
  }
  return true;
}

export function validateDefinition(definition) {
  const blockingErrors = [];
  const warnings = [];
  const error = (fieldPath, message, nodeId) => blockingErrors.push({ fieldPath, message, ...(nodeId ? {nodeId} : {}) });
  if (!object(definition) || !checkTree(definition) || JSON.stringify(definition).length > 128_000) {
    error('/', '定义格式或大小无效');
    return { blockingErrors, warnings };
  }
  const { schemaVersion, form, policy, workflow } = definition;
  if (schemaVersion !== 1) error('schemaVersion', '只支持版本 1');
  if (!keysAllowed(definition,['schemaVersion','form','policy','workflow'])) error('/', '定义含未支持字段');
  if (!keysAllowed(policy,['authority','maxSteps','requiredBindings'])) error('policy','策略含未支持字段');
  if (!keysAllowed(workflow,['start','nodes'])) error('workflow','流程含未支持字段');
  const checkForm = (schema, fieldPath, nodeId) => {
    try {
      if (!object(schema) || schema.type !== 'object' || schema.additionalProperties !== false) {
        throw Error('表单必须是明确拒绝额外字段的对象');
      }
      boundedSchema(schema);
      compile(schema);
    } catch (e) { error(fieldPath, e.message, nodeId); }
  };
  checkForm(form, 'form');
  if (!Number.isInteger(policy?.maxSteps) || policy.maxSteps < 1 || policy.maxSteps > 100) error('policy.maxSteps', '步数须为 1 至 100');
  if (typeof policy?.authority !== 'string' || !policy.authority.trim()) error('policy.authority', '缺少业务权威');
  if (!Array.isArray(workflow?.nodes) || !workflow.nodes.length || workflow.nodes.length > 50) {
    error('workflow.nodes', '流程须包含 1 至 50 个节点');
    return { blockingErrors, warnings };
  }
  const nodes = new Map();
  const outputs = new Set();
  for (const node of workflow.nodes) {
    if (!object(node) || !identifier.test(node.id ?? '') || forbidden.has(node.id)) {
      error('workflow.nodes', '节点 ID 无效');
      continue;
    }
    const field = (key, message) => error('workflow.nodes.' + node.id + '.' + key, message, node.id);
    if (nodes.has(node.id)) field('id', '节点 ID 重复');
    nodes.set(node.id, node);
    if (!Object.hasOwn(nodeEdges, node.type)) {
      field('type', '节点类型未注册');
      continue;
    }
    if (!keysAllowed(node,['id','type',...nodeProperties[node.type],...nodeEdges[node.type]])) field('type','节点含未支持字段');
    if (['action', 'human', 'waitEvent'].includes(node.type)) {
      if (typeof node.outputKey !== 'string' || !identifier.test(node.outputKey) || forbidden.has(node.outputKey)) {
        field('outputKey', '结果字段无效');
      } else if (outputs.has(node.outputKey)) field('outputKey', '结果字段重复');
      else outputs.add(node.outputKey);
    }
    if (node.type === 'action') {
      if (typeof node.bindingCode !== 'string' || !/^[a-z][a-z0-9.-]{0,139}$/.test(node.bindingCode)) field('bindingCode', '能力代码无效');
      if (!object(node.input) || !Object.entries(node.input).every(([key, value]) =>
        identifier.test(key) && !/^(schoolId|environmentId|connectionId|url|externalUrl|secret|secretRef|adapterCode)$/i.test(key) && expression(value))) {
        field('input', '输入映射只接受字段引用或字面值，且不可控制连接、密钥或学校');
      }
    }
    if (node.type === 'human') {
      if (node.role !== 'OPERATOR') field('role', '首版人工任务仅支持服务操作员');
      if (!['SERVICE', 'RESOURCE', 'SCHOOL'].includes(node.scope?.type) || !expression(node.scope?.id)) field('scope', '岗位范围无效');
      checkForm(node.form, 'workflow.nodes.' + node.id + '.form', node.id);
    }
    if (['human', 'waitEvent'].includes(node.type) && !seconds(node.timeoutSeconds)) field('timeoutSeconds', '必须设置有效超时');
    if (node.type === 'waitEvent') {
      if (!safePath(node.correlationPath)) field('correlationPath', '事件关联字段无效');
      if (typeof node.eventType !== 'string' || !/^[a-z][a-z0-9._-]{0,139}$/.test(node.eventType)) field('eventType', '事件类型无效');
    }
    if (node.type === 'condition' && (!safePath(node.path) || !operators.has(node.operator)
      || (node.operator !== 'exists' && !Object.hasOwn(node, 'value'))
      || (node.operator === 'in' && !Array.isArray(node.value)))) field('operator', '比较条件无效');
    if (node.type === 'timer' && !seconds(node.delaySeconds)) field('delaySeconds', '定时须在 1 秒至 30 天');
    if (node.type === 'incident' && (node.resumePolicy !== 'OPERATION_RESULT_ONLY' || typeof node.category !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(node.category))) field('resumePolicy', '异常节点只允许按权威操作结果恢复');
    if (node.type === 'end' && (typeof node.outcome !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(node.outcome))) field('outcome', '缺少明确业务终点');
  }
  if (!nodes.has(workflow.start)) error('workflow.start', '起始节点不存在');
  for (const node of nodes.values()) {
    for (const edge of nodeEdges[node.type] ?? []) {
      if (!nodes.has(node[edge])) error('workflow.nodes.' + node.id + '.' + edge, '出口节点不存在', node.id);
    }
    const paths = [];
    if (node.type === 'action') {
      for (const [key,value] of Object.entries(node.input ?? {})) {
        if (value?.path) paths.push(['input.'+key,value.path]);
      }
      for (const [key,required] of Object.entries(protectedInputs[node.bindingCode] ?? {})) {
        if (node.input?.[key]?.path !== required) error('input.'+key,'受保护输入必须引用已验证字段',node.id);
      }
    }
    if (node.type === 'human' && node.scope?.id?.path) paths.push(['scope.id',node.scope.id.path]);
    if (node.type === 'condition') paths.push(['path',node.path]);
    if (node.type === 'waitEvent') paths.push(['correlationPath',node.correlationPath]);
    for (const [key,path] of paths) if (!declaredPath(path,form,outputs)) error(key,'引用字段未声明',node.id);
    if (node.type === 'action' && nodes.get(node.onUnknown)?.type !== 'incident') {
      error('workflow.nodes.' + node.id + '.onUnknown', '未知结果必须进入核查节点', node.id);
    }
  }
  const visited = new Set();
  const stack = new Set();
  function visit(id) {
    if (!nodes.has(id)) return;
    if (stack.has(id)) {
      error('workflow.nodes.' + id, '首版流程禁止循环', id);
      return;
    }
    if (visited.has(id)) return;
    stack.add(id);
    const node = nodes.get(id);
    for (const edge of nodeEdges[node.type] ?? []) visit(node[edge]);
    stack.delete(id);
    visited.add(id);
  }
  visit(workflow.start);
  for (const id of nodes.keys()) if (!visited.has(id)) error('workflow.nodes.' + id, '节点不可达', id);
  if (![...visited].some(id => nodes.get(id).type === 'end')) error('workflow', '流程没有可达终点');
  return { blockingErrors, warnings };
}

export function readPath(context, path) {
  if (!safePath(path)) throw Error('不安全的字段引用');
  let value = context;
  for (const key of path.split('.')) {
    if (!object(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

export function resolveExpression(context, mapping) {
  if (!expression(mapping)) throw Error('无效输入映射');
  return Object.hasOwn(mapping, 'path') ? readPath(context, mapping.path) : mapping.literal;
}

export function evaluateCondition(context, node) {
  const value = readPath(context, node.path);
  if (node.operator === 'exists') return value !== undefined;
  if (value === undefined) throw Error('条件字段缺失');
  const expected = node.value;
  if (node.operator === 'in') {
    if (!expected.every(candidate => typeof candidate === typeof value)) throw Error('条件比较类型不匹配');
    return expected.includes(value);
  }
  if (typeof expected !== typeof value || (object(value) || Array.isArray(value))) throw Error('条件比较类型不匹配');
  if (node.operator === 'eq') return value === expected;
  if (node.operator === 'ne') return value !== expected;
  if (typeof value !== 'number') throw Error('范围比较须为数值');
  if (node.operator === 'gt') return value > expected;
  if (node.operator === 'gte') return value >= expected;
  if (node.operator === 'lt') return value < expected;
  if (node.operator === 'lte') return value <= expected;
  throw Error('未注册条件运算');
}
