// Spec derivation: turn a Research Packet (or a bare brief) into a structured
// site spec. Split out of pipeline.js to keep that file under the size rule.
// Deliberately has no closure state and no filesystem access.
import { slugify, titleCase } from './pipeline-text.js';
import { deriveTokens, extractHexes, extractNamedColours } from './tokens.js';
import { deriveMediaSlots, bindSlotsToSections } from './media-slots.js';

// LATENT BUG, fixed here: `fail` was called by deriveSpecFromPacket's
// packet_required guard but never defined or imported in this module, so that
// guard threw a ReferenceError ("fail is not defined") instead of the structured
// error it intended. The guard has never worked. Matches the shape used in
// cards.js, canvas.js and conversation.js.
function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// Every section a spec carries must be a TYPED object. Research returns
// `sections_per_page` as plain strings ("Hero: name, positioning, city, Book
// CTA"), and those strings were previously passed through raw. Compose reads
// `section.type`, so an untyped section fell to the generic text branch: the
// hero was never a hero, and when imagery landed the hero image silently
// rendered nowhere while the generated files sat on disk. Nothing errored.
//
// Normalizing here rather than in compose is deliberate: the spec is the
// contract, and a spec that stores untyped sections is simply wrong, whoever
// happens to read it next.
export const SECTION_TYPES = ['hero', 'text', 'list', 'cta'];

// Cues are matched only at the START of a string, on the label a human wrote
// before the colon. A section that merely mentions "book" in its body is not a
// CTA, and guessing from anywhere in the text produces confident mislabelling.
const TYPE_CUES = [
  { type: 'hero', re: /^\s*hero\b/i },
  { type: 'cta', re: /^\s*(cta|call to action|book(ing)?\s+cta)\b/i },
];

// A heading is page language. These words are LAYOUT vocabulary -- the shape a
// designer was asked to build, not anything a visitor should read. A real build
// published "Final CTA band" and "Credential and license strip" as <h2> on a
// customer page.
//
// This is the same defect as outline-as-copy, in the sibling field: the body was
// routed through the copy stage and the heading was left echoing the note. Only
// unambiguous layout terms are listed. "At a glance" and "in brief" are ordinary
// English and are deliberately NOT here -- a detector that flags good headings
// trains you to ignore it.
const LAYOUT_VOCABULARY = /\b(band|strip|block|module|carousel|grid|rail|tile|slab|marquee|cta)\b/i;

export function isLayoutLabel(heading) {
  return typeof heading === 'string' && LAYOUT_VOCABULARY.test(heading);
}

function splitLabel(text) {
  const m = /^([^:.\u2014-]{3,60})(?:\s*[:\u2014-]\s*)(.+)$/s.exec(text);
  if (!m) return { heading: null, body: text.trim() };
  return { heading: m[1].trim(), body: m[2].trim() };
}

