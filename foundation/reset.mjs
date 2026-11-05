import {closeDatabase, digest, transaction} from './db.mjs';
import {migrate} from './migrate.mjs';
import {seed} from './seed.mjs';

try {
  if (process.env.APP_MODE !== 'demo' || !process.argv.includes('--confirm') ||
      !(process.env.DEMO_RESET_TOKEN?.length >= 32)) {
    throw new Error('Reset requires demo mode, an installation reset token and --confirm');
  }
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('campus_foundation:migrate'))");
    const marker = await client.query('SELECT reset_token_hash FROM foundation_installation WHERE singleton');
    if (marker.rows[0]?.reset_token_hash !== digest(process.env.DEMO_RESET_TOKEN)) {
      throw new Error('This database has no matching demo installation marker');
    }
    const sensitive = await client.query(`
      SELECT 1 FROM environments WHERE mode <> 'DEMO'
      UNION ALL SELECT 1 FROM connections WHERE mode <> 'DEMO'
    `);
    if (sensitive.rowCount) throw new Error('Reset blocked by non-demo configuration');
    await client.query('DROP SCHEMA campus_foundation CASCADE');
  });
  await migrate();
  await seed();
  console.log('Reset the marked demo foundation schema');
} finally {
  await closeDatabase();
}
