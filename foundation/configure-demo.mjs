import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('Set DATABASE_URL for the dedicated PostgreSQL demo database first');
const parsed = new URL(dbUrl);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) {
  throw new Error('The demo configuration generator requires a loopback PostgreSQL URL');
}
const secrets = ['SESSION_SECRET','CREDENTIAL_ENCRYPTION_KEY','DEMO_RESET_TOKEN'];
const callbackNames = ['ALPHA','BETA'].flatMap(school =>
  ['LIBRARY','ENERGY','LOCKER'].map(adapter => `FOUNDATION_CALLBACK_${school}_${adapter}`));
const content = [
  'APP_MODE=demo', 'PORT=3015', 'APP_BASE_URL=http://localhost:3015', 'WORKER_ID=foundation-local',
  'DB_PATH=storage/foundation-portal.db',
  'DATABASE_URL=' + JSON.stringify(dbUrl), 'ADAPTER_SECRET_ALLOWLIST=' + callbackNames.join(','),
  ...[...secrets,...callbackNames].map(name => name + '=' + randomBytes(32).toString('hex'))
].join('\n') + '\n';
await writeFile('.env.foundation', content, {flag:'wx',mode:0o600});
console.log('Created .env.foundation with independent DEMO secrets');
