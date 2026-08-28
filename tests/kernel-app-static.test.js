// Regression: page modules under /pages/*.js must be served. When they 404 the
// shell never renders, every page loses its h1, and the console looks empty in a
// way that is indistinguishable from an honest empty state. Caught at M0.
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/kernel/app.js';

function request(app, url) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
      end(body) { this.writableEnded = true; if (body) chunks.push(body); resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString() }); },
    };
    app.handler({ method: 'GET', url }, res);
  });
}

describe('static asset serving', () => {
  it('serves page modules, kit modules and the stylesheet', async () => {
    const app = createApp();
    for (const url of ['/pages/work.js', '/kit/shell.js', '/kit/region.js', '/app.css']) {
      const res = await request(app, url);
      expect(res.status, `${url} must be served, not 404`).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    }
  });

  it('refuses traversal out of the public directory', async () => {
    const app = createApp();
    const res = await request(app, '/kit/../../server/kernel/paths.js');
    expect(res.status).toBe(404);
  });

  it('returns JSON NOT_FOUND for unknown api paths and html for unknown pages', async () => {
    const app = createApp();
    expect((await request(app, '/api/nope')).status).toBe(404);
    expect(JSON.parse((await request(app, '/api/nope')).body).error).toBe('NOT_FOUND');
    const page = await request(app, '/nope');
    expect(page.status).toBe(404);
    expect(page.headers['Content-Type']).toMatch(/html/);
  });
});
