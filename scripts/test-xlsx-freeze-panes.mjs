import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dashboard/scripts/app.js', import.meta.url), 'utf8');

const patchStart = source.indexOf('function xmlAttrEscape(');
const patchEnd = source.indexOf('function patchWorksheetDataValidationXml(', patchStart);
assert.notEqual(patchStart, -1, 'xmlAttrEscape is missing');
assert.notEqual(patchEnd, -1, 'freeze patch boundary is missing');
const patchSource = source.slice(patchStart, patchEnd);
const patchWorksheetFreezeXml = new Function(`"use strict"; ${patchSource}; return patchWorksheetFreezeXml;`)();
const fixture = '<?xml version="1.0"?><worksheet><dimension ref="A1:C9"/><sheetViews><sheetView workbookViewId="0"><selection activeCell="B2" sqref="B2"/></sheetView></sheetViews><sheetData/></worksheet>';
const patched = patchWorksheetFreezeXml(fixture, { ySplit: 3, topLeftCell: 'A4', activePane: 'bottomLeft' });

assert.equal((patched.match(/<pane\b/g) || []).length, 1, 'worksheet must contain exactly one frozen pane');
assert.match(patched, /<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"\/>/);
assert.match(patched, /<selection pane="bottomLeft" activeCell="A4" sqref="A4"\/>/);
assert.equal((patchWorksheetFreezeXml(patched, { ySplit: 3 }).match(/<pane\b/g) || []).length, 1, 'patch must be idempotent');

const targetSheets = [
  'รายเส้นทางที่เปรียบเทียบ',
  'ขาดทุน',
  'สำรองน้ำมัน > 50%',
  'ราคาจ่ายผิดปกติ',
  'ราคารับผิดปกติ',
  'ข้อมูลไม่เปลี่ยนแปลง',
  'ไม่มีข้อมูลเปรียบเทียบ'
];
for (const sheetName of targetSheets) {
  assert.ok(source.includes(`'${sheetName}'`), `${sheetName} must remain in the normal-view freeze list`);
}
assert.match(source, /patchWorksheetFreezeXml\(patchedXml, opts\.freeze\)/, 'writer must serialize the freeze pane');
assert.match(source, /if \(_isSingleMode\) \{[\s\S]*normalViewFreezeSheetNames\.forEach[\s\S]*freezeRows = 3;/, 'freeze rows must be enabled only in normal view');

console.log('Normal-view XLSX freeze panes verified for all seven requested sheets.');
