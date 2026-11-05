import {all,now} from './db.mjs';
const terminals=new Set(['COMPLETED','CANCELLED','REJECTED']);
export function retentionForFile(file,at=Date.now()){
 const orders=all('printOrders').filter(o=>o.fileId===file.id);
 if(orders.some(o=>!terminals.has(o.status)))return {due:false,reason:'ACTIVE_PRINT_ORDER',expiresAt:null};
 let base;if(!orders.length)base=Date.parse(file.createdAt);else base=Math.max(...orders.map(o=>Date.parse(o.closedAt||o.completedAt||o.usedAt||o.updatedAt||o.createdAt)));
 if(!Number.isFinite(base))return {due:false,reason:'MISSING_TIMESTAMP',expiresAt:null};
 const expires=base+(orders.length?7*86400000:86400000);return {due:!file.deletedAt&&expires<=at,reason:orders.length?'TERMINAL_ORDER_7_DAYS':'ORPHAN_24_HOURS',expiresAt:new Date(expires).toISOString()};
}
