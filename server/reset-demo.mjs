import {spawnSync} from 'node:child_process';
import {unlinkSync} from 'node:fs';
import {resolve,sep} from 'node:path';
if(process.env.APP_MODE==='production'||!process.argv.includes('--confirm=RESET_DEMO')){console.error('仅演示环境允许重置。确认删除本地演示数据：node server/reset-demo.mjs --confirm=RESET_DEMO');process.exit(1)}
const storageRoot=resolve('storage');const dbPath=resolve(process.env.DB_PATH||'storage/campus.db');if(!dbPath.startsWith(storageRoot+sep)){console.error('仅允许重置storage目录中的演示数据库');process.exit(1)}
const {db,all}=await import('./db.mjs');
for(const f of all('files')){if(!/^[a-zA-Z0-9_-]+$/.test(f.id))continue;const target=resolve(storageRoot,f.id+'.pdf');if(target.startsWith(storageRoot+sep))try{unlinkSync(target)}catch(e){if(e.code!=='ENOENT')throw e}}
db.exec('BEGIN IMMEDIATE; DELETE FROM records; DELETE FROM meta; COMMIT;');db.close();const result=spawnSync(process.execPath,['-e',"import('./server/db.mjs').then(()=>console.log('演示数据库已重置并重新初始化'))"],{stdio:'inherit',env:process.env});process.exit(result.status??1);
