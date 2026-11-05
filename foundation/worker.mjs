import {closeDatabase, transaction} from './db.mjs';
import {runReleaseTest} from './releases.mjs';
import {tickWorker} from './runtime/index.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const workerId = process.env.WORKER_ID;
const once = process.argv.includes('--once');
const concurrency = once ? 1 : Number(process.env.WORKER_CONCURRENCY ?? 4);
if (!workerId || workerId.length > 96) throw new Error('WORKER_ID is required (maximum 96 characters)');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('WORKER_CONCURRENCY must be 1 through 8');
if (process.env.APP_MODE !== 'demo') throw new Error('Foundation worker only supports explicit DEMO mode');
let stopping = false;
let nextHeartbeat = 0;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {stopping = true});
async function run(slot) {
  do {
    try {
      if (slot === 0 && Date.now() >= nextHeartbeat) {
        await transaction(client => client.query(`
          INSERT INTO worker_heartbeats(worker_id,seen_at) VALUES($1,now())
          ON CONFLICT(worker_id) DO UPDATE SET seen_at=excluded.seen_at
        `, [workerId]));
        nextHeartbeat = Date.now() + 15000;
      }
      const worked = await tickWorker(workerId + ':' + slot,{RELEASE_TEST:runReleaseTest});
      if (!worked && !once) await delay(500);
    } catch (error) {
      console.error('Foundation worker error', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WORKER_ERROR');
      if (once) throw new Error('Foundation worker tick failed');
      await delay(2000);
    }
  } while (!stopping && !once);
}
try {
  await Promise.all(Array.from({length:concurrency},(_,slot)=>run(slot)));
} finally {
  await closeDatabase();
}
