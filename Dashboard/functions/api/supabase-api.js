// Cloudflare Pages Function — ported from netlify/functions/supabase-api.mjs.
// Route: /api/supabase-api (file-based routing under dashboard/functions/api/).
// Read-only proxy to Supabase REST + Apps Script freshness check. No node:fs
// or other Node-only APIs, so this is safe to run on the Workers runtime.

import {
  productionContainsBatch,
  sourceBatchReadyToday,
} from '../../../supabase/sync/daily-sync-readiness.mjs';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const REST_PAGE_SIZE = 1000;
const DEFAULT_MIN_OPERATIONAL_DATE = '2020-01-01';
const STALE_SYNC_HOURS = 36;

const TRIP_COLUMNS = [
  'row_identity_key',
  'date',
  'customer',
  'vtype',
  'route_desc',
  'route',
  'route_key',
  'route_core',
  'route_vehicle',
  'route_prefix',
  'route_group',
  'is_flash_route',
  'driver',
  'plate',
  'payee',
  'oil',
  'recv',
  'pay',
  'margin',
  'pct',
  'reason',
  'anomalies',
];

const FIELD_MAP = {
  rowIdentityKey: 'row_identity_key',
  date: 'date',
  customer: 'customer',
  route: 'route',
  routeDesc: 'route_desc',
  routeKey: 'route_key',
  routeCore: 'route_core',
  routeVehicle: 'route_vehicle',
  routePrefix: 'route_prefix',
  routeGroup: 'route_group',
  isFlashRoute: 'is_flash_route',
  vtype: 'vtype',
  driver: 'driver',
  plate: 'plate',
  payee: 'payee',
  recv: 'recv',
  pay: 'pay',
  oil: 'oil',
  margin: 'margin',
  pct: 'pct',
  reason: 'reason',
  anomalies: 'anomalies',
};

export async function onRequestOptions() {
  return response(204, null);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const action = String(params.action || 'summary').trim().toLowerCase();

    if (action === 'meta') return response(200, await getMeta(env), { cache: 'no-store' });
    if (action === 'health') return response(200, await getHealth(env), { cache: 'no-store' });
    if (action === 'freshness') return response(200, await getFreshness(env), { cache: 'no-store' });
    if (action === 'summary') return response(200, await getSummary(env));
    if (action === 'trips') return response(200, await getTrips(env, params));
    if (action === 'oil') return response(200, await getOil(env));
    if (action === 'routes') return response(200, await getRoutes(env));
    if (action === 'customers') return response(200, await getCustomers(env));
    if (action === 'dates') return response(200, await getDates(env));
    if (action === 'compare') return response(200, await getCompare(env, params));

    return response(400, { error: `Unsupported action: ${action}` });
  } catch (error) {
    console.error('[supabase-api]', error);
    return response(error.status || 500, { error: error.message || 'Supabase API failed' });
  }
}

async function getFreshness(env) {
  const appsScriptUrl = requireEnv(env, 'APPS_SCRIPT_API_URL');
  const [sourceHealth, sourceTrips, production] = await Promise.all([
    fetchAppsScriptJson(appsScriptUrl, 'health'),
    fetchAppsScriptJson(appsScriptUrl, 'trips', { page: '0', limit: '1', fields: 'date' }),
    getHealth(env),
  ]);
  const source = {
    lastDailyBatchJob: sourceHealth?.lastDailyBatchJob || null,
    tripsTotal: Number(sourceTrips?.total || 0),
  };
  const sourceReady = sourceBatchReadyToday(source);
  const productionCurrent = sourceReady && productionContainsBatch(source, production);

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    sourceReady,
    productionCurrent,
    preferAppsScript: sourceReady && !productionCurrent,
    source: {
      tripsRows: source.tripsTotal,
      batchFinishedAt: source.lastDailyBatchJob?.finishedAt || null,
    },
    production: {
      tripsRows: Number(production?.supabase?.tripsRows || 0),
      promotedAt: production?.latestSyncRun?.promoted_at || null,
      status: production?.latestSyncRun?.status || null,
    },
  };
}

