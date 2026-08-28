// Tiny router. No framework, no build step. Modules contribute declarative routes.
import fs from 'node:fs';
import path from 'node:path';
import { bindIdentity } from './identity.js';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

export function createApp() {
  const routes = [];
  const statics = [];

  // A1: every route declares its identity requirement at registration. `scope`
  // is 'site' (identity bound and required at ingress) or 'global' (explicitly
  // site-independent). There is no third option and no default fallback.
  function route(method, pattern, handler, { scope = 'site' } = {}) {
    if (scope !== 'site' && scope !== 'global') throw new Error(`route ${method} ${pattern}: scope must be 'site' or 'global'`);
    routes.push({ method, pattern, handler, scope });
  }
  function page(urlPath, file) { statics.push({ urlPath, file }); }

  function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    const match = routes.find((r) => r.method === req.method && r.pattern === pathname);
    if (match) {
      try {
        // Identity is bound once, here, and handed to the handler frozen.
        const identity = bindIdentity(
          { query: url.searchParams, headers: req.headers || {} },
          { requireSite: match.scope === 'site' },
        );
        const result = await match.handler({ req, res, url, query: url.searchParams, identity });
        if (res.writableEnded) return;
        return send(res, result?.status || 200, result?.body ?? result ?? {});
      } catch (error) {
        return send(res, error.statusCode || 500, { error: error.code || 'handler_failed', message: error.message });
      }
    }

    const staticPage = statics.find((s) => s.urlPath === pathname);
    if (staticPage) {
      const file = path.join(publicDir, staticPage.file);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'NOT_FOUND', path: pathname });
      return send(res, 200, fs.readFileSync(file), MIME['.html']);
    }

    if (pathname.startsWith('/kit/') || pathname.startsWith('/pages/') || pathname === '/app.css') {
      const file = path.join(publicDir, pathname.replace(/^\//, ''));
      const resolved = path.resolve(file);
      if (!resolved.startsWith(publicDir) || !fs.existsSync(resolved)) return send(res, 404, { error: 'NOT_FOUND', path: pathname });
      return send(res, 200, fs.readFileSync(resolved), MIME[path.extname(resolved)] || 'application/octet-stream');
    }

    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND', path: pathname });
    return send(res, 404, `<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;padding:2rem"><h1>404</h1><p>No page at <code>${pathname}</code>.</p><p><a href="/">Work</a></p>`, MIME['.html']);
  }

  return { route, page, handler, routes, statics };
}
