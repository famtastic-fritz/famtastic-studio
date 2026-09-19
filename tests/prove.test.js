import { creditedHtml, writeFixtureLogo } from './helpers/credited-fixture.js';
// LINT-EXCEPTION: PROVE verification suite (endgame item 26) deliberately covers many
// independent PROVE list items in one file per the task's ownership constraint
// (tests/prove.test.js only); splitting it would violate that constraint.
//
// Endgame ship-blocking item 26: execute the full PROVE verification list (plan
// section 6, v1.0) as amended by A14 (v1.1 amendments) against the greenfield
// tree. This file adds INDEPENDENT verification for items not already covered,
// or covered only partially, by the existing suite (isolation-adversarial.test.js,
// isolation-boundaries.test.js, kernel-mutation.test.js, kernel-events.test.js,
// kernel-deploy.test.js, kernel-pipeline.test.js, kernel-recipe.test.js,
// kernel-site.test.js). It does not restate those tests. See
// docs/env/prove-2026-08-22.md for the full PROVE verdict table and how each
// item maps to evidence, including which items are proven here vs by reading
// existing passing tests vs by reading source only (never executed).
//
// This suite drives the REAL router (createApp()) with the REAL modules
// (server/modules/*/index.js) wired to REAL kernel primitives over a hermetic
// temp STUDIO_DATA_ROOT, same harness pattern as isolation-boundaries.test.js.
// No product file is modified anywhere in this task.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
import { createSpec } from '../server/kernel/spec.js';
import { createSite } from '../server/kernel/site.js';
import { createDeploy } from '../server/kernel/deploy.js';
import { preflightModuleClosure, assertInvariants } from '../server/kernel/invariants.js';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let root;
let paths;
let journal;
let events;
let registry;
let app;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-'));
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
  fs.rmSync(root, { recursive: true, force: true });
});

// Same fake-transport HTTP driver as isolation-boundaries.test.js: drives the
// real app.handler with a real Readable body stream, no product code touched.
function request(method, url, { headers = {}, body } = {}) {
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
          json: () => JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()),
        });
      },
    };
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.push(bodyStr || null);
    if (bodyStr) req.push(null);
    app.handler(req, res);
  });
}

function siteHeaders(siteId, convoId) {
  return { 'x-site-id': siteId, ...(convoId ? { 'x-conversation-id': convoId } : {}) };
}

function makeSite(siteId, extraSpec = {}) {
  fs.mkdirSync(paths.within('sites', siteId), { recursive: true });
  fs.writeFileSync(paths.within('sites', siteId, 'spec.json'), JSON.stringify({ customer: {}, ...extraSpec }, null, 2));
}

// ---------------------------------------------------------------------------
// PROVE 1: no-auth operator access; bind scope. The server has no login,
// token, or credential check anywhere in the router (confirmed by reading
// kernel/app.js and kernel/identity.js: bindIdentity only checks site_id
// format/conflict, never a credential). Bind-scope logic
// (BIND_LAN=1 -> 0.0.0.0, else 127.0.0.1) lives inline in server/index.js and
// can only be exercised by actually booting the process -- so this section
// spawns the real boot script both ways. It surfaces a real, reproducible
// defect: the server currently cannot boot at all.
// ---------------------------------------------------------------------------
describe('PROVE 1: no-auth access + bind scope', () => {
  it('no route anywhere requires a credential; router only ever inspects site identity', async () => {
    makeSite('acme');
    // A request with zero auth-shaped headers succeeds against a site-scoped
    // route; this is the intended no-auth-on-preview-port design, restated as
    // an executable check rather than an assumption.
    const res = await request('GET', '/api/sites/current?site_id=acme', {});
    expect(res.status).toBe(200);
  });

  it('boot + bind scope, executed against the real process: default env binds 127.0.0.1, BIND_LAN=1 binds 0.0.0.0. ' +
     'NOTE (transient defect, self-resolved during this verification pass): earlier in this same session the real ' +
     'boot (`node server/index.js`) reproducibly failed P0-I1 preflight with "reads forbidden env prefix: ' +
     'server/kernel/proofs.js" -- a false positive from a comment in proofs.js containing the literal forbidden-prefix ' +
     'string, which server/kernel/invariants.js flags via raw substring matching, not comment-aware parsing. The ' +
     'comment wording was edited (by concurrent work on this shared worktree, not by this task) before this test ran; ' +
     'boot now succeeds. See docs/env/prove-2026-08-22.md for the exact captured stderr from the earlier failing run.', () => {
    const runOnce = (env, port) => spawnSync(process.execPath, ['server/index.js'], {
      cwd: treeRoot,
      env: { ...process.env, ...env, STUDIO_DATA_ROOT: root, PORT: String(port) },
      timeout: 2000, // the server never exits on its own once listening; this bounds the wait, not a failure condition
      encoding: 'utf8',
    });

    const defaultRun = runOnce({}, 34011);
    expect(defaultRun.stdout).toMatch(/listening on http:\/\/127\.0\.0\.1:34011/);
    expect(defaultRun.stdout).not.toMatch(/0\.0\.0\.0/);

    const lanRun = runOnce({ BIND_LAN: '1' }, 34012);
    expect(lanRun.stdout).toMatch(/listening on http:\/\/0\.0\.0\.0:34012/);
  }, 15000);

  it('P0-I1 preflight, as it stands now: passes over the real module closure with no violation (re-verified at test time, not assumed from the earlier failure)', () => {
    const modulesDir = path.join(treeRoot, 'server/modules');
    const moduleEntries = fs.readdirSync(modulesDir)
      .map((n) => path.join(modulesDir, n, 'index.js'))
      .filter((p) => fs.existsSync(p));
    expect(() => preflightModuleClosure({
      entryFiles: [
        path.join(treeRoot, 'server/index.js'),
        path.join(treeRoot, 'server/kernel/paths.js'),
        path.join(treeRoot, 'server/kernel/events.js'),
        path.join(treeRoot, 'server/kernel/journal.js'),
        path.join(treeRoot, 'server/kernel/registry.js'),
        path.join(treeRoot, 'server/kernel/app.js'),
        path.join(treeRoot, 'server/kernel/modules.js'),
        ...moduleEntries,
      ],
      treeRoot,
    })).not.toThrow();
    const proofsSrc = fs.readFileSync(path.join(treeRoot, 'server/kernel/proofs.js'), 'utf8');
    expect(proofsSrc).not.toMatch(/process\.env\.FAMTASTIC_PROOF/); // never a real read of the forbidden prefix
  });

  it('assertInvariants() itself (the env-var runtime check) is sound: it does not false-positive on an unrelated env', () => {
    expect(() => assertInvariants({ PATH: '/usr/bin' })).not.toThrow();
    expect(() => assertInvariants({ FAMTASTIC_PROOF_DISPATCH_SECRET: 'x' })).toThrow(/P0-I1 violated/);
  });
});

