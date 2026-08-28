/**
 * The imagery adapter: fills declared media slots with real generated images.
 *
 * Design constraints, all load-bearing:
 *
 * - **Preflight before spend.** A cheap availability probe runs before any slot
 *   is attempted, so an unreachable generator costs one request rather than
 *   twelve. This is the pattern the salvage pass found in the prior system.
 * - **Parallel from the start.** The efficiency audit found media filling would
 *   be the next serial bottleneck the moment it was wired: 11 slots at ~2.5s
 *   each is ~28s sequential and ~7s at a concurrency of 4. Built concurrent
 *   rather than retrofitted.
 * - **Budget cap.** max_images_per_run is a hard ceiling. Slots beyond it are
 *   left declared-unfilled with an honest reason, never silently dropped.
 * - **Fail means declared-unfilled. NEVER substitute.** No placeholder, no
 *   stock photo, no gradient, no reused image from another site. A slot that
 *   could not be filled says so, and the site renders honestly without it.
 * - **A slot may be marked `commissioned`.** Three states, not two: filled,
 *   unfilled, commissioned. A direction that needs a recurring character, a
 *   scene language, or motion cannot get it from a prompt, and filling such a
 *   slot with something competent-and-generic settles for less than the
 *   direction asked for. A commissioned slot is held out BEFORE the budget is
 *   spent and waits for a human. This is the same never-substitute rule applied
 *   one level up: to a slot the adapter COULD fill but should not.
 *
 * Provenance note: generation runs through a keyless public endpoint, so no API
 * key or paid account is involved. Every filled slot records the provider, the
 * exact prompt sent, the endpoint, the byte count and a sha256 of the actual
 * bytes written, so an image can always be traced to what asked for it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadImageryConfig() {
  const file = path.resolve(HERE, '../../config/imagery.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildUrl(config, prompt) {
  const encoded = encodeURIComponent(String(prompt).slice(0, 900));
  return `${config.endpoint}/${encoded}?width=${config.width}&height=${config.height}&nologo=true`;
}

/**
 * preflight: is the generator reachable and returning image bytes at all?
 * Returns { available, reason, duration_ms }. Never throws.
 */
