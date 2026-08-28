// Deterministic imagery plumbing for tests.
//
// The imagery adapter does a preflight HTTP probe and then one HTTP GET per
// slot against a live generator. A test must never do either.
//
// Nothing passed imageryOptions before 2026-08-25, and it did not matter,
// because the research stub declared no media prompts -- so `media_slots.length`
// was zero, the executor's guard skipped the stage, and imagery was never
// exercised by any pipeline test. Confirmed by probe, not by reading: fetch was
// never called and no preflight was ever recorded.

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * @param opts.failPreflight  generator unavailable: every slot must stay
 *   declared-unfilled with a reason, and nothing may be substituted.
 * @param opts.rateLimitAfter after N successful slots, return HTTP 429, to
 *   exercise the backoff path rather than assuming it works.
 */
export function makeImageryStub({ failPreflight = false, rateLimitAfter = Infinity } = {}) {
  let served = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (failPreflight) return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    served += 1;
    if (served > rateLimitAfter) {
      return { ok: false, status: 429, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => PNG_1x1.buffer.slice(PNG_1x1.byteOffset, PNG_1x1.byteOffset + PNG_1x1.byteLength),
    };
  };
  return { fetchImpl, calls, get served() { return served; } };
}
