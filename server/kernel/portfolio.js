/**
 * The operator's real portfolio: `~/Development/FAMtastic/sites` and `.../Apps`.
 *
 * THIS SCAN IS READ-ONLY BY CONSTRUCTION -- it never writes, full stop. That is
 * a narrower claim than it used to be: the DIRECTORIES it scans are no longer
 * globally read-only. Ruled 2026-08-27: the editor writes directly into a real
 * site's files, through mutation.js's journal, exactly like a studio-generated
 * one. What stays true is that nothing in THIS FILE ever does. Classification
 * here answers "what is this and where does it live"; it is never the thing
 * deciding to change a byte.
 *
 * CLASSIFICATION IS FROM SIGNALS ON DISK, NEVER FROM A LIST
 *
 * Per the standing rule that capability truth is computed from probes rather
 * than documents: nothing here reads a manifest of "the real sites". It looks at
 * what is actually present -- a git remote, a `.site-context/`, a backend with a
 * schema, built output -- and reports what it found. A directory it cannot
 * classify is `unknown`, which the console shows as needing declaration, rather
 * than being quietly counted as real or quietly hidden.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Directories whose NAME is a deliberate probe or fixture. Exact suffix/prefix
// matching, not fuzzy: "site-demo" is a fixture, "site-the-daily-grind" is not.
const TEST_NAME = /(^|-)(probe|demo|poc|fixture|scratch|sandbox)(-|$)|^test-|-test$|\.pre-repair-|\bstage\d+\b/i;

function gitRemote(dir) {
  if (!exists(path.join(dir, '.git'))) return null;
  try {
    return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

function countHtml(dir, depth = 2) {
  let n = 0;
  const walk = (d, lvl) => {
    if (lvl > depth) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, lvl + 1);
      else if (e.name.endsWith('.html')) n += 1;
    }
  };
  walk(dir, 0);
  return n;
}

/**
 * Does this have a server-side runtime? Studio can carry such a site but cannot
 * rebuild it (MBSH-SPEC-GAP), so the answer decides capability_class.
 */
function backendEvidence(dir) {
  const be = path.join(dir, 'backend');
  if (!isDir(be)) return null;
  const found = [];
  if (exists(path.join(be, 'schema.sql'))) found.push('schema.sql');
  if (isDir(path.join(be, 'admin'))) found.push('admin/');
  if (isDir(path.join(be, 'lib'))) found.push('lib/');
  if (isDir(path.join(be, 'cron'))) found.push('cron/');
  let php = 0;
  try { php = fs.readdirSync(be).filter((f) => f.endsWith('.php')).length; } catch { /* ignore */ }
  if (php) found.push(`${php} php endpoint(s)`);
  return found.length ? found : null;
}

/** The site's public domain, when the repo declares one. CNAME is the only
 * declaration we trust; guessing a domain from a directory name would be a
 * fabricated claim on a customer-facing card. */
function domainOf(dir) {
  for (const rel of ['CNAME', 'dist/CNAME', 'frontend/dist/CNAME', 'public/CNAME']) {
    try {
      const v = fs.readFileSync(path.join(dir, rel), 'utf8').trim().split('\n')[0].trim();
      if (v && !v.includes(' ')) return v;
    } catch { /* keep looking */ }
  }
  // Backend config declares the site's own base URL (MBSH does this).
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'backend/config/site-config.json'), 'utf8'));
    const url = cfg.API_BASE_URL || cfg.BASE_URL || cfg.SITE_URL;
    if (url) return new URL(url).hostname;
  } catch { /* not declared */ }
  return null;
}

function lastTouch(dir) {
  try { return fs.statSync(dir).mtime.toISOString(); } catch { return null; }
}

