import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuietHours, isQuietTime, msUntilQuietStart, msUntilQuietEnd, wakerCronSchedule } from './quiet-hours';

const HOUR_MS = 3600_000;
const W = parseQuietHours('02-09')!;

test('parses 02-09', () => assert.deepEqual(W, { startHour: 2, endHour: 9 }));

test('rejects bad values', () => {
  assert.equal(parseQuietHours('2-2'), null);
  assert.equal(parseQuietHours('x'), null);
  assert.equal(parseQuietHours(undefined), null);
});

test('02:00 BRT is quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T05:00:00Z')), true));

test('01:59 BRT is not quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T04:59:00Z')), false));

test('09:00 BRT is not quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T12:00:00Z')), false));

test('wrapping window 22-06', () => {
  const w = parseQuietHours('22-06')!;
  assert.equal(isQuietTime(w, new Date('2026-11-21T01:00:00Z')), true);
  assert.equal(isQuietTime(w, new Date('2026-11-21T09:00:00Z')), false);
});

test('msUntilQuietStart from 09:00 BRT is 17h', () =>
  assert.equal(msUntilQuietStart(W, new Date('2026-11-21T12:00:00Z')), 17 * HOUR_MS));

test('msUntilQuietEnd from 02:00 BRT is 7h', () =>
  assert.equal(msUntilQuietEnd(W, new Date('2026-11-21T05:00:00Z')), 7 * HOUR_MS));

test('msUntilQuietEnd from 08:59:30 BRT is 30s', () =>
  assert.equal(msUntilQuietEnd(W, new Date('2026-11-21T11:59:30Z')), 30_000));

// The waker cron (UTC) must fire at the END of the window: a waker that
// fires inside the window only gets "dormindo" back and the bot sleeps all day.
test('wakerCronSchedule for 02-09 fires at 09h BRT (12h UTC)', () =>
  assert.equal(wakerCronSchedule(W), '0,15,30 12 * * *'));

test('wakerCronSchedule wraps past midnight UTC', () =>
  assert.equal(wakerCronSchedule(parseQuietHours('22-23')!), '0,15,30 2 * * *'));
