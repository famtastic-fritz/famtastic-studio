// Isolation adversarial tests (Phase 2, greenfield rebuild).
//
// The legacy leak this guards against: POST /api/switch-site at
// site-studio/server.js:5450 assigned a process-wide `TAG` and broadcast the
// new site's spec to EVERY connected WebSocket client, regardless of which
// site they were viewing. CONVENTIONS.md #5 forbids ambient site state
// entirely (no global current-site variable anywhere on the server; every
// request that reads or writes site state names site_id explicitly). These
// tests try, in good faith, to break that guarantee -- not to restate it.
//
// This suite drives the REAL router (createApp()) with the REAL modules
// (server/modules/*/index.js, discovered via kernel/modules.js) wired to
// REAL kernel primitives (paths/journal/events) over a hermetic temp
// STUDIO_DATA_ROOT, plus real WebSocket sockets for the event-delivery
// section. It does not reimplement any kernel logic.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createPaths } from '../server/kernel/paths.js';
import { createEvents } from '../server/kernel/events.js';
import { createJournal } from '../server/kernel/journal.js';
import { createRegistry } from '../server/kernel/registry.js';
import { loadModules } from '../server/kernel/modules.js';
import { createConversation } from '../server/kernel/conversation.js';
import { createMutation } from '../server/kernel/mutation.js';

let root;
let paths;
let journal;
let events;
let registry;
let app;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-'));
  process.env.STUDIO_DATA_ROOT = root;
  paths = createPaths();
  journal = createJournal({ paths });
  events = createEvents({ paths });
  registry = createRegistry();
  app = createApp();
  const modules = await loadModules();
  for (const mod of modules) mod.register({ app, paths, journal, events, registry });
});

afterEach(() => {
  delete process.env.STUDIO_DATA_ROOT;
  delete process.env.SITE_TAG;
  delete process.env.CURRENT_SITE;
  delete globalThis.TAG;
  delete globalThis.currentSite;
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- HTTP driver over the real app.handler, fake req/res (same pattern as
// tests/router-identity.test.js), but with a real Readable body stream so
// POST handlers that do req.on('data'/'end') (readJsonBody in the modules)
// work unmodified. A `delayMs` lets a caller simulate a slow-to-arrive body
// without touching any kernel code -- the delay lives entirely in the test's
// fake transport.
function request(method, url, { headers = {}, body, delayMs = 0 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(status, hdrs) { this.statusCode = status; this.headers = hdrs || {}; },
      end(chunk) {
        this.writableEnded = true;
        if (chunk) chunks.push(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          json: () => JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()),
          text: () => Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(),
        });
      },
    };
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    const push = () => { if (bodyStr) req.push(bodyStr); req.push(null); };
    if (delayMs > 0) setTimeout(push, delayMs); else push();
    app.handler(req, res);
  });
}

