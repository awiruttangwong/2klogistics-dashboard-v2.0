const DEFAULT_EXPECTED_SPREADSHEET_ID = '1z84ZlRsonSpaqIZbwKNTaqtai-UzCUPzp2-GGHALrQU';

const appsScriptUrl = process.env.APPS_SCRIPT_API_URL || process.argv[2] || '';
const expectedSpreadsheetId = process.env.EXPECTED_DASHBOARD_SPREADSHEET_ID || DEFAULT_EXPECTED_SPREADSHEET_ID;

main().catch(error => {
  console.error(`[apps-script-health] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!appsScriptUrl) {
    throw new Error('Set APPS_SCRIPT_API_URL to the new Apps Script Web App /exec URL, or pass it as the first argument.');
  }

  const health = await fetchAction('health');
  const meta = await fetchAction('meta');
  const trips = await fetchAction('trips', {
    page: '0',
    limit: '1',
    fields: 'date,customer,route,vtype,driver,plate,payee,recv,pay,oil,margin',
  });

  const failures = [];
  const warnings = [];
  if (health?.contract?.passed !== true) failures.push('health.contract.passed is not true');
  if (Number(health?.trigger?.dailyBatchJobCount || 0) !== 1) warnings.push(`dailyBatchJob trigger count is ${health?.trigger?.dailyBatchJobCount ?? 'missing'}`);
  if (health?.spreadsheet?.matchesExpected === false) failures.push(`active spreadsheet is ${health.spreadsheet.id}, expected ${expectedSpreadsheetId}`);
  if (health?.spreadsheet && health.spreadsheet.expectedId !== expectedSpreadsheetId) warnings.push(`health expectedId is ${health.spreadsheet.expectedId}, local expected is ${expectedSpreadsheetId}`);
  if (Number(trips?.total || 0) <= 0) failures.push('trips total is zero or missing');
  if (!Array.isArray(trips?.trips)) failures.push('trips payload is missing trips array');

  const result = {
    ok: failures.length === 0,
    appsScriptUrl,
    spreadsheet: health?.spreadsheet || null,
    trigger: health?.trigger || null,
    contract: health?.contract || null,
    configuredMonths: meta?.configuredMonths || [],
    missingMonths: meta?.missingMonths || [],
    tripsTotal: trips?.total ?? null,
    warnings,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) throw new Error(`Apps Script health failed: ${failures.join('; ')}`);
}

async function fetchAction(action, params = {}) {
  const url = new URL(appsScriptUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${action} HTTP ${response.status}: ${trim(text)}`);
  return text ? JSON.parse(text) : null;
}

function trim(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}
