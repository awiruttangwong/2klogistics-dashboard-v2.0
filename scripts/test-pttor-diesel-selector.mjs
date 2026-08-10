import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('dashboard/API/Code.gs', 'utf8');
const context = vm.createContext({
  console,
  Utilities: {
    formatDate: () => '2026-07-03',
  },
});
vm.runInContext(source, context);

const records = [
  { PRICE_DATE: '2026-07-03T05:00', PRODUCT: 'ดีเซล B20', PRICE: '32.50' },
  { PRICE_DATE: '2026-07-03T05:00', PRODUCT: 'ดีเซล', PRICE: '37.50' },
  { PRICE_DATE: '2026-07-03T05:00', PRODUCT: 'เบนซิน', PRICE: '46.44' },
  { PRICE_DATE: '2026-07-03T05:00', PRODUCT: 'Super Power Diesel', PRICE: '50.05' },
];

const selected = context.selectDieselRows_(records, 'PTTOR');
assert.equal(selected.length, 1);
assert.equal(selected[0].date, '2026-07-03');
assert.equal(selected[0].price, 37.5);

assert.equal(context.getDieselRecordScore_({ PRODUCT: 'ดีเซล' }), 100);
assert.equal(context.getDieselRecordScore_({ PRODUCT: 'Diesel' }), 100);
assert.equal(context.getDieselRecordScore_({ PRODUCT: 'Super Power Diesel' }), 0);
assert.equal(context.getDieselRecordScore_({ PRODUCT: 'Premium Diesel' }), 0);
assert.equal(context.getDieselRecordScore_({ PRODUCT: 'ดีเซล B20' }), 0);
assert.equal(
  context.getDieselRecordScore_({ NOTE: 'ดีเซล', PRODUCT: 'Super Power X99' }),
  0,
);

console.log('PTTOR diesel selector test passed.');