// WHY `instruction` AND `body` ARE DIFFERENT FIELDS
//
// Research declares sections as strings like:
//   "Hero: name, one-line clinical positioning, primary Book CTA"
//
// The half after the colon is an INSTRUCTION TO A WRITER. It is not copy. For
// five consecutive builds it was assigned straight to `body` and rendered, so
// every page published its own outline: "four short cards linking into
// Services" appeared on the customer's homepage as if it were a sentence.
//
// Every DOM check passed. One h1, correct heading order, real nav, no broken
// links, accessibility gate green. Structurally perfect and completely
// unshippable, because absence-checking cannot see a page that has all its
// parts and none of its substance.
//
// The fix is structural, not a better prompt. The instruction now lands in
// `instruction` and `body` starts NULL. A section with a null body renders
// nothing — the same honest-empty discipline the imagery adapter already uses
// for a slot it could not fill. Missing copy is now VISIBLE instead of being
// silently impersonated by the note that asked for it.
//
// A copy stage consumes `instruction` and writes `body`. Until one is wired,
// pages come out visibly short rather than convincingly wrong, and
// build-defects.mjs raises OUTLINE_AS_COPY the moment anything assigns an
// instruction back into a body.
function normalizeSection(entry, index, { isHome }) {
  // Already typed: keep it, but never let an unknown type through -- compose
  // would silently render it as generic text anyway, so the spec should say so.
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const type = SECTION_TYPES.includes(entry.type) ? entry.type : 'text';
    return { ...entry, type, id: entry.id || `section-${index + 1}` };
  }
  if (typeof entry !== 'string' || !entry.trim()) return null;

  const text = entry.trim();
  const cue = TYPE_CUES.find((c) => c.re.test(text));
  const { heading, body } = splitLabel(text);

  if (cue?.type === 'hero') {
    // A hero carries no heading: the page's own <h1> is the headline.
    // `instruction`, never `body` — see the note above normalizeSection.
    return { id: 'hero', type: 'hero', instruction: body || text, body: null };
  }
  if (cue?.type === 'cta') {
    // When the label IS just the cue word ("CTA: Book your first visit"), it is
    // a type marker, not a heading. Using it verbatim puts the literal word
    // "CTA" on the customer's page.
    const isBareCue = heading && /^(cta|call to action)$/i.test(heading.trim());
    return {
      id: `cta-${index + 1}`,
      type: 'cta',
      heading: isBareCue || !heading ? 'Get started' : heading,
      // A CTA's items are labels a human wrote, not prose to be generated.
      items: [body || text],
    };
  }
  // A layout label is part of the note, not a heading. It moves into the
  // instruction so the writer knows what the section is FOR, and the section
  // renders with no heading rather than with a production label.
  const headingIsLabel = isLayoutLabel(heading);
  const usableHeading = heading && !headingIsLabel ? heading : null;
  return {
    id: slugify(heading || `section-${index + 1}`) || `section-${index + 1}`,
    type: 'text',
    ...(usableHeading ? { heading: usableHeading } : {}),
    instruction: headingIsLabel ? `${heading}: ${body || text}` : (body || text),
    body: null,
  };
}

/**
 * normalizeSections: turn whatever research declared into typed sections.
 * On the home page, if nothing typed itself as the hero, the first section
 * becomes one -- a home page without a hero is a template failure, not a
 * legitimate shape, and compose anchors the hero image to it.
 */
export function normalizeSections(declared, { isHome = false } = {}) {
  const list = (Array.isArray(declared) ? declared : [])
    .map((entry, i) => normalizeSection(entry, i, { isHome }))
    .filter(Boolean);
  if (isHome && list.length && !list.some((sec) => sec.type === 'hero')) {
    // Promotion carries the INSTRUCTION and leaves body null, exactly like every
    // other section. Writing body directly here bypassed the instruction/body
    // split: the outline label landed in body, and because the copy stage only
    // fills a null body it skipped the section entirely, so the echo guard never
    // saw it. A real build published "Opening statement" as its hero. The
    // structural fix preserved the defect it existed to catch.
    const first = list[0];
    list[0] = {
      id: 'hero',
      type: 'hero',
      instruction: first.instruction || first.heading || first.body || '',
      body: null,
    };
  }
  return list;
}

// DERIVATION NEVER WRITES `body`. Ruled 2026-08-25 after the fourth instance of
// one pattern: a fix that preserved the defect in the one path that skipped its
// own discipline. Every section leaves here with an `instruction` and a NULL
// body, and only the copy stage -- whose echo guard rejects a body scoring too
// close to the instruction that asked for it -- may fill one.
//
// These defaults previously wrote body directly, including shippable
// placeholders like "More about X is coming soon." A placeholder that reaches a
// customer page is the same failure as an outline that reaches one: text that
// was never written for a reader.
function defaultSections({ id, isHome, businessName, description, offers, ctas }) {
  const sections = [];
  const about = description
    ? `Introduce ${businessName} to a first-time visitor, using: ${description}`
    : `Introduce ${businessName} to a first-time visitor`;
  if (isHome) {
    sections.push({ id: 'hero', type: 'hero', instruction: about, body: null });
    if (offers.length) sections.push({ id: 'offers', type: 'list', heading: 'What we offer', items: offers });
    sections.push({ id: 'cta', type: 'cta', heading: 'Get started', items: ctas });
  } else if (id === 'about') {
    sections.push({ id: 'about', type: 'text', heading: 'About', instruction: about, body: null });
  } else if (id === 'contact') {
    sections.push({ id: 'contact', type: 'cta', heading: 'Contact us', items: ctas });
  } else {
    const label = titleCase(id);
    sections.push({
      id: `${id}-intro`,
      type: 'text',
      heading: label,
      instruction: description
        ? `Write the ${label} section for ${businessName}, using: ${description}`
        : `Write the ${label} section for ${businessName}`,
      body: null,
    });
  }
  return sections;
}

