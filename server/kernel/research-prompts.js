// The shay-native model contract (server/kernel/research.js): what the prompt
// asks the claude CLI for, and how the JSON it returns is sanitized against
// that same shape. Kept separate from research.js so the two halves of "what
// we asked for" and "what we accept back" change together and stay obviously
// in sync, without touching dispatch, CLI invocation, or fetch-verification
// logic. No I/O here -- string building and pure shape-sanitizing only,
// nothing that needs a test double.
//
// This prompt is paired, in research.js, with a CLI invocation that grants
// exactly two tools via --allowedTools: WebSearch and WebFetch (see
// RESEARCH_ALLOWED_TOOLS below). Verified live against the real `claude` CLI
// on this build (2026-08-23): a plain `claude -p` with no --allowedTools never
// attempts a search and reasons from training data only; adding
// `--allowedTools WebSearch,WebFetch` (as two argv tokens, with -p placed
// AFTER the tools value so the CLI's variadic tools flag does not swallow the
// prompt argument -- confirmed the hard way, see research.js) lets the CLI
// actually search and fetch, and it does: a real run against
// {"business_name":"The Beehive Studio","business_category":"Hair salon",...}
// came back with a real Setmore booking page it had fetched, with real
// address/hours/pricing/policy facts and a real Instagram profile. research.js
// never trusts that self-report on its own -- every source_uri the CLI
// returns is independently re-fetched in code before it is allowed into
// facts[] (see verifyFactCandidates in research.js).

// The only tools this adapter ever grants the CLI. A research call has no
// legitimate reason to touch the filesystem or run a shell command, so
// nothing else is ever passed to --allowedTools.
export const RESEARCH_ALLOWED_TOOLS = 'WebSearch,WebFetch';

const RESPONSE_SHAPE = JSON.stringify({
  facts: [{ claim: '...', source_uri: 'https://...', verification_state: 'verified|unverified' }],
  open_questions: ['...'],
  benchmarks: [{ claim: '...', kind: 'pricing|hours_pattern|service_menu|demographic|seasonality', sources: ['https://...'], applies_to: 'market|category|locality', display_rule: 'indicative|range_only|never_as_own_claim', confidence: 'high|medium|low' }],
  confidence_notes: '...',
  brand: { palette_direction: '...', type_direction: '...', imagery_direction: '...', voice: '...' },
  site_needs: { pages: ['...'], sections_per_page: { '<page name>': ['...'] }, offers: ['...'], ctas: ['...'] },
  media_prompts: [{ slot: '...', prompt: '...' }],
  seo_targets: { keywords: ['...'], meta_direction: '...' },
});

/**
 * Builds the single prompt sent to the claude CLI for one shay-native research
 * run. `brief` is serialized verbatim so the model sees exactly what the
 * operator supplied, however thin.
 */
