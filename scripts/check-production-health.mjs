import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_HEALTH_URL = 'https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api?action=health';

loadDotEnvFile();

const MAX_SYNC_AGE_HOURS = Number.parseFloat(process.env.MAX_SYNC_AGE_HOURS || '36');
const healthUrl = process.env.DASHBOARD_HEALTH_URL || DEFAULT_HEALTH_URL;
const attempts = positiveInt(process.env.HEALTH_CHECK_ATTEMPTS, 3);
const retryDelayMs = positiveInt(process.env.HEALTH_CHECK_RETRY_DELAY_MS, 2000);

main().catch(error => {
  console.error(`[production-health] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  const response = await fetchWithRetry(healthUrl, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  }, { label: 'Health endpoint', attempts, retryDelayMs });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Health endpoint HTTP ${response.status}: ${trim(text)}`);
  }

  const health = text ? JSON.parse(text) : null;
  const elapsedMs = Date.now() - startedAt;
  const failures = [];
  const warnings = [];

  if (!health?.ok) failures.push('health.ok is false');
  if (health?.latestSyncRun?.status !== 'promoted') failures.push(`latest sync status is ${health?.latestSyncRun?.status || 'missing'}`);
  if (Number(health?.latestSyncRun?.rows_failed || 0) !== 0) failures.push(`rows_failed is ${health.latestSyncRun.rows_failed}`);
  if (Number(health?.supabase?.tripsRows || 0) <= 0) failures.push('active trips row count is zero');
  if (health?.checks?.rowsMatchActiveTable === false) failures.push('rows_written does not match trips_active row count');
  if (Number.isFinite(Number(health?.sync?.ageHours)) && Number(health.sync.ageHours) > MAX_SYNC_AGE_HOURS) {
    failures.push(`sync age is ${health.sync.ageHours}h, above ${MAX_SYNC_AGE_HOURS}h`);
  }
  if (Number(health?.dates?.suspiciousDatesBeforeMin || 0) > 0) {
    warnings.push(`${health.dates.suspiciousDatesBeforeMin} date group(s) before ${health.dates.minOperationalDate}; ignored by date picker`);
  }

  const summary = {
    ok: failures.length === 0,
    elapsedMs,
    tripsRows: health?.supabase?.tripsRows || 0,
    syncStatus: health?.latestSyncRun?.status || null,
    syncAgeHours: health?.sync?.ageHours ?? null,
    dateRange: {
      min: health?.dates?.min || null,
      max: health?.dates?.max || null,
    },
    warnings,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    throw new Error(`Production health check failed: ${failures.join('; ')}`);
  }
}

function trim(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

async function fetchWithRetry(url, init, { label, attempts, retryDelayMs }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      const text = await response.text().catch(() => '');
      lastError = new Error(`${label} HTTP ${response.status}: ${trim(text)}`);
      console.warn(`[production-health] ${lastError.message}; retrying ${attempt}/${attempts}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      console.warn(`[production-health] ${label} fetch failed: ${error.message}; retrying ${attempt}/${attempts}`);
    }
    await sleep(retryDelayMs * attempt);
  }
  throw lastError || new Error(`${label} failed`);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
