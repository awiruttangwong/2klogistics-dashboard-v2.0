import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const netlifySchedule = await readFile('netlify/functions/schedule-supabase-sync.mjs', 'utf8');
const githubWatchdog = await readFile('.github/workflows/production-sync-watchdog.yml', 'utf8');
const releaseVerifier = await readFile('scripts/netlify-release.mjs', 'utf8');
const syncWorker = await readFile('supabase/sync/sync-apps-script-to-supabase.mjs', 'utf8');
const frontend = await readFile('dashboard/scripts/app.js', 'utf8');
const appsScript = await readFile('dashboard/API/Code.gs', 'utf8');
const appsScriptConfig = await readFile('dashboard/API/config.gs', 'utf8');

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
assert.match(
  appsScriptConfig,
  /DAILY_BATCH_RECOVERY_NEAR_MINUTE\s*=\s*30/,
  'Apps Script must schedule a Google-side recovery around 08:30 Asia/Bangkok'
);
assert.match(
  appsScript,
  /function dailyBatchRecoveryJob\(\)/,
  'Apps Script must expose a recovery trigger handler'
);
assert.match(
  appsScript,
  /isSuccessfulDailyBatchToday_\(lastStatus\)/,
  'Apps Script recovery must skip when today\'s batch already succeeded'
);
assert.match(
  appsScript,
  /function dailyBatchRecoveryJob\(\)\s*{\s*return runDailyBatchWithLock_\(true\)/,
  'Apps Script recovery must share the primary batch lock'
);
assert.match(
  appsScript,
  /ScriptApp\.newTrigger\('dailyBatchRecoveryJob'\)/,
  'Apps Script trigger installer must create the recovery trigger'
);

console.log('[pre-nine-recovery] all deadline controls are present');
