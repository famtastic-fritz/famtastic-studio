// Portfolio module: thin HTTP binding over server/kernel/portfolio.js.
// Read-only by construction -- there is no write route here, and there is not
// going to be one. Studio inventories the operator's real work; it does not
// mutate it from this surface.
import fs from 'node:fs';
import { createPaths, loadPathsConfig } from '../../kernel/paths.js';
import { scanPortfolio } from '../../kernel/portfolio.js';
import { thumbnailFor } from '../../kernel/thumbnails.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  return { status, body: { error: error.code || 'handler_failed', message: error.message } };
}

export default {
  name: 'portfolio',
  register({ app }) {
    app.route('GET', '/api/portfolio', async () => {
      try {
        const config = loadPathsConfig();
        const paths = createPaths();
        const roots = {
          ...(config.portfolio_roots || {}),
          studio_sites: paths.root('sites'),
        };
        if (!Object.keys(roots).length) {
          // Honest state, with the reason and the fix, rather than an empty list
          // that reads as "you have no sites".
          return {
            status: 200,
            body: {
              status: 'not_configured',
              reason: 'no portfolio_roots are declared in config/paths.json, so there is nowhere to look',
              roots: [], sites: [], total: 0,
              origin_counts: { legit: 0, unknown: 0, test: 0 },
              capability_counts: { brochure: 0, application: 0 },
            },
          };
        }
        return { status: 200, body: scanPortfolio({ roots }) };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    // Card thumbnails. The id is validated against the scan's own results, so
    // this route can only ever read a directory the portfolio actually contains
    // -- an allowlist, not path arithmetic.
    app.route('GET', '/api/portfolio/thumbnail', async ({ res, query }) => {
      try {
        const siteId = query?.get ? (query.get('site') || '') : '';
        const config = loadPathsConfig();
        const paths = createPaths();
        const scan = scanPortfolio({
          roots: {
            ...(config.portfolio_roots || {}),
            studio_sites: paths.root('sites'),
          },
        });
        const site = scan.sites.find((s) => s.id === siteId);
        if (!site) return { status: 404, body: { error: 'unknown_site', message: `no portfolio site named ${siteId}` } };
        const result = await thumbnailFor({ siteId: site.id, siteDir: site.path, previewsRoot: paths.root('previews') });
        if (result.state !== 'ready') {
          // A designed placeholder, not a 404: the card legitimately has no
          // renderable entry, and the reason is drawn INTO the image so the
          // card itself says why. A failed request here would read as a broken
          // page when nothing is broken.
          const msg = String(result.reason || 'no preview').replace(/[<>&]/g, '');
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#0d0d13"/><text x="320" y="192" fill="#6a6a76" font-family="ui-monospace,monospace" font-size="15" text-anchor="middle">no renderable entry page</text><text x="320" y="218" fill="#4a4a55" font-family="ui-monospace,monospace" font-size="11" text-anchor="middle">${msg.slice(0, 80)}</text></svg>`;
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
          res.end(svg);
          return undefined;
        }
        // app.js's send() speaks JSON; write the png directly and end.
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(result.file));
        return undefined;
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });
  },
};
