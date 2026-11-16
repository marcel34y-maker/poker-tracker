import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, centsToInput, settle } from '../money.js';

test('parseMoney: valid inputs', () => {
  const cases = {
    '20': 2000, '$20': 2000, ' 20 ': 2000, '€ 20': 2000, '£5': 500,
    '12.5': 1250, '12.50': 1250, '12.05': 1205, '.5': 50, '0.01': 1, '0': 0, '7.': 700,
    '1,250': 125000, '1,250.75': 125075, '1,000,000': 100000000,
    '12,50': 1250, '12,5': 1250, '0020': 2000,
  };
  for (const [input, cents] of Object.entries(cases)) {
    assert.equal(parseMoney(input), cents, `parseMoney(${JSON.stringify(input)})`);
  }
});

test('parseMoney: rejects bad input', () => {
  for (const input of ['', '   ', '.', 'abc', '12.345', '-5', '1.2.3', '12a', '1,25,0', '$', null, undefined, '1e3', '9999999999']) {
    assert.equal(parseMoney(input), null, `parseMoney(${JSON.stringify(input)})`);
  }
});

test('parseMoney: no float drift', () => {
  assert.equal(parseMoney('0.29'), 29); // 0.29*100 = 28.999999999999996 in floats
  assert.equal(parseMoney('1.15'), 115);
  assert.equal(parseMoney('4.35'), 435);
});

test('formatMoney', () => {
  assert.equal(formatMoney(2000), '$20');
  assert.equal(formatMoney(1250), '$12.50');
  assert.equal(formatMoney(1205, 'eur'), '€12.05');
  assert.equal(formatMoney(500, 'gbp'), '£5');
  assert.equal(formatMoney(125000, 'chips'), '1,250');
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(1, 'usd'), '$0.01');
  assert.equal(formatMoney(-1250), '−$12.50');
  assert.equal(formatMoney(-1250, 'usd', { ascii: true }), '-$12.50');
  assert.equal(formatMoney(3000, 'usd', { sign: true }), '+$30');
  assert.equal(formatMoney(0, 'usd', { sign: true }), '$0');
  assert.equal(formatMoney(123456789), '$1,234,567.89');
  assert.equal(formatMoney(2000, 'usd', { forceCents: true }), '$20.00');
  assert.throws(() => formatMoney(12.5));
});

test('parse/format round trip', () => {
  for (const c of [0, 1, 99, 100, 1250, 2000, 123456, 99999999]) {
    assert.equal(parseMoney(formatMoney(c, 'usd', { ascii: true })), c);
    assert.equal(parseMoney(centsToInput(c)), c);
  }
});

const sumBy = (list, key, id) => list.filter(p => p[key] === id).reduce((s, p) => s + p.amount, 0);
function checkSettles(entries, payments) {
  for (const e of entries) {
    const received = sumBy(payments, 'to', e.id);
    const paid = sumBy(payments, 'from', e.id);
    assert.equal(received - paid, e.net, `${e.id} ends at net`);
  }
  for (const p of payments) {
    assert.ok(Number.isInteger(p.amount) && p.amount > 0);
  }
}

test('settle: all even → no payments', () => {
  const e = [{ id: 'a', name: 'A', net: 0 }, { id: 'b', name: 'B', net: 0 }, { id: 'c', name: 'C', net: 0 }];
  assert.deepEqual(settle(e), []);
});

test('settle: one winner', () => {
  const e = [
    { id: 'a', name: 'Ann', net: 6000 },
    { id: 'b', name: 'Bob', net: -2000 },
    { id: 'c', name: 'Cat', net: -4000 },
  ];
  const p = settle(e);
  checkSettles(e, p);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { from: 'c', to: 'a', amount: 4000 }); // biggest debtor first
});

test('settle: many winners', () => {
  const e = [
    { id: 'a', name: 'A', net: 5000 },
    { id: 'b', name: 'B', net: 3000 },
    { id: 'c', name: 'C', net: 2000 },
    { id: 'd', name: 'D', net: -6000 },
    { id: 'e', name: 'E', net: -4000 },
  ];
  const p = settle(e);
  checkSettles(e, p);
  assert.ok(p.length <= e.length - 1);
  assert.deepEqual(p[0], { from: 'd', to: 'a', amount: 5000 });
});

test('settle: cents like $12.50', () => {
  const e = [
    { id: 'a', name: 'A', net: 1250 },
    { id: 'b', name: 'B', net: 3725 },
    { id: 'c', name: 'C', net: -2475 },
    { id: 'd', name: 'D', net: -2500 },
  ];
  const p = settle(e);
  checkSettles(e, p);
  assert.ok(p.some(x => x.amount === 1250 || x.amount === 1225));
});

test('settle: throws when not balanced', () => {
  assert.throws(() => settle([{ id: 'a', name: 'A', net: 100 }]));
});
