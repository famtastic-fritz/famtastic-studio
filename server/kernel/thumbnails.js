/**
 * Site thumbnails for the portfolio cards.
 *
 * The console-v2 mockup's Sites page is a card grid where each card SHOWS the
 * site -- a rendered hero, not a directory listing. This renders each portfolio
 * site's entry file once, caches the png under the previews root, and
 * invalidates when the entry file changes.
 *
 * Rendering spawns scripts/capture/thumb.mjs as a child process so the server
 * itself never imports puppeteer. Concurrency is capped at 2: eight cards
 * arriving at once must not launch eight browsers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ENTRY_CANDIDATES = ['dist/index.html', 'frontend/dist/index.html', 'frontend/index.html', 'index.html', 'public/index.html', 'web/index.html'];

export function resolveEntry(siteDir) {
  for (const rel of ENTRY_CANDIDATES) {
    const p = path.join(siteDir, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * contentRootFor: the directory that actually holds this site's real pages,
 * as opposed to the whole repo directory.
 *
 * Found running the importer against a real site: page.js and the importer
 * both originally walked a site's ENTIRE directory for any `.html` file
 * anywhere, unbounded. For a simple one-directory site that is harmless. For
 * a real project directory -- a monorepo with `frontend/node_modules/`,
 * `.artifacts/` test reports, `marketing/` assets, admin exports -- it swept
 * in 113 files as "pages" for a site with roughly a dozen real routes. This
 * is the same "where's the real entry" question resolveEntry() above already
 * answers for the thumbnail; this returns the directory it lives in, so both
 * page.js and the importer walk from the actual build root rather than the
 * whole repository.
 *
 * A site with none of the known entry shapes (no dist/, no frontend/, just
 * HTML at its own root -- the common case for a small brochure repo) falls
 * back to the site's own directory, which is exactly correct for that shape.
 */
export function contentRootFor(siteDir) {
  const entry = resolveEntry(siteDir);
  return entry ? path.dirname(entry) : siteDir;
}

// Subdirectories that hold real code or tooling, never a customer-facing
// page, wherever in a site tree they appear.
const NON_PAGE_DIRS = new Set(['node_modules', '.git', 'admin', 'lib', 'cron', 'config', 'uploads']);

// `skipNames`, when given, excludes those directory names but ONLY at the
// walk's own top level (dir === base) -- it exists for exactly one caller
// below: the site-root candidate's fallback walk, which must never descend
// into a recognized subtree name that is either already covered by its own
// candidate or, for backend/ specifically, deliberately excluded.
function walkAllHtml(dir, base, out = [], skipNames = null) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || NON_PAGE_DIRS.has(entry.name)) continue;
    if (dir === base && skipNames && skipNames.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAllHtml(full, base, out, skipNames);
    else if (entry.name.endsWith('.html')) out.push(full.slice(base.length + 1));
  }
  return out;
}

// A single "content root" (contentRootFor above) is the right model for a
// site that has one -- a single build output directory. It is the WRONG
// model for MBSH: its own DEPLOY.md rsyncs frontend/ into the production
// docroot first, then backend/ on top with --delete, so backend/'s copy of
// any page WINS on the real deployed site, and backend/ is not purely PHP
// logic to skip -- it also carries the authoritative version of every
// customer-facing static page. contentRootFor()'s single-candidate list
// would have picked a stale, two-file dist/ directory instead, missing all
// twenty-seven of the site's real pages.
// Exported: server/modules/media/index.js reuses this exact precedence list
// to resolve a root-relative real asset path (e.g. an <img src="/assets/..">
// found on a real page) against the same candidate subtrees a real site's
// pages themselves are discovered under -- MBSH's own real deploy layout
// (backend/ rsynced on top of frontend/ with --delete, per its DEPLOY.md)
// means a root-relative src on a real page is never found at the bare site
// directory; it lives under whichever subtree actually deploys it.
export const SUBTREE_PRECEDENCE = ['backend', 'frontend', 'dist', 'build', 'public', 'web'];
const KNOWN_SUBTREE_NAMES = new Set(SUBTREE_PRECEDENCE);

