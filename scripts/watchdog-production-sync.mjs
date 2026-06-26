import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_HEALTH_URL = 'https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api?action=health';
const DEFAULT_MIN_PROMOTED_HOUR_BANGKOK = 8;
const DEFAULT_MIN_ROW_DELTA_TO_SYNC = 1;
const DEFAULT_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SYNC_ATTEMPTS = 3;
const DEFAULT_SYNC_RETRY_DELAY_MS = 30000;
const DEFAULT_HEALTH_RETRY_ATTEMPTS = 5;
const DEFAULT_HEALTH_RETRY_DELAY_MS = 5000;

const argv = new Set(process.argv.slice(2));
const options = {
  checkOnly: argv.has('--check-only'),
  forceSync: argv.has('--force-sync'),
  help: argv.has('--help') || argv.has('-h'),
};

loadDotEnvFile();

if (options.help) {
  printHelp();
  process.exit(0);
}

main().catch(error => {
  console.error(`[production-sync-watchdog] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  const appsScriptUrl = requiredEnv('APPS_SCRIPT_API_URL');
  const dashboardHealthUrl = process.env.DASHBOARD_HEALTH_URL || DEFAULT_HEALTH_URL;
  const minPromotedHour = positiveInt(process.env.WATCHDOG_MIN_PROMOTED_HOUR_BANGKOK, DEFAULT_MIN_PROMOTED_HOUR_BANGKOK);
  const minRowDelta = positiveInt(process.env.WATCHDOG_MIN_ROW_DELTA_TO_SYNC, DEFAULT_MIN_ROW_DELTA_TO_SYNC);

  const [appsScript, production] = await Promise.all([
    getAppsScriptState(appsScriptUrl),
    getProductionState(dashboardHealthUrl),
  ]);

  const decision = decideSync({
    appsScript,
    production,
    minPromotedHour,
    minRowDelta,
    forceSync: options.forceSync,
  });

  const before = buildReport({ appsScript, production, decision });
  console.log(JSON.stringify({ phase: 'before', ...before }, null, 2));

  if (!decision.shouldSync) {
    console.log('[production-sync-watchdog] production is current; no sync needed.');
    return;
  }

  if (decision.blocked && !options.forceSync) {
    throw new Error(`Production cannot be self-healed safely: ${decision.reasons.join('; ')}`);
  }

  if (options.checkOnly) {
    console.log('[production-sync-watchdog] check-only mode; sync required but not executed.');
    return;
  }

  ensureSyncEnv();
  runSupabaseSync();

  const afterProduction = await getProductionState(dashboardHealthUrl);
  const afterDecision = decideSync({
    appsScript,
    production: afterProduction,
    minPromotedHour,
    minRowDelta,
    forceSync: false,
  });
  const after = buildReport({ appsScript, production: afterProduction, decision: afterDecision });
  console.log(JSON.stringify({ phase: 'after', ...after }, null, 2));

  if (afterDecision.shouldSync) {
    throw new Error(`Production still stale after watchdog sync: ${afterDecision.reasons.join('; ')}`);
  }
}

async function getAppsScriptState(appsScriptUrl) {
  const health = await fetchAppsScriptAction(appsScriptUrl, 'health');
  const trips = await fetchAppsScriptAction(appsScriptUrl, 'trips', {
    page: '0',
    limit: '1',
    fields: 'date,customer,route,vtype,driver,plate,payee,recv,pay,oil,margin',
  });

  const failures = [];
  if (health?.contract?.passed !== true) failures.push('Apps Script contract did not pass');
  if (health?.spreadsheet?.matchesExpected === false) failures.push('Apps Script spreadsheet does not match expected id');
  if (Number(trips?.total || 0) <= 0) failures.push('Apps Script trips total is zero or missing');
  if (!Array.isArray(trips?.trips)) failures.push('Apps Script trips payload is missing trips array');
  if (failures.length) throw new Error(`Apps Script state is not usable: ${failures.join('; ')}`);

  return {
    ok: true,
    tripsTotal: Number(trips.total || 0),
    spreadsheetId: health?.spreadsheet?.id || null,
    spreadsheetName: health?.spreadsheet?.name || null,
    trigger: health?.trigger || null,
    contract: health?.contract || null,
  };
}

function decideSync({ appsScript, production, minPromotedHour, minRowDelta, forceSync }) {
  const reasons = [];
  const blocked = Boolean(production?.unavailable);
  const prodRows = Number(production?.supabase?.tripsRows || 0);
  const rowsWritten = Number(production?.latestSyncRun?.rows_written || 0);
  const sourceRows = Number(appsScript?.tripsTotal || 0);
  const rowDelta = sourceRows - prodRows;
  const promotedAt = production?.latestSyncRun?.promoted_at || null;
  const promotedBangkok = getBangkokParts(promotedAt);
  const nowBangkok = getBangkokParts(new Date().toISOString());
  const promotedAfterTodayCutoff = Boolean(
    promotedBangkok
    && promotedBangkok.date === nowBangkok.date
    && promotedBangkok.hour >= minPromotedHour
  );

  if (forceSync) reasons.push('force-sync requested');
  if (production?.unavailable) {
    reasons.push(`production health unavailable: ${production.error || 'unknown error'}`);
    return {
      shouldSync: true,
      blocked,
      reasons,
      rowDelta,
      promotedAt,
      promotedBangkok,
      nowBangkok,
      sourceRows,
      prodRows: null,
      rowsWritten: null,
    };
  }
  if (!production?.ok) reasons.push('production health is not ok');
  if (production?.latestSyncRun?.status !== 'promoted') reasons.push(`latest sync status is ${production?.latestSyncRun?.status || 'missing'}`);
  if (prodRows <= 0) reasons.push('production active trips row count is zero');
  if (Math.abs(sourceRows - prodRows) >= minRowDelta) {
    reasons.push(`Apps Script tripsTotal (${sourceRows}) differs from Supabase tripsRows (${prodRows})`);
  }
  if (rowsWritten > 0 && prodRows > 0 && rowsWritten !== prodRows) {
    reasons.push(`rows_written (${rowsWritten}) differs from tripsRows (${prodRows})`);
  }
  if (!promotedAfterTodayCutoff) {
    reasons.push(`latest promotion is not after ${String(minPromotedHour).padStart(2, '0')}:00 Asia/Bangkok today`);
  }

  return {
    shouldSync: reasons.length > 0,
    blocked,
    reasons,
    rowDelta,
    promotedAt,
    promotedBangkok,
    nowBangkok,
    sourceRows,
    prodRows,
    rowsWritten,
  };
}

function buildReport({ appsScript, production, decision }) {
  return {
    ok: !decision.shouldSync,
    appsScript: {
      tripsTotal: appsScript.tripsTotal,
      spreadsheetId: appsScript.spreadsheetId,
      triggerHour: appsScript.trigger?.configuredHour ?? null,
      contractPassed: appsScript.contract?.passed ?? null,
    },
    production: {
      ok: production?.ok ?? null,
      unavailable: production?.unavailable ?? false,
      error: production?.error ?? null,
      tripsRows: production?.supabase?.tripsRows ?? null,
      syncStatus: production?.latestSyncRun?.status ?? null,
      rowsWritten: production?.latestSyncRun?.rows_written ?? null,
      promotedAt: production?.latestSyncRun?.promoted_at ?? null,
      maxDate: production?.dates?.max ?? null,
    },
    decision,
  };
}

function ensureSyncEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_API_URL'].filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Cannot run sync; missing required environment variables: ${missing.join(', ')}`);
  }
}

