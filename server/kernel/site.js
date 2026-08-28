// Single shared predicate module for the five site denominators (amendment A6).
// No other file may classify a site. Rules and their evidence fields are exported
// as DENOMINATORS so the UI can render the rule text verbatim.
import fs from 'node:fs';
import { classifyCapability } from './spec-derive.js';

const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h: how old a live verification probe may be

export const DENOMINATORS = {
  directories: {
    rule: 'top-level entries under the sites root that are directories',
    evidence: ['siteDir'],
  },
  valid_spec: {
    rule: 'directory contains spec.json that parses as JSON',
    evidence: ['siteDir', 'spec.json'],
  },
  customer: {
    rule: 'valid_spec and spec.customer.id is set',
    evidence: ['spec.customer.id'],
  },
  deployable: {
    rule: 'customer and spec.deploy.target is set',
    evidence: ['spec.deploy.target'],
  },
  live: {
    rule:
      'deployable and spec.deploy.receipt.target equals spec.deploy.canonical_target (declared explicitly, not inferred), is not a preview/staging target, is labeled environment production when labeled at all, and ' +
      'spec.deploy.receipt.verified_at is a probe timestamp inside the freshness window ' +
      '(never inferred from the filesystem)',
    evidence: ['spec.deploy.receipt.target', 'spec.deploy.receipt.verified_at'],
  },
};

