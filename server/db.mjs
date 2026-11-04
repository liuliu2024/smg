import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
export const id=()=>randomUUID(); export const now=()=>new Date().toISOString();
mkdirSync('storage',{recursive:true});
export const db=new DatabaseSync(process.env.DB_PATH||'storage/campus.db');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);`);
export const all=k=>db.prepare('SELECT data FROM records WHERE kind=?').all(k).map(r=>JSON.parse(r.data));
export const get=(k,i)=>{const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(k,i);return r?JSON.parse(r.data):null};
export const put=(k,o)=>{o.updatedAt=now();o.createdAt??=o.updatedAt;db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(k,o.id,JSON.stringify(o));return o};
export const del=(k,i)=>db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(k,i);
export function tx(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
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
for(let i=0;i<20;i++){const a=apps[i];put('apps',{id:a?.[0]||`planned${i}`,name:a?.[1]||['课表查询','校园报修','场馆预约'][i%3],internalPath:a?.[2]||'',description:a?'校园便捷服务':'规划中，未接入真实系统',category:i%2?'生活服务':'学习服务',status:a?'ACTIVE':'PLANNED'})}
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

