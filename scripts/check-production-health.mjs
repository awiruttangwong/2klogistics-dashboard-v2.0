const DEFAULT_HEALTH_URL = 'https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api?action=health';
const MAX_SYNC_AGE_HOURS = Number.parseFloat(process.env.MAX_SYNC_AGE_HOURS || '36');

const healthUrl = process.env.DASHBOARD_HEALTH_URL || DEFAULT_HEALTH_URL;

main().catch(error => {
  console.error(`[production-health] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  const response = await fetch(healthUrl, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
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