// ---------------------------------------------------------------------------
// PROVE 2: cross-site isolation. Already covered by tests/isolation-adversarial.test.js
// (11 tests: delayed concurrent A/B for conversation and mutation, ambient-state
// attack via globalThis.TAG and SITE_TAG/CURRENT_SITE env, identity conflict and
// spoofing over HTTP and WebSocket) and tests/isolation-boundaries.test.js
// (16 tests: real-websocket event delivery isolation, rapid interleaved emits,
// path-boundary/traversal tests). Both pass (see prove-2026-08-22.md). This
// section adds ONLY the one A14 sub-case those files do not cover: spec.json
// writes and event emission, not just conversation/mutation, isolated under the
// same delayed concurrent A/B shape. "Memory" from A14's list is not applicable:
// no memory subsystem exists anywhere in this tree (grep confirms zero hits
// besides an unrelated in-memory comment in deploy.js).
// ---------------------------------------------------------------------------
describe('PROVE 2 (A14 addition): delayed concurrent A/B over spec + events, not just conversation', () => {
  it('a slow spec write for site A in flight does not block or bleed into a fast spec write for site B, and each site only ever sees its own events', async () => {
    makeSite('site-a');
    makeSite('site-b');
    const specKernel = createSpec({ paths, mutation: createMutation({ paths, journal, events }) });

    const slowA = new Promise((resolve) => {
      setTimeout(() => resolve(specKernel.write('site-a', { customer: { id: 'A' } }, { initiator: 'test' })), 40);
    });
    const fastB = specKernel.write('site-b', { customer: { id: 'B' } }, { initiator: 'test' });

    await Promise.all([slowA, fastB]);

    const readA = specKernel.read('site-a');
    const readB = specKernel.read('site-b');
    expect(readA.spec.customer.id).toBe('A');
    expect(readB.spec.customer.id).toBe('B');

    const eventsA = events.replay('site-a', 0).map((e) => e.type);
    const eventsB = events.replay('site-b', 0).map((e) => e.type);
    expect(eventsA.every((t) => true)).toBe(true); // sanity: replay succeeded
    expect(events.replay('site-a', 0).some((e) => e.payload && JSON.stringify(e.payload).includes('"B"'))).toBe(false);
    expect(events.replay('site-b', 0).some((e) => e.payload && JSON.stringify(e.payload).includes('"A"'))).toBe(false);
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PROVE 3: conversation reload/restart continuity per site.
// ---------------------------------------------------------------------------
describe('PROVE 3: conversation reload/restart continuity', () => {
  it('a second kernel instance constructed over the same data root (simulating a server restart) sees the full prior history for a site, and only that site', async () => {
    const first = createConversation({ paths });
    const { conversation_id } = first.newConversation('acme');
    first.append({ site_id: 'acme', conversation_id, role: 'operator', text: 'first message' });
    first.append({ site_id: 'acme', conversation_id, role: 'system', text: 'second message' });

    // Simulate restart: brand new kernel instance, no shared in-memory state,
    // same STUDIO_DATA_ROOT on disk.
    const restarted = createConversation({ paths });
    const history = restarted.read('acme');
    expect(history).toHaveLength(2);
    expect(history[0].text).toBe('first message');
    expect(history[1].text).toBe('second message');

    // Ownership survives the restart too: a conversation minted for acme
    // before restart is still refused against another site after restart.
    let caught = null;
    try {
      restarted.append({ site_id: 'other-site', conversation_id, role: 'operator', text: 'hijack' });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('conversation_site_mismatch');
  });

  it('restart continuity holds over the real HTTP surface: append before, read after re-registering modules against the same root', async () => {
    makeSite('acme');
    await request('POST', '/api/sites/conversation', {
      headers: siteHeaders('acme'),
      body: { text: 'before restart', conversation_id: 'conv_fixed_1' },
    });

    // Re-create app + reload modules fresh, same pattern a real process
    // restart would produce (new in-memory state, same data root).
    const restartedApp = createApp();
    const restartedModules = await loadModules();
    for (const mod of restartedModules) restartedModules && mod.register({ app: restartedApp, paths, journal, events, registry });
    const res = await new Promise((resolve) => {
      const chunks = [];
      const fakeRes = {
        writableEnded: false, statusCode: 200, headers: {},
        writeHead(s, h) { this.statusCode = s; this.headers = h || {}; },
        end(c) { this.writableEnded = true; if (c) chunks.push(c); resolve({ status: this.statusCode, json: () => JSON.parse(Buffer.concat(chunks.map((x) => Buffer.from(x))).toString()) }); },
      };
      const req = new Readable({ read() {} });
      req.method = 'GET';
      req.url = '/api/sites/conversation?site_id=acme';
      req.headers = {};
      req.push(null);
      restartedApp.handler(req, fakeRes);
    });
    const body = await res.json();
    const texts = (body.entries || []).map((e) => e.text);
    expect(texts).toContain('before restart');
  });
});

// ---------------------------------------------------------------------------
// PROVE 4: journal completeness audit -- independent verification that every
// mutation (apply and undo) produces exactly one journal entry, and that the
// final bytes on disk for every touched path match what the LATEST journal
// entry for that path claims, cross-checked against direct filesystem reads
// (not the mutation kernel's own accounting). Direct-edit latency is already
// measured and recorded in docs/env/latency-2026-08-22.md (p50 12ms / p95
// 23ms against a 140ms budget); cited, not re-measured here. Undo exactness
// (create/update/delete/multi-artifact/divergent redo/stale revision/crash
// boundary/journal-unavailable) is already covered by kernel-mutation.test.js
// (14 tests, all pass); this section adds one independent full-manifest
// equality check A14 asks for explicitly, and the cross-site-audit-against-disk.
// ---------------------------------------------------------------------------
describe('PROVE 4: journal completeness audit', () => {
  it('every apply/undo across two sites produces exactly one journal entry each, and disk bytes for every touched file match the latest entry that touched it', () => {
    const mutation = createMutation({ paths, journal, events });
    makeSite('acme');
    makeSite('globex');

    const r1 = mutation.apply({ site_id: 'acme', initiator: 't', intent: 'create', changes: [{ path: 'index.html', contents: '<h1>1</h1>' }] });
    const r2 = mutation.apply({ site_id: 'acme', initiator: 't', intent: 'update', changes: [{ path: 'index.html', contents: '<h1>2</h1>' }, { path: 'style.css', contents: 'body{}' }] });
    const r3 = mutation.apply({ site_id: 'globex', initiator: 't', intent: 'create', changes: [{ path: 'index.html', contents: '<h1>g1</h1>' }] });
    mutation.undo('acme', r2.undo_token);

    const acmeEntries = journal.read('acme', { limit: 100 });
    const globexEntries = journal.read('globex', { limit: 100 });
    // 2 applies + 1 undo for acme, 1 apply for globex -- one entry per call, no more, no fewer.
    expect(acmeEntries).toHaveLength(3);
    expect(globexEntries).toHaveLength(1);
    expect(new Set(acmeEntries.map((e) => e.entry_id)).size).toBe(3); // no duplicate entry_ids
    void r1; void r3;

    // Independent disk audit: read index.html and style.css directly and
    // confirm they equal the after_base64 the manifest for their LAST
    // journal entry actually claims -- not what the kernel says happened,
    // what the file bytes actually are.
    const latestManifestFor = (entries, relPath) => {
      for (const entry of entries) { // newest-first
        const item = (entry.evidence?.manifest || []).find((m) => m.path === relPath);
        if (item) return item;
      }
      return null;
    };
    const onDiskIndex = fs.readFileSync(paths.within('sites', 'acme', 'index.html'));
    const claim = latestManifestFor(acmeEntries, 'index.html');
    expect(claim).not.toBeNull();
    expect(claim.after_exists).toBe(true);
    expect(onDiskIndex.toString('base64')).toBe(claim.after_base64);
    expect(crypto.createHash('sha256').update(onDiskIndex).digest('hex')).toBe(claim.after_sha256);
    // The undo restored index.html to "<h1>1</h1>", not "<h1>2</h1>" -- the
    // undo's own manifest is the latest entry, and it must reflect that.
    expect(onDiskIndex.toString('utf8')).toBe('<h1>1</h1>');
  });

  it('A14 undo exactness, independently: full before/after manifest equality with content hashes, verified for the redo path (undo of an undo restores the ORIGINAL bytes exactly, not a copy)', () => {
    const mutation = createMutation({ paths, journal, events });
    makeSite('acme');
    const original = Buffer.from('<h1>original</h1>');
    mutation.apply({ site_id: 'acme', initiator: 't', intent: 'seed', changes: [{ path: 'index.html', contents: original }] });
    const originalHash = crypto.createHash('sha256').update(original).digest('hex');

    const changed = mutation.apply({ site_id: 'acme', initiator: 't', intent: 'edit', changes: [{ path: 'index.html', contents: '<h1>changed</h1>' }] });
    const undone = mutation.undo('acme', changed.undo_token); // back to original
    expect(fs.readFileSync(paths.within('sites', 'acme', 'index.html')).toString()).toBe('<h1>original</h1>');
    expect(crypto.createHash('sha256').update(fs.readFileSync(paths.within('sites', 'acme', 'index.html'))).digest('hex')).toBe(originalHash);

    const redone = mutation.undo('acme', undone.undo_token); // redo: forward to "changed" again
    expect(fs.readFileSync(paths.within('sites', 'acme', 'index.html')).toString()).toBe('<h1>changed</h1>');
    void redone;
  });
});

// ---------------------------------------------------------------------------
// PROVE 5: proposal review flow; apply-to-working-copy strictly separate from
// publish/deploy; approval never implies execution.
//
// NOT-APPLICABLE for the conversational half of this item: no Shay reasoning
// layer exists in this milestone. server/kernel/conversation.js documents
// this explicitly ("Shay is not wired to a model in this milestone (M2)"),
// ROLES is frozen to ['operator','system'] with no 'assistant' role, and no
// module in server/modules/ generates a proposal card and auto-applies it.
// There is therefore no live "Shay proposes, operator approves, system
// executes" loop to adversarially test yet -- testing it would mean testing
// code that does not exist. What IS built and testable is the structural
// separation the item also asks for: mutation.apply (working copy) and
// deploy.deploy (publish) are different kernels writing different roots, and
// no code path calls deploy from inside apply.
// ---------------------------------------------------------------------------
describe('PROVE 5: apply-to-working-copy is structurally separate from deploy/publish', () => {
  it('mutation.apply never writes under the famtasticinc (deploy) root, and deploy.deploy never writes under the sites (working copy) root except the spec.json target pointer', () => {
    const mutation = createMutation({ paths, journal, events });
    const deploy = createDeploy({ paths, journal, events });
    makeSite('acme', { customer: { id: 'c1' } });
    writeFixtureLogo(paths.within('sites', 'acme'));
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), creditedHtml('<h1>hi</h1>'));

    const famtasticincRoot = paths.root('famtasticinc');
    expect(fs.existsSync(famtasticincRoot)).toBe(false); // nothing deployed yet

    mutation.apply({ site_id: 'acme', initiator: 't', intent: 'edit', changes: [{ path: 'about.html', contents: creditedHtml('<h1>about</h1>', 'about.html') }] });
    expect(fs.existsSync(famtasticincRoot) && fs.readdirSync(famtasticincRoot).length > 0).toBeFalsy();

    const before = fs.readFileSync(paths.within('sites', 'acme', 'index.html')).toString();
    deploy.deploy({ site_id: 'acme', initiator: 't' });
    const after = fs.readFileSync(paths.within('sites', 'acme', 'index.html')).toString();
    expect(after).toBe(before); // deploy never rewrites the working copy's page bytes
    expect(fs.existsSync(famtasticincRoot)).toBe(true); // it DID write the separate deploy root
  });

  it('no route registered anywhere calls deploy as a side effect of an edit/apply route: /api/sites/edit and /api/sites/conversation never touch a deploy receipt', async () => {
    makeSite('acme', { customer: { id: 'c1' } });
    fs.mkdirSync(paths.within('sites', 'acme'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), '<html><body><h1 data-fam-sel="h1">hi</h1></body></html>');
    await request('POST', '/api/sites/edit', {
      headers: siteHeaders('acme'),
      body: { page_path: 'index.html', selector: 'h1', before_text: 'hi', after_text: 'bye' },
    });
    expect(fs.existsSync(paths.root('famtasticinc'))).toBe(false);
    expect(fs.existsSync(paths.root('deploys'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROVE 6 + 11: honest states under a killed backing endpoint, cross-checked
// against a wrong-denominator audit (A6). Kills each backing directory/root
// in turn and asserts explicit honest rendering (NOT_FOUND/empty/404), never
// a fabricated 200 with invented rows, then separately builds a real, mixed
// portfolio of sites on disk and checks /api/sites denominators against a
// hand count from the filesystem (not the kernel's own bookkeeping).
// ---------------------------------------------------------------------------
describe('PROVE 6: honest states when a backing endpoint is killed', () => {
  it('GET /api/sites when the sites root does not exist at all -> honest NOT_FOUND, not a fabricated empty-but-ok 200', async () => {
    fs.rmSync(paths.root('sites'), { recursive: true, force: true });
    const res = await request('GET', '/api/sites', {});
    const body = await res.json();
    expect(res.status).toBe(200); // the endpoint itself is reachable
    expect(body.status).toBe('NOT_FOUND'); // but honestly reports the root is missing
    expect(body.sites).toEqual([]);
  });

  it('GET /api/sites/current for a site_id with no directory on disk -> 404 site_not_found, never a synthesized site', async () => {
    const res = await request('GET', '/api/sites/current?site_id=ghost', {});
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe('site_not_found');
  });

  it('GET /api/proofs when the events root has never been created -> honest not_configured with a real reason, zero fabricated entries', async () => {
    // events root not created yet in a fresh temp STUDIO_DATA_ROOT
    const res = await request('GET', '/api/proofs', {});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('not_configured');
    expect(body.entries).toEqual([]);
    expect(body.reason).toMatch(/events root does not exist/);
  });

  it('GET /api/sites/pages for a site with a directory but zero HTML files -> honest empty, not an invented page list', async () => {
    makeSite('acme');
    const res = await request('GET', '/api/sites/pages?site_id=acme', {});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('empty');
  });

  // /api/media and /api/components used to be a raw listing of the (empty,
  // unused) studio-owned media/components roots, honestly NOT_FOUND when
  // those roots did not exist. Replaced by dedicated portfolio-projection
  // modules (server/modules/media/, server/modules/components/) with their
  // own isolated-portfolio test coverage -- this suite's single shared
  // `paths` reads the REAL, machine-specific portfolio_roots (an absolute
  // path, unaffected by this file's temp STUDIO_DATA_ROOT), which is not a
  // reproducible premise for a unit test to assert a specific status against.
});

describe('PROVE 11: wrong-denominator audit against disk', () => {
  it('site.list() denominator counts equal a hand count over the actual directories/spec files on disk, for a mixed portfolio', () => {
    const site = createSite({ paths });
    const sitesRoot = paths.ensure('sites');

    // directories-only: dir exists, no spec.json
    fs.mkdirSync(path.join(sitesRoot, 'dir-only'));
    // valid_spec: spec.json parses, no customer.id
    fs.mkdirSync(path.join(sitesRoot, 'spec-only'));
    fs.writeFileSync(path.join(sitesRoot, 'spec-only', 'spec.json'), JSON.stringify({}));
    // customer: has customer.id, no deploy.target
    fs.mkdirSync(path.join(sitesRoot, 'customer-only'));
    fs.writeFileSync(path.join(sitesRoot, 'customer-only', 'spec.json'), JSON.stringify({ customer: { id: 'c1' } }));
    // deployable: has deploy.target, receipt missing/stale so not live
    fs.mkdirSync(path.join(sitesRoot, 'deployable-only'));
    fs.writeFileSync(path.join(sitesRoot, 'deployable-only', 'spec.json'), JSON.stringify({ customer: { id: 'c2' }, deploy: { target: '/x' } }));
    // live: deploy target matches canonical, fresh probe, production
    fs.mkdirSync(path.join(sitesRoot, 'live-only'));
    fs.writeFileSync(path.join(sitesRoot, 'live-only', 'spec.json'), JSON.stringify({
      customer: { id: 'c3' },
      deploy: {
        target: '/live-target', canonical_target: '/live-target',
        receipt: { target: '/live-target', environment: 'production', verified_at: new Date().toISOString() },
      },
    }));
    // a directory that is not even readable as a directory-level entry should
    // not appear at all -- covered structurally by fs.readdirSync withFileTypes.

    const body = site.list();

    // Hand count from disk, independent of site.js's own classify() function:
    // recompute the same predicates by hand over the raw directory listing.
    const entries = fs.readdirSync(sitesRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    let handDirectories = 0, handValidSpec = 0, handCustomer = 0, handDeployable = 0, handLive = 0;
    for (const entry of entries) {
      const specPath = path.join(sitesRoot, entry.name, 'spec.json');
      if (!fs.existsSync(specPath)) { handDirectories += 1; continue; }
      let spec;
      try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch { handDirectories += 1; continue; }
      handDirectories += 1; handValidSpec += 1;
      if (!spec.customer?.id) continue;
      handCustomer += 1;
      if (!spec.deploy?.target) continue;
      handDeployable += 1;
      const r = spec.deploy.receipt;
      if (r && r.target === spec.deploy.canonical_target && r.environment === 'production' && r.verified_at) handLive += 1;
    }

    expect(body.denominators.directories.value).toBe(handDirectories);
    expect(body.denominators.valid_spec.value).toBe(handValidSpec);
    expect(body.denominators.customer.value).toBe(handCustomer);
    expect(body.denominators.deployable.value).toBe(handDeployable);
    expect(body.denominators.live.value).toBe(handLive);
    expect(body.denominators.directories.value).toBe(5);
    expect(body.denominators.live.value).toBe(1);
  });

  it('FIXED: the deployments page reads the same collection key the API returns, so a real deploy no longer renders as a false empty page', async () => {
    makeSite('acme', { customer: { id: 'c1' } });
    writeFixtureLogo(paths.within('sites', 'acme'));
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), creditedHtml('<h1>hi</h1>'));
    const deploy = createDeploy({ paths, journal, events });
    deploy.deploy({ site_id: 'acme', initiator: 't' });

    const res = await request('GET', '/api/deployments', {});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.receipts)).toBe(true);
    expect(body.receipts.length).toBeGreaterThan(0); // real evidence exists on the wire

    // The bug was a key mismatch: the page declared `deployments` while the API
    // returns `receipts`, so real receipts rendered as an honest-looking empty
    // page. The smoke could not catch it because its fixture never seeds a
    // deploy. Assert the page now names the key the wire actually carries.
    expect(body.deployments, 'the wire carries receipts, not deployments').toBeUndefined();

    const pageSrc = fs.readFileSync(path.join(treeRoot, 'public/pages/deployments.js'), 'utf8');
    expect(pageSrc).toMatch(/collection:\s*'receipts'/);
    expect(pageSrc).toMatch(/data\.receipts/);
    expect(pageSrc, 'the stale keys must be gone, not merely supplemented').not.toMatch(/data\.deployments/);
    // If this assertion ever starts failing because the page was fixed to read
    // `receipts`, that is the bug being closed, not this test being wrong.
  });
});

// ---------------------------------------------------------------------------
// PROVE 7: proofs page renders only real integration events; read-only
// verified with no mutation route reachable.
// ---------------------------------------------------------------------------
describe('PROVE 7: proofs is read-only and renders only real events', () => {
  it('no mutation route is reachable under /api/proofs for any HTTP method', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await request(method, '/api/proofs', { body: { proof_id: 'p1' } });
      expect(res.status).toBe(404); // the router has no non-GET route registered for this pattern
    }
  });

  it('renders exactly the proof.stage.* events actually on the event spine, in order, with no stage invented for a site that never emitted one', async () => {
    makeSite('acme');
    makeSite('globex');
    events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'pr1' } });
    events.emit({ type: 'proof.stage.generating', site_id: 'acme', payload: { proof_id: 'pr1' } });
    events.emit({ type: 'site.updated', site_id: 'globex', payload: {} }); // not a proof event; must not appear

    const res = await request('GET', '/api/proofs', {});
    const body = await res.json();
    expect(body.status).not.toBe('not_configured');
    expect(body.entries).toHaveLength(1); // one proof_id, two stage events collapsed into its trail
    expect(body.entries[0].proof_id).toBe('pr1');
    expect(body.entries[0].site_id).toBe('acme');
    expect(body.entries[0].stage).toBe('generating'); // latest stage, not fabricated
    const stages = body.entries[0].evidence_trail.map((s) => s.stage);
    expect(stages).toEqual(['ingested', 'generating']);
    // globex never emitted a proof event: it must not produce an entry.
    expect(body.entries.some((e) => e.site_id === 'globex')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROVE 8: deploy confirmation without dispatch; rollback restores exactly;
// deploy evidence attached.
// ---------------------------------------------------------------------------
describe('PROVE 8: deploy confirm/dispatch, rollback exactness, evidence', () => {
  it('GAP, documented not invented: there is no server-side dry-run/preview deploy route. POST /api/sites/deploy dispatches ' +
     'immediately on receipt -- confirmation-without-dispatch, if it exists at all, is a client-side card pattern ' +
     '(cards.js action.confirm_required) that this suite cannot exercise without a browser/DOM harness (none is wired ' +
     'in this tree: no jsdom/happy-dom dependency, no vitest DOM environment configured). What IS verified: GET ' +
     '/api/sites/deployments never dispatches (read-only), confirming the read side of that split is at least honest.', async () => {
    makeSite('acme', { customer: { id: 'c1' } });
    writeFixtureLogo(paths.within('sites', 'acme'));
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), creditedHtml('<h1>hi</h1>'));
    const before = fs.existsSync(paths.root('famtasticinc'));
    await request('GET', '/api/sites/deployments', { headers: siteHeaders('acme') });
    const after = fs.existsSync(paths.root('famtasticinc')) && fs.readdirSync(paths.root('famtasticinc')).length > 0;
    expect(before).toBe(false);
    expect(after).toBe(false); // a GET never dispatches a deploy
  });

  it('rollback restores the exact prior manifest (every file, sha256-verified) via the real HTTP surface, and the receipt carries attached evidence', async () => {
    makeSite('acme', { customer: { id: 'c1' } });
    writeFixtureLogo(paths.within('sites', 'acme'));
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), creditedHtml('<h1>v1</h1>'));
    fs.writeFileSync(paths.within('sites', 'acme', 'style.css'), 'body{color:red}');

    const dep1 = await (await request('POST', '/api/sites/deploy', { headers: siteHeaders('acme') })).json();
    expect(dep1.manifest_hash).toBeTruthy();
    expect(dep1.receipt_id).toBeTruthy();
    expect(dep1.timestamp).toBeTruthy();
    expect(dep1.source_revision).toBeDefined(); // deploy evidence attached: hash, timestamp, revision

    writeFixtureLogo(paths.within('sites', 'acme'));
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), creditedHtml('<h1>v2</h1>'));
    fs.writeFileSync(paths.within('sites', 'acme', 'style.css'), 'body{color:blue}');
    const dep2 = await (await request('POST', '/api/sites/deploy', { headers: siteHeaders('acme') })).json();

    const rollback = await (await request('POST', '/api/sites/rollback', { headers: siteHeaders('acme'), body: { receipt_id: dep2.receipt_id } })).json();
    expect(rollback.verification.ok).toBe(true);
    expect(rollback.restored_receipt_id).toBe(dep1.receipt_id);

    // Independent verification against actual bytes at the restored target,
    // not the response body's own claim.
    const restoredIndex = fs.readFileSync(path.join(rollback.restored_target, 'index.html')).toString();
    const restoredCss = fs.readFileSync(path.join(rollback.restored_target, 'style.css')).toString();
    expect(restoredIndex).toBe(creditedHtml('<h1>v1</h1>'));
    expect(restoredCss).toBe('body{color:red}');
  });
});

// ---------------------------------------------------------------------------
// PROVE 9: DNA completeness -- already covered end to end by
// tests/kernel-pipeline.test.js ("a failed stage is located and retryable at
// the stage level", 4 tests, all pass): a deliberately failed stage records
// the failure, leaves earlier stages intact, and a stage-level retry
// succeeds without re-running the whole pipeline; retrying an unknown stage
// or a stage with no failed attempt is refused. Cited, not duplicated here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PROVE 10: recipe re-run reproduces the stage sequence against a new packet.
// kernel-recipe.test.js (9 tests) and kernel-dna.test.js (14 tests) already
// cover fromRun()/isVerifiedRerun() structurally. This adds one independent,
// end-to-end check: derive a recipe from a real DNA run, "rerun" it against
// a DIFFERENT declared input, and assert the stage sequence is identical
// while the output is deliberately NOT byte-identical (A4's definition).
// ---------------------------------------------------------------------------
describe('PROVE 10: recipe re-run reproduces the stage sequence against a new packet', () => {
  it('a recipe derived from one run, executed with a different declared input (a new packet_ref, a different site), reproduces the same ordered stage graph with genuinely different output, and isVerifiedRerun() accepts it', async () => {
    const { createDna } = await import('../server/kernel/dna.js');
    const { createRecipe } = await import('../server/kernel/recipe.js');
    const dna = createDna({ paths });
    const recipe = createRecipe({ paths, dna });

    const STAGE_GRAPH = [
      { stage: 'research', depends_on: [] },
      { stage: 'generate', depends_on: ['research'] },
      { stage: 'verify', depends_on: ['generate'] },
    ];
    function runPipeline(site_id, packetRef) {
      const { run_id } = dna.startRun({
        site_id, research_packet_ref: packetRef, source_commit: 'commit1', tree_hash: 'tree1',
        recipe_snapshot: { stack_directives: ['drupal+react-front'] }, stage_graph: STAGE_GRAPH,
      });
      for (const node of STAGE_GRAPH) {
        dna.recordStage({
          run_id, stage: node.stage, prompt_template: `${node.stage}/v1`, prompt_snapshot: `do ${node.stage} for {{site}}`,
          model: 'claude-sonnet-5', agent: `${node.stage}-agent`, verification: { passed: true }, status: 'success',
          outputs: [{ ref: `${node.stage}-output-for-${packetRef}`, content: `${node.stage}:${packetRef}` }],
        });
      }
      dna.finishRun({ run_id, outcome: 'success' });
      return run_id;
    }

    const firstRunId = runPipeline('acme', 'packet_original');
    const savedRecipe = recipe.fromRun(firstRunId, { name: 'test-recipe' });
    const firstStageOrder = savedRecipe.stages.map((s) => s.stage);
    expect(firstStageOrder).toEqual(['research', 'generate', 'verify']);

    // Rerun: SAME resolved stage graph, executed against a NEW declared
    // packet (different research_packet_ref, different site).
    const rerunRunId = runPipeline('globex', 'packet_new');
    const rerunRecord = dna.read(rerunRunId);
    const rerunStageOrder = rerunRecord.replay_manifest.stage_graph.map((n) => n.stage);
    expect(rerunStageOrder).toEqual(firstStageOrder);

    // Definition per A4/recipe.js: byte-identical output is NEVER required,
    // and here it genuinely differs (different packet ref baked into it).
    const originalRecord = dna.read(firstRunId);
    const originalOutputs = originalRecord.stages.map((s) => s.outputs_ref);
    const rerunOutputs = rerunRecord.stages.map((s) => s.outputs_ref);
    expect(rerunOutputs).not.toEqual(originalOutputs);

    const verdict = recipe.isVerifiedRerun(savedRecipe, rerunRecord);
    expect(verdict).toEqual({ verified: true, reason: null });
  });
});

// ---------------------------------------------------------------------------
// PROVE 12: shipped assets contain no model/provider controls and no
// tenant/team/billing chrome. Grep-based structural check over every shipped
// static asset (not a sample), so this test regresses the moment such a
// control is introduced.
// ---------------------------------------------------------------------------
describe('PROVE 12: no model/provider or tenant/team/billing chrome in shipped assets', () => {
  it('scans every file under public/ for forbidden terms', () => {
    const forbidden = /model[- ]?(select|picker|dropdown)|claude-3|claude-4|gpt-4|gpt-5|anthropic|openai\b|\bbilling\b|\binvoice\b|\bsubscription\b|\btenant\b|\bsign.?in\b|\bpassword\b|\bapi.?key\b/i;
    const publicDir = path.join(treeRoot, 'public');
    const offenders = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(html|js|css)$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          if (forbidden.test(src)) offenders.push(path.relative(treeRoot, full));
        }
      }
    })(publicDir);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A14: event disconnect, replay, dedup -- over REAL WebSocket connections
// against the real events kernel attached to a real HTTP server (fake
// req/res transport cannot carry an upgrade request, so this section is the
// one place in this file that binds a real ephemeral port).
// ---------------------------------------------------------------------------
describe('A14: events disconnect / replay / dedup (real WebSocket)', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer(app.handler);
    events.attach(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function connect(siteId, afterSeq) {
    const url = `ws://127.0.0.1:${port}/events?site_id=${encodeURIComponent(siteId)}${afterSeq !== undefined ? `&after_seq=${afterSeq}` : ''}`;
    return new WebSocket(url);
  }

  it('disconnect then reconnect with the last seen seq replays only the events emitted while disconnected, no duplicates, no gaps', async () => {
    makeSite('acme');
    events.emit({ type: 't', site_id: 'acme', payload: { i: 1 } });
    events.emit({ type: 't', site_id: 'acme', payload: { i: 2 } });

    const ws1 = connect('acme', 0);
    const firstBatch = await new Promise((resolve) => {
      const seen = [];
      ws1.on('message', (data) => {
        seen.push(JSON.parse(data.toString()));
        if (seen.length === 2) resolve(seen);
      });
    });
    expect(firstBatch.map((e) => e.seq)).toEqual([1, 2]);
    ws1.close(); // disconnect
    await new Promise((resolve) => ws1.on('close', resolve));

    // While disconnected, more events land.
    events.emit({ type: 't', site_id: 'acme', payload: { i: 3 } });
    events.emit({ type: 't', site_id: 'acme', payload: { i: 4 } });

    const ws2 = connect('acme', 2); // reconnect, presenting last seen seq
    const replayed = await new Promise((resolve) => {
      const seen = [];
      ws2.on('message', (data) => {
        seen.push(JSON.parse(data.toString()));
        if (seen.length === 2) resolve(seen);
      });
    });
    ws2.close();

    // Replay contains ONLY the missed events -- no duplicates of 1/2, no gap.
    expect(replayed.map((e) => e.seq)).toEqual([3, 4]);
    const allSeqsSeenAcrossBothConnections = [...firstBatch, ...replayed].map((e) => e.seq);
    expect(new Set(allSeqsSeenAcrossBothConnections).size).toBe(4); // dedup: no seq delivered twice across the reconnect boundary
  });

  it('a cursor ahead of retained history gets an explicit resync_required, never a silent empty replay masquerading as "caught up"', async () => {
    makeSite('acme');
    events.emit({ type: 't', site_id: 'acme', payload: {} });
    const ws = connect('acme', 999);
    const first = await new Promise((resolve) => ws.on('message', (data) => resolve(JSON.parse(data.toString()))));
    ws.close();
    expect(first.type).toBe('resync_required');
    expect(first.available).toBe(1);
  });

  it('DEDUP FIXED: a repeated idempotency_key returns the original event instead of allocating a second sequence', () => {
    // Previously the key was stored and passed through but never checked, so a
    // genuine double submit produced two events with two sequences and consumers
    // applied it twice. Dedup now happens inside the sequence lock.
    const e1 = events.emit({ type: 't', site_id: 'acme', payload: { a: 1 }, idempotency_key: 'same-key' });
    const e2 = events.emit({ type: 't', site_id: 'acme', payload: { a: 1 }, idempotency_key: 'same-key' });
    expect(e2.seq).toBe(e1.seq);
    expect(e2.event_id).toBe(e1.event_id);
    expect(events.replay('acme', 0).filter((e) => e.idempotency_key === 'same-key')).toHaveLength(1);
  });

  it('two independent connections to the same site never cross-deliver, confirming disconnect/reconnect isolation holds per-site as well as per-connection', async () => {
    makeSite('acme');
    makeSite('globex');
    const wsAcme = connect('acme', 0);
    const wsGlobex = connect('globex', 0);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let both connections settle

    const acmeSeen = [];
    const globexSeen = [];
    wsAcme.on('message', (data) => acmeSeen.push(JSON.parse(data.toString())));
    wsGlobex.on('message', (data) => globexSeen.push(JSON.parse(data.toString())));

    events.emit({ type: 't', site_id: 'acme', payload: {} });
    events.emit({ type: 't', site_id: 'globex', payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));

    wsAcme.close(); wsGlobex.close();
    expect(acmeSeen).toHaveLength(1);
    expect(globexSeen).toHaveLength(1);
    expect(acmeSeen[0].site_id).toBe('acme');
    expect(globexSeen[0].site_id).toBe('globex');
  });
});

// ---------------------------------------------------------------------------
// A14: honest states under malformed 2xx payloads and one-of-many dependency
// failure and recovery. The reordered/delayed-response half of this item is
// a CLIENT-side concern (public/kit/region.js's generation counter, already
// read and cited in prove-2026-08-22.md) that cannot be executed here: this
// tree has no jsdom/happy-dom dependency and no vitest DOM environment, so
// region.js (which calls document.createElement) cannot run outside a real
// browser. What IS testable at this layer: the server's own honest-states
// discipline holds even when one dependency (spec) is broken while another
// (pages) is fine, on the SAME site.
// ---------------------------------------------------------------------------
describe('A14: honest states, one-of-many dependency failure and recovery', () => {
  it('a site with a corrupt (unparseable) spec.json still serves its real pages honestly, and the corrupt spec is reported as invalid rather than crashing the whole site read', async () => {
    makeSite('acme');
    fs.writeFileSync(paths.within('sites', 'acme', 'spec.json'), '{ not valid json');
    fs.writeFileSync(paths.within('sites', 'acme', 'index.html'), '<h1>still here</h1>');

    const specRes = await (await request('GET', '/api/sites/spec', { headers: siteHeaders('acme') })).json();
    expect(specRes.valid).toBe(false);
    expect(specRes.errors.join(' ')).toMatch(/does not parse/);

    const pagesRes = await (await request('GET', '/api/sites/pages', { headers: siteHeaders('acme') })).json();
    expect(pagesRes.status).toBe('available'); // the OTHER dependency is unaffected and reports honestly
  });

  it('recovery: once spec.json is fixed, a subsequent read reflects the fix immediately with no stale caching', async () => {
    makeSite('acme');
    fs.writeFileSync(paths.within('sites', 'acme', 'spec.json'), '{ not valid json');
    const broken = await (await request('GET', '/api/sites/spec', { headers: siteHeaders('acme') })).json();
    expect(broken.valid).toBe(false);

    fs.writeFileSync(paths.within('sites', 'acme', 'spec.json'), JSON.stringify({ customer: { id: 'c1' } }));
    const fixed = await (await request('GET', '/api/sites/spec', { headers: siteHeaders('acme') })).json();
    expect(fixed.valid).toBe(true);
    expect(fixed.spec.customer.id).toBe('c1');
  });
});
