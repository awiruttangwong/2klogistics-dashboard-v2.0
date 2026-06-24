import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PAGE_LIMIT = 5000;
const DEFAULT_TIMEOUT_MS = 60000;
const CENT_TOLERANCE = 0.01;

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APPS_SCRIPT_API_URL',
];

const argv = new Set(process.argv.slice(2));
const options = {
  dryRun: argv.has('--dry-run'),
  promote: argv.has('--promote'),
  verbose: argv.has('--verbose'),
  help: argv.has('--help') || argv.has('-h'),
};

loadDotEnvFile();

if (options.help) {
  printHelp();
  process.exit(0);
}

main().catch(error => {
  console.error(`[supabase-sync] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  assertRuntime();
  assertEnv(options);

  const config = {
    supabaseUrl: stripTrailingSlash(process.env.SUPABASE_URL || ''),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    appsScriptApiUrl: process.env.APPS_SCRIPT_API_URL,
    batchSize: positiveInt(process.env.SUPABASE_SYNC_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    pageLimit: Math.min(positiveInt(process.env.APPS_SCRIPT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT), 5000),
    timeoutMs: positiveInt(process.env.SYNC_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };

  console.log('[supabase-sync] mode:', options.dryRun ? 'dry-run' : 'write-staging');
  console.log('[supabase-sync] promote:', options.promote ? 'yes' : 'no');

  const startedAt = new Date().toISOString();
  const [summaryPayload, oilPayload, trips] = await Promise.all([
    fetchAppsScriptJson(config, 'summary'),
    fetchAppsScriptJson(config, 'oil'),
    fetchAllTrips(config),
  ]);

  const prepared = prepareTrips(trips);
  const localParity = buildParitySummary(prepared.rows);
  const summaryContractErrors = validateSummaryPayload(summaryPayload, localParity);
  const tripContractErrors = prepared.contractErrors;
  const contractErrors = summaryContractErrors.concat(tripContractErrors);
  const summaryHash = sha256(canonicalJson(summaryPayload));
  const sourceMonths = [...new Set(prepared.rows.map(row => row.source_month).filter(Boolean))].sort();

  console.log(`[supabase-sync] apps-script trips: ${trips.length}`);
  console.log(`[supabase-sync] prepared staging rows: ${prepared.rows.length}`);
  console.log(`[supabase-sync] contract errors: ${contractErrors.length}`);

  if (options.dryRun) {
    console.log('[supabase-sync] dry-run finished before Supabase writes');
    console.log(JSON.stringify({
      tripsRead: trips.length,
      stagingRows: prepared.rows.length,
      sourceMonths,
      summaryHash,
      localTotals: omitGroupRows(localParity),
      dailyGroupCount: localParity.daily.length,
      routeGroupCount: localParity.route.length,
      contractErrorCount: contractErrors.length,
      contractErrors: contractErrors.slice(0, 20),
      ...(options.verbose ? { localParity } : {}),
    }, null, 2));
    return;
  }

  const syncRun = await createSyncRun(config, {
    started_at: startedAt,
    status: 'running',
    source_months: sourceMonths,
    rows_read: trips.length,
    rows_written: 0,
    rows_failed: tripContractErrors.length,
    app_version: 'v3-shadow-sync',
  });

  let finalStatus = 'failed';
  let rowsWritten = 0;

  try {
    await upsertSummarySnapshot(config, syncRun.id, summaryHash, summaryPayload);
    await upsertOilPrices(config, oilPayload);
    const stagingRows = prepared.rows.map(row => ({ ...row, sync_run_id: syncRun.id }));
    rowsWritten = await upsertStagingTrips(config, stagingRows);

    const dbParity = await rpc(config, 'get_staging_parity_summary', { p_sync_run_id: syncRun.id });
    const parityReport = buildParityReport(syncRun.id, localParity, dbParity, contractErrors);
    await insertParityReport(config, parityReport);

    finalStatus = parityReport.ok ? 'success' : 'parity_failed';
    await updateSyncRun(config, syncRun.id, {
      status: finalStatus,
      finished_at: new Date().toISOString(),
      rows_written: rowsWritten,
      rows_failed: tripContractErrors.length,
      error_message: parityReport.ok ? null : 'Parity report failed. Inspect public.parity_reports for details.',
    });

    console.log(`[supabase-sync] parity: ${parityReport.ok ? 'PASS' : 'FAIL'}`);
    console.log(`[supabase-sync] sync_run_id: ${syncRun.id}`);

    if (options.promote) {
      if (!parityReport.ok) {
        throw new Error('Refusing to promote because parity failed.');
      }
      await rpc(config, 'promote_sync_run', { p_sync_run_id: syncRun.id });
      console.log(`[supabase-sync] promoted sync_run_id: ${syncRun.id}`);
    } else {
      console.log('[supabase-sync] staging only. Re-run with --promote after reviewing parity if you want to activate this run.');
    }
  } catch (error) {
    await updateSyncRun(config, syncRun.id, {
      status: finalStatus === 'parity_failed' ? 'parity_failed' : 'failed',
      finished_at: new Date().toISOString(),
      rows_written: rowsWritten,
      rows_failed: Math.max(tripContractErrors.length, trips.length - rowsWritten),
      error_message: trimMessage(error.message),
    }).catch(updateError => {
      console.error(`[supabase-sync] failed to update sync_runs after error: ${updateError.message}`);
    });
    throw error;
  }
}

function assertRuntime() {
  if (typeof fetch !== 'function') {
    throw new Error('This sync service requires Node.js 18+ because it uses global fetch().');
  }
}

function assertEnv(currentOptions) {
  const required = currentOptions.dryRun ? ['APPS_SCRIPT_API_URL'] : REQUIRED_ENV;
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill server-side values.`);
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run supabase:sync -- [--dry-run] [--promote] [--verbose]

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  APPS_SCRIPT_API_URL
  SUPABASE_SYNC_BATCH_SIZE=500
  APPS_SCRIPT_PAGE_LIMIT=5000
  SYNC_REQUEST_TIMEOUT_MS=60000

Notes:
  - Default mode writes only trips_staging, summary_snapshots, oil_prices, sync_runs, and parity_reports.
  - It does not touch Dashboard/API/Code.gs.
  - It promotes to trips_active only when --promote is provided and parity passes.
  - --verbose includes full local daily/route parity output during dry-run.
`.trim());
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

async function fetchAllTrips(config) {
  const trips = [];
  let page = 0;
  let total = null;
  let hasMore = true;

  while (hasMore) {
    const payload = await fetchAppsScriptJson(config, 'trips', {
      page: String(page),
      limit: String(config.pageLimit),
    });

    if (payload.error) throw new Error(`Apps Script trips endpoint returned error: ${payload.error}`);
    if (!Array.isArray(payload.trips)) throw new Error('Apps Script trips endpoint returned invalid shape: trips is not an array.');

    trips.push(...payload.trips);
    total = typeof payload.total === 'number' ? payload.total : total;
    hasMore = !!payload.hasMore;
    page += 1;

    console.log(`[supabase-sync] fetched trips page ${page}: ${trips.length}${total !== null ? ` / ${total}` : ''}`);

    if (page > 10000) {
      throw new Error('Refusing to continue after 10000 pages; check APPS_SCRIPT_PAGE_LIMIT or endpoint pagination.');
    }
  }

  if (total !== null && trips.length !== total) {
    throw new Error(`Apps Script trips pagination mismatch: fetched ${trips.length}, endpoint total ${total}.`);
  }

  return trips;
}

async function fetchAppsScriptJson(config, action, params = {}) {
  const url = new URL(config.appsScriptApiUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJsonWithRetry(url, {
    timeoutMs: config.timeoutMs,
    label: `Apps Script action=${action}`,
  });
}

async function fetchJsonWithRetry(url, { timeoutMs, label, init = {}, attempts = 3 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${label} HTTP ${response.status}: ${trimMessage(text)}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

function prepareTrips(trips) {
  const seen = new Map();
  const rows = [];
  const contractErrors = [];

  trips.forEach((trip, index) => {
    try {
      const sourceMonth = textOrNull(trip.sourceMonth || trip.source_month);
      const routeKey = textOrNull(trip.routeKey || trip.route_key) || textOrNull(trip.route) || '-';
      const date = normalizeDate(trip.date);
      if (!date) throw new Error('date is required');

      const identityBaseKey = canonicalIdentity([
        date,
        trip.customer,
        trip.vtype,
        routeKey,
        trip.route,
        trip.routeDesc || trip.route_desc,
        trip.driver,
        trip.plate,
        trip.payee,
        sourceMonth || '',
      ]);
      const ordinal = (seen.get(identityBaseKey) || 0) + 1;
      seen.set(identityBaseKey, ordinal);
      const rowIdentityKey = `${sha256(identityBaseKey)}-${ordinal}`;

      rows.push({
        sync_run_id: null,
        row_identity_key: rowIdentityKey,
        identity_base_key: identityBaseKey,
        identity_ordinal: ordinal,
        payload_hash: sha256(canonicalJson(normalizeTripForHash(trip))),
        source_month: sourceMonth,
        date,
        customer: textOrEmpty(trip.customer),
        vtype: textOrNull(trip.vtype),
        route_desc: textOrNull(trip.routeDesc || trip.route_desc),
        route: textOrEmpty(trip.route),
        route_key: routeKey,
        route_core: textOrNull(trip.routeCore || trip.route_core),
        route_vehicle: textOrNull(trip.routeVehicle || trip.route_vehicle),
        route_prefix: textOrNull(trip.routePrefix || trip.route_prefix),
        route_group: textOrNull(trip.routeGroup || trip.route_group),
        is_flash_route: Boolean(trip.isFlashRoute || trip.is_flash_route),
        driver: textOrNull(trip.driver),
        plate: textOrNull(trip.plate),
        payee: textOrNull(trip.payee),
        oil: money(trip.oil),
        recv: money(trip.recv),
        pay: money(trip.pay),
        margin: money(trip.margin),
        pct: nullableNumber(trip.pct),
        reason: textOrNull(trip.reason),
        anomalies: Array.isArray(trip.anomalies) ? trip.anomalies : [],
        raw_payload: trip && typeof trip === 'object' ? trip : {},
      });
    } catch (error) {
      contractErrors.push({
        index,
        message: error.message,
        sample: safeSample(trip),
      });
    }
  });

  return { rows, contractErrors };
}

function normalizeTripForHash(trip) {
  return {
    date: normalizeDate(trip.date),
    customer: textOrEmpty(trip.customer),
    vtype: textOrNull(trip.vtype),
    routeDesc: textOrNull(trip.routeDesc || trip.route_desc),
    route: textOrEmpty(trip.route),
    routeKey: textOrNull(trip.routeKey || trip.route_key),
    routeCore: textOrNull(trip.routeCore || trip.route_core),
    routeVehicle: textOrNull(trip.routeVehicle || trip.route_vehicle),
    routePrefix: textOrNull(trip.routePrefix || trip.route_prefix),
    routeGroup: textOrNull(trip.routeGroup || trip.route_group),
    isFlashRoute: Boolean(trip.isFlashRoute || trip.is_flash_route),
    driver: textOrNull(trip.driver),
    plate: textOrNull(trip.plate),
    payee: textOrNull(trip.payee),
    oil: money(trip.oil),
    recv: money(trip.recv),
    pay: money(trip.pay),
    margin: money(trip.margin),
    pct: nullableNumber(trip.pct),
    reason: textOrNull(trip.reason),
    anomalies: Array.isArray(trip.anomalies) ? trip.anomalies : [],
    sourceMonth: textOrNull(trip.sourceMonth || trip.source_month),
  };
}

async function createSyncRun(config, payload) {
  const rows = await supabaseRest(config, '/rest/v1/sync_runs', {
    method: 'POST',
    body: payload,
    prefer: 'return=representation',
  });
  if (!Array.isArray(rows) || !rows[0]?.id) throw new Error('Supabase did not return sync_runs.id.');
  return rows[0];
}

async function updateSyncRun(config, id, patch) {
  await supabaseRest(config, '/rest/v1/sync_runs', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: patch,
    prefer: 'return=minimal',
  });
}

async function upsertSummarySnapshot(config, syncRunId, payloadHash, payload) {
  await supabaseRest(config, '/rest/v1/summary_snapshots', {
    method: 'POST',
    query: { on_conflict: 'sync_run_id' },
    body: [{ sync_run_id: syncRunId, payload_hash: payloadHash, payload, is_active: false }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

async function upsertOilPrices(config, oilPayload) {
  const prices = Array.isArray(oilPayload?.prices) ? oilPayload.prices : [];
  if (!prices.length) return 0;
  const rows = prices.map(price => ({
    period_no: textOrEmpty(price.period_no),
    period_name: normalizeDate(price.period_name),
    year_en: positiveInt(price.year_en, Number(String(price.period_name || '').slice(0, 4)) || new Date().getFullYear()),
    update_date: price.update_date || `${normalizeDate(price.period_name)}T00:00:00.000Z`,
    price: money(price.price),
    source: oilPayload.source || 'PTTOR',
    source_url: oilPayload.sourceUrl || oilPayload.source_url || null,
  })).filter(row => row.period_no && row.period_name);

  for (const batch of chunks(rows, config.batchSize)) {
    await supabaseRest(config, '/rest/v1/oil_prices', {
      method: 'POST',
      query: { on_conflict: 'period_no' },
      body: batch,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  return rows.length;
}

async function upsertStagingTrips(config, rows) {
  let written = 0;
  for (const batch of chunks(rows, config.batchSize)) {
    await supabaseRest(config, '/rest/v1/trips_staging', {
      method: 'POST',
      query: { on_conflict: 'sync_run_id,row_identity_key' },
      body: batch,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    written += batch.length;
    console.log(`[supabase-sync] upserted staging rows: ${written} / ${rows.length}`);
  }
  return written;
}

async function insertParityReport(config, report) {
  await supabaseRest(config, '/rest/v1/parity_reports', {
    method: 'POST',
    body: report,
    prefer: 'return=minimal',
  });
}

async function rpc(config, name, payload) {
  return supabaseRest(config, `/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: payload,
  });
}

