import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dashboard/scripts/app.js', import.meta.url), 'utf8');
const objectStartMarker = 'const qaReasonHeadersBySheet = {';
const objectStart = source.indexOf(objectStartMarker);
assert.notEqual(objectStart, -1, 'qaReasonHeadersBySheet mapping is missing');

const bodyStart = objectStart + objectStartMarker.length - 1;
const bodyEnd = source.indexOf('\n      };', bodyStart);
assert.notEqual(bodyEnd, -1, 'qaReasonHeadersBySheet mapping is incomplete');

const objectSource = source.slice(bodyStart, bodyEnd + 8).replace(/;\s*$/, '');
const buildMapping = new Function('_isSingleMode', `"use strict"; return (${objectSource});`);

const basePriceReasons = [
  'ได้กำไรเท่าเดิม/มากขึ้น',
  'ขาดทุน/ไม่สามารถลดราคา พขร. ได้',
  'โปร',
  'ดันราคา/หารถไม่ได้',
  'รถแทน/รถด่วน',
];
const sharedNewReason = 'รอเรทราคาน้ำมันจากลูกค้า';
const singleMode = buildMapping(true);
const compareMode = buildMapping(false);

assert.deepEqual(singleMode['สำรองน้ำมัน > 50%'], [
  'น้ำมันไม่พอวิ่ง',
  'หลีกเลี่ยงการปิดตู้โอนจ่าย',
  'สำรองน้ำมันขาเดียว',
  'สำรองน้ำมัน 1 สัปดาห์',
]);
assert.deepEqual(compareMode['สำรองน้ำมัน > 50%'], [
  'น้ำมันไม่พอวิ่ง',
  'หลีกเลี่ยงการปิดตู้โอนจ่าย',
]);
assert.deepEqual(singleMode['ขาดทุน'], [
  'ขาดทุน/ไม่สามารถลดราคา พขร. ได้',
  'โปร',
  'ดันราคา/หารถไม่ได้',
  'รถแทน/รถด่วน',
  'ใส่ราคารับผิด',
  'ใส่ราคาจ่ายผิด',
]);
assert.deepEqual(compareMode['ขาดทุน'], [
  'ขาดทุน/ไม่สามารถลดราคา พขร. ได้',
  'โปร',
  'ดันราคา/หารถไม่ได้',
  'รถแทน/รถด่วน',
]);
assert.deepEqual(singleMode['ราคาจ่ายผิดปกติ'], [
  ...basePriceReasons,
  sharedNewReason,
  'ใส่ราคาจ่ายผิด',
]);
assert.deepEqual(singleMode['ราคารับผิดปกติ'], [
  ...basePriceReasons,
  sharedNewReason,
  'ใส่ราคารับผิด',
]);
assert.deepEqual(compareMode['ราคาจ่ายผิดปกติ'], basePriceReasons);
assert.deepEqual(compareMode['ราคารับผิดปกติ'], basePriceReasons);

const singleSummaryReasons = [...new Set(Object.values(singleMode).flat())];
assert.equal(singleSummaryReasons.filter(reason => reason === sharedNewReason).length, 1);
assert.ok(singleSummaryReasons.includes('ใส่ราคารับผิด'));
assert.ok(singleSummaryReasons.includes('ใส่ราคาจ่ายผิด'));

for (const contract of [
  'const qaSummaryReasonHeaders = [...new Set(',
  'const qaSheetReasonHeaders = qaReasonHeadersForSheet(sheetTitle);',
  'const sourceReasonCol = qaReasonColForSheet(sourceSheet, reasonHeader);',
  '...qaSummaryReasonHeaders.map(reasonHeader => hCell(qaSummaryReasonLabel(reasonHeader)))',
]) {
  assert.ok(source.includes(contract), `XLSX reviewer-reason contract is missing: ${contract}`);
}

console.log('XLSX reviewer reasons verified for normal and compare views.');