/**
 * assertNoPreWrittenBody: the invariant, checkable.
 *
 * Called at the end of derivation so a future direct write fails HERE, loudly,
 * rather than surfacing months later as a page that reads slightly wrong. The
 * hero-promotion bypass rendered "Opening statement" to a real build and no test
 * caught it, because nothing asserted the invariant itself.
 */
export function assertNoPreWrittenBody(pages) {
  const offenders = [];
  for (const page of pages || []) {
    for (const sec of page.sections || []) {
      if (sec.body !== null && sec.body !== undefined) {
        offenders.push(`${page.id || '?'}/${sec.id || '?'}`);
      }
    }
  }
  if (offenders.length) {
    throw fail(
      500,
      'body_written_outside_copy_stage',
      `derivation wrote body for ${offenders.length} section(s) (${offenders.slice(0, 5).join(', ')}); only the copy stage may write body, so its echo guard cannot be bypassed`,
    );
  }
  return pages;
}

/**
 * deriveSpecFromPacket (ENDGAME item 9): a structured site spec from a
 * Research Packet. When the packet's execution_status is 'no_findings' (the
 * honest current state -- no research provider is connected), the spec is
 * derived from the brief itself and clearly marked 'brief-derived'. It never
 * invents business facts: page structure is scaffolding, not a claim.
 */
