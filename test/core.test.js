/**
 * Tests for the Business Hour Evaluator core.
 *
 * Every timestamp below is a fixed, hand-computed instant. We never assert
 * against wall-clock time. DST boundaries were chosen to exercise the
 * wallClockToEpoch self-correction logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BusinessHourEvaluator } from '../src/core.js';

// Helper: build an evaluator for a 9-17 Mon-Fri schedule with optional lunch.
function nineToFive(tz, opts = {}) {
  return new BusinessHourEvaluator({
    timeZone: tz,
    open: '09:00',
    close: '17:00',
    lunchStart: opts.lunch ? '13:00' : undefined,
    lunchEnd: opts.lunch ? '14:00' : undefined,
    workdays: opts.workdays,
  });
}

// Deterministic hand-picked instants (epoch-ms). Verified against public tz
// data for 2024. We pick a winter date and a summer date in each relevant zone
// to cross DST transitions.

// 2024-01-15 (Monday) 10:00 Europe/London (UTC+0, no BST in January).
const LONDON_MON_10H_JAN = Date.UTC(2024, 0, 15, 10, 0, 0, 0);
// 2024-01-15 09:00 London (exactly open).
const LONDON_MON_09H_JAN = Date.UTC(2024, 0, 15, 9, 0, 0, 0);
// 2024-01-15 17:00 London (exactly close — should be closed).
const LONDON_MON_17H_JAN = Date.UTC(2024, 0, 15, 17, 0, 0, 0);
// 2024-01-15 16:59:59.999 London (still open).
const LONDON_MON_165959_JAN = Date.UTC(2024, 0, 15, 16, 59, 59, 999);
// 2024-01-15 13:00 London (lunch start, inclusive — should be open for the
// [open, lunchStart) rule, but since lunchStart is itself inclusive in the
// lunch gap, lunch begins here; so with lunch this should be CLOSED).
const LONDON_MON_13H_JAN = Date.UTC(2024, 0, 15, 13, 0, 0, 0);
// 2024-01-15 14:00 London (lunch end, exclusive — should be open).
const LONDON_MON_14H_JAN = Date.UTC(2024, 0, 15, 14, 0, 0, 0);
// 2024-01-13 (Saturday) 10:00 London — weekend, closed.
const LONDON_SAT_10H_JAN = Date.UTC(2024, 0, 13, 10, 0, 0, 0);

// 2024-07-15 (Monday) 10:00 Europe/London (BST = UTC+1). So UTC instant is 09:00Z.
const LONDON_MON_10H_JUL = Date.UTC(2024, 6, 15, 9, 0, 0, 0);
// 2024-07-15 09:00 London = exactly open in BST. UTC = 08:00Z.
const LONDON_MON_09H_JUL = Date.UTC(2024, 6, 15, 8, 0, 0, 0);
// 2024-07-15 17:00 London = exactly close. UTC = 16:00Z.
const LONDON_MON_17H_JUL = Date.UTC(2024, 6, 15, 16, 0, 0, 0);

// New York is UTC-5 in winter (EST), UTC-4 in summer (EDT).
// 2024-01-15 (Mon) 10:00 America/New_York = 15:00Z.
const NYC_MON_10H_JAN = Date.UTC(2024, 0, 15, 15, 0, 0, 0);
// 2024-07-15 (Mon) 10:00 America/New_York (EDT) = 14:00Z.
const NYC_MON_10H_JUL = Date.UTC(2024, 6, 15, 14, 0, 0, 0);
// 2024-07-15 09:00 NYC (exactly open, EDT) = 13:00Z.
const NYC_MON_09H_JUL = Date.UTC(2024, 6, 15, 13, 0, 0, 0);
// 2024-07-15 17:00 NYC (exactly close, EDT) = 21:00Z.
const NYC_MON_17H_JUL = Date.UTC(2024, 6, 15, 21, 0, 0, 0);
// 2024-07-15 13:00 NYC (lunch start) = 17:00Z.
const NYC_MON_13H_JUL = Date.UTC(2024, 6, 15, 17, 0, 0, 0);
// 2024-07-15 14:00 NYC (lunch end) = 18:00Z.
const NYC_MON_14H_JUL = Date.UTC(2024, 6, 15, 18, 0, 0, 0);
// 2024-07-13 (Sat) 10:00 NYC = weekend.
const NYC_SAT_10H_JUL = Date.UTC(2024, 6, 13, 14, 0, 0, 0);

// Tokyo is UTC+9 year-round (no DST). 2024-01-15 (Mon) 10:00 JST = 01:00Z.
const TOKYO_MON_10H_JAN = Date.UTC(2024, 0, 15, 1, 0, 0, 0);
// 2024-01-15 09:00 JST = 00:00Z.
const TOKYO_MON_09H_JAN = Date.UTC(2024, 0, 15, 0, 0, 0, 0);
// 2024-01-15 17:00 JST = 08:00Z.
const TOKYO_MON_17H_JAN = Date.UTC(2024, 0, 15, 8, 0, 0, 0);

test('London winter: mid-morning is open', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_10H_JAN), true);
});

test('London winter: exact open boundary is inclusive', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_09H_JAN), true);
});

test('London winter: exact close boundary is exclusive', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_17H_JAN), false);
});

test('London winter: one ms before close is open', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_165959_JAN), true);
});

test('London summer (BST): mid-morning is open — DST handled', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_10H_JUL), true);
});

test('London summer: exact open boundary in BST', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_09H_JUL), true);
});

test('London summer: exact close boundary in BST is exclusive', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_17H_JUL), false);
});

test('Saturday in London is closed (default Mon-Fri)', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_SAT_10H_JAN), false);
});

test('Lunch start is inclusive in the gap: with lunch, 13:00 is closed', () => {
  const e = nineToFive('Europe/London', { lunch: true });
  assert.equal(e.isOpenAt(LONDON_MON_13H_JAN), false);
});

test('Lunch end is exclusive: 14:00 is open again', () => {
  const e = nineToFive('Europe/London', { lunch: true });
  assert.equal(e.isOpenAt(LONDON_MON_14H_JAN), true);
});

test('Without lunch, 13:00 is open (lunch not configured)', () => {
  const e = nineToFive('Europe/London');
  assert.equal(e.isOpenAt(LONDON_MON_13H_JAN), true);
});

test('New York winter (EST): 10:00 is open', () => {
  const e = nineToFive('America/New_York');
  assert.equal(e.isOpenAt(NYC_MON_10H_JAN), true);
});

test('New York summer (EDT): 10:00 is open — DST handled', () => {
  const e = nineToFive('America/New_York');
  assert.equal(e.isOpenAt(NYC_MON_10H_JUL), true);
});

test('New York summer: exact open boundary is inclusive', () => {
  const e = nineToFive('America/New_York');
  assert.equal(e.isOpenAt(NYC_MON_09H_JUL), true);
});

test('New York summer: exact close boundary is exclusive', () => {
  const e = nineToFive('America/New_York');
  assert.equal(e.isOpenAt(NYC_MON_17H_JUL), false);
});

test('New York summer: lunch start closes the gap', () => {
  const e = nineToFive('America/New_York', { lunch: true });
  assert.equal(e.isOpenAt(NYC_MON_13H_JUL), false);
});

test('New York summer: lunch end reopens', () => {
  const e = nineToFive('America/New_York', { lunch: true });
  assert.equal(e.isOpenAt(NYC_MON_14H_JUL), true);
});

test('New York Saturday is closed', () => {
  const e = nineToFive('America/New_York');
  assert.equal(e.isOpenAt(NYC_SAT_10H_JUL), false);
});

test('Tokyo (no DST): 10:00 is open', () => {
  const e = nineToFive('Asia/Tokyo');
  assert.equal(e.isOpenAt(TOKYO_MON_10H_JAN), true);
});

test('Tokyo: exact open boundary inclusive', () => {
  const e = nineToFive('Asia/Tokyo');
  assert.equal(e.isOpenAt(TOKYO_MON_09H_JAN), true);
});

test('Tokyo: exact close boundary exclusive', () => {
  const e = nineToFive('Asia/Tokyo');
  assert.equal(e.isOpenAt(TOKYO_MON_17H_JAN), false);
});

test('Custom workdays include Sunday-only schedule', () => {
  // Sunday 2024-01-14 10:00 London = 10:00Z.
  const sun = Date.UTC(2024, 0, 14, 10, 0, 0, 0);
  const e = new BusinessHourEvaluator({
    timeZone: 'Europe/London',
    open: '09:00',
    close: '17:00',
    workdays: [0], // Sunday only
  });
  assert.equal(e.isOpenAt(sun), true);
  // Monday should now be closed.
  assert.equal(e.isOpenAt(LONDON_MON_10H_JAN), false);
});

test('rejects wrap-around (open >= close)', () => {
  assert.throws(
    () => new BusinessHourEvaluator({ timeZone: 'UTC', open: '22:00', close: '06:00' }),
    /open .* must be strictly before close/
  );
});

test('rejects open === close', () => {
  assert.throws(
    () => new BusinessHourEvaluator({ timeZone: 'UTC', open: '09:00', close: '09:00' }),
    /strictly before/
  );
});

test('rejects lunch without lunchEnd', () => {
  assert.throws(
    () => new BusinessHourEvaluator({
      timeZone: 'UTC', open: '09:00', close: '17:00', lunchStart: '13:00',
    }),
    /lunchStart requires lunchEnd/
  );
});

test('rejects lunch outside [open, close)', () => {
  assert.throws(
    () => new BusinessHourEvaluator({
      timeZone: 'UTC', open: '09:00', close: '17:00',
      lunchStart: '08:00', lunchEnd: '10:00',
    }),
    /lunch window must be within/
  );
});

test('rejects lunchEnd <= lunchStart', () => {
  assert.throws(
    () => new BusinessHourEvaluator({
      timeZone: 'UTC', open: '09:00', close: '17:00',
      lunchStart: '13:00', lunchEnd: '13:00',
    }),
    /strictly after/
  );
});

test('rejects invalid HH:MM', () => {
  assert.throws(
    () => new BusinessHourEvaluator({ timeZone: 'UTC', open: '25:00', close: '17:00' }),
    /Invalid HH:MM/
  );
});

test('rejects invalid timezone', () => {
  assert.throws(
    () => new BusinessHourEvaluator({ timeZone: 'Not/A_Real_Zone', open: '09:00', close: '17:00' }),
    /Invalid or unsupported timeZone/
  );
});

test('rejects non-finite timestamp', () => {
  const e = nineToFive('Europe/London');
  assert.throws(() => e.isOpenAt(NaN), /timestamp must be/);
  assert.throws(() => e.isOpenAt('not-a-number'), /timestamp must be/);
});

test('same-day caching returns consistent results', () => {
  // Two calls on the same London January day should agree.
  const e = nineToFive('Europe/London');
  const a = e.isOpenAt(LONDON_MON_10H_JAN);
  const b = e.isOpenAt(LONDON_MON_10H_JAN);
  assert.equal(a, b);
});
