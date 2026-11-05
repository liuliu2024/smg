import {randomBytes, randomUUID} from 'node:crypto';
import {isolatedFoundation} from './foundation-harness.mjs';

export async function demoFoundation(t) {
  const db = await isolatedFoundation(t);
  const origin = 'http://localhost:3998';
  const url = new URL(`${origin}/api/v1/foundation`);
  process.env.APP_MODE = 'demo';
  process.env.APP_BASE_URL = origin;
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  const {seed, demoSecretName} = await import('../foundation/seed.mjs');
  const {assets} = await import('../foundation/runtime/index.mjs');
  const names = ['alpha','beta'].flatMap(school => assets.packages.map(pkg => demoSecretName(school, pkg.code)));
  for (const name of names) process.env[name] = randomBytes(32).toString('hex');
  process.env.ADAPTER_SECRET_ALLOWLIST = names.join(',');
  await db.migrate();
  await seed();
  const {demoLogin, authenticate, switchRole} = await import('../foundation/auth.mjs');

  async function session(schoolCode, account) {
    let cookie;
    const identity = await demoLogin({schoolCode, account}, {headers: {origin}}, {
      setHeader(name, value) { if (name === 'Set-Cookie') cookie = value.split(';')[0]; }
    }, randomUUID());
    const request = {method: 'POST', headers: {cookie, origin, 'x-csrf-token': identity.csrfToken}};
    return {
      context() { return authenticate(request, url, randomUUID()); },
      async switch(role) { await switchRole(await authenticate(request, url, randomUUID()), role, url); }
    };
  }
  return {...db, session, assets, origin, requestUrl: url, seed};
}
