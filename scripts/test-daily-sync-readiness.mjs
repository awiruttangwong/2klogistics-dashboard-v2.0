import assert from 'node:assert/strict';

import {
  bangkokDate,
  productionContainsBatch,
  sourceBatchReadyToday,
} from '../supabase/sync/daily-sync-readiness.mjs';

const now = '2026-06-29T02:00:00.000Z';
const source = {
  tripsTotal: 43963,
  lastDailyBatchJob: {
    ok: true,
    contractPassed: true,
    finishedAt: '2026-06-29T01:07:30.661Z',
    errors: [],
    syncErrors: [],
  },
};

assert.equal(bangkokDate(now), '2026-06-29');
assert.equal(sourceBatchReadyToday(source, now), true);
assert.equal(sourceBatchReadyToday({
  ...source,
  lastDailyBatchJob: { ...source.lastDailyBatchJob, ok: false },
}, now), false);
assert.equal(sourceBatchReadyToday({
  ...source,
  lastDailyBatchJob: { ...source.lastDailyBatchJob, finishedAt: '2026-06-28T01:07:30.661Z' },
}, now), false);
assert.equal(sourceBatchReadyToday({
  ...source,
  lastDailyBatchJob: { ...source.lastDailyBatchJob, syncErrors: ['M6 failed'] },
}, now), false);

const currentProduction = {
  ok: true,
  latestSyncRun: {
    status: 'promoted',
    promoted_at: '2026-06-29T01:10:00.000Z',
  },
  supabase: { tripsRows: 43963 },
};

assert.equal(productionContainsBatch(source, currentProduction), true);
assert.equal(productionContainsBatch(source, {
  ...currentProduction,
  latestSyncRun: { ...currentProduction.latestSyncRun, promoted_at: '2026-06-29T01:00:00.000Z' },
}), false);
assert.equal(productionContainsBatch(source, {
  ...currentProduction,
  supabase: { tripsRows: 43755 },
}), false);

console.log('[daily-sync-readiness] all tests passed');
