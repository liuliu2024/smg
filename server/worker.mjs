import {runJobs} from './services.mjs';
export async function tick(){return runJobs()}
await tick();if(!process.argv.includes('--once'))setInterval(()=>tick().catch(console.error),60000);
