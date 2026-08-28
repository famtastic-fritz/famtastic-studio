// Shay provider admin surface: GET/PUT /api/admin/shay
// (server/modules/admin/index.js). Covers:
//   - honest degradation when server/kernel/shay-adapters/index.js (a
//     parallel lane's deliverable) has not landed on this machine yet --
//     the response must say so, not return an empty adapters list that
//     reads like "no adapters exist";
//   - PUT rejecting an unknown provider id;
//   - PUT accepting a known provider id, persisting it to config/shay.json,
//     and reporting whether the change was journaled.
//
// config/shay.json is a real, repo-tracked config file (same pattern as
// config/paths.json), not something under the hermetic STUDIO_DATA_ROOT
// used elsewhere in this suite -- the admin module resolves it relative to
// its own file, matching kernel/paths.js's own convention. This test
// snapshots and restores that file's real content around every test so a
// shared worktree is never left with a mutated provider value.
//
// server/kernel/shay-adapters/ is a parallel lane's deliverable (owned, not
// touched, by this test). Its real adapters spawn actual CLIs (claude,
// codex, gemini, kimi) with per-adapter timeouts up to 20s each -- fine for
// the one real end-to-end proof (the scratch-boot + Playwright screenshot
// this task's Verify step calls for) but wrong for this unit suite, which
// needs to be fast and deterministic regardless of what is installed or
// authenticated on the machine running it. Every test here therefore points
// server/modules/admin/index.js's ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE test
// seam at either a guaranteed-nonexistent path (simulating "registry
// absent", the default in beforeEach) or a disposable stub file (simulating
// "registry available" with instant, scripted answers) -- never at the real
// registry. This suite makes no claim at all about the real adapters'
// live installed/authenticated/responds state; that claim is made only by
// the screenshot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createPaths } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import adminModule from '../server/modules/admin/index.js';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shayConfigFile = path.join(treeRoot, 'config', 'shay.json');

let dataRoot;
let originalShayConfigText;
let app;

beforeEach(async () => {
  originalShayConfigText = fs.readFileSync(shayConfigFile, 'utf8');

  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-shay-'));
  process.env.STUDIO_DATA_ROOT = dataRoot;
  // Guaranteed not to exist -- simulates "registry absent" deterministically,
  // regardless of whether the real server/kernel/shay-adapters/ has landed
  // on this machine. Individual tests below override this to point at a
  // stub when they want to simulate "registry available" instead.
  process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE = path.join(dataRoot, 'no-such-shay-adapters-registry', 'index.js');
  const paths = createPaths();
  const journal = createJournal({ paths });
  app = createApp();
  adminModule.register({ app, paths, journal });
});

