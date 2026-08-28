/**
 * Measurement records: a number, and everything needed to know whether to
 * still believe it.
 *
 * WHY
 *
 * "Research is ~99% of build time" was measured correctly on 2026-08-23, quoted
 * as fact on 2026-08-25, and was wrong by then: two model-backed stages had been
 * added in between and research was 24-32%. I used the stale number to diagnose
 * a regression and reached the wrong conclusion, twice.
 *
 * That is the fifth instance of one pattern this week, and the same shape as the
 * stale RULING problem ADR-0011 fixed with `circumstance` and expiry: both a
 * stale ruling and a stale metric look authoritative, and neither announces its
 * own age. R2 is therefore extended from rulings to measurements.
 *
 * A measurement without its conditions is an anecdote. A measurement without an
 * expiry is a future mistake.
 */

export const MEASUREMENT_SCHEMA_VERSION = 1;

/** Default shelf life. Short, because this system changes weekly. */
export const DEFAULT_TTL_DAYS = 14;

/**
 * record: build a measurement record.
 *
 * `invalidated_by` is the important field and the one a plain timestamp cannot
 * replace: it names what would make this number wrong. "Research is 99%" did not
 * go stale with time, it went stale when a stage was added -- so an expiry alone
 * would not have caught it, but "adding or removing a model-backed stage" would.
 */
export function record({
  metric, value, unit,
  measured_at, conditions = {},
  invalidated_by = [], ttl_days = DEFAULT_TTL_DAYS, note = '',
} = {}) {
  if (!metric) throw new Error('a measurement needs a metric name');
  if (value === undefined || value === null) throw new Error(`measurement ${metric} has no value`);
  if (!measured_at) throw new Error(`measurement ${metric} has no measured_at; an undated number is an anecdote`);
  if (!conditions || typeof conditions !== 'object' || !Object.keys(conditions).length) {
    throw new Error(`measurement ${metric} has no conditions; the same build measured on a loaded machine and an idle one are different numbers`);
  }
  const at = Date.parse(measured_at);
  if (Number.isNaN(at)) throw new Error(`measurement ${metric} has an unparseable measured_at`);
  return {
    schema_version: MEASUREMENT_SCHEMA_VERSION,
    metric, value, unit: unit || null,
    measured_at,
    expires_at: new Date(at + ttl_days * 86400000).toISOString(),
    conditions,
    invalidated_by: [...invalidated_by],
    note,
  };
}

/** Is this number still safe to quote? */
export function isStale(measurement, now = Date.now()) {
  if (!measurement?.expires_at) return true;
  return Date.parse(measurement.expires_at) <= now;
}

/**
 * assertFresh: throw rather than let a stale number be quoted as fact.
 * The failure mode being prevented is not "the number is slightly old", it is
 * "a decision was made from it".
 */
export function assertFresh(measurement, now = Date.now()) {
  if (isStale(measurement, now)) {
    const err = new Error(
      `measurement "${measurement?.metric}" expired ${measurement?.expires_at} (measured ${measurement?.measured_at}). Re-measure before quoting it. It would also be invalidated by: ${(measurement?.invalidated_by || []).join('; ') || 'nothing recorded'}`,
    );
    err.code = 'stale_measurement';
    throw err;
  }
  return measurement;
}
