// Page reads for a site. Revision is a sha256 content hash. Any pagePath that
// would escape the site directory is rejected before touching the filesystem.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { discoverPages } from './thumbnails.js';

function titleFromHtml(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// THE SEAM. See paths.js#resolveSite: reads never create, so a genuinely
// unknown site_id 404s here rather than silently resolving into the (empty)
// studio root.
function resolvePagePath(paths, siteId, pagePath) {
  const { rootName } = paths.resolveSite(siteId);
  try {
    return paths.within(rootName, siteId, pagePath);
  } catch {
    throw Object.assign(new Error(`page path escapes the site directory: ${pagePath}`), {
      statusCode: 400,
      code: 'invalid_page_path',
    });
  }
}

export function createPage({ paths }) {
  function list(siteId) {
    let resolved;
    try {
      resolved = paths.resolveSite(siteId);
    } catch (error) {
      if (error.code === 'site_not_found') return { site_id: siteId, pages: [], status: 'NOT_FOUND' };
      throw error;
    }
    const siteDir = resolved.dir;
    if (!fs.existsSync(siteDir)) {
      return { site_id: siteId, pages: [], status: 'NOT_FOUND' };
    }
    // Walk each real content subtree (frontend/, dist/, and -- only for a
    // site whose own backend evidence marks it application-class -- backend/
    // too) and resolve duplicate pages across them by documented precedence,
    // rather than a single guessed content root. A studio-generated site has
    // no scan entry (resolved.entry is null) and is never application-class,
    // so includeBackend is simply false there.
    const includeBackend = resolved.entry?.capability_class === 'application';
    const { pages: discovered } = discoverPages(siteDir, { includeBackend });
    const pages = discovered.map(({ path: relPath }) => {
      const full = `${siteDir}/${relPath}`;
      const stat = fs.statSync(full);
      let title = null;
      try {
        title = titleFromHtml(fs.readFileSync(full, 'utf8'));
      } catch {
        title = null;
      }
      return { path: relPath, title, bytes: stat.size, modified: stat.mtime.toISOString() };
    });
    return { site_id: siteId, pages, status: pages.length ? 'available' : 'empty' };
  }

  function get(siteId, pagePath) {
    const resolved = resolvePagePath(paths, siteId, pagePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      throw Object.assign(new Error(`page not found: ${pagePath}`), {
        statusCode: 404,
        code: 'page_not_found',
      });
    }
    const buffer = fs.readFileSync(resolved);
    const stat = fs.statSync(resolved);
    return {
      site_id: siteId,
      path: pagePath,
      html: buffer.toString('utf8'),
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      revision: hashContent(buffer),
    };
  }

  return { list, get };
}