afterEach(() => {
  fs.writeFileSync(shayConfigFile, originalShayConfigText);
  delete process.env.STUDIO_DATA_ROOT;
  delete process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE;
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

// Same fake-transport HTTP driver used by tests/prove.test.js and
// tests/isolation-boundaries.test.js: drives the real app.handler with a
// real Readable body stream, no product code touched.
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

describe('GET /api/admin/shay', () => {
  it('reports the configured provider honestly', async () => {
    const res = await request('GET', '/api/admin/shay');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active_provider).toBe('claude');
  });

  it('degrades honestly when the adapter registry is not available (no fake empty list)', async () => {
    const res = await request('GET', '/api/admin/shay');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('not_implemented');
    expect(body.reason).toMatch(/shay-adapters/);
    expect(body.adapters).toEqual([]);
    // The active provider is still honestly reported even though no
    // adapter status could be verified.
    expect(body.active_provider).toBe('claude');
  });
});

// These tests exercise the "registry available" rendering path using
// ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE (see server/modules/admin/index.js) to
// point resolveAdapterStatus() at a disposable stub module written under
// os.tmpdir(). This never creates, writes, or reads
// server/kernel/shay-adapters/ -- that directory stays untouched, as
// required, while still letting the "adapters present" and "status check
// failed" branches be verified against real behavior rather than only
// asserted by reading the source.
describe('GET /api/admin/shay with a stub adapter registry (never touches server/kernel/shay-adapters/)', () => {
  let stubDir;

  afterEach(() => {
    delete process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE;
    if (stubDir) fs.rmSync(stubDir, { recursive: true, force: true });
    stubDir = undefined;
  });

  function writeStub(source) {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shay-adapters-stub-'));
    const file = path.join(stubDir, 'index.js');
    fs.writeFileSync(file, source);
    process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE = file;
    return file;
  }

  it('renders live status via a checkAll() export, distinguishing installed/authenticated/responds', async () => {
    writeStub(`
      export async function checkAll() {
        return [
          { id: 'claude', displayName: 'Claude CLI', installed: true, authenticated: true, responds: true, detail: null },
          { id: 'gemini', displayName: 'Gemini CLI', installed: true, authenticated: false, responds: false, detail: 'ineligible tier' },
        ];
      }
    `);
    const res = await request('GET', '/api/admin/shay');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeUndefined();
    expect(body.adapters).toHaveLength(2);
    const gemini = body.adapters.find((a) => a.id === 'gemini');
    expect(gemini.installed).toBe(true);
    expect(gemini.authenticated).toBe(false);
    expect(gemini.responds).toBe(false);
    expect(gemini.detail).toMatch(/ineligible/);
  });

  it('renders live status via a listAdapters() + checkStatus() export', async () => {
    writeStub(`
      export function listAdapters() {
        return [
          { id: 'kimi', displayName: 'Kimi CLI', async checkStatus() { return { installed: true, authenticated: false, responds: false, detail: 'billing 403' }; } },
        ];
      }
    `);
    const res = await request('GET', '/api/admin/shay');
    const body = await res.json();
    expect(body.adapters).toEqual([
      { id: 'kimi', displayName: 'Kimi CLI', installed: true, authenticated: false, responds: false, detail: 'billing 403' },
    ]);
  });

  it('reports status "error" honestly when the module exposes no recognized interface', async () => {
    writeStub('export const nothingUseful = 42;');
    const res = await request('GET', '/api/admin/shay');
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.reason).toMatch(/none of the recognized/);
    expect(body.adapters).toEqual([]);
  });

  it('reports status "error" honestly when the status check itself throws (never renders a default)', async () => {
    writeStub("export async function checkAll() { throw new Error('spawn ENOENT'); }");
    const res = await request('GET', '/api/admin/shay');
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.reason).toMatch(/spawn ENOENT/);
    expect(body.adapters).toEqual([]);
  });

  it('PUT validates provider ids against the live registry once one is available, not just the static fallback', async () => {
    writeStub(`
      export async function checkAll() {
        return [{ id: 'only-this-one', displayName: 'Only This One', installed: true, authenticated: true, responds: true }];
      }
    `);
    // 'claude' is in the static fallback list but NOT in this live registry
    // -- once a registry is available it is the authority, not the fallback.
    const bad = await request('PUT', '/api/admin/shay', { body: { provider: 'claude' } });
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.known_providers).toEqual(['only-this-one']);

    const good = await request('PUT', '/api/admin/shay', { body: { provider: 'only-this-one' } });
    expect(good.status).toBe(200);
  });
});

