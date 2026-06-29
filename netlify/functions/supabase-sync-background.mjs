import { timingSafeEqual } from 'node:crypto';

import {
  productionContainsBatch,
  sourceBatchReadyToday,
} from '../../supabase/sync/daily-sync-readiness.mjs';
import { runSupabaseSync } from '../../supabase/sync/sync-apps-script-to-supabase.mjs';

const DEFAULT_READY_WAIT_MS = 8 * 60 * 1000;
const DEFAULT_READY_POLL_MS = 30 * 1000;

export default async function handler(request) {
  if (request.method !== 'POST' || !isAuthorized(request)) {
    console.warn('[netlify-background-sync] ignored unauthorized invocation');
    return;
  }

  const source = await waitForSuccessfulSourceBatch();
  const before = await fetchProductionHealth();
  if (productionContainsBatch(source, before)) {
    console.log('[netlify-background-sync] production already contains today\'s completed Apps Script batch');
    return;
  }

  console.log(JSON.stringify({
    event: 'sync-start',
    sourceRows: source.tripsTotal,
    sourceBatchFinishedAt: source.lastDailyBatchJob.finishedAt,
    productionRows: before?.supabase?.tripsRows ?? null,
    productionPromotedAt: before?.latestSyncRun?.promoted_at ?? null,
  }));

  const syncResult = await runSupabaseSync({ dryRun: false, promote: true, verbose: false });
  if (syncResult?.status === 'skipped-locked') {
    console.log('[netlify-background-sync] another recovery worker is already syncing this batch');
    return;
  }

  const after = await fetchProductionHealth();
  if (!productionContainsBatch(source, after)) {
    throw new Error('Supabase sync completed but production does not contain the latest Apps Script batch');
  }

  console.log(JSON.stringify({
    event: 'sync-complete',
    rows: after.supabase.tripsRows,
    promotedAt: after.latestSyncRun.promoted_at,
  }));
}

export const config = {
  background: true,
};

async function waitForSuccessfulSourceBatch() {
  const waitMs = nonNegativeInt(process.env.NETLIFY_SYNC_READY_WAIT_MS, DEFAULT_READY_WAIT_MS);
  const pollMs = positiveInt(process.env.NETLIFY_SYNC_READY_POLL_MS, DEFAULT_READY_POLL_MS);
  const deadline = Date.now() + waitMs;
  let lastSource = null;

  while (true) {
    lastSource = await fetchSourceState();
    if (sourceBatchReadyToday(lastSource)) return lastSource;
    if (Date.now() >= deadline) {
      const batch = lastSource?.lastDailyBatchJob;
      throw new Error(
        `Apps Script batch is not ready today (ok=${batch?.ok ?? null}, finishedAt=${batch?.finishedAt || 'missing'})`
      );
    }
    console.log('[netlify-background-sync] waiting for today\'s successful Apps Script batch');
    await sleep(pollMs);
  }
}

async function fetchSourceState() {
  const appsScriptUrl = requiredEnv('APPS_SCRIPT_API_URL');
  const [health, trips] = await Promise.all([
    fetchAppsScript(appsScriptUrl, 'health'),
    fetchAppsScript(appsScriptUrl, 'trips', {
      page: '0',
      limit: '1',
      fields: 'date',
    }),
  ]);
  return {
    lastDailyBatchJob: health?.lastDailyBatchJob || null,
    tripsTotal: Number(trips?.total || 0),
  };
}

async function fetchAppsScript(baseUrl, action, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJson(url, `Apps Script action=${action}`);
}

async function fetchProductionHealth() {
  const siteUrl = requiredEnv('URL').replace(/\/+$/, '');
  return fetchJson(
    `${siteUrl}/.netlify/functions/supabase-api?action=health`,
    'production health'
  );
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${trim(text)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON: ${trim(text)}`);
  }
}

function isAuthorized(request) {
  const expected = requiredEnv('NETLIFY_SYNC_TRIGGER_SECRET');
  const provided = request.headers.get('x-sync-token') || '';
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
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

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function trim(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
