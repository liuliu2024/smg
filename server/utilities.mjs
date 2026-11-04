import {createHash} from 'node:crypto';
import {all,get,put,id,now,tx} from './db.mjs';
import {need,fail,audit,role} from './services.mjs';
const field=(key,label,type='text')=>({key,label,type,required:true});
export const utilityDefinitions={
calendar:{name:'个人日程',category:'个人工具',private:true,fields:[field('title','日程名称'),field('startsAt','开始时间','datetime-local'),field('endsAt','结束时间','datetime-local'),field('location','地点')]},
tasks:{name:'待办清单',category:'个人工具',private:true,fields:[field('title','待办事项'),field('dueDate','截止日期','date'),field('description','说明','textarea')]},
notes:{name:'个人笔记',category:'个人工具',private:true,fields:[field('title','笔记标题'),field('body','笔记内容','textarea'),field('category','分类')]},
expenses:{name:'个人记账',category:'个人工具',private:true,fields:[field('title','用途'),field('amountCents','金额（分）','number'),field('date','日期','date'),field('category','分类')]},
contacts:{name:'校园通讯录',category:'校园信息',fields:[field('title','部门名称'),field('location','办公地点'),field('contact','公开联系方式'),field('body','服务说明','textarea')]},
places:{name:'校园地点查询',category:'校园信息',fields:[field('title','地点名称'),field('campus','校区'),field('location','详细位置'),field('body','到达指引','textarea')]},
shuttles:{name:'校车时刻',category:'交通出行',fields:[field('title','线路名称'),field('stops','途经站点'),field('times','发车时刻（HH:mm逗号分隔）'),field('body','乘车说明','textarea')]},
hours:{name:'开放时间',category:'校园信息',fields:[field('title','服务地点'),field('location','位置'),field('schedule','开放时段'),field('body','节假日说明','textarea')]},
guides:{name:'办事指南',category:'行政办公',fields:[field('title','事项名称'),field('materials','所需材料','textarea'),field('body','办理步骤','textarea'),field('location','办理地点')]},
resources:{name:'资料下载',category:'数字服务',exportable:true,fields:[field('title','资料名称'),field('category','分类'),field('body','资料正文','textarea')]},
faq:{name:'常见问题',category:'交流反馈',fields:[field('title','问题'),field('category','分类'),field('body','答复','textarea')]},
schoolcalendar:{name:'校园校历',category:'教学教务',fields:[field('title','校历事项'),field('startsAt','开始时间','datetime-local'),field('endsAt','结束时间','datetime-local'),field('body','说明','textarea')]}
};
const ops=u=>['SUPER_ADMIN','CAMPUS_OPERATOR'].includes(u.activeRole);
const kind=m=>'utility:'+m;
const text=(v,max=8000)=>{need(typeof v==='string'&&v.trim()&&v.length<=max,'文本为空或超过长度限制');return v.trim()};
function clean(cfg,b){const out={};for(const f of cfg.fields){let value=b[f.key];if(f.type==='number'){need(Number.isInteger(value)&&value>=0&&value<=100000000,'金额须为非负整数分');out[f.key]=value}else if(f.type==='datetime-local'){need(typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value)),'时间不合法');out[f.key]=new Date(value).toISOString()}else if(f.type==='date'){need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'日期不合法');out[f.key]=value}else out[f.key]=text(value,f.type==='textarea'?8000:300)}if(out.endsAt)need(out.endsAt>out.startsAt,'结束时间必须晚于开始');if(out.times)need(out.times.split(/[,，]/).every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim())),'发车时刻格式应为HH:mm');return out}
function view(cfg,o){const {userId,...safe}=o;return {...safe,allowedActions:cfg.private?(o.status==='COMPLETED'?['reopen','edit','archive']:['edit','archive',...(cfg.name==='待办清单'?['complete']:[]),...(cfg.name==='个人笔记'?[o.pinned?'unpin':'pin']:[])]):(cfg.exportable?['export']:[])}}
export function utilities(u,p,m,b,url,key){
 const admin=p[0]==='admin'&&p[1]==='utilities';if(p[0]!=='utilities'&&!admin)return {handled:false};
 const module=p[admin?2:1],rid=p[admin?3:2],actionPath=p[admin?4:3],cfg=utilityDefinitions[module];if(!cfg)fail(404,'工具不存在');
 const app=all('apps').find(a=>a.utilityModule===module);if(!admin&&(!app||app.status!=='ACTIVE'||app.roles?.length&&!app.roles.includes(u.activeRole)))fail(403,'服务当前不可用');
 if(admin){role(u,['SUPER_ADMIN','CAMPUS_OPERATOR']);if(cfg.private)fail(403,'个人工具仅本人可访问')}
 const own=o=>cfg.private?o.userId===u.id:admin||o.status==='PUBLISHED';
 if(m==='GET'){
   let rows=all(kind(module)).filter(o=>own(o)&&o.status!=='ARCHIVED');
   if(rid){const o=rows.find(o=>o.id===rid)||fail(404,'记录不存在');if(actionPath==='export'){need(cfg.exportable,'此服务不提供导出');audit(u,'UTILITY_EXPORT',o.id);return {handled:true,data:{filename:'campus-resource.txt',content:o.title+'\n\n'+o.body+'\n\n演示资料，非学校正式文件'}}}return {handled:true,data:{...view(cfg,o),allowedActions:admin?['edit','archive',o.status==='PUBLISHED'?'unpublish':'publish']:view(cfg,o).allowedActions}}}
   const q=(url.searchParams.get('q')||'').trim();if(q)rows=rows.filter(o=>cfg.fields.some(f=>String(o[f.key]).includes(q)));const status=url.searchParams.get('status');if(status)rows=rows.filter(o=>o.status===status);rows.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.createdAt.localeCompare(a.createdAt));
   const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);need(Number.isInteger(page)&&page>0&&Number.isInteger(pageSize)&&pageSize>0&&pageSize<=100,'分页参数不合法');
   return {handled:true,data:{config:{module,...cfg,canCreate:cfg.private||admin,notice:cfg.private?'个人工具，数据仅本人可见；请勿录入真实敏感资料':'演示校园信息，由校园运营维护，不代表学校正式通知'},records:rows.slice((page-1)*pageSize,page*pageSize).map(o=>({...view(cfg,o),allowedActions:admin?['edit','archive',o.status==='PUBLISHED'?'unpublish':'publish']:view(cfg,o).allowedActions})),meta:{page,pageSize,total:rows.length,totalPages:Math.ceil(rows.length/pageSize)},summary:module==='expenses'?{totalCents:rows.reduce((s,o)=>s+o.amountCents,0)}:{}}};
 }
 need(m==='POST','仅支持GET/POST');if(!cfg.private&&!admin)fail(403,'只有运营人员可维护校园信息');
 const data=tx(()=>{
   const hash=createHash('sha256').update(JSON.stringify({p,b})).digest('hex'),ikey=key&&'utility:'+u.id+':'+p.join('/')+':'+key;need(!key||typeof key==='string'&&key.length<=200,'幂等键无效');if(ikey){const prev=get('idempotency',ikey);if(prev){if(prev.requestHash!==hash)fail(409,'幂等键内容冲突');return prev.response}}
   let o=rid?get(kind(module),rid):null;if(rid&&(!o||!own(o)))fail(404,'记录不存在');if(o?.status==='ARCHIVED')fail(409,'记录已归档');if(o&&b.version!==undefined&&b.version!==o.version)fail(409,'记录已修改，请刷新');
   if(!rid||actionPath!=='action'){const values=clean(cfg,b);if(module==='calendar'&&all(kind(module)).some(x=>x.id!==rid&&x.userId===u.id&&x.status!=='ARCHIVED'&&values.startsAt<x.endsAt&&values.endsAt>x.startsAt))fail(409,'与已有日程时间冲突');o={...o,id:rid||id(),userId:cfg.private?u.id:undefined,...values,status:o?.status||(cfg.private?'ACTIVE':'DRAFT')};}
   else {need(o,'记录不存在');const a=b.action;if(a==='archive')o.status='ARCHIVED';else if(a==='complete'&&module==='tasks'&&o.status==='ACTIVE')o.status='COMPLETED';else if(a==='reopen'&&module==='tasks'&&o.status==='COMPLETED')o.status='ACTIVE';else if(['pin','unpin'].includes(a)&&module==='notes')o.pinned=a==='pin';else if(['publish','unpublish'].includes(a)&&admin)o.status=a==='publish'?'PUBLISHED':'DRAFT';else fail(409,'当前状态不允许此操作')}
   put(kind(module),o);audit(u,'UTILITY_'+module+'_'+(b.action||'SAVE'),o.id);const result=view(cfg,o);if(ikey)put('idempotency',{id:ikey,requestHash:hash,response:result});return result;
 });return {handled:true,data};
}
// Seed only fictitious campus information; edits survive subsequent starts.
for(const [module,cfg] of Object.entries(utilityDefinitions)){
 let app=all('apps').find(a=>a.utilityModule===module);if(!app){app=all('apps').find(a=>a.status==='PLANNED'&&a.name===cfg.name)||{id:'utility-'+module};put('apps',{...app,name:cfg.name,code:'utility-'+module,utilityModule:module,status:'ACTIVE',category:cfg.category,internalPath:'/utilities/'+module,description:cfg.private?'整理个人事项，记录与内容仅本人可见':'查询校园服务信息，支持关键词检索',roles:[]})}
 if(cfg.private||all(kind(module)).length)continue;
 const sample={contacts:{title:'演示学生服务中心',location:'主校区服务楼101',contact:'演示总机 000-00000000',body:'提供校内事项咨询，号码仅为演示占位'},places:{title:'演示图书馆',campus:'主校区',location:'服务楼东侧，步行入口在南门',body:'从主校门沿中轴步行约五分钟；此为虚构校区指引'},shuttles:{title:'主校区—东校区演示线',stops:'主校门、生活区、东校门',times:'08:00,12:00,17:00',body:'工作日演示时刻，非真实运营车辆信息'},hours:{title:'图书馆演示开放时间',location:'主校区图书馆',schedule:'周一至周五 08:00—21:00',body:'节假日以学校正式公告为准，此处为演示数据'},guides:{title:'如何使用校园报修',materials:'问题描述、校内具体位置',body:'1.打开校园报修。2.填写情况。3.等待运营受理。4.查看处理回复并确认关闭。',location:'在线校园报修'},resources:{title:'校园平台演示使用手册',category:'平台指南',body:'本文件演示资料下载流程。登录后可使用图书预约、在线打印、食堂点餐及校园服务。全部身份和数据均为虚构。'},faq:{title:'打印费用如何计算？',category:'打印服务',body:'黑白每印面20分，彩色100分，装订每份100分。双面影响纸张数量，不改变按印面计费。价格以服务端报价为准。'},schoolcalendar:{title:'校园服务体验周（演示）',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+7*86400000).toISOString(),body:'虚构校园活动时段，不是学校正式校历。'}}[module];
 if(sample)put(kind(module),{id:'sample-'+module,...sample,status:'PUBLISHED'});
}

