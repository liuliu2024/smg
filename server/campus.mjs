import {createHash} from 'node:crypto';
import {all,get,put,id,now,tx} from './db.mjs';
import {fail,need,role,audit,notify} from './services.mjs';
const affairTypes=['印章申请','差旅申请','教室借用','行政事项','学生证补办','档案转递','补考报名','重修申请'];
const eventTypes=['校园活动','志愿服务','竞赛报名'];
const definitions={
repairs:{name:'校园报修',fields:['title','description','location'],initial:'SUBMITTED',transitions:{accept:['SUBMITTED','ACCEPTED'],start:['ACCEPTED','PROCESSING'],resolve:['PROCESSING','RESOLVED'],reject:['SUBMITTED','REJECTED']}},
venues:{name:'场地预约',fields:['venueId','date','slot','purpose'],initial:'CONFIRMED'},
lost:{name:'失物招领',fields:['title','description','location','type'],initial:'OPEN'},
activities:{name:'校园活动',fields:['eventId'],initial:'REGISTERED'},
feedback:{name:'意见反馈',fields:['title','description','category'],initial:'SUBMITTED',transitions:{process:['SUBMITTED','PROCESSING'],resolve:['PROCESSING','RESOLVED']}},
certificates:{name:'证明申请',fields:['type','purpose'],initial:'SUBMITTED',transitions:{approve:['SUBMITTED','APPROVED'],reject:['SUBMITTED','REJECTED']}},
marketplace:{name:'校园二手',fields:['title','description','priceCents','category'],initial:'ACTIVE'},
affairs:{name:'办事申请',fields:['type','title','description'],initial:'SUBMITTED',transitions:{approve:['SUBMITTED','APPROVED'],reject:['SUBMITTED','REJECTED']}}
};
const kind=m=>'campus:'+m;
const operator=u=>['SUPER_ADMIN','CAMPUS_OPERATOR'].includes(u.activeRole);
const text=(v,max=2000)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max,'请填写有效文本');return v.trim()};
const take=(b,fields)=>Object.fromEntries(fields.map(f=>[f,f==='priceCents'?b[f]:text(b[f],f==='description'?3000:200)]));
const allowedActions=(u,module,o,admin=false)=>{if(admin){let ops=Object.entries(definitions[module].transitions||{}).filter(([,t])=>t[0]===o.status).map(([a])=>a);if((module==='venues'&&o.status==='CONFIRMED'||module==='activities'&&o.status==='REGISTERED')&&o.startsAt>now())ops.push('cancel');if(module==='lost'&&['OPEN','CLAIM_PENDING'].includes(o.status))ops.push('close');if(module==='lost'&&o.status==='CLAIM_PENDING')ops.push('confirm-return');if(module==='marketplace'&&o.status==='ACTIVE')ops.push('withdraw');return ops}const own=o.userId===u.id;let actions=[];if(own){if(({repairs:['SUBMITTED'],venues:['CONFIRMED'],activities:['REGISTERED'],feedback:['SUBMITTED'],certificates:['SUBMITTED'],affairs:['SUBMITTED']}[module]||[]).includes(o.status))actions.push('cancel');if(['repairs','feedback'].includes(module)&&o.status==='RESOLVED')actions.push('close');if(module==='lost'&&['OPEN','CLAIM_PENDING'].includes(o.status))actions.push('close');if(module==='lost'&&o.status==='CLAIM_PENDING')actions.push('confirm-return');if(module==='marketplace'&&o.status==='ACTIVE')actions.push('sold','withdraw')}else if(module==='lost'&&['OPEN','CLAIM_PENDING'].includes(o.status)&&!all('campusClaims').some(c=>c.postId===o.id&&c.userId===u.id&&c.status==='PENDING'))actions.push('claim');if(['venues','activities'].includes(module)&&o.startsAt<=now())actions=actions.filter(a=>a!=='cancel');return actions};
const visible=(u,module,o,admin=false)=>{if(['lost','marketplace'].includes(module)){const {userId,...publicData}=o;const myClaims=module==='lost'?all('campusClaims').filter(c=>c.postId===o.id&&c.userId===u.id).map(({id,status,reason,updatedAt})=>({id,status,reason,updatedAt})):[];return {...publicData,...(module==='lost'?{isClaimant:myClaims.length>0,myClaims}:{}),isOwner:o.userId===u.id,allowedActions:allowedActions(u,module,o,admin),authorName:(get('users',o.userId)?.displayName?.slice(0,1)||'校')+'同学',claims:undefined}}return {...o,...(module==='certificates'?{notice:'平台演示审核结果，不是学校正式证明'}:module==='affairs'?{notice:'本地人工审核演示，不同步教务或财务，不产生学校正式决定'}:{}),isOwner:o.userId===u.id,allowedActions:allowedActions(u,module,o,admin)}};
const message=(u,module,o,status)=>{audit(u,'CAMPUS_'+module+'_'+status,o.id);notify(o.userId,definitions[module].name+'：'+status,'/services/'+module,'campus:'+module+':'+o.id+':'+status)};
const options=(admin=false)=>({venues:all('campusVenues').filter(x=>admin||x.enabled),events:all('campusEvents').filter(x=>admin||x.enabled&&x.startsAt>now()),affairTypes,eventTypes,slots:['09:00','10:00','14:00','15:00','19:00']});
export function campus(u,p,m,b,url,key){
const admin=p[0]==='admin'&&p[1]==='services';if(!(p[0]==='services'||admin))return {handled:false};const module=p[admin?2:1],rid=p[admin?3:2],operation=p[admin?4:3];const definition=definitions[module];if(!definition)fail(404,'校园服务不存在');if(admin)role(u,['SUPER_ADMIN','CAMPUS_OPERATOR']);else{const app=all('apps').find(a=>a.coreModule===module);if(!app||app.status!=='ACTIVE'||app.roles?.length&&!app.roles.includes(u.activeRole))fail(403,'该应用当前不可用');if(!['STUDENT','TEACHER','LIBRARIAN','PRINT_OPERATOR','CANTEEN_MERCHANT','CAMPUS_OPERATOR','SUPER_ADMIN'].includes(u.activeRole)&&!get('roles',u.activeRole)?.permissions?.includes('VIEW_PORTAL'))fail(403,'当前角色不允许使用校园服务')}
if(admin&&rid==='options'&&['venues','activities'].includes(module)){
const resource=module==='venues'?'campusVenues':'campusEvents';if(m==='GET')return {handled:true,data:{config:{module,name:definition.name+'资源配置'},records:all(resource),options:options(true)}};need(m==='POST','仅支持GET/POST');return {handled:true,data:tx(()=>{const previous=b.id?get(resource,b.id):null;if(b.id&&!previous)fail(404,'资源不存在');need(Number.isInteger(b.capacity)&&b.capacity>=1&&b.capacity<=10000,'容量须为1至10000');need(typeof b.enabled==='boolean','请明确开关');let entry={...previous,id:previous?.id||id(),name:text(b.name,100),location:text(b.location,200),capacity:b.capacity,enabled:b.enabled};if(module==='activities'){need(typeof b.startsAt==='string'&&!Number.isNaN(Date.parse(b.startsAt))&&new Date(b.startsAt)>new Date(),'活动时间必须在未来');const enrolled=all(kind('activities')).filter(x=>x.eventId===entry.id&&x.status==='REGISTERED').length;if(enrolled>b.capacity)fail(409,'容量不能低于已报名人数');if(enrolled&&previous.startsAt!==new Date(b.startsAt).toISOString())fail(409,'已有报名不可改变活动时间');need(!b.eventType||eventTypes.includes(b.eventType),'活动类型无效');entry={...entry,eventType:b.eventType||previous?.eventType||'校园活动',description:text(b.description,2000),startsAt:new Date(b.startsAt).toISOString(),remaining:b.capacity-enrolled}}put(resource,entry);audit(u,'SAVE_'+resource,entry.id);return entry})}}
if(m==='GET'){
const publicModule=['lost','marketplace'].includes(module);let records=all(kind(module)).filter(o=>admin||o.userId===u.id||publicModule&&['OPEN','CLAIM_PENDING','ACTIVE'].includes(o.status)||module==='lost'&&all('campusClaims').some(c=>c.postId===o.id&&c.userId===u.id));if(rid){const record=records.find(o=>o.id===rid);if(!record)fail(404,'记录不存在');const claims=module==='lost'?all('campusClaims').filter(c=>c.postId===rid&&(admin||record.userId===u.id||c.userId===u.id)):undefined;return {handled:true,data:{...visible(u,module,record,admin),...(claims?{claims:claims.map(c=>({...c,userId:undefined,claimantName:get('users',c.userId)?.displayName||'校园用户',isClaimant:c.userId===u.id}))}:{})}}}
const query=url?.searchParams?.get('q');if(query)records=records.filter(o=>JSON.stringify(visible(u,module,o,admin)).includes(query));records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));let meta;if(admin){const page=Number(url?.searchParams?.get('page')||1),pageSize=Number(url?.searchParams?.get('pageSize')||20);need(Number.isInteger(page)&&page>=1&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100,'分页参数无效');const status=url?.searchParams?.get('status');if(status)records=records.filter(x=>x.status===status);meta={page,pageSize,total:records.length,totalPages:Math.ceil(records.length/pageSize)};records=records.slice((page-1)*pageSize,page*pageSize)}return {handled:true,data:{...(meta?{meta}:{}),config:{module,...definition,localDemo:true,notice:module==='affairs'?'本地人工审核演示，不同步教务或财务，不产生学校正式决定':module==='certificates'?'平台演示审核结果，不是学校正式证明':'本地演示业务，不发送真实外部通知'},records:records.map(o=>visible(u,module,o,admin)),options:options(admin)}}}
need(m==='POST','仅支持GET和POST');
const execute=()=>{
if(!rid){need(!admin,'请使用用户服务提交申请');const data=take(b,definition.fields);let record={id:id(),userId:u.id,...data,status:definition.initial};
if(module==='repairs')need(['教学楼','宿舍','食堂','图书馆','操场'].some(x=>data.location.includes(x))||data.location.length>=2,'请填写具体位置');
if(module==='venues'){const venue=get('campusVenues',data.venueId);need(venue?.enabled,'场地未开放');need(/^\d{4}-\d{2}-\d{2}$/.test(data.date)&&options().slots.includes(data.slot),'预约日期/时段无效');const start=new Date(data.date+'T'+data.slot+':00+08:00');need(start>new Date()&&start-new Date()<30*86400000,'仅可预约未来30天时段');need(!Number.isNaN(Date.parse(data.date+'T00:00:00Z'))&&new Date(data.date+'T00:00:00Z').toISOString().slice(0,10)===data.date,'日期不存在');if(all(kind(module)).some(o=>o.venueId===data.venueId&&o.date===data.date&&o.slot===data.slot&&o.status==='CONFIRMED'))fail(409,'该场地时段已被预约');record.venueName=venue.name;record.startsAt=start.toISOString();record.endsAt=new Date(start.getTime()+3600000).toISOString()}
if(module==='lost')need(['LOST','FOUND'].includes(data.type),'请选择寻物或招领');
if(module==='activities'){const event=get('campusEvents',data.eventId);need(event?.enabled&&event.startsAt>now(),'活动已关闭');if(all(kind(module)).some(o=>o.eventId===event.id&&o.userId===u.id&&o.status==='REGISTERED'))fail(409,'你已报名该活动');if(event.remaining<=0)fail(409,'活动名额已满');put('campusEvents',{...event,remaining:event.remaining-1});record.eventName=event.name;record.startsAt=event.startsAt}
if(module==='certificates')need(['在读证明','成绩证明','实习证明'].includes(data.type),'证明类型无效');
if(module==='marketplace')need(Number.isInteger(data.priceCents)&&data.priceCents>=0&&data.priceCents<=10000000,'价格须为整数分且不超过十万元');
if(module==='affairs')need(affairTypes.includes(data.type),'办事类型无效');
put(kind(module),record);message(u,module,record,record.status);return visible(u,module,record,admin);
}
const o=get(kind(module),rid)||fail(404,'记录不存在');if(!admin&&o.userId!==u.id&&!['lost'].includes(module))fail(404,'记录不存在');
let action=operation==='cancel'?'cancel':b.action;need(typeof action==='string','请选择操作');
if(action==='cancel'){
need(o.userId===u.id||admin&&['venues','activities'].includes(module),'仅本人可取消');if(admin)o.response=text(b.reason,2000);const allowed={repairs:['SUBMITTED'],venues:['CONFIRMED'],activities:['REGISTERED'],feedback:['SUBMITTED'],certificates:['SUBMITTED'],affairs:['SUBMITTED']}[module]||[];if(!allowed.includes(o.status))fail(409,'当前状态不可取消');if(module==='venues'&&o.startsAt<=now())fail(409,'开始后的预约不可取消');if(module==='activities'){if(o.startsAt<=now())fail(409,'活动已开始');const event=get('campusEvents',o.eventId);put('campusEvents',{...event,remaining:event.remaining+1})}o.status='CANCELLED';
}else if(module==='lost'&&action==='claim'){
need(!admin&&o.userId!==u.id,'不能认领本人发布物品');if(!['OPEN','CLAIM_PENDING'].includes(o.status))fail(409,'该信息不可认领');const reason=text(b.reason,1000);if(all('campusClaims').some(c=>c.postId===rid&&c.userId===u.id&&c.status==='PENDING'))fail(409,'已提交认领');const claim=put('campusClaims',{id:id(),postId:rid,userId:u.id,reason,status:'PENDING'});o.status='CLAIM_PENDING';put(kind(module),o);notify(o.userId,'收到失物认领申请','/services/lost','claim:'+claim.id);audit(u,'LOST_CLAIM',rid);return {id:claim.id,status:claim.status,postId:rid};
}else if(module==='lost'&&action==='confirm-return'){
need(o.userId===u.id||admin,'仅发布者或运营可确认');if(o.status!=='CLAIM_PENDING')fail(409,'当前状态不能确认归还');const claim=get('campusClaims',b.claimId);need(claim?.postId===rid&&claim.status==='PENDING','认领申请无效');for(const c of all('campusClaims').filter(c=>c.postId===rid&&c.status==='PENDING')){put('campusClaims',{...c,status:c.id===claim.id?'CONFIRMED':'REJECTED'});if(c.id!==claim.id)notify(c.userId,'认领未匹配，物品已交接','/services/lost','claim-rejected:'+c.id)}o.status='RETURNED';notify(claim.userId,'认领已确认，请联系现场工作人员交接','/services/lost','claim-confirmed:'+claim.id);
}else if(module==='lost'&&action==='close'){
need(admin||o.userId===u.id,'仅发布者可关闭');if(!['OPEN','CLAIM_PENDING'].includes(o.status))fail(409,'当前状态不能关闭');o.status='CLOSED';for(const c of all('campusClaims').filter(c=>c.postId===rid&&c.status==='PENDING')){put('campusClaims',{...c,status:'REJECTED'});notify(c.userId,'失物信息已关闭，认领未通过','/services/lost','claim-rejected:'+c.id)}
}else if(module==='marketplace'&&['sold','withdraw'].includes(action)){
need(admin||o.userId===u.id,'仅发布者可操作');if(o.status!=='ACTIVE')fail(409,'当前状态不可操作');o.status=action==='sold'?'SOLD':'WITHDRAWN';
}else if(['repairs','feedback'].includes(module)&&action==='close'&&!admin){
need(o.userId===u.id,'仅本人确认');if(o.status!=='RESOLVED')fail(409,'仅已解决事项可确认');o.status='CLOSED';
}else{
role(u,['SUPER_ADMIN','CAMPUS_OPERATOR']);const transition=definition.transitions?.[action];if(!transition||o.status!==transition[0])fail(409,'状态流转不允许');o.response=text(b.reason,2000);o.handledBy=u.id;o.handledAt=now();o.status=transition[1];if(module==='certificates'&&o.status==='APPROVED')o.referenceNumber='DEMO-'+o.id.slice(0,8).toUpperCase();
}
put(kind(module),o);message(u,module,o,o.status);return visible(u,module,o,admin);
};
const response=tx(()=>{if(!key)return execute();need(typeof key==='string'&&key.length<=200,'幂等键无效');const requestHash=createHash('sha256').update(JSON.stringify({m,p,b})).digest('hex');const kid='campus:'+u.id+':'+p.join('/')+':'+key;const prior=get('idempotency',kid);if(prior){if(prior.requestHash!==requestHash)fail(409,'幂等键内容冲突');return prior.response}const result=execute();put('idempotency',{id:kid,requestHash,response:result});return result});return {handled:true,data:response};
}











