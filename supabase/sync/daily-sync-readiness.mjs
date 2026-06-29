const BANGKOK_TIMEZONE = 'Asia/Bangkok';

export function bangkokDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function sourceBatchReadyToday(source, nowIso = new Date().toISOString()) {
  const batch = source?.lastDailyBatchJob;
  if (!batch?.ok || batch?.contractPassed !== true) return false;
  if (!batch.finishedAt || bangkokDate(batch.finishedAt) !== bangkokDate(nowIso)) return false;
  if (Array.isArray(batch.errors) && batch.errors.length > 0) return false;
  if (Array.isArray(batch.syncErrors) && batch.syncErrors.length > 0) return false;
  return Number(source?.tripsTotal || 0) > 0;
}

export function productionContainsBatch(source, production) {
  const batchFinishedAt = Date.parse(source?.lastDailyBatchJob?.finishedAt || '');
  const promotedAt = Date.parse(production?.latestSyncRun?.promoted_at || '');
  const sourceRows = Number(source?.tripsTotal || 0);
  const productionRows = Number(production?.supabase?.tripsRows || 0);
  return Boolean(
    production?.ok
    && production?.latestSyncRun?.status === 'promoted'
    && Number.isFinite(batchFinishedAt)
    && Number.isFinite(promotedAt)
    && promotedAt >= batchFinishedAt
    && sourceRows > 0
    && sourceRows === productionRows
  );
}
