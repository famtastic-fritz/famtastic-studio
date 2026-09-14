// Media module: thin HTTP binding over server/kernel/media-inventory.js.
// Read-only, portfolio-wide -- like server/modules/portfolio/index.js, there
// is no write route here. The Media screen shows a real tile grid of real
// images already sitting in the operator's real HTML pages; it does not
// generate or edit them.
import fs from 'node:fs';
import path from 'node:path';
import { buildMediaInventory } from '../../kernel/media-inventory.js';
import { SUBTREE_PRECEDENCE } from '../../kernel/thumbnails.js';
import { discoverLibrary } from '../../kernel/library-discovery.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  return { status, body: { error: error.code || 'handler_failed', message: error.message } };
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// True for a src that is already a remote URL (protocol-relative or with a
// scheme) -- never a local file this endpoint could serve, so it is
// rejected up front rather than fed into path resolution.
function isRemote(src) {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(src);
}

export default {
  name: 'media',
  register({ app, paths }) {
    // Portfolio-wide projection -- like /api/portfolio, global scope: this is
    // not any one site's data, it is every real site's real images at once.
    app.route('GET', '/api/media', async () => {
      try {
        const result = buildMediaInventory({ paths });
        if (result.status === 'not_configured') {
          return {
            status: 200,
            body: {
              status: 'not_configured',
              reason: result.reason,
              source: 'media inventory (buildMediaInventory)',
              assets: [],
              unfilled: [],
              skipped_sites: result.skipped_sites,
            },
          };
        }
        const libraryPresets = discoverLibrary({ id: 'media-studio', paths });

        return {
          status: 200,
          body: {
            status: 'ok',
            source: 'media inventory (portfolio-specs + page + importer.extractImages)',
            assets: result.assets,
            presets: libraryPresets.entries.filter(entry => entry.kind === 'preset'),
            library: libraryPresets,
            unfilled: result.unfilled,
            skipped_sites: result.skipped_sites,
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    // Serves one real image's actual bytes so the console can show a real
    // thumbnail. site_id/src (and optionally from, the real page that
    // referenced src, needed to resolve a plain-relative src against the
    // right directory) come from the query string -- this route is a
    // portfolio-wide asset lookup, not bound to one site's identity.
    app.route('GET', '/api/media/asset', async ({ res, query }) => {
      try {
        const siteId = (query.get('site_id') || '').trim();
        const src = (query.get('src') || '').trim();
        const from = (query.get('from') || '').trim() || null;

        if (!siteId || !src) {
          return { status: 400, body: { error: 'site_and_src_required', message: 'site_id and src are both required' } };
        }
        if (isRemote(src)) {
          return { status: 404, body: { error: 'not_found', message: `${src} is a remote URL, not a local asset this endpoint can serve` } };
        }

        // A read: no createIfMissing, so a genuinely unknown site_id 404s
        // here rather than resolving into an empty studio directory.
        const resolved = paths.resolveSite(siteId);

        // src with any query string/fragment stripped -- normal URL
        // semantics: a browser requests /x.png?v=2 as literally /x.png.
        // Every candidate below tries this clean form FIRST; the raw,
        // unstripped src is tried only after, as a defensive fallback for a
        // build tool that bakes a cache-buster straight into a real file
        // NAME rather than a query string (observed for real: MBSH's own
        // dist/ build output names one file literally ...-foil.png?v=2).
        const cleanSrc = src.split(/[?#]/)[0];

        // Root-relative bases: the site's own bare root first (the
        // documented default), then each subtree page.js/discoverPages
        // already recognize as a real content root, in the same precedence
        // order a real deploy would resolve them in. A real multi-subtree
        // site (MBSH: backend/ rsynced on top of frontend/ with --delete,
        // per its own DEPLOY.md) means a root-relative src written on a
        // real page is never found at the bare site directory -- it lives
        // under whichever subtree actually deploys it. 'backend' is only a
        // candidate for an application-class site, mirroring page.js's own
        // includeBackend gate -- a brochure site's backend/, if any, is not
        // real page content and must not become an accidental asset source.
        // A plain-relative (from-based) src has exactly one base: it
        // already follows the referring page into whatever subtree that
        // page itself lives in, so it has no such ambiguity to resolve.
        let bases;
        if (src.startsWith('/')) {
          const includeBackend = resolved.entry?.capability_class === 'application';
          const subtrees = includeBackend ? SUBTREE_PRECEDENCE : SUBTREE_PRECEDENCE.filter((s) => s !== 'backend');
          bases = ['.', ...subtrees];
        } else {
          bases = [from ? path.posix.dirname(from) : '.'];
        }

        const tail = src.startsWith('/') ? src.slice(1) : src;
        const cleanTail = src.startsWith('/') ? cleanSrc.slice(1) : cleanSrc;

        // Real path arithmetic (join/normalize) only decides what "the
        // relative path" means for each candidate; containment is never
        // decided by string arithmetic alone -- every candidate still goes
        // through paths.within, so any escape attempt (surviving
        // normalization, or a symlink escape on disk) is still caught the
        // same way it always was, for every candidate tried.
        const candidates = bases.map((base) => path.posix.normalize(path.posix.join(base, cleanTail)));
        if (cleanTail !== tail) {
          candidates.push(...bases.map((base) => path.posix.normalize(path.posix.join(base, tail))));
        }

        let absPath = null;
        for (const candidate of candidates) {
          let resolvedPath;
          try {
            resolvedPath = paths.within(resolved.rootName, siteId, candidate);
          } catch {
            continue;
          }
          if (fs.existsSync(resolvedPath) && !fs.statSync(resolvedPath).isDirectory()) {
            absPath = resolvedPath;
            break;
          }
        }

        if (!absPath) {
          const cleanName = path.basename(src).replace(/[<>&]/g, '');
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><rect width="400" height="250" fill="#0d0d13"/><rect x="8" y="8" width="384" height="234" rx="4" fill="none" stroke="#262635" stroke-dasharray="4 4"/><text x="200" y="120" fill="#8e8ea0" font-family="ui-monospace,monospace" font-size="13" font-weight="bold" text-anchor="middle">IMAGE</text><text x="200" y="145" fill="#525264" font-family="ui-monospace,monospace" font-size="11" text-anchor="middle">${cleanName.slice(0, 36)}</text></svg>`;
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
          res.end(svg);
          return undefined;
        }

        // The extension comes from cleanSrc (the logical, query-stripped
        // request), not absPath -- the matched candidate can legitimately be
        // a disk file whose literal name still carries a baked-in query
        // suffix (the dist/ case above), and that must never change what
        // Content-Type a real .png is served as.
        const ext = path.extname(cleanSrc).slice(1).toLowerCase();
        const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
        const buffer = fs.readFileSync(absPath);
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': String(buffer.length), 'Cache-Control': 'no-cache' });
        res.end(buffer);
        return undefined;
      } catch (error) {
        if (error.statusCode) return errorResponse(error);
        return { status: 404, body: { error: 'not_found', message: error.message } };
      }
    }, { scope: 'global' });
  },
};
