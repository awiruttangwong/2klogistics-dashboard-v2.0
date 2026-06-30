import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const wrapper = resolve('supabase/cli/run-supabase-cli.mjs');
const baseEnv = { ...process.env };
for (const key of ['SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
  delete baseEnv[key];
}

const duplicateDir = mkdtempSync(resolve(tmpdir(), 'supabase-cli-duplicate-'));
const mismatchDir = mkdtempSync(resolve(tmpdir(), 'supabase-cli-mismatch-'));

try {
  writeFileSync(resolve(duplicateDir, '.env'), 'SUPABASE_PROJECT_REF=first\nSUPABASE_PROJECT_REF=second\n');
  const duplicate = spawnSync(process.execPath, [wrapper, 'help'], {
    cwd: duplicateDir,
    env: baseEnv,
    encoding: 'utf8',
  });
  assert.notEqual(duplicate.status, 0, 'duplicate .env keys must fail before any CLI command');
  assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /duplicate \.env keys are not allowed/);

  writeFileSync(resolve(mismatchDir, '.env'), [
    'SUPABASE_PROJECT_REF=project-a',
    'SUPABASE_URL=https://project-b.supabase.co',
    'SUPABASE_ACCESS_TOKEN=test-token',
    'SUPABASE_DB_PASSWORD=test-password',
    '',
  ].join('\n'));
  const mismatch = spawnSync(process.execPath, [wrapper, 'db', 'push', '--dry-run'], {
    cwd: mismatchDir,
    env: baseEnv,
    encoding: 'utf8',
  });
  assert.notEqual(mismatch.status, 0, 'project ref mismatch must fail before Supabase CLI starts');
  assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /SUPABASE_PROJECT_REF does not match SUPABASE_URL/);

  console.log('[supabase-cli-guard] all tests passed');
} finally {
  rmSync(duplicateDir, { recursive: true, force: true });
  rmSync(mismatchDir, { recursive: true, force: true });
}