async function fetchAppsScriptJson(baseUrl, action, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    const text = await res.text();
    if (!res.ok) throw statusError(res.status, `Apps Script ${action} HTTP ${res.status}: ${trimMessage(text)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function getMeta(env) {
  const health = await getHealth(env);
  return {
    ok: true,
    source: 'supabase',
    api: 'supabase-api',
    generatedAt: new Date().toISOString(),
    health,
  };
}

async function getHealth(env) {
  const runs = await supabaseRest(env, '/rest/v1/sync_runs', {
    select: 'id,status,is_active,rows_read,rows_written,rows_failed,promoted_at,finished_at,error_message',
    is_active: 'eq.true',
    order: 'promoted_at.desc',
    limit: '1',
  });

  const active = runs.rows[0] || null;
  const count = await supabaseRest(env, '/rest/v1/trips_active', { select: 'id', limit: '1' }, {
    headers: { Prefer: 'count=exact' },
  });
  const dateDiagnostics = await getDateDiagnostics(env);
  const generatedAt = new Date();
  const promotedAt = active?.promoted_at ? new Date(active.promoted_at) : null;
  const syncAgeHours = promotedAt && !Number.isNaN(promotedAt.getTime())
    ? Math.round(((generatedAt.getTime() - promotedAt.getTime()) / 36_000) / 10) / 10
    : null;
  const rowsFailed = Number(active?.rows_failed || 0);
  const rowsWritten = Number(active?.rows_written || 0);
  const activeRows = count.total ?? 0;
  const rowsMatch = rowsWritten === activeRows;
  const stale = syncAgeHours === null || syncAgeHours > STALE_SYNC_HOURS;
  const ok = Boolean(active)
    && active.status === 'promoted'
    && activeRows > 0
    && rowsFailed === 0
    && rowsMatch
    && !stale;

  return {
    ok,
    source: 'supabase',
    generatedAt: generatedAt.toISOString(),
    latestSyncRun: active,
    checks: {
      activePromotedRun: Boolean(active && active.status === 'promoted'),
      rowsFailedZero: rowsFailed === 0,
      rowsMatchActiveTable: rowsMatch,
      syncFresh: !stale,
    },
    sync: {
      ageHours: syncAgeHours,
      staleAfterHours: STALE_SYNC_HOURS,
      expectedSchedule: '08:00 Asia/Bangkok (UTC+7)',
    },
    supabase: {
      tripsRows: activeRows,
      latestSyncStatus: active?.status || null,
    },
    dates: dateDiagnostics,
  };
}

async function getSummary(env) {
  const result = await supabaseRest(env, '/rest/v1/summary_snapshots', {
    select: 'payload,created_at,sync_run_id',
    is_active: 'eq.true',
    order: 'created_at.desc',
    limit: '1',
  });
  const row = result.rows[0];
  if (!row?.payload) throw statusError(404, 'No active summary snapshot found');
  return row.payload;
}

async function getTrips(env, params) {
  const requestedLimit = clampInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = Math.max(0, parseIntSafe(params.page, 0));
  const offset = page * requestedLimit;
  const fields = selectTripColumns(params.fields);
  const filters = buildTripFilters(params);
  const rows = [];
  let total = null;

  for (let innerOffset = 0; innerOffset < requestedLimit; innerOffset += REST_PAGE_SIZE) {
    const limit = Math.min(REST_PAGE_SIZE, requestedLimit - innerOffset);
    const result = await supabaseRest(env, '/rest/v1/trips_active', {
      select: fields.join(','),
      order: 'date.asc,row_identity_key.asc',
      limit: String(limit),
      offset: String(offset + innerOffset),
      ...filters,
    }, {
      headers: { Prefer: 'count=exact' },
    });
    if (total === null) total = result.total;
    rows.push(...result.rows.map(mapTripRow));
    if (result.rows.length < limit) break;
  }

  const resolvedTotal = total ?? rows.length;
  return {
    trips: rows,
    total: resolvedTotal,
    page,
    limit: requestedLimit,
    hasMore: offset + rows.length < resolvedTotal,
    start: params.start || null,
    end: params.end || null,
    route: params.route || null,
    source: 'supabase',
  };
}

async function getOil(env) {
  const result = await supabaseRest(env, '/rest/v1/oil_prices', {
    select: 'period_no,period_name,year_en,update_date,price,source,source_url',
    order: 'period_name.asc',
    limit: '5000',
  });
  const prices = result.rows.map(row => ({
    period_no: row.period_no,
    period_name: row.period_name,
    year_en: row.year_en,
    update_date: row.update_date,
    price: Number(row.price),
  }));
  return {
    prices,
    source: result.rows[0]?.source || 'PTTOR',
    sourceUrl: result.rows[0]?.source_url || 'https://www.pttor.com/news/oil-price',
    productLabel: 'ดีเซล (ราคาขายปลีก กทม. และปริมณฑล)',
    lastFetch: new Date().toISOString(),
  };
}

async function getRoutes(env) {
  const result = await supabaseRest(env, '/rest/v1/active_routes_summary', {
    select: 'route,route_key,route_group,route_core,route_vehicle,route_prefix,trips',
    order: 'trips.desc',
    limit: '5000',
  });
  return {
    routes: result.rows.map(row => ({
      route: row.route,
      routeKey: row.route_key,
      routeGroup: row.route_group,
      routeCore: row.route_core,
      routeVehicle: row.route_vehicle,
      routePrefix: row.route_prefix,
      trips: row.trips,
    })),
    source: 'supabase',
  };
}

async function getCustomers(env) {
  const result = await supabaseRest(env, '/rest/v1/active_customers_summary', {
    select: 'customer,trips',
    order: 'trips.desc',
    limit: '5000',
  });
  return {
    customers: result.rows.map(row => ({
      customer: row.customer,
      name: row.customer,
      trips: row.trips,
    })),
    source: 'supabase',
  };
}

async function getDates(env) {
  const result = await supabaseRest(env, '/rest/v1/active_dates_summary', {
    select: 'date,trips',
    order: 'date.asc',
    limit: '5000',
  });
  const minOperationalDate = getMinOperationalDate(env);
  const allRows = result.rows;
  const rows = allRows.filter(row => isOperationalDate(row.date, minOperationalDate));
  const selectedRows = rows.length ? rows : allRows;
  return {
    dates: selectedRows.map(row => row.date),
    rows: selectedRows,
    allDatesCount: allRows.length,
    excludedDatesCount: allRows.length - selectedRows.length,
    minOperationalDate,
    source: 'supabase',
  };
}

async function getDateDiagnostics(env) {
  const minOperationalDate = getMinOperationalDate(env);
  const [minResult, maxResult, suspiciousResult] = await Promise.all([
    supabaseRest(env, '/rest/v1/active_dates_summary', {
      select: 'date,trips',
      order: 'date.asc',
      limit: '1',
    }),
    supabaseRest(env, '/rest/v1/active_dates_summary', {
      select: 'date,trips',
      order: 'date.desc',
      limit: '1',
    }),
    supabaseRest(env, '/rest/v1/active_dates_summary', {
      select: 'date,trips',
      date: `lt.${minOperationalDate}`,
      order: 'date.asc',
      limit: '5000',
    }),
  ]);
  return {
    min: minResult.rows[0]?.date || null,
    max: maxResult.rows[0]?.date || null,
    minOperationalDate,
    suspiciousDatesBeforeMin: suspiciousResult.rows.length,
    suspiciousTripsBeforeMin: suspiciousResult.rows.reduce((sum, row) => sum + Number(row.trips || 0), 0),
  };
}

async function getCompare(env, params) {
  const [a, b] = await Promise.all([
    getTrips(env, { start: params.startA || params.a_start, end: params.endA || params.a_end, limit: MAX_LIMIT, page: 0 }),
    getTrips(env, { start: params.startB || params.b_start, end: params.endB || params.b_end, limit: MAX_LIMIT, page: 0 }),
  ]);
  return {
    a,
    b,
    source: 'supabase',
  };
}

function buildTripFilters(params) {
  const filters = {};
  const dateFilters = [];
  if (params.start) dateFilters.push(`gte.${params.start}`);
  if (params.end) dateFilters.push(`lte.${params.end}`);
  if (dateFilters.length) filters.date = dateFilters;
  if (params.route) {
    const route = escapeFilterValue(params.route);
    filters.or = `(route.eq.${route},route_key.eq.${route},route_group.eq.${route})`;
  }
  return filters;
}

function selectTripColumns(fields) {
  if (!fields) return TRIP_COLUMNS;
  const selected = String(fields)
    .split(',')
    .map(field => FIELD_MAP[field.trim()])
    .filter(Boolean);
  return [...new Set(selected.length ? selected : TRIP_COLUMNS)];
}

async function supabaseRest(env, path, query = {}, options = {}) {
  const baseUrl = requireEnv(env, 'SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, item);
      });
    } else if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw statusError(res.status, `Supabase REST ${res.status}: ${trimMessage(text)}`);
  }
  return {
    rows: text ? JSON.parse(text) : [],
    total: parseContentRangeTotal(res.headers.get('content-range')),
  };
}

function mapTripRow(row) {
  return {
    rowIdentityKey: row.row_identity_key,
    date: row.date,
    customer: row.customer,
    route: row.route,
    routeDesc: row.route_desc,
    routeKey: row.route_key,
    routeCore: row.route_core,
    routeVehicle: row.route_vehicle,
    routePrefix: row.route_prefix,
    routeGroup: row.route_group,
    isFlashRoute: Boolean(row.is_flash_route),
    vtype: row.vtype,
    driver: row.driver,
    plate: row.plate,
    payee: row.payee,
    recv: numberOrZero(row.recv),
    pay: numberOrZero(row.pay),
    oil: numberOrZero(row.oil),
    margin: numberOrZero(row.margin),
    pct: row.pct == null ? null : Number(row.pct),
    reason: row.reason,
    anomalies: Array.isArray(row.anomalies) ? row.anomalies : [],
  };
}

function parseContentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+|\*)$/);
  return match && match[1] !== '*' ? Number(match[1]) : null;
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, fallback, min, max) {
  return Math.min(max, Math.max(min, parseIntSafe(value, fallback)));
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function escapeFilterValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function requireEnv(env, name) {
  const value = env?.[name];
  if (!value) throw statusError(500, `Missing required environment variable: ${name}`);
  return value;
}

function getMinOperationalDate(env) {
  const value = String(env?.SUPABASE_MIN_OPERATIONAL_DATE || DEFAULT_MIN_OPERATIONAL_DATE).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : DEFAULT_MIN_OPERATIONAL_DATE;
}

function isOperationalDate(value, minOperationalDate) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= minOperationalDate;
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function trimMessage(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function response(statusCode, body, options = {}) {
  const cacheControl = options.cache === 'no-store'
    ? 'no-store'
    : statusCode === 200
    ? 'public, max-age=30, s-maxage=60, stale-while-revalidate=120'
    : 'no-store';
  return new Response(body == null ? '' : JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': cacheControl,
      'CDN-Cache-Control': cacheControl,
      'Vary': 'Accept-Encoding',
    },
  });
}
