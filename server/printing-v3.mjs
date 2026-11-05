import {bindRule} from './catalog-v3.mjs';
import {createHash} from 'node:crypto';
import {credentialFor,credentialToken,consumeCredential} from './credentials-v3.mjs';
import {db,all,get,put,id,now,tx} from './db.mjs';
import {quote as calculate,need,fail,scope,audit,notify} from './services.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS v3_print_quotes(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,file_id TEXT NOT NULL,point_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),sheets INTEGER NOT NULL CHECK(sheets>0),
 rule_version TEXT NOT NULL,parameters_json TEXT NOT NULL,pricing_snapshot_json TEXT NOT NULL,
 pages_json TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_order_id TEXT UNIQUE);
 CREATE INDEX IF NOT EXISTS v3_print_quotes_owner ON v3_print_quotes(user_id,expires_at);
 CREATE TABLE IF NOT EXISTS v3_pickup_credentials(
 domain TEXT NOT NULL,order_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,ciphertext TEXT NOT NULL,
 created_at TEXT NOT NULL,used_at TEXT,PRIMARY KEY(domain,order_id));`);
const hash=s=>createHash('sha256').update(s).digest('hex');
function ensureCredential(o){const c=credentialFor('printing',o.id,o.pickupToken);if(o.pickupToken){delete o.pickupToken;put('printOrders',o)}return c}
for(const order of all('printOrders').filter(o=>o.pickupToken))tx(()=>{if(order.status==='READY')ensureCredential(order);else{delete order.pickupToken;put('printOrders',order)}});
function publicOrder(o,owner=false){const {pickupToken,...safe}=o;if(owner&&o.status==='READY'){const c=ensureCredential(o);if(!c.used_at)safe.pickupToken=credentialToken(c)}return {...safe,fulfillmentMode:'MANUAL',paymentNotice:o.paymentMode==='SIMULATED'?'模拟支付，未发生真实收款':'到店支付，由对应打印点人员确认'}}
function parameters(b){const colorMode=b.colorMode||({BLACK_WHITE:'BW',COLOR:'COLOR'}[b.color]);let duplex=b.duplex;if(typeof duplex==='string')duplex=({SINGLE:false,DOUBLE:true})[duplex];need(!b.paper||b.paper==='A4','仅支持A4');return {fileId:b.fileId,pointId:b.pointId,copies:b.copies,colorMode,duplex,binding:b.binding||'NONE',pages:b.pages||'all',paper:'A4'}}
function pointAvailable(pointId){const p=get('points',pointId);need(p,'打印点不存在');if(p.acceptingOrders===false||p.open===false||p.status==='PAUSED'||p.status==='DISABLED')fail(409,'打印点暂停接收新订单');return p}
function quoteView(r){return {id:r.id,quoteId:r.id,expiresAt:r.expires_at,ruleVersion:r.rule_version,amountCents:r.amount_cents,sheets:r.sheets,selectedPages:JSON.parse(r.pages_json),pricingSnapshot:JSON.parse(r.pricing_snapshot_json),paramsSnapshot:JSON.parse(r.parameters_json)}}
function notifyState(u,o,a){notify(o.userId,'打印订单：'+({READY:'待取件',REJECTED:'已拒绝',EXCEPTION:'出现异常',COMPLETED:'已完成',CANCELLED:'已取消'}[o.status]||o.status),'/printing/orders/'+o.id,'print-v3:'+o.id+':'+o.status);audit(u,'PRINT_'+a.toUpperCase(),o.id)}
function action(u,o,a,b){
 if(a==='cancel'){if(o.userId!==u.id)fail(404,'订单不存在')}else scope(u,o,'printing');
 if(b.version!==undefined&&b.version!==o.version)fail(409,'订单已更新，请刷新');
 if(a==='confirm-payment'){
  if(o.paymentMode!=='OFFLINE'||o.paymentStatus!=='UNPAID'||!['ACCEPTED','PROCESSING','READY'].includes(o.status))fail(409,'当前订单不允许到店收款确认');
  o.paymentStatus='PAID_OFFLINE';o.confirmedBy=u.id;o.confirmedAt=now();put('payments',{id:id(),domain:'printing',orderId:o.id,mode:'OFFLINE',status:o.paymentStatus,amountCents:o.amountCents,confirmedBy:u.id,confirmedAt:o.confirmedAt});
 }else if(a==='redeem'){
  if(o.status!=='READY'||!['PAID_OFFLINE','SIMULATED_PAID'].includes(o.paymentStatus))fail(409,'订单未待取或未确认付款');
  need(typeof b.token==='string'&&b.token.length<=256,'请输入有效取件凭证');const c=ensureCredential(o);
  if(c.used_at||hash(b.token)!==c.token_hash)fail(409,'凭证无效或已使用');
  const updated=db.prepare('UPDATE v3_pickup_credentials SET used_at=? WHERE domain=? AND order_id=? AND used_at IS NULL').run(now(),'printing',o.id);if(updated.changes!==1)fail(409,'凭证已使用');o.status='COMPLETED';o.completedAt=now();o.usedAt=now();
 }else if(['cancel','reject'].includes(a)){
  if(o.status!=='SUBMITTED')fail(409,'仅待接单订单可取消或拒绝');if(a==='reject')need(typeof b.reason==='string'&&b.reason.trim(),'拒绝须填写原因');o.status=a==='cancel'?'CANCELLED':'REJECTED';o.reason=b.reason?.trim().slice(0,1000);o.closedAt=now();
 }else if(a==='exception'){
  if(!['ACCEPTED','PROCESSING','READY'].includes(o.status))fail(409,'当前状态不可标记异常');need(typeof b.reason==='string'&&b.reason.trim(),'异常须填写原因');o.previousStatus=o.status;o.status='EXCEPTION';o.reason=b.reason.trim().slice(0,1000);
 }else if(a==='resolve'){
  if(o.status!=='EXCEPTION')fail(409,'订单不处于异常');need(['restore','cancel'].includes(b.resolution),'请选择恢复或取消');need(typeof b.reason==='string'&&b.reason.trim(),'处理须填写原因');
  if(b.resolution==='restore'){if(!['ACCEPTED','PROCESSING','READY'].includes(o.previousStatus))fail(409,'异常前态不可恢复');o.status=o.previousStatus}else{o.status='CANCELLED';o.closedAt=now();if(o.paymentStatus!=='UNPAID')o.afterSalesStatus='MANUAL_REQUIRED'}o.reason=b.reason.trim().slice(0,1000);
 }else{const transition={accept:['SUBMITTED','ACCEPTED'],start:['ACCEPTED','PROCESSING'],ready:['PROCESSING','READY']}[a];if(!transition||o.status!==transition[0])fail(409,'状态流转不允许');o.status=transition[1];if(o.status==='READY')ensureCredential(o)}
 if(['CANCELLED','REJECTED','COMPLETED'].includes(o.status)){o.closedAt??=now();db.prepare('UPDATE v3_pickup_credentials SET used_at=COALESCE(used_at,?) WHERE domain=? AND order_id=?').run(now(),'printing',o.id)}
 delete o.pickupToken;put('printOrders',o);notifyState(u,o,a);return publicOrder(o,a==='cancel');
}
export function printingV3(u,p,m,b,url,key){
 const path=p.join('/');const mine=p[0]==='printing',admin=p[0]==='admin'&&p[1]==='printing';if(!mine&&!admin)return {handled:false};
 if(mine&&path==='printing/quotes'&&m==='POST')return {handled:true,data:tx(()=>{const params=parameters(b);pointAvailable(params.pointId);const price=calculate(u,params),qid=id(),created=now(),expiry=new Date(Date.now()+600000).toISOString();db.prepare('INSERT INTO v3_print_quotes(id,user_id,file_id,point_id,amount_cents,sheets,rule_version,parameters_json,pricing_snapshot_json,pages_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(qid,u.id,params.fileId,params.pointId,price.amountCents,price.sheets,String(price.pricingSnapshot.version),JSON.stringify(params),JSON.stringify(price.pricingSnapshot),JSON.stringify(price.selectedPages),created,expiry);return quoteView(db.prepare('SELECT * FROM v3_print_quotes WHERE id=?').get(qid))})};
 if(mine&&path==='printing/orders'&&m==='POST')return {handled:true,data:tx(()=>{
  need(typeof key==='string'&&key.length>0&&key.length<=200,'下单必须提供Idempotency-Key');const requestHash=hash(JSON.stringify(b)),recordId='print-v3:'+u.id+':'+key,prior=get('idempotency',recordId);if(prior){if(prior.requestHash!==requestHash)fail(409,'幂等键内容冲突');return prior.response}
  need(typeof b.quoteId==='string','请先获取报价并提交quoteId');const q=db.prepare('SELECT * FROM v3_print_quotes WHERE id=? AND user_id=?').get(b.quoteId,u.id);if(!q)fail(404,'报价不存在');if(q.expires_at<=now()||q.consumed_order_id)fail(409,'报价已过期或已使用，请重新报价');pointAvailable(q.point_id);const params=JSON.parse(q.parameters_json),current=calculate(u,params);if(String(current.pricingSnapshot.version)!==q.rule_version||current.amountCents!==q.amount_cents)fail(409,'价格规则已变更，请重新报价');
  const mode=b.paymentMode||'OFFLINE';need(['OFFLINE','SIMULATED'].includes(mode),'支付模式无效');const o=put('printOrders',{id:id(),userId:u.id,pointId:q.point_id,fileId:q.file_id,quoteId:q.id,...params,...current,status:'SUBMITTED',paymentMode:mode,paymentStatus:mode==='SIMULATED'?'SIMULATED_PAID':'UNPAID',createdAt:now()});db.prepare('UPDATE v3_print_quotes SET consumed_order_id=? WHERE id=? AND consumed_order_id IS NULL').run(o.id,q.id);bindRule('PrintOrder',o.id,q.rule_version);audit(u,'PRINT_SUBMITTED',o.id);const response=publicOrder(o,true);put('idempotency',{id:recordId,userId:u.id,operation:'printing/orders',key,requestHash,response,expiresAt:new Date(Date.now()+86400000).toISOString()});return response;
 })};
 if(mine&&path==='printing/points'&&m==='GET')return {handled:true,data:all('points').map(point=>{const count=all('printOrders').filter(o=>o.pointId===point.id&&['SUBMITTED','ACCEPTED','PROCESSING','EXCEPTION'].includes(o.status)).length;return {...point,pendingCount:count,loadStatus:point.acceptingOrders===false||point.open===false?'PAUSED':count>=15?'BUSY':count>=5?'NORMAL':'AVAILABLE',updatedAt:point.updatedAt}})};
 if(mine&&p[1]==='orders'){
  if(m==='GET'){const rows=all('printOrders').filter(o=>o.userId===u.id);if(p[2]){const o=rows.find(x=>x.id===p[2])||fail(404,'订单不存在');if(p[3]==='credential'){if(o.status!=='READY')fail(409,'仅待取订单提供有效凭证');return {handled:true,data:{orderId:o.id,token:publicOrder(o,true).pickupToken}}}return {handled:true,data:publicOrder(o,true)}}const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);need(Number.isInteger(page)&&page>0&&Number.isInteger(pageSize)&&pageSize>0&&pageSize<=100,'分页参数错误');const status=url.searchParams.get('status');const filtered=rows.filter(x=>!status||x.status===status).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {handled:true,data:filtered.slice((page-1)*pageSize,page*pageSize).map(o=>publicOrder(o,true)),meta:{page,pageSize,total:filtered.length}}}
  if(m==='POST'&&p[3]==='cancel')return {handled:true,data:tx(()=>action(u,get('printOrders',p[2])||fail(404,'订单不存在'),'cancel',b))};
 }
 if(admin&&path==='admin/printing/redeem'&&m==='POST'){need(typeof b.token==='string','请输入凭证');const c=db.prepare('SELECT order_id FROM v3_pickup_credentials WHERE domain=? AND token_hash=?').get('printing',hash(b.token));if(!c)fail(409,'凭证无效');return {handled:true,data:tx(()=>action(u,get('printOrders',c.order_id)||fail(404,'订单不存在'),'redeem',b))}}
 if(admin&&p[2]==='orders'&&p[3]){const o=get('printOrders',p[3])||fail(404,'订单不存在');scope(u,o,'printing');if(m==='GET')return {handled:true,data:publicOrder(o,false)};if(m==='POST'&&p[4])return {handled:true,data:tx(()=>action(u,get('printOrders',o.id),p[4],b))}}
 return {handled:false};
}
