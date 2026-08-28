/**
 * Benchmarks: researchable MARKET facts, kept structurally apart from the
 * customer's own claims.
 *
 * WHY THIS EXISTS
 *
 * The honesty rule that correctly blocks invented facts was also blocking
 * legitimately researchable market facts, and that is the direct cause of
 * **98 of 256 sections rendering empty**. "Pricing", "Hours table", "Service
 * menu" came back blank not because the pipeline failed but because the only
 * two categories available were `facts[]` (needs a verified source about THIS
 * business) and `not_found[]`.
 *
 * THE DISTINCTION, STATED ONCE SO IT IS NEVER BLURRED
 *
 *   "this shop charges $30"              -> a BUSINESS fact.
 *                                           Stays not_found until the customer
 *                                           supplies it. Never researched into
 *                                           existence.
 *
 *   "fades in this market run $25-$35"   -> a MARKET fact.
 *                                           Researchable, verifiable against
 *                                           real sources, and publishable as an
 *                                           indicative range clearly marked.
 *
 * **A benchmark may never be rendered as the customer's own claim.** That is not
 * enforced by asking a writer to remember it. Per the standing rule -- arrange
 * for the dangerous thing not to be present -- a benchmark is handed downstream
 * ALREADY FRAMED as a market statement, and any rendering that converts it into
 * a first-person claim is rejected.
 */

export const BENCHMARK_KINDS = ['pricing', 'hours_pattern', 'service_menu', 'demographic', 'seasonality'];
export const BENCHMARK_APPLIES_TO = ['market', 'category', 'locality'];
export const DISPLAY_RULES = ['indicative', 'range_only', 'never_as_own_claim'];
export const CONFIDENCE = ['high', 'medium', 'low'];

/**
 * Which section types each benchmark kind can supply. This is the section-supply
 * contract from the typed-research design, applied to the category that was
 * causing the empty sections in the first place.
 */
export const SUPPLIES_SECTION_TYPES = {
  pricing: ['pricing', 'services', 'packages'],
  hours_pattern: ['hours', 'visit', 'contact'],
  service_menu: ['services', 'menu', 'treatments'],
  demographic: ['audience', 'about', 'language'],
  seasonality: ['seasonal', 'availability', 'booking'],
};

function fail(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

/** Shape-check one candidate. Returns null when it cannot be a benchmark. */
export function sanitizeBenchmark(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const claim = typeof entry.claim === 'string' ? entry.claim.trim() : '';
  if (!claim) return null;
  if (!BENCHMARK_KINDS.includes(entry.kind)) return null;

  const sources = Array.isArray(entry.sources)
    ? entry.sources.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
    : [];

  return {
    claim,
    kind: entry.kind,
    sources,
    applies_to: BENCHMARK_APPLIES_TO.includes(entry.applies_to) ? entry.applies_to : 'market',
    // Default is the most restrictive rule, not the most permissive. A
    // benchmark whose display rule the model failed to state is not licence to
    // render it freely.
    display_rule: DISPLAY_RULES.includes(entry.display_rule) ? entry.display_rule : 'never_as_own_claim',
    confidence: CONFIDENCE.includes(entry.confidence) ? entry.confidence : 'low',
    supplies_section_types: SUPPLIES_SECTION_TYPES[entry.kind] || [],
  };
}

export function sanitizeBenchmarks(list) {
  return (Array.isArray(list) ? list : []).map(sanitizeBenchmark).filter(Boolean);
}

/**
 * Benchmarks earn their place the same way facts do: by a fetch this process
 * performed. A benchmark with no confirmable source is not downgraded to a
 * softer claim -- it is dropped, with a reason.
 */
export async function verifyBenchmarks(candidates, { verifySourceUri, looksLikeHttpUrl, fetchImpl } = {}) {
  const kept = [];
  const rejected = [];
  for (const b of sanitizeBenchmarks(candidates)) {
    const urls = b.sources.filter((s) => looksLikeHttpUrl(s));
    if (!urls.length) {
      rejected.push({ claim: b.claim, reason: 'no retrievable source was given for this market claim; a benchmark without a source is indistinguishable from an invented one' });
      continue;
    }
    const verdicts = await Promise.all(urls.map((u) => verifySourceUri(u, { fetchImpl })));
    const confirmed = urls.filter((_, i) => verdicts[i]?.ok);
    if (!confirmed.length) {
      rejected.push({ claim: b.claim, reason: `none of ${urls.length} cited source(s) could be independently re-fetched` });
      continue;
    }
    kept.push({
      ...b,
      sources: confirmed,
      verified_at: new Date().toISOString(),
      verification_state: 'source_confirmed',
    });
  }
  return { benchmarks: kept, rejected };
}

// First person, and possessive forms that turn a market range into a price list.
const OWN_CLAIM = /\b(we|our|i|my|us)\b|\bours\b/i;

/**
 * frameForCopy: hand a writer a benchmark that is ALREADY a market statement.
 *
 * The writer never receives a bare "$25-$35". It receives "In this market,
 * fades typically run $25-$35", so the shape that reaches the page is the
 * shape that is true. This is prevention, not a guard.
 */
export function frameForCopy(benchmark) {
  const scope = { market: 'In this market', category: 'For this kind of business', locality: 'Locally' }[benchmark.applies_to] || 'In this market';
  const stripped = benchmark.claim.replace(/^(typical(ly)?|generally|usually)[,:\s]+/i, '');
  return {
    kind: benchmark.kind,
    display_rule: benchmark.display_rule,
    confidence: benchmark.confidence,
    sources: benchmark.sources,
    // What the writer is given, verbatim.
    framed: `${scope}, ${stripped.charAt(0).toLowerCase()}${stripped.slice(1)}`,
    must_not: 'state this as the business\'s own price, hours, or menu; it describes the market, not this customer',
  };
}

/**
 * assertNotOwnClaim: reject copy that converted a benchmark into a first-person
 * claim. The last line of defence, after framing has already made it unlikely.
 */
export function assertNotOwnClaim(body, benchmark) {
  if (typeof body !== 'string' || !body.trim()) return null;
  // Find the numeric or distinctive core of the benchmark in the body.
  const core = (benchmark.claim.match(/\$[\d,]+(\s*[-–]\s*\$?[\d,]+)?|\d+(\.\d+)?%/g) || [])[0];
  if (!core) return null;
  const idx = body.indexOf(core);
  if (idx < 0) return null;
  // Look at the sentence carrying it, not the whole body: a page may legitimately
  // say "we" elsewhere.
  const start = body.lastIndexOf('.', idx) + 1;
  const endRaw = body.indexOf('.', idx);
  const sentence = body.slice(start, endRaw < 0 ? body.length : endRaw);
  if (OWN_CLAIM.test(sentence)) {
    return `benchmark "${benchmark.claim}" is rendered as the business's own claim ("${sentence.trim().slice(0, 80)}"); it describes the market and may only appear as an indicative range`;
  }
  return null;
}
