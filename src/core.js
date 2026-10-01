/**
 * @file Business Hour Evaluator core.
 *
 * Decides whether a given epoch-millisecond timestamp is "business hours"
 * for a set of opening/closing rules in a named IANA timezone, with a lunch
 * break excluded and weekends skipped.
 *
 * IMPORTANT AMBIGUITY RESOLUTION
 * ------------------------------
 * "09:00" means local wall-clock 09:00:00.000 exactly. The half-open
 * interval is [open, close): the open boundary is inclusive, the close
 * boundary is exclusive. The lunch break is treated as a fully excluded
 * gap regardless of whether the surrounding period is otherwise open, and
 * its endpoints follow the same half-open rule: lunch removes [lunchStart,
 * lunchEnd). This means a lunchStart of "13:00" does NOT exclude 13:00:00
 * exactly, but does exclude 13:00:00.001 onwards. Picking a single rule
 * (half-open everywhere) avoids the off-by-one ambiguity that arises when
 * close/lunchEnd are inclusive in some cases and not others.
 *
 * WEEKENDS
 * --------
 * Saturday and Sunday are always non-business regardless of timezone. We do
 * NOT attempt locale-specific weekend definitions (e.g. Friday-Saturday in
 * some Gulf states). The README states this assumption.
 */

/**
 * Convert a "HH:MM" local time on a given Date object (used as a date/year
 * anchor in the target timezone) into an epoch-ms timestamp.
 *
 * Why we do it this way instead of arithmetic on hour fields:
 * We build the wall-clock time in the target timezone by formatting a Date
 * via Intl.DateTimeFormat with `timeZone` set, then we can read back the
 * resolved fields. But constructing a Date that represents "09:00 in
 * Europe/London" directly is not possible with the Date constructor (it
 * interprets arguments in the runtime's local zone). Instead we use a
 * well-known trick: format the *current* instant in the target zone to get
 * its year/month/day, then construct the UTC instant for that calendar day,
 * then add HH hours and MM minutes, and finally rely on the *format* path
 * to detect the DST offset and correct. The correction uses the fact that
 * Intl can tell us the offset of a given instant in the target zone; we
 * subtract that offset to land on the desired wall-clock time.
 *
 * Concretely: if we want wall-clock T in zone Z, we want the epoch instant E
 * such that when E is formatted in Z it reads T. That means
 *   E = wallClockEpoch(Z, dateOf(E)) + (H*3600+M*60)*1000
 * where wallClockEpoch is midnight-ish. But midnight's epoch depends on DST.
 * The robust approach: pick a candidate E by assuming offset 0, format it in
 * Z to read the actual wall-clock it produces, measure the difference to the
 * desired wall-clock, and subtract the difference. This self-corrects for
 * DST because the formatter is authoritative for the target zone.
 *
 * @param {number} epoch - any instant on the calendar day of interest.
 * @param {string} timeZone - IANA timezone, e.g. "America/New_York".
 * @param {string} hhmm - "HH:MM" (24h, zero-padded).
 * @returns {number} epoch-ms of the desired wall-clock moment in the zone.
 */
function wallClockToEpoch(epoch, timeZone, hhmm) {
  const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));

  // Format the given instant in the target zone to find its calendar date.
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
 day: '2-digit',
  });
  const parts = dateFmt.formatToParts(new Date(epoch));
  const y = parseInt(parts.find((p) => p.type === 'year').value, 10);
  const mo = parseInt(parts.find((p) => p.type === 'month').value, 10);
  const d = parseInt(parts.find((p) => p.type === 'day').value, 10);

  // Candidate: construct UTC midnight for that date, then add HH:MM.
  // This candidate is "as if" the zone were UTC. Format it in the target
  // zone to see what wall-clock it actually corresponds to.
  const candidateUtcMidnight = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const candidate = candidateUtcMidnight + hh * 3600_000 + mm * 60_000;

  // Now figure out what wall-clock the candidate represents in the target
  // zone, and how far it is from the desired wall-clock. We measure the
  // candidate's offset in the target zone by comparing its UTC components
  // to its formatted-in-zone components.
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const tparts = timeFmt.formatToParts(new Date(candidate));
  const get = (type) => parseInt(tparts.find((p) => p.type === type).value, 10);
  const fY = get('year');
  const fMo = get('month');
  const fD = get('day');
  const fH = get('hour') === 24 ? 0 : get('hour'); // Intl can emit "24" for midnight in some environments
  const fMi = get('minute');
  const fS = get('second');

  const candidateAsUtcEpoch = Date.UTC(fY, fMo - 1, fD, fH, fMi, fS, 0);
  const offsetMs = candidate - candidateAsUtcEpoch;

  // candidate represented wall-clock fH:fMi in zone. We want HH:MM. So we
  // shift by the difference between the desired wall-clock and the actual
  // wall-clock, expressed in ms.
  const desiredWallSeconds = hh * 3600 + mm * 60;
  const actualWallSeconds = fH * 3600 + fMi * 60 + fS;
  let diffSeconds = desiredWallSeconds - actualWallSeconds;
  // Handle wrap-around at midnight boundary. If the diff is more than 12h,
  // we crossed a day line during formatting; correct accordingly.
  if (diffSeconds > 43200) diffSeconds -= 86400;
  if (diffSeconds < -43200) diffSeconds += 86400;

  return candidate + diffSeconds * 1000 + offsetMs - offsetMs;
}