/**
 * discoverPages: every real page across a site's named top-level subtrees,
 * with duplicates (the same logical page present in more than one subtree)
 * resolved by a documented precedence rather than silently picked or
 * silently kept twice.
 *
 * Each candidate subtree (backend/, frontend/, dist/, build/, public/,
 * web/) is resolved to ITS OWN content root the same way contentRootFor()
 * resolves a whole site -- looking for a nested build-output directory
 * inside it, falling back to the subtree itself when it holds HTML
 * directly. This, not an unbounded walk of the whole tree, is what tells
 * frontend/dist/ (a real build output) apart from a stray sibling
 * frontend/index.html source template: the nested dist/ wins by the same
 * ENTRY_CANDIDATES precedence contentRootFor already uses, and the walk
 * never descends into the sibling that lost. An unbounded sweep was tried
 * first and reintroduced the original 113-pages bug in a new shape -- it
 * also swept in an unrelated marketing/ directory sitting at a site's own
 * root, since nothing about "some other top-level folder" distinguishes
 * real content from an asset dump by name alone.
 *
 * The site's own root is always an additional, lowest-precedence candidate
 * alongside whatever named subtrees exist -- a real page can sit directly
 * at a site's root even when an unrelated named subtree exists alongside it
 * (an application-class site can keep nothing but a database schema under
 * backend/, with its real pages at its own top level). It is resolved the
 * same way contentRootFor() resolves a whole site standalone, and dropped
 * entirely when that resolves to a content root a named-subtree candidate
 * already claims. In the one case where it resolves to the site's own root
 * directory -- no known build shape found anywhere -- its walk skips
 * descending into any recognized subtree name, so it can never become a
 * backdoor around includeBackend or redundantly re-walk a subtree already
 * covered by its own candidate.
 *
 * `includeBackend` gates backend/ into the candidate subtrees at all, ahead
 * of frontend -- pass it only for a site whose own backend evidence marks it
 * application-class (per MBSH's own deploy script). This is a real-data
 * finding, not a guess: running the first version of this function (which
 * always considered backend/ a candidate, just deprioritized) against the
 * actual portfolio swept 861 files out of site-famtastic-designs's backend/
 * -- a Drupal install whose own vendor/core noise and, critically, its
 * backend/web/proofs/ directory is the LIVE FAMTASTIC DESIGNS PROOF PIPELINE
 * output, protected revenue scope that must never be treated as page
 * content. None of those 861 files collided by logical id with anything
 * real, so precedence alone never filtered them -- they all "won" their own
 * groups outright. A brochure-class site's backend/, whatever it contains,
 * is therefore never walked for pages at all; only an application-class
 * site's backend evidence earns it a look, and even then only through the
 * same contentRootFor()-per-subtree resolution every other candidate gets.
 *
 * Returns { pages: [{path, logical_id, subtree}], shadowed: [{path,
 * shadowed_by, reason}] } -- shadowed duplicates are never silently dropped,
 * they are reported so the choice is visible and arguable later.
 */
export function discoverPages(siteDir, { includeBackend = false } = {}) {
  const order = includeBackend ? SUBTREE_PRECEDENCE : ['frontend', 'dist', 'build', 'public', 'web'];

  const candidates = [];
  const claimedContentDirs = new Set();
  for (const name of order) {
    const subtreeDir = path.join(siteDir, name);
    if (!fs.existsSync(subtreeDir)) continue;
    const contentDir = contentRootFor(subtreeDir);
    candidates.push({ subtree: name, contentDir, skipNames: null });
    claimedContentDirs.add(contentDir);
  }

  const rootContentDir = contentRootFor(siteDir);
  if (!claimedContentDirs.has(rootContentDir)) {
    candidates.push({
      subtree: '(site root)',
      contentDir: rootContentDir,
      skipNames: rootContentDir === siteDir ? KNOWN_SUBTREE_NAMES : null,
    });
  }

  const groups = new Map();
  candidates.forEach(({ subtree, contentDir, skipNames }, precedence) => {
    for (const logicalId of walkAllHtml(contentDir, contentDir, [], skipNames)) {
      const sitePath = path.relative(siteDir, path.join(contentDir, logicalId));
      if (!groups.has(logicalId)) groups.set(logicalId, []);
      groups.get(logicalId).push({ path: sitePath, subtree, precedence });
    }
  });

  const pages = [];
  const shadowed = [];
  for (const [logicalId, group] of groups) {
    group.sort((a, b) => a.precedence - b.precedence);
    const [chosen, ...rest] = group;
    pages.push({ path: chosen.path, logical_id: logicalId, subtree: chosen.subtree });
    for (const other of rest) {
      shadowed.push({
        path: other.path,
        shadowed_by: chosen.path,
        reason: `${chosen.subtree} takes precedence over ${other.subtree} for this page; both exist with the same content path`,
      });
    }
  }
  return { pages: pages.sort((a, b) => a.path.localeCompare(b.path)), shadowed };
}

let inFlight = 0;
const queue = [];
const pending = new Map(); // cache path -> promise

function runRender(entry, out) {
  return new Promise((resolve, reject) => {
    const task = () => {
      inFlight += 1;
      const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../scripts/capture/thumb.mjs');
      execFile(process.execPath, [script, `file://${entry}`, out], { timeout: 60000 }, (err) => {
        inFlight -= 1;
        if (queue.length) queue.shift()();
        if (err) reject(err); else resolve();
      });
    };
    if (inFlight < 2) task(); else queue.push(task);
  });
}

/**
 * Returns { state: 'ready', file } | { state: 'none', reason }.
 * Generates on miss; regenerates when the entry file is newer than the cache.
 */
export async function thumbnailFor({ siteId, siteDir, previewsRoot }) {
  const entry = resolveEntry(siteDir);
  if (!entry) return { state: 'none', reason: 'no entry html found (looked for dist/, frontend/dist/, index.html, public/)' };
  fs.mkdirSync(previewsRoot, { recursive: true });
  const out = path.join(previewsRoot, `thumb-${siteId}.png`);
  const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(entry).mtimeMs;
  if (fresh) return { state: 'ready', file: out };
  if (!pending.has(out)) {
    pending.set(out, runRender(entry, out).finally(() => pending.delete(out)));
  }
  try {
    await pending.get(out);
    return { state: 'ready', file: out };
  } catch (error) {
    return { state: 'none', reason: `render failed: ${error.message}` };
  }
}
