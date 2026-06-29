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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, null);
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed' });

  try {
    const params = event.queryStringParameters || {};
    const action = String(params.action || 'summary').trim().toLowerCase();

    if (action === 'meta') return response(200, await getMeta(), { cache: 'no-store' });
    if (action === 'health') return response(200, await getHealth(), { cache: 'no-store' });
    if (action === 'summary') return response(200, await getSummary());
    if (action === 'trips') return response(200, await getTrips(params));
    if (action === 'oil') return response(200, await getOil());
    if (action === 'routes') return response(200, await getRoutes());
    if (action === 'customers') return response(200, await getCustomers());
    if (action === 'dates') return response(200, await getDates());
    if (action === 'compare') return response(200, await getCompare(params));

    return response(400, { error: `Unsupported action: ${action}` });
  } catch (error) {
    console.error('[supabase-api]', error);
    return response(error.status || 500, { error: error.message || 'Supabase API failed' });
  }
}

async function getMeta() {
  const health = await getHealth();
  return {
    ok: true,
    source: 'supabase',
    api: 'supabase-api',
    generatedAt: new Date().toISOString(),
    health,
  };
}

async function getHealth() {
  const runs = await supabaseRest('/rest/v1/sync_runs', {
    select: 'id,status,is_active,rows_read,rows_written,rows_failed,promoted_at,finished_at,error_message',
    is_active: 'eq.true',
    order: 'promoted_at.desc',
    limit: '1',
  });

  const active = runs.rows[0] || null;
  const count = await supabaseRest('/rest/v1/trips_active', { select: 'id', limit: '1' }, {
    headers: { Prefer: 'count=exact' },
  });
  const dateDiagnostics = await getDateDiagnostics();
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

async function getSummary() {
  const result = await supabaseRest('/rest/v1/summary_snapshots', {
    select: 'payload,created_at,sync_run_id',
    is_active: 'eq.true',
    order: 'created_at.desc',
    limit: '1',
  });
  const row = result.rows[0];
  if (!row?.payload) throw statusError(404, 'No active summary snapshot found');
  return row.payload;
}

async function getTrips(params) {
  const requestedLimit = clampInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = Math.max(0, parseIntSafe(params.page, 0));
  const offset = page * requestedLimit;
  const fields = selectTripColumns(params.fields);
  const filters = buildTripFilters(params);
  const rows = [];
  let total = null;

  for (let innerOffset = 0; innerOffset < requestedLimit; innerOffset += REST_PAGE_SIZE) {
    const limit = Math.min(REST_PAGE_SIZE, requestedLimit - innerOffset);
    const result = await supabaseRest('/rest/v1/trips_active', {
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

async function getOil() {
  const result = await supabaseRest('/rest/v1/oil_prices', {
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

async function getRoutes() {
  const result = await supabaseRest('/rest/v1/active_routes_summary', {
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

async function getCustomers() {
  const result = await supabaseRest('/rest/v1/active_customers_summary', {
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

async function getDates() {
  const result = await supabaseRest('/rest/v1/active_dates_summary', {
    select: 'date,trips',
    order: 'date.asc',
    limit: '5000',
  });
  const minOperationalDate = getMinOperationalDate();
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

async function getDateDiagnostics() {
  const minOperationalDate = getMinOperationalDate();
  const [minResult, maxResult, suspiciousResult] = await Promise.all([
    supabaseRest('/rest/v1/active_dates_summary', {
      select: 'date,trips',
      order: 'date.asc',
      limit: '1',
    }),
    supabaseRest('/rest/v1/active_dates_summary', {
      select: 'date,trips',
      order: 'date.desc',
      limit: '1',
    }),
    supabaseRest('/rest/v1/active_dates_summary', {
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

async function getCompare(params) {
  const [a, b] = await Promise.all([
    getTrips({ start: params.startA || params.a_start, end: params.endA || params.a_end, limit: MAX_LIMIT, page: 0 }),
    getTrips({ start: params.startB || params.b_start, end: params.endB || params.b_end, limit: MAX_LIMIT, page: 0 }),
  ]);
  return {
    a,
    b,
    source: 'supabase',
  };
}

async function fetchAllActiveTrips(columns) {
  const rows = [];
  let offset = 0;
  while (true) {
    const result = await supabaseRest('/rest/v1/trips_active', {
      select: columns.join(','),
      order: 'date.asc,row_identity_key.asc',
      limit: String(REST_PAGE_SIZE),
      offset: String(offset),
    });
    rows.push(...result.rows);
    if (result.rows.length < REST_PAGE_SIZE) return rows;
    offset += REST_PAGE_SIZE;
  }
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

async function supabaseRest(path, query = {}, options = {}) {
  const baseUrl = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw statusError(500, `Missing required environment variable: ${name}`);
  return value;
}

function getMinOperationalDate() {
  const value = String(process.env.SUPABASE_MIN_OPERATIONAL_DATE || DEFAULT_MIN_OPERATIONAL_DATE).trim();
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
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': cacheControl,
      'Netlify-CDN-Cache-Control': cacheControl,
      'Vary': 'Accept-Encoding',
    },
    body: body == null ? '' : JSON.stringify(body),
  };
}