export async function preflight({ config = loadImageryConfig(), fetchImpl = fetch } = {}) {
  if (!config.enabled) {
    return { available: false, reason: 'imagery is disabled in config/imagery.json', duration_ms: 0 };
  }
  const started = Date.now();
  try {
    const res = await fetchImpl(buildUrl(config, 'a plain grey square, test pattern'), {
      signal: AbortSignal.timeout(config.preflight_timeout_ms ?? 20000),
    });
    const duration_ms = Date.now() - started;
    if (!res.ok) {
      return { available: false, reason: `generator responded HTTP ${res.status}`, duration_ms };
    }
    const type = res.headers?.get?.('content-type') || '';
    if (!/^image\//.test(type)) {
      return { available: false, reason: `generator returned content-type '${type}', not an image`, duration_ms };
    }
    return { available: true, reason: null, duration_ms, provider: config.provider };
  } catch (error) {
    return { available: false, reason: `generator unreachable: ${error.message}`, duration_ms: Date.now() - started };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// randomImpl and sleepImpl are injectable so a test can prove the backoff
// SCHEDULE without spending the wall-clock time it describes.
async function generateOne({ slot, config, fetchImpl, outDir, site_id, randomImpl = Math.random, sleepImpl = sleep }) {
  const started = Date.now();
  if (!slot.prompt) {
    return { ...slot, state: 'unfilled', fill_error: 'no prompt was declared for this slot; nothing to generate from' };
  }
  // A slot with no id has no filename. Writing `undefined.jpg` and reporting
  // 'filled' is worse than failing: two such slots silently collide on one
  // file, and the summary claims both succeeded. Observed during calibration.
  // Reject instead. The derivation path always sets id, so this only fires for
  // a malformed caller — which is exactly when a silent success is most costly.
  const slotId = typeof slot.id === 'string' ? slot.id.trim() : '';
  if (!slotId || !/^[A-Za-z0-9._-]+$/.test(slotId)) {
    return {
      ...slot,
      state: 'unfilled',
      fill_error: slotId
        ? `slot id ${JSON.stringify(slotId)} is not a safe filename; refusing to write it`
        : 'slot has no id, so it has no filename; refusing to write undefined.jpg and report success',
    };
  }
  try {
    const url = buildUrl(config, slot.prompt);
    // A keyless public generator rate-limits, and a 429 is a "wait", not a
    // "no". Observed on a real 9-slot run: concurrency 4 with no backoff filled
    // 2 of 9 and lost the rest to 429s. Retried with growing waits, a 429 stops
    // costing us the slot. Bounded so a genuinely throttled generator still
    // ends as declared-unfilled rather than hanging the build.
    // EXPONENTIAL, not linear. The previous schedule multiplied a 4s base by the
    // attempt number (4s, 8s, 12s, 16s): it waits too long on the first retry,
    // when the limiter has usually already cleared, and grows too slowly when it
    // has not. Exponential from 1s (1, 2, 4, 8) recovers faster in the common
    // case and backs off harder in the bad one.
    //
    // FULL JITTER matters more than the schedule once slots run concurrently:
    // without it, N workers that hit a 429 in the same window all sleep the same
    // duration and retry in lockstep, reproducing the burst that caused the
    // limit. Each worker instead waits a random point in [0, delay].
    const maxAttempts = Math.max(1, Number(config.rate_limit_retries) || 1);
    const initial = Number(config.rate_limit_backoff_initial_ms) || 1000;
    const multiplier = Number(config.rate_limit_backoff_multiplier) || 2;
    let res;
    let waited_ms = 0;
    let rate_limited = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(config.timeout_ms ?? 60000) });
      if (res.status !== 429 || attempt === maxAttempts) break;
      rate_limited += 1;
      const ceiling = initial * (multiplier ** (attempt - 1));
      const delay = Math.round(randomImpl() * ceiling);
      waited_ms += delay;
      await sleepImpl(delay);
    }
    if (rate_limited) {
      // Recorded per slot: a slot that only arrived after backoff is not the
      // same as one that arrived first time, and a summary that hides that
      // makes a throttled provider look healthy.
      slot = { ...slot, rate_limited_attempts: rate_limited, backoff_waited_ms: waited_ms };
    }
    if (!res.ok) {
      return { ...slot, state: 'unfilled', fill_error: `generator responded HTTP ${res.status}` };
    }
    const type = res.headers?.get?.('content-type') || '';
    if (!/^image\//.test(type)) {
      return { ...slot, state: 'unfilled', fill_error: `generator returned content-type '${type}', not an image` };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      return { ...slot, state: 'unfilled', fill_error: 'generator returned zero bytes' };
    }
    const ext = type.includes('png') ? 'png' : 'jpg';
    const filename = `${slotId}.${ext}`;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, filename), bytes);
    return {
      ...slot,
      state: 'filled',
      asset_ref: `media/${filename}`,
      filled_by: {
        provider: config.provider,
        endpoint: config.endpoint,
        prompt_sent: slot.prompt,
        content_type: type,
        bytes: bytes.length,
        sha256: sha256(bytes),
        duration_ms: Date.now() - started,
        generated_at: new Date().toISOString(),
        site_id,
      },
      fill_error: null,
    };
  } catch (error) {
    return { ...slot, state: 'unfilled', fill_error: `generation failed: ${error.message}` };
  }
}

/**
 * fillMediaSlots: attempt every declared slot, concurrently and within budget.
 * Returns { slots, summary, preflight }. Never throws; a slot that cannot be
 * filled comes back unfilled with a reason.
 */
