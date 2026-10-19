# Business Hour Evaluator

A small, dependency-free TypeScript/JavaScript library that decides whether a given epoch-millisecond timestamp falls within defined business hours for a named IANA timezone, with optional lunch-break exclusion and weekend skipping.

## Usage

```js
import { BusinessHourEvaluator } from './src/index.js';

const hours = new BusinessHourEvaluator({
  timeZone: 'America/New_York',
  open: '09:00',
  close: '17:00',
  lunchStart: '13:00',
  lunchEnd: '14:00',
  // workdays defaults to [1,2,3,4,5] (Mon-Fri, 0=Sunday)
});

hours.isOpenAt(Date.now());
```

Run the tests with `node --test` (ESM). The test suite uses fixed hand-computed timestamps; it never touches the wall clock.

## Why this exists

The problem is straightforward to state and surprisingly fiddly to solve correctly: "is this instant within this wall-clock window in this timezone?" Timezones have DST, and `Date` objects in JavaScript are always UTC under the hood with formatting layered on top. Constructing the epoch instant that corresponds to "09:00 local in Europe/London" requires care, because the constructor interprets its arguments in the runtime's local zone, not the target zone.

This library resolves wall-clock times in the target zone by formatting candidate instants via `Intl.DateTimeFormat` with `timeZone` set, reading back the actual wall-clock they produce, and shifting to the desired wall-clock. This is the only portable, dependency-free way to do it — it leans on the platform's own tz data. The trade-off is that the result is only as correct as the runtime's ICU database, which in practice is good enough for almost all real schedules and is the same data any third-party library would ship.

## Boundary semantics

All time windows are **half-open**: `[start, end)`. The open boundary is inclusive, the close boundary is exclusive. The lunch break follows the same rule: it removes `[lunchStart, lunchEnd)`. So a schedule of 09:00-17:00 with lunch 13:00-14:00 is open at exactly 09:00:00.000, closed at exactly 13:00:00.000, open again at exactly 14:00:00.000, and closed at exactly 17:00:00.000. One rule, applied everywhere — no special-casing endpoints.

## The awkward edges you will hit

- **Overnight schedules are not supported.** `open` must be strictly less than `close`. A 22:00-06:00 night shift would require spanning two calendar days and re-resolving the next day's boundaries; that is deliberately out of scope. The constructor throws if `open >= close`.

- **Weekend definition is fixed as "any day not in `workdays`".** We do not attempt locale-specific weekends (e.g. Friday-Saturday in some Gulf states). If you need that, pass the appropriate `workdays` array. Weekday numbering is 0=Sunday through 6=Saturday, matching `Date.prototype.getDay`.

- **DST gap/overlap days (spring forward, fall back) are handled by the formatter**, but the wall-clock instants that fall in a non-existent hour (e.g. 02:30 on a spring-forward day in `America/New_York`) will still resolve to *some* epoch — the formatter picks the canonical interpretation — and `isOpenAt` will answer based on that. If your schedule's open or close lands exactly in a DST gap, the resolved instant may differ from naive expectation; this is inherent to wall-clock-to-epoch conversion in any library.

- **The runtime's ICU timezone database is authoritative.** If your Node was built against a stale or stripped ICU, some timezone names may be rejected. This is the cost of zero third-party dependencies.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

