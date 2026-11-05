import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {closeDatabase, digest, transaction} from './db.mjs';
import {pathToFileURL} from 'node:url';

const location = new URL('./migrations/', import.meta.url);
export async function migrate() {
  const names = (await readdir(location)).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
  return transaction(async client => {
    const {rows: [server]} = await client.query('SHOW server_version_num');
    if (Number(server.server_version_num) < 160000) throw new Error('PostgreSQL 16 or newer is required');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('campus_foundation:migrate'))");
    const priorSchema = await client.query("SELECT to_regnamespace('campus_foundation') AS existing");
    await client.query('CREATE SCHEMA IF NOT EXISTS campus_foundation');
    await client.query('SET LOCAL search_path = campus_foundation');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = [];
    for (const name of names) {
      const source = await readFile(new URL(name, location), 'utf8');
      const normalized = source.replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(normalized).digest('hex');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      // The supplied baseline wraps its own DDL. The outer transaction also records its checksum.
      const ddl = normalized.replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');
      await client.query(ddl);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      applied.push(name);
    }
    if (!priorSchema.rows[0].existing && process.env.APP_MODE === 'demo' && process.env.DEMO_RESET_TOKEN?.length >= 32) {
      await client.query('INSERT INTO foundation_installation VALUES(true,$1)', [digest(process.env.DEMO_RESET_TOKEN)]);
    }
    return applied;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const applied = await migrate();
    console.log(applied.length ? `Applied ${applied.join(', ')}` : 'All foundation migrations already applied');
  } finally {
    await closeDatabase();
  }
}