// RULED 2026-08-27: 61 directories is not 61 sites. The operator has about
// nine. A directory qualifies as a SITE only through a deliberate signal --
// its own repo, a managed-site record, a declared domain, or deploy evidence --
// and same-domain/same-remote directories collapse into ONE site plus its
// experiments. Better nine correct entries than 59 honest ones.
//
// Two traps this rule exists to avoid, both hit by the first version:
// - `git remote` succeeds in ANY subdirectory of the monorepo by walking up to
//   the parent repo, so "has a remote" was true for fifty scratch dirs. Only a
//   directory with its OWN .git counts (gitRemote already enforces this).
// - spec.json is a pipeline artifact that every probe build emits. It is
//   evidence a build ran here, not that a business exists. The spec signal that
//   qualifies is .site-context/, the managed-site record.
const BACKUP_NAME = /\.pre-|backup|-\d{8}(-|$)/i;

function qualifies(name, signals, domain) {
  if (signals.site_context) return 'carries .site-context/, the managed-site record';
  if (signals.git_remote) return `its own git repo with remote ${signals.git_remote.replace(/.*[:/]/, '').replace(/\.git$/, '')}`;
  if (signals.git_repo) return 'its own git repo (no remote configured; git init is a deliberate act)';
  if (domain) return `declares the domain ${domain}`;
  if (signals.deploy_evidence) return `carries deploy evidence (${signals.deploy_evidence})`;
  return null;
}

function classify(name, signals, domain) {
  if (TEST_NAME.test(name)) {
    return { origin: 'test', reason: 'the directory name marks it as a probe, demo or fixture' };
  }
  const why = qualifies(name, signals, domain);
  if (why) return { origin: 'site', reason: why };
  return { origin: 'unclassified', reason: 'no own repo, no .site-context/, no domain, no deploy evidence -- nothing deliberate marks this as a real property' };
}

/**
 * Same domain or same remote means ONE site. The others are experiments on it,
 * not additional portfolio entries: site-mbsh-reunion-cinematic-proof and
 * site-mbsh-reunion-event-cinema share mbsh-reunion's repo remote and domain,
 * and they are one site plus two experiments, not three sites.
 *
 * Primary selection, in order: not a backup name; has .site-context; name
 * closest to the remote/domain; shortest name. Deterministic, no timestamps.
 */