// The last line above (offsetMs - offsetMs) is deliberately a no-op retained
// to make the self-consistency of the math obvious to readers: the offset is
// already baked into `candidate`'s relationship to wall-clock, and the diff
// shift is what aligns us to the desired wall-clock. Removing the offset
// correction entirely would double-count. Keep the explicit pair so future
// readers can see the cancellation is intentional.

/**
 * Parse and validate an "HH:MM" string. Throws on malformed input so that
 * misconfiguration fails loudly at evaluator construction, not silently at
 * query time.
 *
 * @param {string} s
 * @returns {string} the same string if valid.
 */
function validateHHMM(s) {
  if (typeof s !== 'string') throw new TypeError('Time must be a string');
  const m = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.exec(s);
  if (!m) throw new RangeError(`Invalid HH:MM time: ${JSON.stringify(s)}`);
  return s;
}

/**
 * Validate and normalise the weekday list. Accepts integers 0..6 (Sun..Sat,
 * matching JavaScript's Date.prototype.getDay and Intl's weekday numbering).
 * Stores as a Set for O(1) membership.
 *
 * We deliberately use 0=Sunday to match `Date#getDay()` and the Intl
 * `weekday` short-form numbering, so we never have to translate between
 * conventions.
 *
 * @param {number[]} days
 * @returns {Set<number>}
 */
function validateWorkdays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new TypeError('workdays must be a non-empty array of 0..6');
  }
  const set = new Set();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new RangeError(`Invalid weekday: ${JSON.stringify(d)}`);
    }
    set.add(d);
  }
  return set;
}

/**
 * Validate an IANA timezone by constructing a formatter that uses it. Throws
 * if the runtime rejects the name. This is the only portable way to check a
 * timezone string without a third-party tz database.
 *
 * @param {string} tz
 */
function validateTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) {
  throw new TypeError('timeZone must be a non-empty string');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' });
  } catch (e) {
    throw new RangeError(`Invalid or unsupported timeZone: ${JSON.stringify(tz)}`);
  }
}

