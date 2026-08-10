import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_EXPECTED_SPREADSHEET_ID = '1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw';

loadDotEnvFile();

const cliArgs = process.argv.slice(2);
const legacyUrlArg = cliArgs[0] && !cliArgs[0].startsWith('--') ? cliArgs[0] : '';
const appsScriptUrl = readOption('--url') || process.env.APPS_SCRIPT_API_URL || legacyUrlArg;
const expectedSpreadsheetId = process.env.EXPECTED_DASHBOARD_SPREADSHEET_ID || DEFAULT_EXPECTED_SPREADSHEET_ID;
const requiredMonthOverride = readOption('--month') || process.env.REQUIRED_DATA_MONTH || '';

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
  const bangkokMonth = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    month: 'numeric',
  }).format(new Date()));
  const requiredMonthNumber = requiredMonthOverride ? Number(requiredMonthOverride) : bangkokMonth;
  if (!Number.isInteger(requiredMonthNumber) || requiredMonthNumber < 1 || requiredMonthNumber > 12) {
    throw new Error(`Invalid --month value: ${requiredMonthOverride}. Expected 1-12.`);
  }
  const requiredCurrentMonth = `DATA(M${requiredMonthNumber})`;
  const configuredMonths = Array.isArray(meta?.configuredMonths) ? meta.configuredMonths : [];
  if (health?.contract?.passed !== true) failures.push('health.contract.passed is not true');
  if (Number(health?.trigger?.dailyBatchJobCount || 0) !== 1) warnings.push(`dailyBatchJob trigger count is ${health?.trigger?.dailyBatchJobCount ?? 'missing'}`);
  // expectedRecoveryJobCount is only present once the /exec Web App deployment has been
  // updated to code that reports it (triggers themselves always run latest-saved code, so
  // dailyBatchRecoveryJobCount can be ahead of what this stale field says). Without it, fall
  // back to a loose sanity check (>=1) instead of a hard-coded expectation of 1.
  const expectedRecoveryJobCount = health?.trigger?.expectedRecoveryJobCount !== undefined
    ? Number(health.trigger.expectedRecoveryJobCount)
    : null;
  if (health?.trigger?.dailyBatchRecoveryJobCount !== undefined) {
    const actualRecoveryJobCount = Number(health.trigger.dailyBatchRecoveryJobCount);
    if (expectedRecoveryJobCount !== null && actualRecoveryJobCount !== expectedRecoveryJobCount) {
      failures.push(`dailyBatchRecoveryJob trigger count is ${actualRecoveryJobCount}, expected ${expectedRecoveryJobCount}`);
    } else if (expectedRecoveryJobCount === null && actualRecoveryJobCount < 1) {
      failures.push(`dailyBatchRecoveryJob trigger count is ${actualRecoveryJobCount}`);
    } else if (expectedRecoveryJobCount === null) {
      warnings.push(`health.trigger.expectedRecoveryJobCount missing (stale /exec deployment) — dailyBatchRecoveryJobCount is ${actualRecoveryJobCount}, not validated against config`);
    }
  }
  if (health?.spreadsheet?.matchesExpected === false) failures.push(`active spreadsheet is ${health.spreadsheet.id}, expected ${expectedSpreadsheetId}`);
  if (health?.spreadsheet && health.spreadsheet.expectedId !== expectedSpreadsheetId) warnings.push(`health expectedId is ${health.spreadsheet.expectedId}, local expected is ${expectedSpreadsheetId}`);
  if (Number(trips?.total || 0) <= 0) failures.push('trips total is zero or missing');
  if (!Array.isArray(trips?.trips)) failures.push('trips payload is missing trips array');
  if (!configuredMonths.includes(requiredCurrentMonth)) {
    failures.push(`${requiredCurrentMonth} is not configured in the deployed Apps Script Web App`);
  }

  const result = {
    ok: failures.length === 0,
    appsScriptUrl,
    spreadsheet: health?.spreadsheet || null,
    trigger: health?.trigger || null,
    contract: health?.contract || null,
    requiredCurrentMonth,
    configuredMonths,
    missingMonths: meta?.missingMonths || [],
    tripsTotal: trips?.total ?? null,
    warnings,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) throw new Error(`Apps Script health failed: ${failures.join('; ')}`);
}

function readOption(name) {
  const index = cliArgs.indexOf(name);
  if (index === -1) return '';
  return cliArgs[index + 1] || '';
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
