import {randomUUID} from 'node:crypto';
import pg from 'pg';

export const foundationTestUrl = process.env.FOUNDATION_TEST_DATABASE_URL;
export const missingFoundationTestDb = foundationTestUrl ? false : 'Set FOUNDATION_TEST_DATABASE_URL to a disposable PostgreSQL 16+ cluster';

export async function isolatedFoundation(t) {
  const name = `foundation_it_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({connectionString: foundationTestUrl, connectionTimeoutMillis: 4000});
  const previous = process.env.DATABASE_URL;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const url = new URL(foundationTestUrl);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.href;
  const database = await import('../foundation/db.mjs');
  t.after(async () => {
    try {
      await database.closeDatabase();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
  const {migrate} = await import('../foundation/migrate.mjs');
  return {migrate, transaction: database.transaction, url};
}

export function oneSuccessful(results, errorCode) {
  const failures = results.filter(result => result.status === 'rejected');
  if (results.filter(result => result.status === 'fulfilled').length !== 1 || failures.length !== 1) {
    throw new Error('Expected exactly one concurrent write to succeed');
  }
  if (failures[0].reason.code !== errorCode) throw failures[0].reason;
}
