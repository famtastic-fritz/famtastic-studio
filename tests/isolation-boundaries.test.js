// Isolation adversarial tests, part 2: delivery, storage and path boundaries.
// Split from isolation-adversarial.test.js to stay under the 500-line rule.
// Part 1 covers concurrency, ambient-state attacks and identity spoofing.
//
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
describe('event delivery isolation (real websockets)', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    events.attach(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  function connect(query) {
    return new WebSocket(`ws://127.0.0.1:${port}/events${query}`);
  }

  it('a subscriber bound to site A never receives an event emitted for site B, and vice versa', async () => {
    const wsA = connect('?site_id=site-a');
    const wsB = connect('?site_id=site-b');
    await Promise.all([
      new Promise((resolve) => wsA.on('open', resolve)),
      new Promise((resolve) => wsB.on('open', resolve)),
    ]);

    const seenA = [];
    const seenB = [];
    wsA.on('message', (raw) => seenA.push(JSON.parse(raw.toString())));
    wsB.on('message', (raw) => seenB.push(JSON.parse(raw.toString())));

    events.emit({ type: 'test.event', site_id: 'site-a', payload: { for: 'a' } });
    events.emit({ type: 'test.event', site_id: 'site-b', payload: { for: 'b' } });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(seenA.filter((e) => e.type === 'test.event')).toHaveLength(1);
    expect(seenA.find((e) => e.type === 'test.event').payload).toEqual({ for: 'a' });
    expect(seenB.filter((e) => e.type === 'test.event')).toHaveLength(1);
    expect(seenB.find((e) => e.type === 'test.event').payload).toEqual({ for: 'b' });

    wsA.close();
    wsB.close();
  });

  it('a subscriber with no site_id at all is refused, not silently attached to every site', async () => {
    const ws = connect('');
    const closeCode = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => {});
    });
    expect(closeCode).toBe(4400);
    expect(events.clients.size).toBe(0);
  });

  it('rapid emits for two sites interleaved never cross-deliver, over many events', async () => {
    const wsA = connect('?site_id=site-a');
    const wsB = connect('?site_id=site-b');
    await Promise.all([
      new Promise((resolve) => wsA.on('open', resolve)),
      new Promise((resolve) => wsB.on('open', resolve)),
    ]);
    const seenA = [];
    const seenB = [];
    wsA.on('message', (raw) => seenA.push(JSON.parse(raw.toString())));
    wsB.on('message', (raw) => seenB.push(JSON.parse(raw.toString())));

    for (let i = 0; i < 20; i += 1) {
      events.emit({ type: 'burst', site_id: i % 2 === 0 ? 'site-a' : 'site-b', payload: { i } });
    }
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(seenA.every((e) => e.payload.i % 2 === 0)).toBe(true);
    expect(seenB.every((e) => e.payload.i % 2 === 1)).toBe(true);
    expect(seenA).toHaveLength(10);
    expect(seenB).toHaveLength(10);

    wsA.close();
    wsB.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Journal and conversation isolation under interleaved writes.
// ---------------------------------------------------------------------------
describe('journal and conversation isolation', () => {
  it('interleaved journal.append calls for two sites: each file contains only its own entries', () => {
    for (let i = 0; i < 10; i += 1) {
      const siteId = i % 2 === 0 ? 'site-a' : 'site-b';
      journal.append({ site_id: siteId, initiator: 'test', intent: 'write', changes: [], result: { i } });
    }
    const entriesA = journal.read('site-a', { limit: 100 });
    const entriesB = journal.read('site-b', { limit: 100 });
    expect(entriesA).toHaveLength(5);
    expect(entriesB).toHaveLength(5);
    expect(entriesA.every((e) => e.site_id === 'site-a')).toBe(true);
    expect(entriesB.every((e) => e.site_id === 'site-b')).toBe(true);
  });

  it('interleaved conversation.append calls for two sites: neither read returns the other site\'s entries', () => {
    const conversation = createConversation({ paths });
    // Each conversation is minted for its own site: a conversation_id now belongs
    // to exactly one site, so sharing one across sites is refused outright.
    const convA = conversation.newConversation('site-a').conversation_id;
    const convB = conversation.newConversation('site-b').conversation_id;
    for (let i = 0; i < 10; i += 1) {
      if (i % 2 === 0) {
        conversation.append({ site_id: 'site-a', conversation_id: convA, role: 'operator', text: `a-${i}` });
      } else {
        conversation.append({ site_id: 'site-b', conversation_id: convB, role: 'operator', text: `b-${i}` });
      }
    }
    const readA = conversation.read('site-a');
    const readB = conversation.read('site-b');
    expect(readA).toHaveLength(5);
    expect(readB).toHaveLength(5);
    expect(readA.every((e) => e.text.startsWith('a-'))).toBe(true);
    expect(readB.every((e) => e.text.startsWith('b-'))).toBe(true);
  });

  it('a card carrying a foreign site_id is refused outright, not written to either file', () => {
    const conversation = createConversation({ paths });
    let caught = null;
    try {
      conversation.append({
        site_id: 'site-a',
        conversation_id: 'conv-a',
        role: 'system',
        text: '',
        card: { site_id: 'site-b', schema_version: 1, type: 'plan', card_id: 'cd_x' },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('identity_conflict');
    expect(caught.statusCode).toBe(400);
    expect(readJsonl(paths.within('conversations', 'site-a.jsonl'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Sequence independence.
// ---------------------------------------------------------------------------
describe('sequence independence', () => {
  it('two sites\' event sequences advance independently under interleaved emits', () => {
    const seqLog = [];
    for (let i = 0; i < 8; i += 1) {
      const siteId = i % 3 === 0 ? 'site-a' : 'site-b'; // uneven interleave on purpose
      const e = events.emit({ type: 't', site_id: siteId, payload: { i } });
      seqLog.push({ siteId, seq: e.seq });
    }
    const seqA = seqLog.filter((e) => e.siteId === 'site-a').map((e) => e.seq);
    const seqB = seqLog.filter((e) => e.siteId === 'site-b').map((e) => e.seq);
    expect(seqA).toEqual([1, 2, 3]);
    expect(seqB).toEqual([1, 2, 3, 4, 5]);
    expect(events.lastSeq('site-a')).toBe(3);
    expect(events.lastSeq('site-b')).toBe(5);
  });

  it('mutation revisions advance independently per site under interleaved applies', () => {
    const mutation = createMutation({ paths, journal, events });
    fs.mkdirSync(paths.within('sites', 'site-a'), { recursive: true });
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });
    const revisions = [];
    for (let i = 0; i < 6; i += 1) {
      const siteId = i % 2 === 0 ? 'site-a' : 'site-b';
      const result = mutation.apply({
        site_id: siteId, initiator: 'test', intent: 'test.write',
        changes: [{ path: `file-${i}.txt`, contents: String(i) }],
      });
      revisions.push({ siteId, revision: result.revision });
    }
    expect(revisions.filter((r) => r.siteId === 'site-a').map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions.filter((r) => r.siteId === 'site-b').map((r) => r.revision)).toEqual([1, 2, 3]);
  });

  it('a burst on one site does not perturb the other site\'s already-issued sequence numbers', () => {
    events.emit({ type: 't', site_id: 'site-a', payload: {} });
    const beforeBurstA = events.lastSeq('site-a');
    for (let i = 0; i < 50; i += 1) events.emit({ type: 't', site_id: 'site-b', payload: { i } });
    expect(events.lastSeq('site-a')).toBe(beforeBurstA);
    expect(events.lastSeq('site-b')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 7. Path escape: reach site B's files through site A's identity via a
//    crafted page_path or spec/mutation path.
// ---------------------------------------------------------------------------
describe('path escape', () => {
  beforeEach(() => {
    fs.mkdirSync(paths.within('sites', 'site-a'), { recursive: true });
    fs.mkdirSync(paths.within('sites', 'site-b'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'site-b', 'secret.html'), '<html>site-b secret</html>');
  });

  // DEFECT (confirmed live, not just asserted): paths.within('sites', siteId, pagePath)
  // only checks that the resolved target stays under the shared *'sites' root*
  // (server/kernel/paths.js#within: `target.startsWith(base + sep)` where base is
  // root('sites'), NOT root('sites')/<siteId>). A page_path of '../site-b/x' resolves
  // to <sitesRoot>/site-a/../site-b/x = <sitesRoot>/site-b/x, which still starts with
  // <sitesRoot>, so `within()` never throws and resolvePagePath() in
  // server/kernel/canvas.js happily returns site-b's absolute path under site-a's
  // identity. Manually verified: GET /api/sites/canvas?site_id=site-a&page_path=../site-b/secret.html
  // returns 200 with site-b's real file content, instrumented and labeled as if it
  // were site-a's page. This is a live cross-site path-escape read (and, via
  // /api/sites/edit, a potential cross-site write) -- exactly the class of bug this
  // suite exists to catch. These three tests assert the CORRECT behavior (refusal)
  // and are expected to fail until server/kernel/paths.js#within or
  // server/kernel/canvas.js#resolvePagePath is fixed to scope the boundary to the
  // specific site directory, not just the shared sites root.
  it('canvas serve refuses a page_path that escapes into another site via ../', async () => {
    const res = await request('GET', `/api/sites/canvas?${siteQuery('site-a')}&page_path=${encodeURIComponent('../site-b/secret.html')}`);
    expect(res.status).toBe(400);
    expect(res.json().error).toBe('invalid_page_path');
    expect(res.text()).not.toContain('site-b secret');
  });

  it('canvas edit refuses a page_path that escapes into another site, and writes nothing', async () => {
    const res = await request('POST', `/api/sites/edit?${siteQuery('site-a')}`, {
      body: { page_path: '../site-b/secret.html', selector: 'p[1]', before_text: 'x', after_text: 'y' },
    });
    expect(res.status).toBe(400);
    expect(res.json().error).toBe('invalid_page_path');
    expect(fs.readFileSync(paths.within('sites', 'site-b', 'secret.html'), 'utf8')).toBe('<html>site-b secret</html>');
  });

  it('canvas edit refuses an absolute page_path pointing at another site\'s file', async () => {
    // path.resolve() treats an absolute second/third argument as authoritative and
    // discards everything before it, so an absolute page_path bypasses the site_id
    // prefix entirely (same root cause as above, worse: no '../' needed at all).
    const absolute = paths.within('sites', 'site-b', 'secret.html');
    const res = await request('POST', `/api/sites/edit?${siteQuery('site-a')}`, {
      body: { page_path: absolute, selector: 'p[1]', before_text: 'x', after_text: 'y' },
    });
    expect(res.status).toBe(400);
  });

  it('mutation.apply refuses a change path that escapes the site directory via ../', () => {
    const mutation = createMutation({ paths, journal, events });
    expect(() => mutation.apply({
      site_id: 'site-a', initiator: 'test', intent: 'test.write',
      changes: [{ path: '../site-b/secret.html', contents: 'pwned' }],
    })).toThrow();
    expect(fs.readFileSync(paths.within('sites', 'site-b', 'secret.html'), 'utf8')).toBe('<html>site-b secret</html>');
  });

  it('mutation.apply refuses an absolute change path', () => {
    const mutation = createMutation({ paths, journal, events });
    const absolute = paths.within('sites', 'site-b', 'secret.html');
    expect(() => mutation.apply({
      site_id: 'site-a', initiator: 'test', intent: 'test.write',
      changes: [{ path: absolute, contents: 'pwned' }],
    })).toThrow();
    expect(fs.readFileSync(paths.within('sites', 'site-b', 'secret.html'), 'utf8')).toBe('<html>site-b secret</html>');
  });

  it('a traversal deep enough to exit the shared sites root entirely IS refused (the outer boundary works)', async () => {
    // These escape root('sites') itself, not just the site-a subdirectory, so
    // paths.within('sites', ...)'s own boundary check (against the sites root)
    // catches them. This confirms the boundary that exists works correctly --
    // the defect above is specifically that no boundary exists at the
    // per-site-directory level, one level down from the one enforced here.
    const variants = ['../../site-b/secret.html', '../../../../../../etc/passwd'];
    for (const variant of variants) {
      const res = await request('GET', `/api/sites/canvas?${siteQuery('site-a')}&page_path=${encodeURIComponent(variant)}`);
      expect(res.status, `page_path=${variant} must be refused`).toBe(400);
      expect(res.json().error).toBe('invalid_page_path');
    }
  });

  it('a nested-segment traversal that stays inside the sites root reaches site-b anyway (same defect, different shape)', async () => {
    // 'a/../../site-b/secret.html' resolves to <sitesRoot>/site-a/a/../../site-b/secret.html
    // = <sitesRoot>/site-b/secret.html -- inside the sites root the whole way, so the
    // outer boundary above never fires. Same root cause and same expected (refusal)
    // behavior as the primary escape tests; included to show the defect is not tied
    // to one specific traversal string.
    const res = await request('GET', `/api/sites/canvas?${siteQuery('site-a')}&page_path=${encodeURIComponent('a/../../site-b/secret.html')}`);
    expect(res.status).toBe(400);
  });
});

describe('pipeline retry is bound to the request identity, not the run record', () => {
  // Second cross-site breach found in this build: /api/pipeline/retry dropped the
  // bound identity and took the site from whatever run_id was named, while
  // /api/builds lists run ids across every site. Same class as the earlier canvas
  // path escape: a new surface reintroduced ambient authority.
  it('refuses a run belonging to another site', async () => {
    const { createPipeline } = await import('../server/kernel/pipeline.js');
    const pipeline = createPipeline({
      paths, journal: { append: () => ({}) }, events: { emit: () => ({}) },
      dna: { read: () => ({ run_id: 'run_x', site_id: 'site-b', stages: [] }) },
      spec: {}, mutation: {},
    });
    await expect(
      pipeline.retryStage({ site_id: 'site-a', run_id: 'run_x', stage: 'compose' }),
    ).rejects.toMatchObject({ code: 'site_mismatch', statusCode: 403 });
  });

  it('refuses when no bound site is supplied at all', async () => {
    const { createPipeline } = await import('../server/kernel/pipeline.js');
    const pipeline = createPipeline({
      paths, journal: { append: () => ({}) }, events: { emit: () => ({}) },
      dna: { read: () => ({ run_id: 'run_x', site_id: 'site-b', stages: [] }) },
      spec: {}, mutation: {},
    });
    await expect(
      pipeline.retryStage({ run_id: 'run_x', stage: 'compose' }),
    ).rejects.toMatchObject({ code: 'identity_required' });
  });
});