// The imagery bridge.
//
// Research produces 8-13 media prompts per brief. Before this, spec-derive
// dropped every one of them: the packet validated them, and nothing downstream
// ever read them. A site would be built with no media slots at all and nothing
// anywhere said media was missing.
//
// This does NOT generate images. Generation requires a paid image API and the
// standing rule is subscriptions and installed CLIs, never API keys, so the
// bridge stops at the honest boundary: it carries every prompt through as a
// DECLARED slot in state 'unfilled', with the prompt attached so an operator or
// a subscription-backed CLI can fill it later.
//
// An unfilled slot is a visible, countable gap. That is the entire point --
// the failure being corrected is media silently not existing.
export function deriveSpecFromPacket({ packet, brief, site_id }) {
  if (!packet) throw fail(400, 'packet_required', 'spec generation requires a research packet');

  // A spec is research-derived only when research actually contributed VERIFIED
  // facts. Keying this off execution_status alone let a packet with zero
  // verified facts call its spec research-derived just because the adapter ran
  // and returned strategic prose. That is the overclaim this field exists to
  // prevent: it is the operator's signal for how much of the spec is grounded.
  const verifiedFactCount = Array.isArray(packet.facts) ? packet.facts.length : 0;
  const derivation = verifiedFactCount > 0 ? 'research-derived' : 'brief-derived';
  const businessName = brief?.business?.name || packet.brand?.name || site_id;
  const description = brief?.business?.description || packet.brand?.description || '';
  const rawPageNames = packet.site_needs?.pages?.length ? packet.site_needs.pages : ['home', 'about', 'contact'];
  const offers = Array.isArray(packet.site_needs?.offers) ? packet.site_needs.offers : [];
  const ctas = Array.isArray(packet.site_needs?.ctas) && packet.site_needs.ctas.length ? packet.site_needs.ctas : ['Get in touch'];
  const sectionsPerPage = packet.site_needs?.sections_per_page || {};
  const artifact_bundle = brief?.artifact_bundle || packet.artifact_bundle || null;
  const backend = brief?.backend || packet.backend || null;
  const functional_contract = brief?.functional_contract || packet.functional_contract || null;
  const declaredCapability = brief?.capability_class || packet.capability_class;
  const capability_class = CAPABILITY_CLASSES.includes(declaredCapability)
    ? declaredCapability
    : (backend ? 'application' : 'brochure');
  const recipe = brief?.recipe || packet.recipe || brief?.archetype || packet.archetype || null;

  const seenIds = new Set();
  const pages = rawPageNames.map((rawName) => {
    let id = slugify(rawName === 'home' ? 'home' : rawName);
    if (rawName === 'home' || rawName === 'index') id = 'home';
    if (seenIds.has(id)) id = `${id}-${seenIds.size}`;
    seenIds.add(id);
    const isHome = id === 'home';
    const pagePath = isHome ? 'index.html' : `${id}.html`;
    const label = isHome ? 'Home' : titleCase(rawName);
    const title = isHome ? businessName : `${label} — ${businessName}`;
    const declared = sectionsPerPage[rawName] || sectionsPerPage[id];
    const normalized = normalizeSections(declared, { isHome });
    const sections = normalized.length
      ? normalized
      : defaultSections({ id, isHome, businessName, description, offers, ctas });
    return { id, path: pagePath, title, heading: isHome ? businessName : label, sections };
  });

  // Fails here, loudly, if any path wrote body directly.
  // Slots are bound AFTER pages exist, because a slot must serve a section.
  const media_slots = bindSlotsToSections(deriveMediaSlots(packet), pages);

  // Tokens are resolved HERE, once, so the composer never has to consult a
  // direction it might forget. brand.palette_direction stays for provenance —
  // it records what was asked for — but nothing downstream reads it.
  const designContract = packet.brand?.design_contract || brief?.design_contract || null;
  const explicitTokens = designContract?.tokens || packet.brand?.tokens || null;
  // Older FAMtastic snapshots used `palette: ['#...', '#...']` while the
  // research packet vocabulary used `palette_direction`. Accept both at this
  // seam so a valid selected design cannot silently fall back to platform white.
  let resolvedPaletteDir = packet.brand?.palette_direction
    || (Array.isArray(packet.brand?.palette) ? packet.brand.palette.join(', ') : '')
    || '';
  const packetHasColors = extractHexes(resolvedPaletteDir).length > 0 || extractNamedColours(resolvedPaletteDir).length > 0;
  if (!packetHasColors) {
    const briefPalette = brief?.business?.palette_direction || brief?.brand?.palette_direction || brief?.business?.style || '';
    if (briefPalette && (extractHexes(briefPalette).length > 0 || extractNamedColours(briefPalette).length > 0)) {
      resolvedPaletteDir = briefPalette;
    }
  }

  return {
    media_slots,
    media_summary: {
      declared: media_slots.length,
      filled: media_slots.filter((m) => m.state === 'filled').length,
      unfilled: media_slots.filter((m) => m.state === 'unfilled').length,
      note: media_slots.length === 0
        ? 'Research declared no media slots for this site.'
        : 'Slots are declared from research media prompts. At derivation time every slot starts unfilled; the imagery adapter fills them later in the run, and an unfilled slot at the end carries the reason it could not be filled.',
    },
    // A backend/application lane is explicit and carried, never guessed from
    // a screenshot. Studio can select the matching recipe and run behavioral
    // checks, but it must not imply that a visual proof proves a database,
    // login, cart, or portal works.
    capability_class,
    recipe,
    backend,
    functional_contract,
    generated_from: {
      packet_id: packet.packet_id,
      source_adapter: packet.source_adapter,
      execution_status: packet.execution_status,
      derivation,
      note: derivation === 'brief-derived'
        ? 'No research provider is connected in this build. This spec is derived directly from the submitted brief, not from research findings.'
        : 'Derived from research packet findings where the packet supplied them; unresolved items remain in open_questions rather than being guessed.',
    },
    tokens: deriveTokens({ paletteDirection: resolvedPaletteDir, explicitTokens }).tokens,
    tokens_provenance: (() => {
      const d = deriveTokens({ paletteDirection: resolvedPaletteDir, explicitTokens });
      return { source: d.source, declared: d.declared, note: d.note };
    })(),
    brand: {
      name: businessName,
      description,
      voice: packet.brand?.voice || null,
      palette_direction: resolvedPaletteDir || null,
      type_direction: packet.brand?.type_direction || null,
      design_contract: designContract,
    },
    pages,
    artifact_bundle,
    offers,
    ctas,
    seo_targets: packet.seo_targets || { keywords: [], meta_direction: '' },
    open_questions: packet.open_questions || [],
  };
}

