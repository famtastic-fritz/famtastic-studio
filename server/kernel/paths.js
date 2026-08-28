// The only module allowed to resolve raw filesystem roots. Everything else asks here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPortfolio } from './portfolio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.resolve(here, '../../config/paths.json');

export function loadPathsConfig() {
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

export function createPaths(config = loadPathsConfig()) {
  const dataRoot = path.resolve(
    path.dirname(configFile),
    '..',
    process.env[config.data_root_env] || config.data_root_default,
  );
  const roots = Object.fromEntries(
    Object.entries(config.roots).map(([name, rel]) => [name, path.resolve(dataRoot, rel)]),
  );
  // The operator's REAL sites, prefixed `portfolio_` so they can never collide
  // with a studio root of the same short name (config.roots.sites is studio
  // BUILD OUTPUT; config.portfolio_roots.sites is the operator's actual repo).
  // Merged into the SAME `roots` map deliberately, so `within()` below --
  // hardened over three prior symlink-escape incidents -- runs identically for
  // both: one containment implementation, never a second one to fall behind.
  // Nothing in this codebase iterates `roots` to auto-create directories
  // (grep confirms `ensure()` is always called with an explicit studio root
  // name), so adding these never causes Studio to mkdir inside the operator's
  // real filesystem.
  for (const [label, rawRoot] of Object.entries(config.portfolio_roots || {})) {
    const expanded = String(rawRoot).replace(/^~/, process.env.HOME || '~');
    roots[`portfolio_${label}`] = path.resolve(expanded);
  }
  function root(name) {
    if (!(name in roots)) throw new Error(`unknown paths root: ${name}`);
    return roots[name];
  }
  function ensure(name) {
    const dir = root(name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Containment is checked at EVERY boundary, not just the outermost root.
  // Checking only the root let `within('sites', siteId, '../other-site/x.html')`
  // resolve into another site's directory while still technically living under
  // the sites root: site A's identity could read, and with a matching selector
  // write, site B's files. Rejecting traversal and absolute segments up front
  // makes every caller safe by default rather than relying on each one to
  // remember, which is how this got through in the first place.
  //
  // That lexical check is not enough on its own: it operates on strings, never
  // touches the filesystem, and so never notices that a path component is a
  // symlink. A symlink planted inside site A's directory (e.g. `evil ->
  // ../site-b`) contains no `..` in the string handed to `within()` — the
  // traversal happens on disk, after resolution, where the lexical check
  // can't see it. `realpathAllowingMissingTail` below walks the path one
  // component at a time with `lstat` (never `stat`, so a symlink is detected
  // rather than followed blindly) and calls `fs.realpathSync` on any symlink
  // it finds, so the containment check runs against where the path actually
  // ends up on disk. It stops at the first component that does not exist yet
  // and appends the remaining (still-lexical) tail, so a not-yet-created file
  // is still permitted as long as its resolved parent is inside the base —
  // writes have to be able to create new files.
  function realpathAllowingMissingTail(fullPath) {
    const { root: fsRoot } = path.parse(fullPath);
    const segments = fullPath.slice(fsRoot.length).split(path.sep).filter(Boolean);
    let resolved = fsRoot || path.sep;
    for (let i = 0; i < segments.length; i += 1) {
      const next = path.join(resolved, segments[i]);
      let stat;
      try {
        stat = fs.lstatSync(next);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          return path.join(resolved, ...segments.slice(i));
        }
        throw err;
      }
      resolved = stat.isSymbolicLink() ? fs.realpathSync(next) : next;
    }
    return resolved;
  }
  function within(name, ...parts) {
    const base = root(name);
    const cleanParts = parts.filter((p) => p !== undefined && p !== null).map(String);
    for (const segment of cleanParts) {
      if (path.isAbsolute(segment)) {
        throw Object.assign(new Error(`absolute path segment is not allowed under root ${name}`), { statusCode: 400, code: 'path_not_allowed' });
      }
      if (segment.split(/[\\/]+/).some((piece) => piece === '..')) {
        throw Object.assign(new Error(`path traversal is not allowed under root ${name}`), { statusCode: 400, code: 'path_not_allowed' });
      }
    }
    const target = path.resolve(base, ...cleanParts);
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw Object.assign(new Error(`path escapes root ${name}`), { statusCode: 400, code: 'path_not_allowed' });
    }
    // Every caller in this codebase addresses a single-site (or single-
    // recipe/deploy/packet) directory as `within(rootName, entityId, ...rest)`.
    // A symlink escape only matters if it lets one entity's traversal reach
    // another entity that legitimately lives under the same root, so the
    // real (symlink-resolved) containment boundary is scoped to that first
    // path segment when there is a nested path beneath it, not just to the
    // shared root. Without this, `sites/site-a/evil -> sites/site-b` would
    // still resolve "inside" the sites root and slip through.
    const realRootBase = realpathAllowingMissingTail(base);
    const effectiveBase = cleanParts.length > 1 ? path.resolve(base, cleanParts[0]) : base;
    const realEffectiveBase = realpathAllowingMissingTail(effectiveBase);
    if (realEffectiveBase !== realRootBase && !realEffectiveBase.startsWith(realRootBase + path.sep)) {
      // The entity segment itself (e.g. the site directory) is a symlink
      // that escapes the root — catches an entity id swapped for a symlink
      // even when nothing beneath it looks suspicious.
      throw Object.assign(new Error(`path escapes root ${name} via symlink`), { statusCode: 400, code: 'path_not_allowed' });
    }
    const realTarget = realpathAllowingMissingTail(target);
    if (realTarget !== realEffectiveBase && !realTarget.startsWith(realEffectiveBase + path.sep)) {
      throw Object.assign(new Error(`path escapes root ${name} via symlink`), { statusCode: 400, code: 'path_not_allowed' });
    }
    return target;
  }

  // THE SEAM. Every kernel module that reads or writes "a site's files" was
  // hardcoding `within('sites', siteId, ...)` -- the studio build-output root.
  // That is why the console only ever worked on sites Studio itself generated:
  // an operator's real site (site-mbsh-reunion) has no directory there at all,
  // so every screen resolved nothing and rendered honestly empty. Twelve nav
  // items, one root cause.
  //
  // resolveSite() is the ONE place that decides which named root a site_id's
  // files live under. It never joins a path itself and never trusts a raw
  // string from the portfolio scan -- it hands the root name to `within()`,
  // so the SAME hardened containment (traversal + symlink resolution, scoped
  // per-entity) that already survived three escape attempts runs on every
  // resolution, for a studio site and a real one alike.
  //
  // Studio-generated sites are checked first (existence under `sites`, cheap:
  // one stat). A real site is found by name in the SAME scan that already
  // gates the Sites page card grid -- so a site_id can only ever resolve to a
  // directory the portfolio scan actually walked and classified. Nothing here
  // reads a raw client-supplied path; the id is the only input, and it has
  // already passed identity.js's shape check before this runs.
  //
  // `createIfMissing`: when nothing claims this id (no studio directory, no
  // portfolio scan entry), default to the studio root instead of throwing.
  // This is not a new liberty -- it is EXACTLY what every caller already got
  // before this seam existed, from the old unconditional `within('sites',
  // siteId, ...)`: a site_id with no directory yet simply resolved to where
  // one would be created. The pipeline's build/compose stages write a brand
  // new site's first bytes this way, before any directory exists. Preserving
  // that default here means adding the portfolio branch changes nothing about
  // site creation; only a genuine READ of a genuinely unknown id should ever
  // 404, so read call sites (canvas, page, site, spec) leave this false.
  function resolveSite(siteId, { createIfMissing = false } = {}) {
    if (!siteId || typeof siteId !== 'string') {
      throw Object.assign(new Error('resolveSite requires a site_id'), { statusCode: 400, code: 'identity_required' });
    }
    const studioDir = within('sites', siteId);
    if (fs.existsSync(studioDir)) {
      return { rootName: 'sites', dir: studioDir, source: 'studio', entry: null };
    }
    const scan = scanPortfolio({ roots: config.portfolio_roots || {} });
    // Only 'site' and 'experiment' resolve -- a real site, or a deliberate
    // variant of one. 'unclassified' is the ~40 scratch directories that fail
    // portfolio.js's OWN qualification bar, and 'test' is a named fixture;
    // letting either resolve would make every directory under the portfolio
    // root openable in the Editor just because something happens to be there,
    // which is the exact "61 directories is not 61 sites" confusion this scan
    // exists to correct, now reopened one level down at the resolver.
    const entry = scan.sites.find((s) => s.id === siteId && (s.origin === 'site' || s.origin === 'experiment'));
    if (!entry) {
      if (createIfMissing) {
        return { rootName: 'sites', dir: studioDir, source: 'studio', entry: null };
      }
      throw Object.assign(new Error(`unknown site: ${siteId}`), { statusCode: 404, code: 'site_not_found' });
    }
    const rootName = `portfolio_${entry.source_root}`;
    if (!(rootName in roots)) {
      // Defensive: the scan found it under a root label paths.js was never
      // configured with. Should be unreachable (both read config.portfolio_roots),
      // but failing loudly here beats resolving into an undefined root.
      throw Object.assign(new Error(`portfolio site ${siteId} is under an unconfigured root: ${entry.source_root}`), { statusCode: 500, code: 'portfolio_root_unconfigured' });
    }
    const dir = within(rootName, siteId);
    return { rootName, dir, source: 'portfolio', entry };
  }

  return { dataRoot, roots, root, ensure, within, resolveSite, config, configFile };
}