export function buildResearchPrompt(brief) {
  const briefJson = JSON.stringify(brief ?? {}, null, 2);
  return [
    'You are a research assistant preparing a Research Packet to help build a small business website.',
    'You have WebSearch and WebFetch tools available in this call -- use them. Search for the business named below plus its stated location/category to try to find its real, current web presence: official site if any, Google Business Profile / Maps listing, Yelp or other review platform, booking platform, social profiles, or (for regulated trades) a state licensing/registry lookup. Prefer primary and official sources over aggregator guesses.',
    '',
    'Business brief (verbatim, as given by the operator):',
    briefJson,
    '',
    'Produce STRICT JSON ONLY, no markdown fences, no prose before or after -- your entire response must be exactly one JSON object matching this shape:',
    RESPONSE_SHAPE,
    '',
    'Hard rules on facts[] (violating these makes the output actively harmful downstream, worse than an empty array):',
    '- Only include an entry in facts[] if source_uri is a URL you actually retrieved (via WebSearch/WebFetch in this call) or are otherwise highly confident is real, specific, and actually supports the claim.',
    '- Never invent, guess, or pattern-generate a plausible-looking URL (no "https://example.com/...", no guessed business domains, no placeholder pages) just to make an entry qualify as a fact.',
    '- If a search finds nothing, or finds something ambiguous / not clearly this specific business, say so in open_questions rather than guessing. If you are reasoning from general knowledge or inference rather than a specific real source, that is NOT a fact -- put it in open_questions instead, or fold it into brand/site_needs/seo_targets as a direction rather than a claim.',
    '- Every fact you do include will be independently re-fetched and checked before anything downstream trusts it, so cite the real URL you actually saw, not a summary of it.',
    '- BENCHMARKS are MARKET facts, and they are a different thing from facts[]. "This shop charges $30" is a claim about THIS business: it belongs in facts[] only with a source about this business, and otherwise stays unknown. "Fades in this market run $25-$35" is a claim about the market: it is researchable, and it belongs in benchmarks[] with the sources you actually read. A benchmark needs a real retrievable source exactly like a fact does.',
    '- Benchmarks are what make a proof read researched rather than hollow. Pricing ranges, typical opening hours for the category, the usual service menu, relevant local demographics, and seasonality are all legitimate to research even when nothing about this specific business is findable. Use them.',
    '- A benchmark describes the market and must NEVER be written as the customer\'s own price, hours or menu. Set display_rule accordingly.',
    '- It is completely correct and expected for facts[] to stay empty when nothing verifiable turns up, especially for a thin brief. An empty facts[] with honest open_questions is a GOOD result. A fabricated fact is a failure.',
    '',
    'Guidance for the rest of the packet:',
    '- brand/site_needs/media_prompts/seo_targets are your creative and strategic judgment based on the brief (and anything real you found) -- directions and recommendations, not verifiable claims, so they do not need source_uri.',
    '- media_prompts: one entry per image/media slot the site needs (e.g. hero, team, gallery), each a usable generation prompt.',
    '- confidence_notes: 2-4 honest sentences on what you actually found vs inferred vs could not determine, and whether search turned up anything at all.',
    '- If the brief is thin or search turns up little, say so plainly in confidence_notes and lean on open_questions rather than invented specifics.',
    '',
    'Do not add fields outside this shape. Do not wrap the object in another object.',
  ].join('\n');
}

// --- Sanitizers for the JSON the CLI hands back ------------------------
// Never trust the shape of model output. Every field below is read
// defensively and coerced to the narrowest honest shape; anything that
// doesn't fit is dropped rather than passed through, so a malformed or
// partial CLI response can never corrupt the packet or crash the run.

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function emptySiteNeeds() {
  return { pages: [], sections_per_page: {}, offers: [], ctas: [] };
}

export function sanitizeStringArray(v) {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
}

export function sanitizeBrand(v) {
  if (!isPlainObject(v)) return {};
  const out = {};
  for (const key of ['palette_direction', 'type_direction', 'imagery_direction', 'voice']) {
    if (typeof v[key] === 'string' && v[key].trim()) out[key] = v[key].trim();
  }
  return out;
}

export function sanitizeSiteNeeds(v) {
  if (!isPlainObject(v)) return emptySiteNeeds();
  const sections_per_page = {};
  if (isPlainObject(v.sections_per_page)) {
    for (const [page, sections] of Object.entries(v.sections_per_page)) {
      const list = sanitizeStringArray(sections);
      if (page.trim() && list.length) sections_per_page[page.trim()] = list;
    }
  }
  return { pages: sanitizeStringArray(v.pages), sections_per_page, offers: sanitizeStringArray(v.offers), ctas: sanitizeStringArray(v.ctas) };
}

export function sanitizeMediaPrompts(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m) => m && typeof m === 'object' && typeof m.slot === 'string' && m.slot.trim() && typeof m.prompt === 'string' && m.prompt.trim())
    .map((m) => ({ slot: m.slot.trim(), prompt: m.prompt.trim() }));
}

export function sanitizeSeoTargets(v) {
  if (!isPlainObject(v)) return { keywords: [], meta_direction: '' };
  return { keywords: sanitizeStringArray(v.keywords), meta_direction: typeof v.meta_direction === 'string' ? v.meta_direction.trim() : '' };
}

export function brandHasContent(b) {
  return Object.keys(b).length > 0; // sanitizeBrand only ever sets a key when it has real content
}
export function siteNeedsHasContent(sn) {
  return sn.pages.length > 0 || Object.keys(sn.sections_per_page).length > 0 || sn.offers.length > 0 || sn.ctas.length > 0;
}
export function seoTargetsHasContent(seo) {
  return seo.keywords.length > 0 || Boolean(seo.meta_direction);
}