async function supabaseRest(config, path, { method, query = {}, body, prefer }) {
  const url = new URL(`${config.supabaseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const { status, ok, text } = await fetchTextWithRetry(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, {
    timeoutMs: config.timeoutMs,
    label: `Supabase ${method} ${path}`,
  });

  if (!ok) {
    throw new Error(`Supabase ${method} ${path} HTTP ${status}: ${trimMessage(text)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchTextWithRetry(url, init, { timeoutMs, label, attempts = 5 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok && shouldRetryHttp(response.status) && attempt < attempts) {
        lastError = new Error(`${label} HTTP ${response.status}: ${trimMessage(text)}`);
        await sleep(750 * attempt);
        continue;
      }
      return { status: response.status, ok: response.ok, text };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(750 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

function shouldRetryHttp(status) {
  return status === 408 || status === 429 || status >= 500;
}

function buildParitySummary(rows) {
  const totals = {
    trip_count: rows.length,
    recv_sum: 0,
    pay_sum: 0,
    oil_sum: 0,
    margin_sum: 0,
  };
  const daily = new Map();
  const route = new Map();

  for (const row of rows) {
    addMoneyTotals(totals, row);
    addGroup(daily, row.date, row);
    addGroup(route, row.route_key, row);
  }

  return {
    ...roundTotals(totals),
    daily: [...daily.values()].sort(compareByKey('date')).map(roundTotals),
    route: [...route.values()].sort(compareByKey('route_key')).map(roundTotals),
  };
}

function addGroup(map, key, row) {
  const normalizedKey = key || '-';
  let group = map.get(normalizedKey);
  if (!group) {
    group = {
      trip_count: 0,
      recv_sum: 0,
      pay_sum: 0,
      oil_sum: 0,
      margin_sum: 0,
    };
    if (row.date === normalizedKey) group.date = normalizedKey;
    else group.route_key = normalizedKey;
    map.set(normalizedKey, group);
  }
  group.trip_count += 1;
  addMoneyTotals(group, row);
}

function addMoneyTotals(target, row) {
  target.recv_sum += money(row.recv);
  target.pay_sum += money(row.pay);
  target.oil_sum += money(row.oil);
  target.margin_sum += money(row.margin);
}

function buildParityReport(syncRunId, local, db, contractErrors) {
  const normalizedDb = normalizeDbParity(db);
  const dailyDiff = diffGroups(local.daily, normalizedDb.daily, 'date');
  const routeDiff = diffGroups(local.route, normalizedDb.route, 'route_key');
  const tripCountDiff = normalizedDb.trip_count - local.trip_count;
  const recvDiff = round2(normalizedDb.recv_sum - local.recv_sum);
  const payDiff = round2(normalizedDb.pay_sum - local.pay_sum);
  const oilDiff = round2(normalizedDb.oil_sum - local.oil_sum);
  const marginDiff = round2(normalizedDb.margin_sum - local.margin_sum);
  const ok = contractErrors.length === 0
    && tripCountDiff === 0
    && almostZero(recvDiff)
    && almostZero(payDiff)
    && almostZero(oilDiff)
    && almostZero(marginDiff)
    && dailyDiff.length === 0
    && routeDiff.length === 0;

  return {
    sync_run_id: syncRunId,
    ok,
    trip_count_diff: tripCountDiff,
    recv_diff: recvDiff,
    pay_diff: payDiff,
    oil_diff: oilDiff,
    margin_diff: marginDiff,
    daily_diff: dailyDiff,
    route_diff: routeDiff,
    missing_rows: [],
    extra_rows: [],
    contract_errors: contractErrors,
  };
}

function validateSummaryPayload(summaryPayload, localParity) {
  const errors = [];
  if (!summaryPayload || typeof summaryPayload !== 'object') {
    return [{ scope: 'summary', message: 'summary payload is missing or not an object' }];
  }
  if (summaryPayload.error) {
    return [{ scope: 'summary', message: `summary endpoint returned error: ${summaryPayload.error}` }];
  }

  const summary = summaryPayload.summary || {};
  for (const key of ['totalTrips', 'totalRevenue', 'totalMargin']) {
    if (summary[key] === undefined) {
      errors.push({
        scope: `summary.${key}`,
        message: 'required summary field is missing',
      });
    }
  }
  if (summary.totalTrips !== undefined && Number(summary.totalTrips) !== localParity.trip_count) {
    errors.push({
      scope: 'summary.totalTrips',
      expected: localParity.trip_count,
      actual: Number(summary.totalTrips),
    });
  }
  if (summary.totalRevenue !== undefined && !almostEqual(Number(summary.totalRevenue), localParity.recv_sum)) {
    errors.push({
      scope: 'summary.totalRevenue',
      expected: localParity.recv_sum,
      actual: Number(summary.totalRevenue),
    });
  }
  if (summary.totalMargin !== undefined && !almostEqual(Number(summary.totalMargin), localParity.margin_sum)) {
    errors.push({
      scope: 'summary.totalMargin',
      expected: localParity.margin_sum,
      actual: Number(summary.totalMargin),
    });
  }

  return errors;
}

function omitGroupRows(summary) {
  return {
    trip_count: summary.trip_count,
    recv_sum: summary.recv_sum,
    pay_sum: summary.pay_sum,
    oil_sum: summary.oil_sum,
    margin_sum: summary.margin_sum,
  };
}

function normalizeDbParity(db) {
  return {
    trip_count: Number(db?.trip_count || 0),
    recv_sum: Number(db?.recv_sum || 0),
    pay_sum: Number(db?.pay_sum || 0),
    oil_sum: Number(db?.oil_sum || 0),
    margin_sum: Number(db?.margin_sum || 0),
    daily: Array.isArray(db?.daily) ? db.daily.map(row => ({
      date: String(row.date || ''),
      trip_count: Number(row.trip_count || 0),
      recv_sum: Number(row.recv_sum || 0),
      pay_sum: Number(row.pay_sum || 0),
      oil_sum: Number(row.oil_sum || 0),
      margin_sum: Number(row.margin_sum || 0),
    })) : [],
    route: Array.isArray(db?.route) ? db.route.map(row => ({
      route_key: String(row.route_key || ''),
      trip_count: Number(row.trip_count || 0),
      recv_sum: Number(row.recv_sum || 0),
      pay_sum: Number(row.pay_sum || 0),
      oil_sum: Number(row.oil_sum || 0),
      margin_sum: Number(row.margin_sum || 0),
    })) : [],
  };
}

function diffGroups(leftRows, rightRows, keyName) {
  const diffs = [];
  const left = new Map(leftRows.map(row => [String(row[keyName]), row]));
  const right = new Map(rightRows.map(row => [String(row[keyName]), row]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();

  for (const key of keys) {
    const a = left.get(key) || zeroGroup(keyName, key);
    const b = right.get(key) || zeroGroup(keyName, key);
    const diff = {
      [keyName]: key,
      trip_count_diff: Number(b.trip_count || 0) - Number(a.trip_count || 0),
      recv_diff: round2(Number(b.recv_sum || 0) - Number(a.recv_sum || 0)),
      pay_diff: round2(Number(b.pay_sum || 0) - Number(a.pay_sum || 0)),
      oil_diff: round2(Number(b.oil_sum || 0) - Number(a.oil_sum || 0)),
      margin_diff: round2(Number(b.margin_sum || 0) - Number(a.margin_sum || 0)),
    };
    if (
      diff.trip_count_diff !== 0 ||
      !almostZero(diff.recv_diff) ||
      !almostZero(diff.pay_diff) ||
      !almostZero(diff.oil_diff) ||
      !almostZero(diff.margin_diff)
    ) {
      diffs.push(diff);
    }
  }
  return diffs;
}

function zeroGroup(keyName, key) {
  return {
    [keyName]: key,
    trip_count: 0,
    recv_sum: 0,
    pay_sum: 0,
    oil_sum: 0,
    margin_sum: 0,
  };
}

function canonicalIdentity(values) {
  return values.map(value => String(value ?? '').trim().replace(/\s+/g, ' ')).join('\u001f');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    let year = Number(slash[3]);
    if (year > 2500) year -= 543;
    return `${year}-${pad2(slash[2])}-${pad2(slash[1])}`;
  }
  return null;
}

function money(value) {
  const n = nullableNumber(value);
  return n === null ? 0 : round2(n);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTotals(row) {
  return {
    ...row,
    recv_sum: round2(row.recv_sum),
    pay_sum: round2(row.pay_sum),
    oil_sum: round2(row.oil_sum),
    margin_sum: round2(row.margin_sum),
  };
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function almostEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= CENT_TOLERANCE;
}

function almostZero(value) {
  return Math.abs(Number(value || 0)) <= CENT_TOLERANCE;
}

function textOrEmpty(value) {
  return value === null || value === undefined ? '' : String(value);
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function compareByKey(key) {
  return (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
}

function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function safeSample(value) {
  try {
    return trimMessage(JSON.stringify(value));
  } catch {
    return String(value).slice(0, 1000);
  }
}

function trimMessage(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