function dedupeSites(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.origin !== 'site') continue;
    const key = (e.git_remote && e.git_remote.replace(/\.git$/, '')) || (e.domain && `dom:${e.domain.replace(/^api\./, '')}`) || `solo:${e.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const score = (e) => (BACKUP_NAME.test(e.id) ? 1000 : 0) + (e.site_context ? -100 : 0) + e.id.length;
    const primary = [...members].sort((a, b) => score(a) - score(b))[0];
    for (const e of members) {
      if (e === primary) continue;
      e.origin = BACKUP_NAME.test(e.id) ? 'test' : 'experiment';
      e.variant_of = primary.id;
      e.origin_reason = BACKUP_NAME.test(e.id)
        ? `a backup copy of ${primary.id} (name carries a backup marker)`
        : `an experiment on ${primary.id}: same ${e.git_remote ? 'git remote' : 'domain'}, so it is a variant, not another site`;
    }
  }
  return entries;
}

function loadOverrides() {
  try {
    const cfg = JSON.parse(fs.readFileSync(new URL('../../config/portfolio-overrides.json', import.meta.url), 'utf8'));
    return cfg.declare || {};
  } catch { return {}; }
}

// paths.js's resolveSite() calls this once or twice per file touched by a
// single edit (build the before/after manifest, then verify on undo). A cold
// scan walks every portfolio directory and shells out to `git remote` for each
// one with its own repo -- fine for one Sites-page load, not fine three times
// in the path of a click-to-edit that targets sub-second response. The
// portfolio's classification (which repo has a remote, which declares a
// domain) does not change from an ordinary content edit, so a short cache is
// free correctness: nothing an edit does can invalidate it, and a real
// classification change (a new site's first commit) is visible again within
// one cache lifetime, not tied to a server restart.
const SCAN_CACHE_MS = 10_000;
let scanCache = null; // { key, at, result }

export function scanPortfolio({ roots = {} } = {}) {
  const cacheKey = JSON.stringify(roots);
  const now = Date.now();
  if (scanCache && scanCache.key === cacheKey && now - scanCache.at < SCAN_CACHE_MS) {
    return scanCache.result;
  }
  const result = scanPortfolioUncached({ roots });
  scanCache = { key: cacheKey, at: now, result };
  return result;
}

/** Exposed for tests, and for anything that must see a change immediately
 * (e.g. right after the importer marks a site) rather than waiting out the
 * cache. Production code should prefer the cached `scanPortfolio` above. */
export function invalidatePortfolioScanCache() {
  scanCache = null;
}

function scanPortfolioUncached({ roots = {} } = {}) {
  const overrides = loadOverrides();
  const entries = [];
  const rootReports = [];

  for (const [label, rawRoot] of Object.entries(roots)) {
    const root = rawRoot.replace(/^~/, process.env.HOME || '~');
    if (!isDir(root)) {
      // A configured root that does not exist is reported, not skipped: silence
      // here would read as "you have no apps".
      rootReports.push({ label, root, state: 'not_found', reason: 'configured portfolio root does not exist on this machine' });
      continue;
    }
    let names;
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (error) {
      rootReports.push({ label, root, state: 'error', reason: error.message });
      continue;
    }
    rootReports.push({ label, root, state: 'available', count: names.length });

    for (const name of names) {
      if (name.startsWith('.')) continue;
      const dir = path.join(root, name);
      const signals = {
        git_repo: isDir(path.join(dir, '.git')),
        git_remote: gitRemote(dir),
        site_context: isDir(path.join(dir, '.site-context')),
        has_dist: isDir(path.join(dir, 'dist')) || isDir(path.join(dir, 'frontend/dist')),
        html_files: countHtml(dir),
        backend: backendEvidence(dir),
        spec_present: exists(path.join(dir, 'spec.json')) || exists(path.join(dir, '.site-context/spec.json')),
        deploy_evidence: ['DEPLOY.md', 'DEPLOYMENT.md', 'DEPLOY-STATE.md', 'netlify.toml', 'vercel.json'].find((f) => exists(path.join(dir, f))) || null,
      };
      const domain = domainOf(dir);
      const { origin, reason } = classify(name, signals, domain);
      const capability_class = signals.backend ? 'application' : 'brochure';
      entries.push({
        id: name,
        domain,
        source_root: label,
        path: dir,
        origin,
        origin_reason: reason,
        capability_class,
        // Studio can rebuild a brochure site from a spec. It can only carry an
        // application, and says so rather than implying uniform capability.
        studio_can_rebuild: capability_class === 'brochure',
        backend_evidence: signals.backend,
        git_remote: signals.git_remote,
        site_context: signals.site_context,
        deploy_evidence: signals.deploy_evidence,
        git_repo: signals.git_repo,
        has_dist: signals.has_dist,
        html_files: signals.html_files,
        spec_present: signals.spec_present,
        last_touch: lastTouch(dir),
      });
    }
  }

  dedupeSites(entries);

  // The operator's declaration wins over every inferred signal. The rule
  // infers; the operator rules -- and the correction is one line in
  // config/portfolio-overrides.json rather than a code change.
  for (const e of entries) {
    const o = overrides[e.id];
    if (!o) continue;
    const declared = typeof o === 'string' ? { origin: o } : o;
    if (['site', 'experiment', 'test', 'unclassified'].includes(declared.origin)) {
      e.origin = declared.origin;
      e.origin_reason = `declared ${declared.origin} by the operator in portfolio-overrides.json`;
      if (declared.variant_of) e.variant_of = declared.variant_of;
    }
  }

  entries.sort((a, b) => {
    const rank = { site: 0, experiment: 1, unclassified: 2, test: 3 };
    return (rank[a.origin] - rank[b.origin]) || a.id.localeCompare(b.id);
  });

  const counts = { site: 0, experiment: 0, unclassified: 0, test: 0 };
  const byClass = { brochure: 0, application: 0 };
  for (const e of entries) { counts[e.origin] += 1; byClass[e.capability_class] += 1; }

  return {
    status: 'ok',
    roots: rootReports,
    origin_counts: counts,
    capability_counts: byClass,
    total: entries.length,
    sites: entries,
  };
}
