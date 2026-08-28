// A1: identity is bound once at ingress, in server/kernel/app.js, and handed
// to every handler frozen. This test proves the contract at the router level
// with a fake req/res, not a real socket -- see tests/kernel-app-static.test.js
// for the same fake-req/res pattern this borrows.
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/kernel/app.js';

function request(app, method, url, headers = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(status, hdrs) { this.statusCode = status; this.headers = hdrs || {}; },
      end(body) {
        this.writableEnded = true;
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(),
        });
      },
    };
    app.handler({ method, url, headers }, res);
  });
}

describe('router identity binding (A1)', () => {
  it('rejects a site-scoped route with no site_id, 400 identity_required, handler never runs', async () => {
    const app = createApp();
    let ran = false;
    app.route('GET', '/api/probe/site', async () => { ran = true; return { status: 200, body: {} }; });

    const res = await request(app, 'GET', '/api/probe/site');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('identity_required');
    expect(ran).toBe(false);
  });

  it('hands a site-scoped handler a frozen identity carrying the right site_id', async () => {
    const app = createApp();
    let seen = null;
    app.route('GET', '/api/probe/site', async ({ identity }) => {
      seen = identity;
      return { status: 200, body: { site_id: identity.site_id } };
    });

    const res = await request(app, 'GET', '/api/probe/site?site_id=demo-site');

    expect(res.status).toBe(200);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(seen.site_id).toBe('demo-site');
    expect(JSON.parse(res.body).site_id).toBe('demo-site');
  });

  it('returns 409 identity_conflict on mismatched query/header site_id, handler never runs', async () => {
    const app = createApp();
    let ran = false;
    app.route('GET', '/api/probe/site', async () => { ran = true; return { status: 200, body: {} }; });

    const res = await request(app, 'GET', '/api/probe/site?site_id=a', { 'x-site-id': 'b' });

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toBe('identity_conflict');
    expect(ran).toBe(false);
  });

  it('runs a global-scoped route with no site_id, identity.site_id is null', async () => {
    const app = createApp();
    let seen = null;
    app.route('GET', '/api/probe/global', async ({ identity }) => {
      seen = identity;
      return { status: 200, body: {} };
    }, { scope: 'global' });

    const res = await request(app, 'GET', '/api/probe/global');

    expect(res.status).toBe(200);
    expect(seen).not.toBeNull();
    expect(seen.site_id).toBeNull();
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('returns 400 identity_invalid for an invalid site_id', async () => {
    const app = createApp();
    app.route('GET', '/api/probe/site', async () => ({ status: 200, body: {} }));

    const traversal = await request(app, 'GET', '/api/probe/site?site_id=' + encodeURIComponent('../evil'));
    expect(traversal.status).toBe(400);
    expect(JSON.parse(traversal.body).error).toBe('identity_invalid');

    const spaced = await request(app, 'GET', '/api/probe/site?site_id=' + encodeURIComponent('a b'));
    expect(spaced.status).toBe(400);
    expect(JSON.parse(spaced.body).error).toBe('identity_invalid');
  });
});
