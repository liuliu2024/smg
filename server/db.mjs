import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
export const id=()=>randomUUID(); export const now=()=>new Date().toISOString();
mkdirSync('storage',{recursive:true});
export const db=new DatabaseSync(process.env.DB_PATH||'storage/campus.db');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);`);
export const all=k=>db.prepare('SELECT data FROM records WHERE kind=?').all(k).map(r=>JSON.parse(r.data));
export const get=(k,i)=>{const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(k,i);return r?JSON.parse(r.data):null};
export const put=(k,o)=>{const previous=get(k,o.id);o.version=(previous?.version||0)+1;o.updatedAt=now();o.createdAt??=o.updatedAt;db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(k,o.id,JSON.stringify(o));return o};
export const del=(k,i)=>db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(k,i);
export function tx(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
const serviceDescriptions={library:'检索馆藏，预约取书，查看借阅与归还记录',printing:'上传PDF，确认页码与报价，跟踪打印和取件',dining:'选择档口与餐段，预订餐品并查看取餐进度',notifications:'查看服务提醒、处理结果与个人站内消息',me:'查看个人身份、收藏和各项校园服务记录',repairs:'提交校园设施故障，跟踪受理与维修进度',venues:'查看可预约场地，选择日期时段并管理预约',lost:'发布寻物与招领信息，核实认领并确认归还',activities:'查看校园活动与剩余名额，报名或取消参加',feedback:'提交服务建议与问题，查看工作人员回复',certificates:'提交证明申请，查看人工审核意见与演示结果',marketplace:'发布闲置物品，浏览校园二手信息并管理上下架',affairs:'在线提交校园办事申请，查看审核意见与处理进度'};
const originalPlannedNames=['校园广播','校园摄影','公共浴室','共享雨伞','宿舍安全巡检','体育测试','节能倡议','校园寻物地图','校园二手集市','校史馆参观','校园活动日历','公益捐赠','绿色出行','社区服务','食堂意见簿'];
export function seed(){if(get('users','student'))return;tx(()=>{
if(get('users','student'))return;
const roles=['STUDENT','TEACHER','LIBRARIAN','PRINT_OPERATOR','CANTEEN_MERCHANT','SUPER_ADMIN','CAMPUS_OPERATOR'];
for(const [i,r] of roles.entries())put('users',{id:['student','teacher','librarian','printer','merchant','admin','operator'][i],displayName:['林知夏','陈老师','图书馆员','一号打印员','一号档口商户','超级管理员','校园运营'][i],campusId:`DEMO${i+1}`,roles:[r],status:'ACTIVE',scope:r==='PRINT_OPERATOR'?['point1']:r==='CANTEEN_MERCHANT'?['stall1']:[],organizationId:'org1'});
put('users',{id:'student2',displayName:'周予安',campusId:'DEMO008',roles:['STUDENT'],status:'ACTIVE',scope:[]});
for(let i=0;i<120;i++)put('users',{id:`demo-user-${i}`,displayName:`演示同学${i+1}`,campusId:`DEMO${100+i}`,roles:['STUDENT'],status:'ACTIVE',scope:[]});
for(let i=1;i<=6;i++)put('organizations',{id:`org${i}`,name:i<=2?`演示校区${i}`:`演示院系${i-2}`,type:i<=2?'CAMPUS':'DEPARTMENT'});
const titles=['设计中的设计','活着','计算机网络','JavaScript高级程序设计','人类简史','平凡的世界','数据结构','艺术的故事','乡土中国','时间简史'];
for(let i=1;i<=30;i++){put('books',{id:`book${i}`,title:titles[(i-1)%10]+(i>10?` · ${Math.ceil(i/10)}`:''),author:'演示作者',publisher:'演示出版社',isbn:`978700000${String(i).padStart(4,'0')}`,category:['文学','科技','艺术'][i%3],location:'主校区图书馆二层'});for(let j=1;j<=5;j++)put('copies',{id:`copy${i}-${j}`,bookId:`book${i}`,status:'AVAILABLE',barcode:`B${i}-${j}`})}
for(let i=1;i<=2;i++)put('points',{id:`point${i}`,name:`${i===1?'主':'东'}校区打印服务点`});
for(let i=1;i<=3;i++){put('stalls',{id:`stall${i}`,name:['禾香小厨','面面俱到','轻食时光'][i-1],hallId:i<3?'hall1':'hall2',open:true});for(let j=1;j<=10;j++)put('products',{id:`product${i}-${j}`,stallId:`stall${i}`,name:['番茄炒蛋饭','香菇鸡肉饭','时蔬套餐','红烧牛肉饭','鲜蔬面'][j%5],priceCents:1000+j*100,remaining:50,active:true})}
for(let i=1;i<=2;i++)put('halls',{id:`hall${i}`,name:`${i===1?'第一':'第二'}食堂`});
const apps=[['library','图书服务','/library'],['printing','在线打印','/printing'],['dining','智慧食堂','/dining'],['notifications','站内消息','/notifications'],['me','个人中心','/me']];
for(let i=0;i<20;i++){const a=apps[i];put('apps',{id:a?.[0]||`planned${i}`,code:a?.[0]||`planned${i}`,name:a?.[1]||originalPlannedNames[i-5],internalPath:a?.[2]||'',description:a?serviceDescriptions[a[0]]:'规划中，未接入真实系统',category:a?({library:'图书服务',printing:'生活服务',dining:'生活服务',notifications:'智慧服务',me:'学生服务'}[a[0]]):'生活服务',status:a?'ACTIVE':'PLANNED'})}
for(let i=1;i<=6;i++)put('announcements',{id:`notice${i}`,title:['欢迎使用校园服务工作台','图书预约服务使用指南','打印服务开放通知'][i%3],body:'本平台为演示环境，所有身份与业务数据均为虚构。',status:'PUBLISHED'});
for(let i=1;i<=8;i++)put('notifications',{id:`msg${i}`,userId:'student',title:'校园服务使用提醒',body:'欢迎体验图书、打印与食堂服务。',readAt:null,targetPath:'/apps'});
});}
seed();
for(const [uid,r,sc] of [['printer2','PRINT_OPERATOR',['point2']],['merchant2','CANTEEN_MERCHANT',['stall2']]])if(!get('users',uid))put('users',{id:uid,displayName:uid,roles:[r],scope:sc,status:'ACTIVE',campusId:uid});


// Additional idempotent demo records. Historical items do not consume current stock.
for(let n=1;n<=10;n++){
if(!get('reservations',`history-reservation-${n}`))put('reservations',{id:`history-reservation-${n}`,userId:n<4?'student':'student2',bookId:`book${n}`,copyId:`copy${n}-1`,status:n%2?'CANCELLED':'REJECTED',reason:'演示历史记录'});
if(!get('printOrders',`history-print-${n}`))put('printOrders',{id:`history-print-${n}`,userId:n<4?'student':'student2',pointId:n%2?'point1':'point2',fileId:null,status:n%2?'COMPLETED':'CANCELLED',amountCents:200*n,copies:1,paymentMode:'OFFLINE',paymentStatus:n%2?'PAID_OFFLINE':'UNPAID',fileDeleted:true});
if(!get('diningOrders',`history-dining-${n}`))put('diningOrders',{id:`history-dining-${n}`,userId:n<4?'student':'student2',stallId:n%2?'stall1':'stall2',items:[{nameSnapshot:'演示套餐',unitPriceCents:1200,quantity:1}],status:n%2?'COMPLETED':'CANCELLED',amountCents:1200,paymentMode:'OFFLINE',paymentStatus:n%2?'PAID_OFFLINE':'UNPAID'});
}
for(const name of ['学习服务','生活服务'])if(!get('categories',name))put('categories',{id:name,name,sortOrder:0});



const expanded={
'行政服务':['公文管理','印章申请','会议室预约','车辆申请','差旅申请','经费报销','合同管理','采购申请','资产管理','办公用品','用章查询','信息公开','制度文件','值班安排','人事服务','工资查询'],
'教学服务':['课表查询','选课中心','成绩查询','教学评价','培养方案','考试安排','课程资源','实践教学','实习管理','教室借用','教学检查','教学日历','课程建设','教师培训','科研项目','论文成果'],
'学生服务':['学籍信息','学生请假','奖助学金','勤工助学','心理预约','就业指导','毕业离校','迎新报到','宿舍申请','学生证补办','证明申请','社团活动','志愿服务','第二课堂','竞赛报名','辅导员服务'],
'图书服务':['馆藏检索','图书推荐','电子期刊','数据库资源','座位预约','研讨间预约','文献传递','阅读活动','学术讲座','馆际互借','新书速递','学科导航'],
'生活服务':['校园报修','场馆预约','快递服务','校园班车','失物招领','一卡通服务','网络缴费','水电查询','洗衣服务','医疗服务','校园地图','便民电话','访客预约','校园超市','住宿查询','生活指南'],
'智慧服务':['统一身份认证','企业微信绑定','数字档案','数据看板','智慧门禁','智慧停车','校园物联网','服务评价','意见反馈','信息安全','网络服务','数字证明','办事大厅','智慧教室','校园开放日','校友服务']};
for(const [category,names] of Object.entries(expanded)){
if(!get('categories',category))put('categories',{id:category,name:category,sortOrder:0});
for(const [n,name] of names.entries()){const code='planned-'+Object.keys(expanded).indexOf(category)+'-'+n;if(!get('apps',code))put('apps',{id:code,code,name,category,description:'规划中 · 未接入真实系统',status:'PLANNED',internalPath:'',externalUrl:'',roles:[]})}
}
if(!get('banners','welcome'))put('banners',{id:'welcome',title:'校园服务，一站直达',body:'云栖职业技术学院演示工作台 · 图书、打印、食堂服务已开放本地体验',targetPath:'/apps',enabled:true,sortOrder:0});
const extendedApps={
'行政服务':['电子签章','流程中心','校务督办','会议纪要','预算申请','项目立项','招标公告','固定资产盘点','校车管理','行政通讯录'],
'教学服务':['调停课申请','补考报名','重修申请','教研活动','课堂考勤','教学督导','教材申报','实验预约','教学质量','毕业设计'],
'学生服务':['奖惩查询','学费查询','助学贷款','困难认定','国防教育','军训管理','学生活动','宿舍调换','毕业去向','档案转递'],
'图书服务':['借阅排行榜','荐购记录','阅读积分','专题书单','文献检索培训','阅读证办理','馆藏分布','开放时间','图书馆咨询','资源试用'],
'生活服务':['校医预约','药房服务','宿舍访客','共享单车','校园充电','饮水服务','运动健康','校园文创','校园气象','交通指引'],
'智慧服务':['可信认证','电子校园卡','知识产权','科研仪器','智慧实验室','校园网络诊断','安全培训','数字资源中心','服务工单','电子表单']};
for(const [category,names] of Object.entries(extendedApps))for(const [n,name] of names.entries()){const code='extended-'+Object.keys(extendedApps).indexOf(category)+'-'+n;if(!get('apps',code))put('apps',{id:code,code,name,category,description:'规划中 · 未接入真实系统',status:'PLANNED',internalPath:'',externalUrl:'',roles:[]})}


// Non-destructive version migration for demo databases created before version tracking.
for(const row of db.prepare('SELECT kind,data FROM records').all()){const record=JSON.parse(row.data);if(!Number.isInteger(record.version))put(row.kind,record)}

// Migrate only untouched legacy planned entries; preserve all user-edited metadata.
for(let i=5;i<20;i++){const old=get('apps','planned'+i);if(old?.status==='PLANNED'&&old.name===['课表查询','校园报修','场馆预约'][i%3])put('apps',{...old,name:originalPlannedNames[i-5]})}

// Additional campus modules use fictitious resources and explicit local workflows.
tx(()=>{
for(const [i,name] of ['综合运动馆','学生活动室','图书研讨室'].entries())if(!get('campusVenues','venue'+(i+1)))put('campusVenues',{id:'venue'+(i+1),name,location:'演示主校区',capacity:[20,30,8][i],enabled:true});
for(const [i,name] of ['校园阅读分享会','绿色校园志愿活动','职业成长工作坊'].entries())if(!get('campusEvents','event'+(i+1)))put('campusEvents',{id:'event'+(i+1),name,description:'虚构演示活动，报名不发送真实通知',location:'演示学生活动中心',capacity:20,remaining:20,enabled:true,startsAt:new Date(Date.now()+(i+2)*86400000).toISOString()});
for(const [eventId,eventType] of [['event1','校园活动'],['event2','志愿服务'],['event3','校园活动']]){const event=get('campusEvents',eventId);if(event&&!event.eventType)put('campusEvents',{...event,eventType})}
if(!get('campusEvents','event4'))put('campusEvents',{id:'event4',name:'校园创意作品挑战赛',description:'演示校内交流活动，报名不代表正式竞赛资格或获奖证明',location:'演示创客空间',eventType:'竞赛报名',capacity:20,remaining:20,enabled:true,startsAt:new Date(Date.now()+5*86400000).toISOString()});
const moduleApps=[
['repairs','校园报修','后勤生活',[]],['venues','场馆预约','运动场馆',['教室借用','研讨间预约']],['lost','失物招领','后勤生活',['校园寻物地图']],['activities','社团活动','校园活动',['校园活动日历','阅读活动','学生活动','志愿服务','竞赛报名']],['feedback','意见反馈','交流反馈',['食堂意见簿','服务评价']],['certificates','证明申请','学工服务',[]],['marketplace','校园二手集市','校园交易',[]],['affairs','办事大厅','行政办公',['印章申请','差旅申请','学生请假','宿舍申请','学生证补办','档案转递','补考报名','重修申请']]
];
for(const [module,name,category,aliases] of moduleApps){let app=all('apps').find(x=>x.coreModule===module);if(!app)app=all('apps').find(x=>x.name===name&&x.status==='PLANNED');if(app&&!app.coreModule){put('apps',{...app,coreModule:module,status:'ACTIVE',category,internalPath:'/services/'+module,description:serviceDescriptions[module],aliases})}if(app?.coreModule){const combined=[...new Set([...(app.aliases||[]),...aliases])];if(combined.length!==(app.aliases||[]).length)put('apps',{...get('apps',app.id),aliases:combined})}if(app)for(const alias of aliases){const duplicate=all('apps').find(x=>x.name===alias&&x.status==='PLANNED'&&!x.coreModule);if(duplicate)put('apps',{...duplicate,status:'DISABLED',mergedInto:app.id})}}
const categoryRules=[['学习服务','教学教务'],['行政服务','行政办公'],['教学服务','教学教务'],['学生服务','学工服务'],['图书服务','图书资源'],['生活服务','后勤生活'],['智慧服务','数字服务']];
for(const app of all('apps')){const match=categoryRules.find(([old])=>app.category===old);if(match)put('apps',{...app,category:match[1]})}
for(const [name,category] of [['就业指导','就业实习'],['实习管理','就业实习'],['毕业去向','就业实习'],['科研项目','科研发展'],['论文成果','科研发展'],['知识产权','科研发展'],['科研仪器','科研发展'],['场馆预约','运动场馆'],['体育测试','运动场馆'],['运动健康','运动场馆'],['国际交流','交流反馈']]){const app=all('apps').find(x=>x.name===name);if(app&&['后勤生活','教学教务','学工服务','数字服务'].includes(app.category))put('apps',{...app,category})}
for(const [index,name] of ['行政办公','教学教务','学工服务','图书资源','后勤生活','运动场馆','校园活动','就业实习','科研发展','数字服务','校园交易','交流反馈'].entries())if(!get('categories',name))put('categories',{id:name,name,sortOrder:index});

for(const app of all('apps')){const description=serviceDescriptions[app.coreModule||app.id];if(description&&['校园便捷服务','本地演示闭环 · 未连接学校真实外部系统'].includes(app.description))put('apps',{...app,description})}
const affairsApp=all('apps').find(a=>a.coreModule==='affairs');if(affairsApp?.name==='办事大厅')put('apps',{...affairsApp,name:'校园办事'});
for(const legacy of ['学习服务','生活服务','行政服务','教学服务','学生服务','图书服务','智慧服务']){const c=get('categories',legacy);if(c?.name===legacy&&!all('apps').some(a=>a.category===legacy))del('categories',legacy)}

});




