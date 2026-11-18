import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, parseDuration, formatDuration, durationToInput, sortSessions } from '../bankroll.js';

test('parseDuration', () => {
  const ok = { '3': 180, '3.5': 210, '3,5': 210, '3:30': 210, '0:45': 45, '.25': 15, '1.75': 105, '12': 720 };
  for (const [i, m] of Object.entries(ok)) assert.equal(parseDuration(i), m, i);
  for (const bad of ['', ' ', 'abc', '3:75', '100', '1.234', '-2', '.']) assert.equal(parseDuration(bad), null, bad);
});

test('formatDuration / durationToInput', () => {
  assert.equal(formatDuration(210), '3h 30m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(120), '2h');
  assert.equal(formatDuration(0), '');
  assert.equal(durationToInput(210), '3:30');
  assert.equal(parseDuration(durationToInput(95)), 95);
});

test('computeStats: empty', () => {
  const s = computeStats([], 50000);
  assert.equal(s.count, 0);
  assert.equal(s.bankroll, 50000);
  assert.equal(s.winRate, null);
  assert.equal(s.hourly, null);
  assert.deepEqual(s.series, []);
});

test('computeStats: mixed sessions with cents', () => {
  const sessions = [
    { id: 'c', date: '2026-11-10', createdAt: 3, buyIn: 4000, cashOut: 0, minutes: 120 },
    { id: 'a', date: '2026-11-01', createdAt: 1, buyIn: 2000, cashOut: 5750, minutes: 180 },
    { id: 'b', date: '2026-11-05', createdAt: 2, buyIn: 3250, cashOut: 3250 },
  ];
  const s = computeStats(sessions, 10000);
  assert.equal(s.count, 3);
  assert.equal(s.profit, -250); // +37.50, 0, −40
  assert.equal(s.bankroll, 9750);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.winRate, 33);
  assert.equal(s.avg, -83); // −250/3 rounded
  assert.equal(s.best, 3750);
  assert.equal(s.worst, -4000);
  assert.equal(s.minutes, 300);
  assert.equal(s.hourly, -50); // (3750 − 4000) over 5h = −$0.50/h
  assert.deepEqual(s.series.map(p => p.value), [13750, 13750, 9750]);
  assert.deepEqual(s.series.map(p => p.id), ['a', 'b', 'c']);
  for (const k of ['profit', 'bankroll', 'avg', 'hourly', 'best', 'worst']) assert.ok(Number.isInteger(s[k]), k);
});

test('sortSessions: same day keeps logging order', () => {
  const out = sortSessions([
    { id: '2', date: '2026-11-01', createdAt: 20 },
    { id: '1', date: '2026-11-01', createdAt: 10 },
    { id: '0', date: '2026-10-31', createdAt: 99 },
  ]);
  assert.deepEqual(out.map(s => s.id), ['0', '1', '2']);
});