function siteQuery(siteId, extra = '') {
  return `site_id=${encodeURIComponent(siteId)}${extra}`;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// 1. Delayed concurrent A/B: a slow-to-complete operation for one site must
//    not let a fast operation for another site observe, block on, or bleed
//    into it, in either interleave order.
// ---------------------------------------------------------------------------
describe('delayed concurrent A/B', () => {
  it('slow site A conversation write, fast site B conversation write in flight: each lands only in its own file', async () => {
    const convA = await request('POST', `/api/sites/conversation/new?${siteQuery('site-a')}`);
    const convB = await request('POST', `/api/sites/conversation/new?${siteQuery('site-b')}`);
    const conversationIdA = convA.json().conversation_id;
    const conversationIdB = convB.json().conversation_id;

    // A's body arrives 60ms late; B's arrives immediately. Both requests are
    // *started* before either completes, so their handling genuinely
    // interleaves inside the same event loop.
    const slowA = request('POST', `/api/sites/conversation?${siteQuery('site-a')}`, {
      body: { conversation_id: conversationIdA, text: 'slow site A message' },
      delayMs: 60,
    });
    const fastB = request('POST', `/api/sites/conversation?${siteQuery('site-b')}`, {
      body: { conversation_id: conversationIdB, text: 'fast site B message' },
    });

    const [resB, resA] = await Promise.all([fastB, slowA]);
    expect(resB.status).toBe(200);
    expect(resA.status).toBe(200);

    const fileA = paths.within('conversations', 'site-a.jsonl');
    const fileB = paths.within('conversations', 'site-b.jsonl');
    const entriesA = readJsonl(fileA);
    const entriesB = readJsonl(fileB);

    expect(entriesA.map((e) => e.text)).toEqual(['slow site A message']);
    expect(entriesB.map((e) => e.text)).toEqual(['fast site B message']);
    expect(entriesA.every((e) => e.site_id === 'site-a')).toBe(true);
    expect(entriesB.every((e) => e.site_id === 'site-b')).toBe(true);
    // Cross-contamination check in both directions.
    expect(entriesA.some((e) => e.text.includes('site B'))).toBe(false);
    expect(entriesB.some((e) => e.text.includes('site A'))).toBe(false);
  });

  it('reverse ordering: slow site B, fast site A -- isolation holds either way', async () => {
    const convA = await request('POST', `/api/sites/conversation/new?${siteQuery('site-a')}`);
    const convB = await request('POST', `/api/sites/conversation/new?${siteQuery('site-b')}`);
    const conversationIdA = convA.json().conversation_id;
    const conversationIdB = convB.json().conversation_id;

    const slowB = request('POST', `/api/sites/conversation?${siteQuery('site-b')}`, {
      body: { conversation_id: conversationIdB, text: 'slow site B message' },
      delayMs: 60,
    });
    const fastA = request('POST', `/api/sites/conversation?${siteQuery('site-a')}`, {
      body: { conversation_id: conversationIdA, text: 'fast site A message' },
    });

    const [resA, resB] = await Promise.all([fastA, slowB]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const entriesA = readJsonl(paths.within('conversations', 'site-a.jsonl'));
    const entriesB = readJsonl(paths.within('conversations', 'site-b.jsonl'));
    expect(entriesA.map((e) => e.text)).toEqual(['fast site A message']);
    expect(entriesB.map((e) => e.text)).toEqual(['slow site B message']);
  });

  it('slow mutation on site A while site B mutation completes: journals and files stay separate', async () => {
    const mutation = createMutation({ paths, journal, events });
    fs.mkdirSync(paths.within('sites', 'site-a'), { recursive: true });
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });

    const slowA = new Promise((resolve) => {
      setTimeout(() => {
        resolve(mutation.apply({
          site_id: 'site-a', initiator: 'test', intent: 'test.write',
          changes: [{ path: 'index.html', contents: '<html>A</html>' }],
        }));
      }, 50);
    });
    const fastB = Promise.resolve().then(() => mutation.apply({
      site_id: 'site-b', initiator: 'test', intent: 'test.write',
      changes: [{ path: 'index.html', contents: '<html>B</html>' }],
    }));

    const [resultB, resultA] = await Promise.all([fastB, slowA]);
    expect(resultA.revision).toBe(1);
    expect(resultB.revision).toBe(1); // independent per-site revision counters

    expect(fs.readFileSync(paths.within('sites', 'site-a', 'index.html'), 'utf8')).toBe('<html>A</html>');
    expect(fs.readFileSync(paths.within('sites', 'site-b', 'index.html'), 'utf8')).toBe('<html>B</html>');

    const journalA = journal.read('site-a', { limit: 10 });
    const journalB = journal.read('site-b', { limit: 10 });
    expect(journalA.every((e) => e.site_id === 'site-a')).toBe(true);
    expect(journalB.every((e) => e.site_id === 'site-b')).toBe(true);
    expect(journalA).toHaveLength(1);
    expect(journalB).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Ambient-state attack: try to influence a second request by mutating
//    anything process-wide between requests.
// ---------------------------------------------------------------------------
describe('ambient-state attack', () => {
  it('setting globalThis.TAG (the exact legacy pattern) between requests does not change site resolution', async () => {
    fs.mkdirSync(paths.within('sites', 'site-a'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'site-a', 'spec.json'), JSON.stringify({ customer: { id: 'a' } }));
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'site-b', 'spec.json'), JSON.stringify({ customer: { id: 'b' } }));

    globalThis.TAG = 'site-b'; // the legacy global the switch-site bug set
    const res = await request('GET', `/api/sites/spec?${siteQuery('site-a')}`);
    expect(res.status).toBe(200);
    expect(res.json().spec.customer.id).toBe('a'); // must resolve site-a, not the global
    delete globalThis.TAG;
  });

  it('setting SITE_TAG / CURRENT_SITE env vars between requests has no effect on identity resolution', async () => {
    fs.mkdirSync(paths.within('sites', 'site-a'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'site-a', 'spec.json'), JSON.stringify({ customer: { id: 'a' } }));

    process.env.SITE_TAG = 'site-b';
    process.env.CURRENT_SITE = 'site-b';
    const res = await request('GET', `/api/sites/spec?${siteQuery('site-a')}`);
    expect(res.status).toBe(200);
    expect(res.json().spec.customer.id).toBe('a');
  });

  it('a prior request for site B does not leak into a site-agnostic global that a later site-A request could inherit', async () => {
    // Fire a full request for site B (touches identity binding, spec read,
    // conversation) and then, on the SAME app instance with no re-registration,
    // issue a request that supplies no site_id at all. If any module cached
    // "the last site seen" in a closure variable, this second request would
    // succeed by inheriting it. Convention #5 says there is no such thing --
    // it must 400 identity_required, exactly like a first-ever request would.
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'site-b', 'spec.json'), JSON.stringify({}));
    const first = await request('GET', `/api/sites/spec?${siteQuery('site-b')}`);
    expect(first.status).toBe(200);

    const second = await request('GET', '/api/sites/spec');
    expect(second.status).toBe(400);
    expect(second.json().error).toBe('identity_required');
  });

  it('module-level ambient site state is structurally absent: server source contains none of the forbidden patterns', () => {
    // Convention #5 names the exact patterns its own lint (scripts/lint-no-ambient-site.mjs)
    // greps for: global.TAG, process.env.SITE, module-level `let currentSite`.
    // This is the one place in the suite where "where the design makes an
    // attack impossible to even attempt, say so" applies literally: there is
    // no live mutable site variable anywhere in server/ to mutate and no
    // handle to reach into and corrupt at runtime, so the adversarial move is
    // a static-source check rather than a live mutation.
    const serverDir = path.resolve(process.cwd(), 'server');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (/global\.TAG\b/.test(src) || /process\.env\.SITE\b/.test(src) || /^\s*let\s+currentSite\b/m.test(src)) {
          offenders.push(full);
        }
      }
    };
    walk(serverDir);
    expect(offenders, `ambient-site patterns found in: ${offenders.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Identity conflict and spoofing.
// ---------------------------------------------------------------------------
describe('identity conflict and spoofing', () => {
  it('query says site A, header says site B -> 409, handler never runs, nothing written', async () => {
    const res = await request('GET', '/api/sites/spec?site_id=site-a', { headers: { 'x-site-id': 'site-b' } });
    expect(res.status).toBe(409);
    expect(res.json().error).toBe('identity_conflict');
  });

  it('query says site A, header says site B on a mutating route -> 409, nothing journaled for either site', async () => {
    const res = await request('PUT', '/api/sites/spec?site_id=site-a', {
      headers: { 'x-site-id': 'site-b' },
      body: { spec: { customer: { id: 'x' } } },
    });
    expect(res.status).toBe(409);
    expect(readJsonl(paths.within('journal', 'site-a.jsonl'))).toHaveLength(0);
    expect(readJsonl(paths.within('journal', 'site-b.jsonl'))).toHaveLength(0);
  });

  it('a conversation_id minted for site A, replayed against site B, is not silently accepted as belonging to site B', async () => {
    const convA = await request('POST', `/api/sites/conversation/new?${siteQuery('site-a')}`);
    const conversationIdFromA = convA.json().conversation_id;
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });

    const spoofed = await request('POST', `/api/sites/conversation?${siteQuery('site-b')}`, {
      body: { conversation_id: conversationIdFromA, text: 'spoofed cross-site message' },
    });

    // Whatever the exact status code, a conversation_id issued under one
    // site's identity must not be silently usable as if it were native to a
    // different site -- that is exactly the kind of implicit cross-boundary
    // trust the legacy switch-site bug relied on.
    expect(
      spoofed.status,
      'conversation_id minted for site-a was accepted at face value for site-b with no ownership check -- ' +
      'server/kernel/conversation.js#append() validates only that site_id and conversation_id are both present ' +
      'and well-formed (identity.js CONVO_RE), never that the conversation_id was actually minted for this ' +
      'site_id. newConversation() in the same file mints a bare random id with no persisted site binding, so ' +
      'there is currently no data conversation.js could consult to reject this. See report to orchestrator.',
    ).not.toBe(200);
  });

  it('the WebSocket ingress applies the identical query/header conflict rule as HTTP', async () => {
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    events.attach(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/events?site_id=site-a`, { headers: { 'x-site-id': 'site-b' } });
    const closeCode = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => {});
    });
    expect(closeCode).toBe(4409);
    server.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Event delivery isolation over REAL sockets, including a subscriber that
//    connects with no site_id at all.
// ---------------------------------------------------------------------------