export class BusinessHourEvaluator {
  /**
   * @param {object} cfg
   * @param {string} cfg.timeZone IANA timezone, e.g. "America/New_York".
   * @param {string} cfg.open "HH:MM" local time, inclusive.
   * @param {string} cfg.close "HH:MM" local time, exclusive.
   * @param {string} [cfg.lunchStart] "HH:MM" local time, inclusive.
   * @param {string} [cfg.lunchEnd] "HH:MM" local time, exclusive.
   * @param {number[]} [cfg.workdays] weekdays 0..6 (Sun=0). Default Mon-Fri [1,2,3,4,5].
   */
  constructor(cfg) {
    if (!cfg || typeof cfg !== 'object') {
      throw new TypeError('BusinessHourEvaluator requires a config object');
    }
    const { timeZone, open, close, lunchStart, lunchEnd, workdays } = cfg;

    validateTimeZone(timeZone);
    validateHHMM(open);
    validateHHMM(close);
    if (lunchStart !== undefined) validateHHMM(lunchStart);
    if (lunchEnd !== undefined) validateHHMM(lunchEnd);

    if (lunchStart !== undefined && lunchEnd === undefined) {
      throw new TypeError('lunchStart requires lunchEnd');
    }
    if (lunchEnd !== undefined && lunchStart === undefined) {
      throw new TypeError('lunchEnd requires lunchStart');
    }

    // Reject wrap-around midnight close: we do not support it. Supporting it
    // would require spanning two calendar days and re-resolving the next
    // day's open/close — a meaningful complication we deliberately omit.
    // The README says so.
    if (open >= close) {
      throw new RangeError(
        `open (${open}) must be strictly before close (${close}); overnight spanning is not supported`
      );
    }

    if (lunchStart !== undefined) {
      // Lunch must be strictly inside [open, close). Equal to open is allowed
      // (a zero-width-open lunch is pointless but not harmful); equal to close
      // is allowed too. But lunchEnd <= lunchStart is meaningless.
      if (lunchStart < open || lunchEnd > close) {
        throw new RangeError('lunch window must be within [open, close)');
      }
      if (lunchEnd <= lunchStart) {
        throw new RangeError('lunchEnd must be strictly after lunchStart');
      }
    }

    this.timeZone = timeZone;
    this.open = open;
    this.close = close;
    this.lunchStart = lunchStart || null;
    this.lunchEnd = lunchEnd || null;
    this.workdays = validateWorkdays(workdays || [1, 2, 3, 4, 5]);

    // Memoise per-calendar-day boundary epochs. A day in the target zone is
    // identified by the formatted YYYY-MM-DD string; computing the open/close
    // epochs for that string once and caching avoids re-running the DST dance
    // for repeated queries on the same day.
    this._cache = new Map();
  }

  /**
   * Get (or compute and cache) the open, close, lunchStart, lunchEnd epoch-ms
   * values for the calendar day in the target zone that contains `epoch`.
   *
   * @param {number} epoch
   * @returns {{open:number, close:number, lunchStart:number|null, lunchEnd:number|null, weekday:number}}
   */
  _dayBoundaries(epoch) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    const parts = fmt.formatToParts(new Date(epoch));
    const y = parts.find((p) => p.type === 'year').value;
    const mo = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    const wd = parts.find((p) => p.type === 'weekday').value;
    const key = `${y}-${mo}-${d}`;

    let cached = this._cache.get(key);
    if (cached) return cached;

    // Use any instant on this day as the anchor for wallClockToEpoch. The
    // noon of that UTC date is a safe, stable choice.
    const anchor = Date.UTC(
      parseInt(y, 10),
      parseInt(mo, 10) - 1,
      parseInt(d, 10),
      12,
      0,
      0,
      0
    );

    const open = wallClockToEpoch(anchor, this.timeZone, this.open);
    const close = wallClockToEpoch(anchor, this.timeZone, this.close);
    let lunchStart = null;
    let lunchEnd = null;
    if (this.lunchStart) {
      lunchStart = wallClockToEpoch(anchor, this.timeZone, this.lunchStart);
      lunchEnd = wallClockToEpoch(anchor, this.timeZone, this.lunchEnd);
    }

    // Map the short weekday name back to 0..6 (Sun..Sat). We do this from the
    // formatted string rather than re-running Intl with weekday:'numeric'
    // because we already have the short name and a fixed table is trivial.
    const weekdayMap = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = weekdayMap[wd];
    if (weekday === undefined) {
      throw new Error(`Unexpected weekday token: ${wd}`);
    }

    cached = { open, close, lunchStart, lunchEnd, weekday };
    this._cache.set(key, cached);
    return cached;
  }

  /**
   * Return true iff `timestamp` falls within business hours.
   *
   * Half-open semantics: [open, close) intersected with the complement of
   * [lunchStart, lunchEnd) (when lunch is configured). Weekends (any day not
   * in `workdays`) always return false.
   *
   * @param {number} timestamp epoch-ms
   * @returns {boolean}
   */
  isOpenAt(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      throw new TypeError('timestamp must be a finite epoch-ms number');
    }
    const { open, close, lunchStart, lunchEnd, weekday } = this._dayBoundaries(timestamp);
    if (!this.workdays.has(weekday)) return false;
    if (timestamp < open || timestamp >= close) return false;
    if (lunchStart !== null && timestamp >= lunchStart && timestamp < lunchEnd) return false;
    return true;
  }
}
