// Canvas module: click-to-edit HTTP surface (Phase 2 contract section 1).
// Site-scoped -- identity comes from the router-supplied frozen `identity`
// object (bound once at ingress, see kernel/app.js + kernel/identity.js).
// This module never calls bindIdentity itself. All real work -- selector
// generation, staleness verification, journaled apply -- lives in
// kernel/canvas.js; this file only wires HTTP to it.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '../../kernel/canvas.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

function errorBody(error, fallbackCode) {
  return { status: error.statusCode || 500, body: { error: error.code || fallbackCode, message: error.message, ...(error.selector ? { selector: error.selector } : {}) } };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

export default {
  name: 'canvas',
  register({ app, paths, journal, events }) {
    const canvas = createCanvas({ paths, journal, events });

    // Serves the page into the canvas with server-stamped data-fam-sel /
    // data-fam-path selectors, plus inlined stylesheets and rewritten asset paths.
    app.route('GET', '/api/sites/canvas', async ({ res, query, identity }) => {
      const pagePath = (query.get('page_path') || '').trim();
      try {
        const html = canvas.serve(identity.site_id, pagePath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      } catch (error) {
        const { status, body } = errorBody(error, 'canvas_serve_failed');
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      }
    });

    // Serves raw site assets (images, videos, fonts, CSS, etc.)
    app.route('GET', '/api/sites/asset', async ({ res, query, identity }) => {
      const assetPath = (query.get('path') || '').trim();
      if (!assetPath) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'path_required', message: 'path query parameter is required' }));
        return;
      }
      try {
        const { rootName, dir: siteAbs } = paths.resolveSite(identity.site_id);
        let abs = null;
        try {
          abs = paths.within(rootName, identity.site_id, assetPath);
        } catch {
          abs = null;
        }

        if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          const candFrontend = path.resolve(siteAbs, 'frontend', assetPath.replace(/^\//, ''));
          const candDist = path.resolve(siteAbs, 'dist', assetPath.replace(/^\//, ''));
          if (candFrontend.startsWith(siteAbs) && fs.existsSync(candFrontend) && !fs.statSync(candFrontend).isDirectory()) {
            abs = candFrontend;
          } else if (candDist.startsWith(siteAbs) && fs.existsSync(candDist) && !fs.statSync(candDist).isDirectory()) {
            abs = candDist;
          }
        }

        if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          const ext = path.extname(assetPath).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
            res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="100%" height="100%" fill="#1a1d24"/><text x="50%" y="50%" fill="#717888" font-family="system-ui, sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">${path.basename(assetPath)}</text></svg>`);
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'asset_not_found', message: `asset not found: ${assetPath}` }));
          return;
        }

        const ext = path.extname(abs).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(abs).pipe(res);
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: error.code || 'asset_serve_failed', message: error.message }));
      }
    });

    app.route('POST', '/api/sites/edit', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const result = canvas.applyEdit({
          site_id: identity.site_id,
          page_path: body.page_path,
          selector: body.selector,
          before_text: body.before_text,
          after_text: body.after_text,
          expectedRevision: body.expectedRevision,
          initiator: 'canvas:operator',
        });
        return { status: 200, body: { site_id: identity.site_id, ...result } };
      } catch (error) {
        return errorBody(error, 'canvas_edit_failed');
      }
    });
  },
};