// Per-stage executor bodies, shared between run() and retryStage(). Each
// returns { value, ...dna recordStage extras }; throwing is the only failure
// signal, caught uniformly by runStage() below. inputs/outputs carry
// `content` (not just `ref`) so dna.recordStage computes a REAL sha256
// digest for every artifact ref instead of leaving it digestless (A4).

// ---------------------------------------------------------------------------
// Option B: a backend Studio can carry but not author.
// ---------------------------------------------------------------------------

export const CAPABILITY_CLASSES = ['brochure', 'application'];

/**
 * classifyCapability(spec) -> 'brochure' | 'application'
 *
 * A declared class always wins. Otherwise a spec carrying a `backend` block is
 * an application, because that block is the only thing in the vocabulary that
 * implies a server-side runtime. Absent both, 'brochure' -- which is the honest
 * default, since everything derivation can produce is one.
 */
export function classifyCapability(spec) {
  const declared = spec?.capability_class;
  if (CAPABILITY_CLASSES.includes(declared)) return declared;
  return spec?.backend ? 'application' : 'brochure';
}

/**
 * attachBackend: register a backend Studio DEPLOYS AND VERIFIES but does not
 * generate or understand.
 *
 * This is deliberately opaque. Studio gets a directory, a schema file, a deploy
 * target and the checks that prove the thing is alive -- and no model of what is
 * inside. Claiming more would be the same overclaim as calling a spec
 * research-derived with zero verified facts.
 *
 * `verify` lists BEHAVIORAL checks, because for an application a rendered page
 * proves nothing: a form can post into a void and every DOM assertion still
 * passes. A backend with no behavioral checks is accepted but marked
 * `verification: 'none_declared'` so the gap is visible rather than implied.
 */
export function attachBackend(spec, backend) {
  if (!spec || typeof spec !== 'object') throw fail(400, 'spec_required', 'attachBackend requires a spec');
  if (!backend || typeof backend !== 'object') throw fail(400, 'backend_required', 'attachBackend requires a backend descriptor');
  if (!backend.root) throw fail(400, 'backend_root_required', 'a backend must name the directory Studio deploys');

  const checks = Array.isArray(backend.verify) ? backend.verify.filter((c) => c && c.name && c.kind) : [];
  return {
    ...spec,
    capability_class: 'application',
    backend: {
      root: backend.root,
      runtime: backend.runtime || 'unknown',
      schema_file: backend.schema_file || null,
      deploy_target: backend.deploy_target || null,
      migrate_command: backend.migrate_command || null,
      // Studio authored none of this. Saying so in the data prevents a future
      // reader treating a carried backend as a generated one.
      authored_by: backend.authored_by || 'external',
      studio_understands_contents: false,
      verify: checks,
      verification: checks.length ? 'behavioral_declared' : 'none_declared',
      note: checks.length
        ? 'Studio deploys this backend and runs the declared behavioral checks. It does not generate or model its contents.'
        : 'Studio deploys this backend but no behavioral checks are declared, so nothing proves it works. A rendered page is not proof for an application site.',
    },
  };
}