function runSupabaseSync() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run supabase:sync -- --promote']
    : ['run', 'supabase:sync', '--', '--promote'];
  const attempts = positiveInt(process.env.WATCHDOG_SYNC_ATTEMPTS, DEFAULT_SYNC_ATTEMPTS);
  const retryDelayMs = positiveInt(process.env.WATCHDOG_SYNC_RETRY_DELAY_MS, DEFAULT_SYNC_RETRY_DELAY_MS);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[production-sync-watchdog] running supabase sync attempt ${attempt}/${attempts}`);
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: positiveInt(process.env.WATCHDOG_SYNC_TIMEOUT_MS, DEFAULT_SYNC_TIMEOUT_MS),
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) lastError = result.error;
    else if (result.status !== 0) lastError = new Error(`supabase:sync exited with status ${result.status}`);
    else return;

    if (attempt < attempts) {
      console.warn(`[production-sync-watchdog] sync attempt ${attempt}/${attempts} failed: ${lastError.message}`);
      sleepSync(retryDelayMs * attempt);
    }
  }

  throw lastError || new Error('supabase:sync failed');
}

async function fetchAppsScriptAction(appsScriptUrl, action, params = {}) {
  const url = new URL(appsScriptUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJson(url, `Apps Script action=${action}`);
}

async function getProductionState(dashboardHealthUrl) {
  try {
    return await fetchJson(dashboardHealthUrl, 'production health');
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      error: trim(error.message),
      latestSyncRun: null,
      supabase: { tripsRows: 0 },
      sync: null,
      dates: null,
      checks: null,
    };
  }
}

async function fetchJson(urlLike, label) {
  const attempts = positiveInt(process.env.WATCHDOG_HEALTH_RETRY_ATTEMPTS, DEFAULT_HEALTH_RETRY_ATTEMPTS);
  const retryDelayMs = positiveInt(process.env.WATCHDOG_HEALTH_RETRY_DELAY_MS, DEFAULT_HEALTH_RETRY_DELAY_MS);
  const response = await fetchWithRetry(urlLike, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  }, { label, attempts, retryDelayMs });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${trim(text)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${trim(text)}`);
  }
}

async function fetchWithRetry(urlLike, init, { label, attempts, retryDelayMs }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(urlLike, init);
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      const text = await response.text().catch(() => '');
      lastError = new Error(`${label} HTTP ${response.status}: ${trim(text)}`);
      console.warn(`[production-sync-watchdog] ${lastError.message}; retrying ${attempt}/${attempts}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      console.warn(`[production-sync-watchdog] ${label} fetch failed: ${error.message}; retrying ${attempt}/${attempts}`);
    }
    await sleep(retryDelayMs * attempt);
  }
  throw lastError || new Error(`${label} failed`);
}

function getBangkokParts(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function loadDotEnvFile(filePath = '.env') {
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) return;
  const text = readFileSync(resolved, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trim(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`
Usage:
  node scripts/watchdog-production-sync.mjs [--check-only] [--force-sync]

Behavior:
  - Reads Apps Script health/trips total.
  - Reads production Supabase API health.
  - Runs npm run supabase:sync -- --promote when production is stale.
  - Re-checks production health after sync and fails if it is still stale.

Environment:
  APPS_SCRIPT_API_URL
  DASHBOARD_HEALTH_URL=https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api?action=health
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  WATCHDOG_MIN_PROMOTED_HOUR_BANGKOK=8
  WATCHDOG_MIN_ROW_DELTA_TO_SYNC=1
  WATCHDOG_SYNC_TIMEOUT_MS=1800000
  WATCHDOG_SYNC_ATTEMPTS=3
  WATCHDOG_SYNC_RETRY_DELAY_MS=30000
  WATCHDOG_HEALTH_RETRY_ATTEMPTS=5
  WATCHDOG_HEALTH_RETRY_DELAY_MS=5000
`.trim());
}
