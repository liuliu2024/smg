import {all,get,now} from './db.mjs';
import {need,fail} from './services.mjs';
import {hasScope} from './auth-v3.mjs';
const activeStatuses=new Set(['PENDING','READY','SUBMITTED','ACCEPTED','PROCESSING','PREPARING','EXCEPTION','RETURNED','REVIEWING','RESUBMITTED','CONFIRMED','REGISTERED','ALLOCATED','REQUESTED','APPROVED','ON_LOAN']);
const domains=[['reservations','library','图书预约','/library/reservations'],['loans','loans','借阅记录','/library/loans'],['printOrders','printing','打印订单','/printing/orders'],['diningOrders','dining','餐饮订单','/dining/orders'],...['repairs','venues','lost','activities','feedback','certificates','marketplace','affairs'].map(m=>['campus:'+m,m,({repairs:'校园报修',venues:'场地预约',lost:'失物招领',activities:'活动报名',feedback:'意见反馈',certificates:'证明申请',marketplace:'二手信息',affairs:'办事申请'})[m],'/services/'+m]),...['housing','leaves','parcels','equipment','jobs','surveys'].map(m=>['extension:'+m,m,({housing:'住宿申请',leaves:'请销假',parcels:'待取包裹',equipment:'设备借用',jobs:'岗位申请',surveys:'问卷记录'})[m],'/extensions/'+m])];
function item(o,domain,title,base){return {id:o.id,domain,title:o.title||o.nameSnapshot||title,status:o.status,createdAt:o.createdAt,updatedAt:o.updatedAt,dueAt:o.expiresAt||o.dueAt||o.startsAt||null,amountCents:o.amountCents,targetPath:base+'/'+o.id,nextPath:base+'/'+o.id}}
function personal(u){return domains.flatMap(([kind,domain,title,base])=>all(kind).filter(o=>o.userId===u.id).map(o=>item(o,domain,title,base))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
const canStaff=(u,domain,o)=>{
 if(domain==='printing')return u.activeRole==='PRINT_OPERATOR'&&hasScope(u,'PRINT_POINT',o.pointId);
 if(domain==='dining')return u.activeRole==='CANTEEN_MERCHANT'&&hasScope(u,'STALL',o.stallId);
 if(['library','loans'].includes(domain))return u.activeRole==='LIBRARIAN'&&hasScope(u,'SERVICE','library');
 const role=['venues','activities','equipment'].includes(domain)?'RESOURCE_MANAGER':['affairs','certificates','leaves','housing'].includes(domain)?'DEPARTMENT_REVIEWER':'SERVICE_AGENT';
 return u.activeRole===role&&hasScope(u,'SERVICE',domain);
};
function businessTasks(u,staff=false){
 const tasks=[];
 for(const [kind,domain,title,base]of domains)for(const o of all(kind)){
  let action=null;
  if(staff){if(!canStaff(u,domain,o)||!activeStatuses.has(o.status))continue;action='办理或查看下一步'}
  else{if(o.userId!==u.id)continue;if(o.status==='READY'&&['library','printing','dining'].includes(domain))action='前往领取';else if(domain==='parcels'&&o.status==='PENDING_PICKUP')action='查看取件凭证';else if(['affairs','certificates'].includes(domain)&&o.status==='RETURNED')action='补充材料';else if(domain==='loans'&&o.status==='ACTIVE'&&o.dueAt<=new Date(Date.now()+3*86400000).toISOString())action='查看借阅到期与续借'}
  if(action)tasks.push({...item(o,domain,title,staff?'/admin/'+(domain==='library'?'library/reservations':domain==='loans'?'library/loans':domain==='printing'?'printing/orders':domain==='dining'?'dining/orders':base.startsWith('/services/')?'services/'+domain:'extensions/'+domain):base),taskId:domain+':'+o.id,sourceId:o.id,actionLabel:action,deadline:o.expiresAt||o.dueAt||null});
 }
 if(staff&&u.activeRole==='SUPER_ADMIN')for(const job of all('jobs').filter(x=>x.status==='FAILED'))tasks.push({id:job.id,taskId:'job:'+job.id,sourceId:job.id,domain:'system',title:'失败后台任务',status:job.status,targetPath:'/admin/jobs',actionLabel:'查看并人工重试',createdAt:job.createdAt});
 return tasks;
}
function paginate(rows,url){const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);need(Number.isInteger(page)&&page>0&&Number.isInteger(pageSize)&&pageSize>0&&pageSize<=100,'分页参数错误');const domain=url.searchParams.get('domain')||url.searchParams.get('type'),status=url.searchParams.get('status'),q=url.searchParams.get('q')||'';need(q.length<=100,'关键词最多100字');const filtered=rows.filter(x=>(!domain||x.domain===domain)&&(!status||x.status===status)&&(!q||[x.id,x.title,x.domain,x.status].some(v=>String(v||'').includes(q))));return {records:filtered.slice((page-1)*pageSize,page*pageSize),meta:{page,pageSize,total:filtered.length,totalPages:Math.ceil(filtered.length/pageSize)}}}
export function projectionsV3(u,p,m,b,url){
 const route=p.join('/');if(!['me/services','tasks','admin/tasks','calendar'].includes(route))return {handled:false};if(m!=='GET')fail(405,'业务投影只读');
 if(route==='me/services'){const result=paginate(personal(u),url);return {handled:true,data:result}}
 if(route==='tasks'||route==='admin/tasks'){if(route==='admin/tasks'&&['STUDENT','TEACHER'].includes(u.activeRole))fail(403,'没有工作人员待办权限');return {handled:true,data:paginate(businessTasks(u,route==='admin/tasks'),url)}}
 const start=url.searchParams.get('start'),end=url.searchParams.get('end');need(typeof start==='string'&&typeof end==='string'&&!Number.isNaN(Date.parse(start))&&!Number.isNaN(Date.parse(end)),'请提供有效start/end');const a=Date.parse(start),z=Date.parse(end);need(z>a&&z-a<=90*86400000,'日历范围必须大于0且最多90天');const events=[];
 for(const [kind,domain,title,base]of domains)for(const o of all(kind).filter(o=>o.userId===u.id)){
  if(['CANCELLED','REJECTED','EXPIRED','RETURNED','COMPLETED','CLOSED','WITHDRAWN'].includes(o.status))continue;
  if(domain==='library'&&o.status!=='READY'||domain==='loans'&&o.status!=='ACTIVE')continue;
  const at=o.startsAt||o.dueAt||o.expiresAt||(o.pickupDate?o.pickupDate+'T'+(o.pickupSlot==='LUNCH'?'11:00':'17:00')+':00+08:00':o.date&&o.slot?o.date+'T'+o.slot+':00+08:00':null);if(!at)continue;const time=Date.parse(at);if(time<a||time>=z)continue;events.push({...item(o,domain,title,base),eventId:domain+':'+o.id,start:new Date(time).toISOString(),end:o.endsAt||new Date(time+3600000).toISOString()});
 }
 events.sort((a,b)=>a.start.localeCompare(b.start));return {handled:true,data:{events,start:new Date(a).toISOString(),end:new Date(z).toISOString(),source:'BUSINESS_PROJECTION'}};
}
