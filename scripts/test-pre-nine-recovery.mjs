import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const netlifySchedule = await readFile('netlify/functions/schedule-supabase-sync.mjs', 'utf8');
const githubWatchdog = await readFile('.github/workflows/production-sync-watchdog.yml', 'utf8');
const releaseVerifier = await readFile('scripts/netlify-release.mjs', 'utf8');
const syncWorker = await readFile('supabase/sync/sync-apps-script-to-supabase.mjs', 'utf8');
const frontend = await readFile('dashboard/scripts/app.js', 'utf8');

assert.match(
  netlifySchedule,
  /schedule:\s*['"]20,30,40,50 1 \* \* \*['"]/,
  'Netlify must retry at 08:20, 08:30, 08:40, and 08:50 Asia/Bangkok'
);
assert.match(
  githubWatchdog,
  /cron:\s*['"]47 1 \* \* \*['"]/,
  'GitHub must provide an independent pre-deadline recovery at 08:47 Asia/Bangkok'
);
assert.match(
  githubWatchdog,
  /cron:\s*['"]17 3 \* \* \*['"]/,
  'GitHub must retain the late 10:17 recovery run'
);
assert.match(
  releaseVerifier,
  /cron:\s*['"]20,30,40,50 1 \* \* \*['"]/,
  'Netlify release verification must enforce the complete pre-deadline schedule'
);
assert.match(
  syncWorker,
  /acquire_sync_lease/,
  'Repeated recovery must acquire a distributed lease before mutating staging'
);
assert.match(
  syncWorker,
  /release_sync_lease/,
  'Repeated recovery must release its distributed lease'
);
assert.match(
  frontend,
  /initializeApiFreshnessRouting/,
  'Frontend must check production freshness before choosing Supabase'
);
assert.match(
  frontend,
  /preferAppsScript/,
  'Frontend must prefer Apps Script when today\'s Supabase snapshot is stale'
);

console.log('[pre-nine-recovery] all deadline controls are present');