describe('PUT /api/admin/shay', () => {
  it('rejects an unknown provider id with 400 and lists known providers', async () => {
    const res = await request('PUT', '/api/admin/shay', { body: { provider: 'not-a-real-provider' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_provider');
    expect(Array.isArray(body.known_providers)).toBe(true);
    expect(body.known_providers).toContain('claude');
    expect(body.known_providers).not.toContain('not-a-real-provider');

    // The rejected write must not have touched the file.
    const after = await (await request('GET', '/api/admin/shay')).json();
    expect(after.active_provider).toBe('claude');
  });

  it('rejects a missing/blank provider with 400', async () => {
    const res = await request('PUT', '/api/admin/shay', { body: {} });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_provider');
  });

  it('accepts a known provider id, persists it, and reports it honestly on GET afterward', async () => {
    const put = await request('PUT', '/api/admin/shay', { body: { provider: 'codex' } });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.active_provider).toBe('codex');
    expect(putBody.previous_provider).toBe('claude');
    expect(typeof putBody.journaled).toBe('boolean');

    const onDisk = JSON.parse(fs.readFileSync(shayConfigFile, 'utf8'));
    expect(onDisk.provider).toBe('codex');

    const get = await request('GET', '/api/admin/shay');
    const getBody = await get.json();
    expect(getBody.active_provider).toBe('codex');
  });

  it('journals the provider change under the global site id when a journal is available', async () => {
    await request('PUT', '/api/admin/shay', { body: { provider: 'gemini' } });
    const entries = fs.existsSync(path.join(dataRoot, '.studio', 'journal', 'global.jsonl'))
      ? fs.readFileSync(path.join(dataRoot, '.studio', 'journal', 'global.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last.intent).toBe('admin.shay.set_provider');
    expect(last.site_id).toBe('global');
  });

  it('does not pretend a change was journaled when no journal is supplied to register()', async () => {
    const bareApp = createApp();
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-shay-bare-'));
    process.env.STUDIO_DATA_ROOT = bareRoot;
    const paths = createPaths();
    adminModule.register({ app: bareApp, paths }); // no journal passed
    process.env.STUDIO_DATA_ROOT = dataRoot;

    const res = await new Promise((resolve) => {
      const chunks = [];
      const fakeRes = {
        writableEnded: false,
        statusCode: 200,
        headers: {},
        writeHead(status, hdrs) { this.statusCode = status; this.headers = hdrs || {}; },
        end(chunk) {
          this.writableEnded = true;
          if (chunk) chunks.push(chunk);
          resolve({ status: this.statusCode, json: () => JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()) });
        },
      };
      const bodyStr = JSON.stringify({ provider: 'kimi' });
      const req = new Readable({ read() {} });
      req.method = 'PUT';
      req.url = '/api/admin/shay';
      req.headers = {};
      req.push(bodyStr);
      req.push(null);
      bareApp.handler(req, fakeRes);
    });

    const body = await res.json();
    expect(body.active_provider).toBe('kimi');
    expect(body.journaled).toBe(false);
    expect(body.journal_error).toMatch(/no journal/);

    fs.rmSync(bareRoot, { recursive: true, force: true });
  });
});

describe('a slow adapter cannot hang the Settings page', () => {
  // The live 4-adapter probe intermittently exceeded the smoke's patience, and a
  // Settings page that hangs for 20 seconds is a real defect regardless of the
  // test. A probe that does not answer in time is reported UNKNOWN with a
  // reason, never assumed green.
  it('reports unknown with a reason when a probe exceeds the deadline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shay-slow-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.js'), `
        export const ADAPTER_IDS = ['slowpoke'];
        export const DEFAULT_ADAPTER_ID = 'slowpoke';
        export function getAdapter() {
          return {
            id: 'slowpoke',
            displayName: 'Slow Poke',
            probe: () => new Promise((r) => { const t = setTimeout(() => r({ ok: true }), 800); if (t.unref) t.unref(); }),
          };
        }
      `);
      process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE = path.join(dir, 'index.js');
      process.env.SHAY_STATUS_DEADLINE_MS = '80';

      const started = Date.now();
      const res = await request('GET', '/api/admin/shay');
      const elapsed = Date.now() - started;
      const body = await res.json();

      const slow = (body.adapters || []).find((a) => a.id === 'slowpoke');
      expect(slow, 'the adapter must still be listed, not dropped').toBeTruthy();
      expect(slow.installed, 'an unanswered probe is unknown, not false').toBeNull();
      expect(slow.authenticated).toBeNull();
      expect(slow.responds).toBeNull();
      expect(slow.detail).toMatch(/did not answer/i);
      expect(elapsed, 'the endpoint must return on the deadline, not on the probe').toBeLessThan(600);
    } finally {
      delete process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE;
      delete process.env.SHAY_STATUS_DEADLINE_MS;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
