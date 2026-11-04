import next from 'next';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {handler} from './main.mjs';
const app=next({dev:!process.argv.includes('--production')});
await app.prepare();
const nextHandler=app.getRequestHandler();
const worker=spawn(process.execPath,['server/worker.mjs'],{stdio:'inherit',env:process.env});
const server=createServer((req,res)=>{
 if(req.url.startsWith('/api/')||req.url==='/health') return Promise.resolve(handler(req,res)).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Internal error');});
 return nextHandler(req,res);
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Campus services: http://localhost:'+ (process.env.PORT||3000)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{worker.kill();server.close(()=>process.exit());});

