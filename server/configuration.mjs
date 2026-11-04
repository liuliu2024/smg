import {all,get,put,del,id,tx,now} from './db.mjs';
import {need,fail,role,audit} from './services.mjs';
const validRoles=['STUDENT','TEACHER','LIBRARIAN','PRINT_OPERATOR','CANTEEN_MERCHANT','CAMPUS_OPERATOR','SUPER_ADMIN'];
const text=(v,max=500)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max,'文本内容为空或过长');return v.trim()};
export function configuration(u,p,m,b){const resource=p[1],rid=p[2];const config={apps:'apps',categories:'categories',content:'announcements',organizations:'organizations',roles:'roles',settings:'settings',messages:'notifications',banners:'banners'};const k=config[resource];if(!k)return {handled:false};
if(!(resource==='content'||resource==='banners')||!get('roles',u.activeRole)?.permissions?.includes('MANAGE_CONTENT'))role(u,['SUPER_ADMIN','CAMPUS_OPERATOR']);if(['organizations','roles','settings'].includes(resource))role(u,['SUPER_ADMIN']);
if(m==='GET')return {handled:true,data:resource==='roles'?[...validRoles.map(r=>({id:r,name:r,system:true})),...all('roles')]:all(k)};
if(!['POST','PUT','DELETE'].includes(m))fail(405,'方法不支持');
const data=tx(()=>{if(m==='DELETE'){if(resource==='roles'&&validRoles.includes(rid))fail(409,'系统角色不可删除');const existing=get(k,rid)||fail(404,'资源不存在');if(resource==='roles'&&all('users').some(x=>x.roles.includes(rid)))fail(409,'角色正在使用');if(resource==='organizations'&&all('users').some(x=>x.organizationId===rid))fail(409,'组织正在使用');del(k,rid);audit(u,'DELETE_'+resource,rid);return {id:rid,deleted:true}}
const existing=rid?get(k,rid):null;if(rid&&!existing)fail(404,'资源不存在');let o={...existing,id:rid||id()};
if(resource==='apps'){o={...o,code:o.code||o.id,name:text(b.name,80),description:text(b.description,300),category:text(b.category||'其他',80),status:b.status,internalPath:b.internalPath||'',externalUrl:b.externalUrl||''};need(['DRAFT','ACTIVE','MAINTENANCE','PLANNED','DISABLED'].includes(o.status));if(o.externalUrl)need(/^https?:\/\//.test(o.externalUrl),'外链仅支持HTTP/HTTPS');if(o.internalPath)need(/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(o.internalPath),'内部地址无效');o.roles=Array.isArray(b.roles)?b.roles.filter(r=>validRoles.includes(r)):[];}
if(resource==='banners'){o={...o,title:text(b.title,120),body:text(b.body||b.title,500),targetPath:b.targetPath||'/apps',enabled:b.enabled===true,sortOrder:Number.isInteger(b.sortOrder)?b.sortOrder:0};need(o.targetPath.startsWith('/')&&!o.targetPath.startsWith('//')&&!o.targetPath.includes(':')&&!o.targetPath.includes('\\'),'内部链接无效')} 
if(resource==='categories')o={...o,name:text(b.name,80),sortOrder:Number.isInteger(b.sortOrder)?b.sortOrder:0};
if(resource==='content'){need(['DRAFT','PUBLISHED','ARCHIVED'].includes(b.status));o={...o,title:text(b.title,200),body:text(b.body,10000),status:b.status,targetRoles:Array.isArray(b.targetRoles)?b.targetRoles.filter(r=>validRoles.includes(r)):[],expiresAt:b.expiresAt||null};if(o.expiresAt)need(!Number.isNaN(Date.parse(o.expiresAt)),'日期错误')}
if(resource==='organizations'){need(['CAMPUS','DEPARTMENT','CLASS'].includes(b.type));o={...o,name:text(b.name,100),type:b.type,parentId:b.parentId||null};if(o.parentId)need(get(k,o.parentId)&&o.parentId!==o.id,'上级组织无效')}
if(resource==='roles'){need(!validRoles.includes(o.id),'系统角色不可修改');const presets=['VIEW_PORTAL','MANAGE_CONTENT'];need(Array.isArray(b.permissions)&&b.permissions.every(x=>presets.includes(x)),'仅允许分配预设低风险权限');o={...o,name:text(b.name,80),permissions:b.permissions,system:false}}
if(resource==='settings'){need(['schoolName','fileRetentionDays'].includes(b.key),'设置项不受支持');o={...o,id:b.key,key:b.key,value:b.key==='schoolName'?text(b.value,80):b.value};if(b.key==='fileRetentionDays')need(Number.isInteger(b.value)&&b.value>=1&&b.value<=90,'保留期为1至90天')}
if(resource==='messages'){need(get('users',b.userId),'收件人不存在');o={...o,userId:b.userId,title:text(b.title,200),body:text(b.body,2000),targetPath:'/notifications',readAt:null}}
put(k,o);audit(u,'SAVE_'+resource,o.id);return o});return {handled:true,data};}
export function management(u,p,m,b){const d=p[1],r=p[2],rid=p[3];let k;
if(d==='printing'&&r==='points'){role(u,['SUPER_ADMIN']);k='points'}
if(d==='printing'&&r==='prices'){role(u,['SUPER_ADMIN']);k='prices'}
if(d==='dining'&&r==='stalls'){role(u,['SUPER_ADMIN','CANTEEN_MERCHANT']);k='stalls'}
if(d==='dining'&&r==='products'){role(u,['SUPER_ADMIN','CANTEEN_MERCHANT']);k='products'}
if(d==='dining'&&r==='inventory'){role(u,['SUPER_ADMIN','CANTEEN_MERCHANT']);const permitted=x=>{const product=get('products',x.variantId);return product&&(u.activeRole==='SUPER_ADMIN'||u.scope.includes(product.stallId))};if(m==='GET')return {handled:true,data:all('inventory').filter(permitted)};need(['POST','PUT'].includes(m),'不支持该操作');return {handled:true,data:tx(()=>{need(permitted(b),'无权管理此库存');need(/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&['LUNCH','DINNER'].includes(b.slot),'日期或餐段无效');need(Number.isInteger(b.remaining)&&b.remaining>=0&&b.remaining<=10000,'库存须为0至10000');const iid=b.variantId+':'+b.date+':'+b.slot;const previous=get('inventory',iid);if(b.version!==undefined&&previous&&b.version!==previous.version)fail(409,'库存已变更，请刷新');const updated=put('inventory',{...previous,id:iid,variantId:b.variantId,date:b.date,slot:b.slot,remaining:b.remaining});audit(u,'SAVE_INVENTORY',iid);return updated})}}
if(!k)return {handled:false};
if(m==='GET')return {handled:true,data:all(k).filter(o=>u.activeRole==='SUPER_ADMIN'||u.scope.includes(k==='stalls'?o.id:o.stallId))};
need(['POST','PUT'].includes(m),'不支持该操作');const data=tx(()=>{const prev=rid?get(k,rid):null;if(rid&&!prev)fail(404,'资源不存在');let o={...prev,id:rid||id()};if(u.activeRole!=='SUPER_ADMIN'&&(!prev||!u.scope.includes(k==='stalls'?prev.id:prev.stallId)))fail(403,'档口范围不允许');
if(k==='points')o={...o,name:text(b.name,100)};
if(k==='stalls'){o={...o,name:text(b.name,100),hallId:prev?.hallId||b.hallId,open:b.open===true};need(get('halls',o.hallId),'食堂不存在')}
if(k==='products'){o={...o,name:text(b.name,100),stallId:prev?.stallId||b.stallId,priceCents:b.priceCents,remaining:b.remaining,active:b.active===true};need(get('stalls',o.stallId),'档口不存在');need(Number.isInteger(o.priceCents)&&o.priceCents>0&&o.priceCents<=100000,'价格须为整数分');need(Number.isInteger(o.remaining)&&o.remaining>=0&&o.remaining<=10000,'库存无效')}
if(k==='prices'){need(get('points',b.pointId),'打印点不存在');for(const key of ['bwPerSide','colorPerSide','staplePerCopy'])need(Number.isInteger(b[key])&&b[key]>=0&&b[key]<=10000,'单价须为整数分');o={...o,pointId:b.pointId,bwPerSide:b.bwPerSide,colorPerSide:b.colorPerSide,staplePerCopy:b.staplePerCopy,ruleVersion:id()}}
put(k,o);audit(u,'SAVE_'+k,o.id);return o});return {handled:true,data};}
export function assignUser(u,userId,b){role(u,['SUPER_ADMIN']);return tx(()=>{const o=get('users',userId)||fail(404,'用户不存在');need(Array.isArray(b.roles)&&b.roles.length>0&&b.roles.every(r=>validRoles.includes(r)||get('roles',r)),'角色无效');if(o.roles.includes('SUPER_ADMIN')&&!b.roles.includes('SUPER_ADMIN')&&all('users').filter(x=>x.status==='ACTIVE'&&x.roles.includes('SUPER_ADMIN')).length<=1)fail(409,'不能移除最后管理员');need(Array.isArray(b.scope)&&b.scope.every(s=>get('points',s)||get('stalls',s)),'业务范围无效');put('users',{...o,roles:[...new Set(b.roles)],scope:[...new Set(b.scope)]});for(const s of all('sessions').filter(x=>x.userId===o.id&&!b.roles.includes(x.activeRole)))del('sessions',s.id);audit(u,'USER_ROLES',o.id);return get('users',o.id)})}