// THE SEAM, but tolerant: list() below calls this for every STUDIO directory
// it already knows exists, so this must not 404 on a site resolveSite() can't
// place (list() iterates the studio root directly; a name that happens to
// collide with nothing in the portfolio scan is still a perfectly normal
// studio site). get() below resolves identity explicitly and separately, so
// its own 404 for a genuinely unknown site still happens there.
function readSpec(paths, siteId, knownDir = null) {
  let specDir = knownDir;
  if (!specDir) {
    try {
      specDir = paths.resolveSite(siteId).dir;
    } catch {
      return null;
    }
  }
  const specPath = `${specDir}/spec.json`;
  if (!fs.existsSync(specPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch {
    return null;
  }
}

function isFreshProbe(verifiedAt, now = Date.now()) {
  if (!verifiedAt) return false;
  const ts = Date.parse(verifiedAt);
  if (Number.isNaN(ts)) return false;
  const age = now - ts;
  return age >= 0 && age <= FRESHNESS_WINDOW_MS;
}

// A deployment being reachable is not the same as a site being live. "Live" means
// the CANONICAL PRODUCTION target specifically: a fresh probe against a preview or
// staging deployment must never render as a green live site.
const NON_PRODUCTION_TOKENS = new Set(['preview', 'staging', 'stage', 'test', 'dev', 'sandbox', 'draft']);

// A target is usually a URL, so token boundaries must include '/' and ':' as well
// as dots and dashes. Splitting on every non-alphanumeric character means
// https://staging.acme.com and https://prod.acme.com/staging are both rejected.
function namesNonProduction(target) {
  return String(target)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => NON_PRODUCTION_TOKENS.has(token));
}

function isLive(spec) {
  const deploy = spec?.deploy;
  const receipt = deploy?.receipt;
  if (!receipt || !receipt.target) return false;

  // The canonical production target must be declared explicitly. Falling back to
  // deploy.target would let whatever was configured last count as production.
  const canonical = deploy.canonical_target;
  if (!canonical) return false;
  if (receipt.target !== canonical) return false;

  // Belt and braces: an environment label, when present, must say production, and
  // a target that names itself preview/staging is rejected regardless.
  if (receipt.environment && String(receipt.environment).toLowerCase() !== 'production') return false;
  if (namesNonProduction(receipt.target)) return false;

  return isFreshProbe(receipt.verified_at);
}

// Origin: is this a real customer site or an artifact of testing?
//
// Console counts that mix the two are the inefficiency that justified the
// rebuild: a directory count of 11 reads as 11 businesses when most are
// fixtures. Origin is DECLARED in the spec and only inferred where inference is
// defensible. Anything we cannot defend is 'unknown', never optimistically
// 'legit' -- an unknown that shows up in the console as needing declaration is
// honest; a guess that inflates the customer count is the exact failure being
// corrected.
export const ORIGIN_VALUES = ['legit', 'test', 'unknown'];

// Confirmed legit by the operator (2026-08-23): the famtastic-* family and the
// mbsh family are real properties.
const LEGIT_PREFIXES = ['famtastic-', 'mbsh'];

// Fixtures and harness output produced by this rebuild's own tooling. These are
// exact, not fuzzy: 'site-' alone is NOT a test marker, because real sites use
// it too (site-auntie-gale-garage-sales is a real property).
const TEST_PREFIXES = [
  'canon-', 'v2-', 'retry', 'shadow-', 'smoke-', 'probe-', 'acme-',
  'site-empty', 'site-partial', 'site-ok', 'site-mixed', 'site-rejected',
  'site-thin', 'site-noretry', 'test-',
];

/**
 * classifyOrigin(siteId, spec) -> 'legit' | 'test' | 'unknown'
 * A declared spec.origin always wins over inference.
 */
export function classifyOrigin(siteId, spec) {
  const declared = spec?.origin;
  if (typeof declared === 'string' && ORIGIN_VALUES.includes(declared) && declared !== 'unknown') {
    return declared;
  }
  const id = String(siteId || '');
  if (LEGIT_PREFIXES.some((p) => id.startsWith(p))) return 'legit';
  if (TEST_PREFIXES.some((p) => id.startsWith(p))) return 'test';
  return 'unknown';
}

function zeroOriginCounts() {
  return { legit: 0, test: 0, unknown: 0 };
}

// classify(siteDir) -> one of directories | valid_spec | customer | deployable | live
export function classify(siteDir) {
  if (!siteDir || !fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    return null;
  }
  const specPath = `${siteDir}/spec.json`;
  if (!fs.existsSync(specPath)) return 'directories';
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch {
    return 'directories';
  }
  if (!spec.customer?.id) return 'valid_spec';
  if (!spec.deploy?.target) return 'customer';
  if (!isLive(spec)) return 'deployable';
  return 'live';
}

function zeroDenominators() {
  return Object.fromEntries(
    Object.entries(DENOMINATORS).map(([key, def]) => [key, { value: 0, rule: def.rule }]),
  );
}

function lastTouch(paths, siteId, knownDir = null) {
  try {
    return fs.statSync(knownDir || paths.within('sites', siteId)).mtime.toISOString();
  } catch {
    return null;
  }
}

function countPages(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${entry.name}`;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.html')) count += 1;
    }
  }
  return count;
}

export function createSite({ paths }) {
  function list() {
    const root = paths.root('sites');
    if (!fs.existsSync(root)) {
      // Same shape as the ok branch. A consumer reading denominators_by_origin
      // must never get undefined just because the root is missing.
      return {
        status: 'NOT_FOUND',
        root,
        denominators: zeroDenominators(),
        denominators_by_origin: { legit: zeroDenominators(), test: zeroDenominators(), unknown: zeroDenominators() },
        origin_counts: zeroOriginCounts(),
        capability_counts: { brochure: 0, application: 0 },
        sites: [],
      };
    }

    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    const denominators = zeroDenominators();
    // Per-origin denominators sit ALONGSIDE the totals rather than replacing
    // them, so the A6 contract is unchanged and the console can show both the
    // raw count and the count that means something.
    const denominators_by_origin = { legit: zeroDenominators(), test: zeroDenominators(), unknown: zeroDenominators() };
    const origin_counts = zeroOriginCounts();
    const capability_counts = { brochure: 0, application: 0 };
    const sites = [];

    for (const entry of entries) {
      const siteId = entry.name;
      const siteDir = paths.within('sites', siteId);
      const denominatorClass = classify(siteDir);
      if (!denominatorClass) continue;

      const specPath = `${siteDir}/spec.json`;
      const specPresent = fs.existsSync(specPath);

      const specForOrigin = readSpec(paths, siteId, siteDir);
      const origin = classifyOrigin(siteId, specForOrigin);
      origin_counts[origin] += 1;
      // What KIND of site this is. A console that counts an application beside
      // a brochure site implies Studio could rebuild both; it can only rebuild
      // one and deploy the other.
      const capability_class = classifyCapability(specForOrigin);
      capability_counts[capability_class] += 1;

      for (const bucket of [denominators, denominators_by_origin[origin]]) {
        bucket.directories.value += 1;
        if (['valid_spec', 'customer', 'deployable', 'live'].includes(denominatorClass)) {
          bucket.valid_spec.value += 1;
        }
        if (['customer', 'deployable', 'live'].includes(denominatorClass)) bucket.customer.value += 1;
        if (['deployable', 'live'].includes(denominatorClass)) bucket.deployable.value += 1;
        if (denominatorClass === 'live') bucket.live.value += 1;
      }

      sites.push({
        id: siteId,
        denominator_class: denominatorClass,
        origin,
        origin_declared: typeof specForOrigin?.origin === 'string',
        capability_class,
        studio_can_rebuild: capability_class === 'brochure',
        spec_present: specPresent,
        last_touch: lastTouch(paths, siteId, siteDir),
      });
    }

    return { status: 'ok', root, denominators, denominators_by_origin, origin_counts, capability_counts, sites };
  }

  // THE SEAM. Studio and portfolio sites alike. A portfolio site with no
  // imported spec yet is not "not found" -- classify() already reports that
  // honestly as 'directories' (dir exists, no spec.json), so it reaches the
  // Editor as a real site the operator can open, asking to be imported,
  // rather than 404ing until the importer happens to have run.
  function get(siteId) {
    const resolved = paths.resolveSite(siteId);
    const siteDir = resolved.dir;
    const denominatorClass = classify(siteDir);
    if (!denominatorClass) {
      throw Object.assign(new Error(`site not found: ${siteId}`), {
        statusCode: 404,
        code: 'site_not_found',
      });
    }
    const spec = readSpec(paths, siteId, siteDir);
    return {
      site_id: siteId,
      spec,
      denominator_class: denominatorClass,
      pages_count: countPages(siteDir),
      last_touch: lastTouch(paths, siteId, siteDir),
      source: resolved.source,
      portfolio: resolved.source === 'portfolio' ? {
        domain: resolved.entry.domain,
        capability_class: resolved.entry.capability_class,
        backend_evidence: resolved.entry.backend_evidence,
        origin: resolved.entry.origin,
      } : null,
    };
  }

  return { list, get, classify, DENOMINATORS };
}