export async function fillMediaSlots({
  slots = [],
  paths,
  site_id,
  config = loadImageryConfig(),
  fetchImpl = fetch,
  randomImpl = Math.random, sleepImpl = sleep,
} = {}) {
  const declared = Array.isArray(slots) ? slots : [];
  const pre = await preflight({ config, fetchImpl });

  if (!pre.available) {
    // Every slot stays declared-unfilled, each carrying WHY. No substitution.
    return {
      preflight: pre,
      slots: declared.map((s) => ({ ...s, state: 'unfilled', fill_error: pre.reason })),
      summary: { declared: declared.length, filled: 0, commissioned: 0, unfilled: declared.length, skipped_over_budget: 0, provider: config.provider, preflight_ok: false, note: `Imagery generator unavailable: ${pre.reason}. Slots are declared and unfilled; nothing was substituted.` },
    };
  }

  // A direction may mark a slot as needing commissioned work. That is a
  // DECISION, not a failure: the bar for this slot is above what a generator
  // reaches, so generating something competent-and-generic would quietly settle
  // for less than the direction asked for. Held out before the budget is spent,
  // so a commissioned slot never consumes a generation attempt.
  //
  // This is the same discipline the adapter already applies to a slot it cannot
  // fill: say so honestly rather than substitute. Applied one level up, to a
  // slot it COULD fill but should not.
  const isCommissioned = (s) => Boolean(s) && (s.state === 'commissioned' || s.needs_commissioned_work === true);
  const commissioned = declared
    .filter(isCommissioned)
    .map((s) => ({
      ...s,
      state: 'commissioned',
      fill_error: null,
      note: s.commission_brief
        ? `held for commissioned work: ${s.commission_brief}`
        : 'the direction marked this slot as needing commissioned work; no generation was attempted',
    }));
  // Predicate, not array membership: the commissioned list holds spread COPIES,
  // so an identity check silently matched nothing and every commissioned slot
  // was ALSO sent to the generator — appearing twice in the result and pushing
  // the counts past `declared`.
  const generatable = declared.filter((s) => !isCommissioned(s));

  const budget = Math.max(0, Number(config.max_images_per_run) || 0);
  const attempt = generatable.slice(0, budget);
  const overBudget = generatable.slice(budget).map((s) => ({
    ...s,
    state: 'unfilled',
    fill_error: `over the per-run budget of ${budget} images; declared but not attempted`,
  }));

  const outDir = paths.within('sites', site_id, 'media');
  const limit = Math.max(1, Number(config.concurrency) || 1);
  const results = new Array(attempt.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= attempt.length) return;
      results[i] = await generateOne({ slot: attempt[i], config, fetchImpl, outDir, site_id, randomImpl, sleepImpl });
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, attempt.length || 1) }, worker));

  const finalSlots = [...results.filter(Boolean), ...overBudget, ...commissioned];
  const filled = finalSlots.filter((s) => s.state === 'filled').length;
  const commissionedCount = commissioned.length;
  return {
    preflight: pre,
    slots: finalSlots,
    summary: {
      declared: declared.length,
      filled,
      commissioned: commissionedCount,
      // Count the state, do not infer it. `finalSlots.length - filled` counted
      // every commissioned slot as unfilled, so declared/filled/commissioned/
      // unfilled stopped adding up the moment a third state existed.
      unfilled: finalSlots.filter((s) => s.state === 'unfilled').length,
      skipped_over_budget: overBudget.length,
      provider: config.provider,
      preflight_ok: true,
      concurrency: limit,
      // Say what actually happened. Reporting 'every slot was filled with a
      // generated image' while two were deliberately held for commissioned work
      // would misdescribe a decision as an outcome.
      note: (() => {
        const parts = [];
        if (filled) parts.push(`${filled} filled by generation`);
        if (commissionedCount) parts.push(`${commissionedCount} held for commissioned work (no generation attempted)`);
        const unfilledCount = finalSlots.filter((x) => x.state === 'unfilled').length;
        if (unfilledCount) parts.push(`${unfilledCount} unfilled, each carrying its reason`);
        return `${parts.join('; ')}. Nothing was substituted.`;
      })(),
    },
  };
}
