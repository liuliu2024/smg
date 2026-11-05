// Adapts legacy positive fixtures to v3's mandatory idempotency and quoted printing contract.
// New v3 negative cases deliberately use native fetch directly.
import {randomUUID} from 'node:crypto';
const quoteCache=new Map();
export async function fixtureFetch(url,options={}){
 const method=options.method||'GET',u=new URL(url),headers=new Headers(options.headers),operation=u.pathname.replace('/api/v1/','');
 if(method==='POST'&&(['library/reservations','dining/orders','printing/orders'].includes(operation)||/^(services|extensions)\/[a-z]+$/.test(operation)||operation==='admin/extensions/parcels')){
  if(!headers.has('Idempotency-Key'))headers.set('Idempotency-Key',randomUUID());
  if(operation==='printing/orders'){
   const body=JSON.parse(options.body||'{}');
   if(body.fileId&&!body.quoteId){const k=headers.get('Cookie')+':'+headers.get('Idempotency-Key')+':'+JSON.stringify(body);let quote=quoteCache.get(k);
    if(!quote){const result=await fetch(new URL('/api/v1/printing/quotes',u),{...options,headers,body:JSON.stringify(body)});const json=await result.json();if(!result.ok)return new Response(JSON.stringify(json),{status:result.status,headers:result.headers});quote=json.data;quoteCache.set(k,quote)}
    options={...options,body:JSON.stringify({quoteId:quote.quoteId,paymentMode:body.paymentMode||'OFFLINE'})};
   }
  }
 }
 return fetch(url,{...options,headers});
}
