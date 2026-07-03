import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dashboard/scripts/app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} is missing`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is incomplete`);
}

const functionNames = [
  'normalizeText',
  'normalizeVehicleType',
  'isFlashCustomerName',
  'isSpxCustomerName',
  'isTimedRouteCustomerName',
  'isRouteCodeLike',
  'parseTimedRouteParts',
  'getRouteIdentity',
  'cleanRouteDisplayText',
  'resolveRouteDisplayLabel',
  'routeDisplay',
  'routeGroupHeaderDisplay',
];
const policySource = functionNames.map(extractFunction).join('\n');
const buildPolicy = new Function('mapCustomer', `"use strict"; ${policySource}; return { routeDisplay, routeGroupHeaderDisplay };`);
const { routeDisplay, routeGroupHeaderDisplay } = buildPolicy(value => value);

const cases = [
  {
    name: 'FLASH keeps the existing timed-code normalization',
    row: { customer: 'FLASH', vtype: '6W7.2', route: 'ขอนแก่น-บ่อวิน', routeDesc: 'LH-6W7.2-BKKC-PDT-03:00-BD-RO' },
    expected: 'LH-6W7.2-BKKC-PDT-BD-RO',
  },
  { name: 'KEX uses ชื่อเส้นทาง code', row: { customer: 'KEX', vtype: '4W', route: 'รัชดา-รังสิต', routeDesc: 'RCDRST1330' }, expected: 'RCDRST1330' },
  { name: 'BEST uses ชื่อเส้นทาง code', row: { customer: 'BEST Express', vtype: '6W7.2', route: 'บางพลี-ลำปาง', routeDesc: 'BKK-LPT' }, expected: 'BKK-LPT' },
  { name: 'J&T uses ชื่อเส้นทาง code', row: { customer: 'J&T', vtype: '6W7.2', route: 'เชียงใหม่-ระยอง', routeDesc: 'CMI-RYG' }, expected: 'CMI-RYG' },
  { name: 'SGT uses ชื่อเส้นทาง code', row: { customer: 'SGT', vtype: '4W', route: 'ชื่อไทย', routeDesc: 'SGT-CODE' }, expected: 'SGT-CODE' },
  { name: 'SPX-LH uses ชื่อเส้นทาง code', row: { customer: 'SPX-LH', vtype: '6W7.2', route: 'ชื่อไทย', routeDesc: 'SPXLH-CODE' }, expected: 'SPXLH-CODE' },
  { name: 'SPX-FSOC uses ชื่อเส้นทาง code', row: { customer: 'SPX-FSOC', vtype: '6W7.2', route: 'FSOCคลังวังน้อย-คลังบัวโรย', routeDesc: 'FSOCN-SOCE' }, expected: 'FSOCN-SOCE' },
  { name: 'missing ชื่อเส้นทาง falls back safely', row: { customer: 'KEX', vtype: '4W', route: 'รัชดา-รังสิต', routeDesc: '' }, expected: 'รัชดา-รังสิต' },
];

for (const testCase of cases) {
  assert.equal(routeDisplay(testCase.row), testCase.expected, testCase.name);
  assert.equal(routeGroupHeaderDisplay(testCase.row), testCase.expected, `${testCase.name} (group header)`);
}

assert.match(source, /const xlsxRouteDisplay = row => routeGroupHeaderDisplay\(row\)/, 'XLSX must use the shared route display resolver');
assert.match(source, /label: routeDisplay\(r\)/, 'Route filter must use the shared route display resolver');
assert.match(source, /cCell\(routeGroupHeaderDisplay\(route\), \{ fill: routeFill, bold: true \}\)/, 'Normal XLSX route headers must use the shared resolver');
assert.match(source, /cCell\(xlsxRouteDisplay\(r\), \{ fill: zf \}\)/, 'Normal XLSX trip rows must use the shared resolver');
assert.match(source, /const qaRouteVal = xlsxRouteDisplay\(r\)/, 'QA helper route keys must use the same visible route label');
assert.match(source, /cCell\(routeGroupHeaderDisplay\(item\.route\), \{ bold: true, fill: 'DBEAFE' \}\)/, 'Normal status-sheet group headers must use the shared resolver');

console.log('Route display policy verified for frontend, filters, and XLSX.');
