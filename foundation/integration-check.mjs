import {spawnSync} from 'node:child_process';

if (!process.env.FOUNDATION_TEST_DATABASE_URL) {
  console.error('Set FOUNDATION_TEST_DATABASE_URL to a disposable PostgreSQL test cluster');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath,['--test','tests/foundation*.test.mjs'],{stdio:'inherit',windowsHide:true});
  process.exitCode = result.status ?? 1;
}
