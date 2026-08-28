// Proofs projection (plan 3.5, Decision 3). Covers: the honest not_configured
// state when no site event log exists, the honest empty state when a log
// exists but carries no proof.stage.* events, the real projection over
// synthetic proof events written through the actual event spine (never
// invented rows), and -- the whole point of D3 -- that no mutating route is
// reachable under /api/proofs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaths } from '../server/kernel/paths.js';
import { createEvents } from '../server/kernel/events.js';
import { createRegistry } from '../server/kernel/registry.js';
import { projectProofs } from '../server/kernel/proofs.js';
import platformModule from '../server/modules/platform/index.js';

let root;
let paths;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofs-'));
  process.env.STUDIO_DATA_ROOT = root;
  paths = createPaths();
});

afterEach(() => {
  delete process.env.STUDIO_DATA_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('projectProofs: honest empty states', () => {
  it('reports not_configured when the events root does not exist at all', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('not_configured');
    expect(body.reason).toMatch(/events root does not exist/);
    expect(body.entries).toEqual([]);
    // Honesty: never invent rows.
    expect(body.entries.length).toBe(0);
  });

  it('reports not_configured when the events root exists but has no site logs', () => {
    paths.ensure('events');
    const events = createEvents({ paths });
    const registry = createRegistry();
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('not_configured');
    expect(body.reason).toMatch(/no site event logs/);
  });

  it('reports empty when a site event log exists but carries no proof events', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    events.emit({ type: 'site.updated', site_id: 'acme', payload: { a: 1 } });
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('empty');
    expect(body.reason).toMatch(/no proof\.stage/);
    expect(body.entries).toEqual([]);
  });

  it('reports empty (not a fabricated entry) when proof events are malformed', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    // No proof_id in payload -- cannot honestly be shown as a proof.
    events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { note: 'missing id' } });
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('empty');
    expect(body.entries).toEqual([]);
    expect(body.skipped_malformed).toBeGreaterThan(0);
  });
});

describe('projectProofs: real synthetic events', () => {
  it('projects a proof through its real stage history via the actual event spine', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();

    events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'p-1', evidence: { url: 'https://example.test/intake/p-1' } } });
    events.emit({ type: 'proof.stage.generating', site_id: 'acme', payload: { proof_id: 'p-1', evidence: null } });
    events.emit({ type: 'proof.stage.proof_ready', site_id: 'acme', payload: { proof_id: 'p-1', evidence: { screenshot: 's3://bucket/p-1.png' } } });

    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('available');
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];
    expect(entry.proof_id).toBe('p-1');
    expect(entry.site_id).toBe('acme');
    expect(entry.stage).toBe('proof_ready');
    expect(entry.stage_label).toBe('ready for review'); // registry status_projection override
    expect(entry.evidence_trail).toHaveLength(3);
    expect(entry.evidence_trail[0].stage).toBe('ingested');
    expect(entry.evidence_trail[2].stage).toBe('proof_ready');
  });

  describe('brief: real intake fields when a real event carries them, honest null when it does not', () => {
    it('surfaces brief-level fields from the latest event, never from an earlier one', () => {
      const events = createEvents({ paths });
      const registry = createRegistry();
      events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'p-1', brief_number: 'stale-should-not-show', client_name: 'Old Name' } });
      events.emit({
        type: 'proof.stage.proof_ready',
        site_id: 'acme',
        payload: {
          proof_id: 'p-1',
          brief_number: '4412',
          client_name: 'Coastal Realty Group',
          quote_snippet: 'Want something clean and trustworthy.',
          signature_verified: true,
          proof_variants: [
            { id: 'a', label: 'A - coastal calm', href: '/proofs/p-1/a' },
            { id: 'b', label: 'B - dusk luxury', href: '/proofs/p-1/b' },
          ],
        },
      });
      const body = projectProofs({ fs, paths, events, registry });
      expect(body.entries[0].brief).toEqual({
        brief_number: '4412',
        client_name: 'Coastal Realty Group',
        quote_snippet: 'Want something clean and trustworthy.',
        signature_verified: true,
        proof_variants: [
          { id: 'a', label: 'A - coastal calm', href: '/proofs/p-1/a' },
          { id: 'b', label: 'B - dusk luxury', href: '/proofs/p-1/b' },
        ],
      });
    });

    it('reports every brief field as null, never a guessed default, when no real event has ever carried one', () => {
      const events = createEvents({ paths });
      const registry = createRegistry();
      events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'p-1' } });
      const body = projectProofs({ fs, paths, events, registry });
      expect(body.entries[0].brief).toEqual({
        brief_number: null,
        client_name: null,
        quote_snippet: null,
        signature_verified: null,
        proof_variants: null,
      });
    });

    it('ignores a malformed proof_variants value rather than throwing or fabricating a shape for it', () => {
      const events = createEvents({ paths });
      const registry = createRegistry();
      events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'p-1', proof_variants: 'not-an-array' } });
      const body = projectProofs({ fs, paths, events, registry });
      expect(body.entries[0].brief.proof_variants).toBeNull();
    });
  });

  it('never renders a stage label the server did not return: falls back to the local vocabulary when the registry has no override', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    events.emit({ type: 'proof.stage.client_reviewing', site_id: 'acme', payload: { proof_id: 'p-2' } });
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.entries[0].stage_label).toBe('client reviewing');
  });

  it('tracks multiple proofs across multiple sites independently (no ambient site)', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    events.emit({ type: 'proof.stage.delivered', site_id: 'acme', payload: { proof_id: 'p-1' } });
    events.emit({ type: 'proof.stage.revision_requested', site_id: 'beta', payload: { proof_id: 'p-9' } });
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.entries).toHaveLength(2);
    const bySite = Object.fromEntries(body.entries.map((e) => [e.site_id, e]));
    expect(bySite.acme.stage).toBe('delivered');
    expect(bySite.beta.stage).toBe('revision_requested');
  });

  it('includes the jump-off from the platform registry, never a hardcoded URL', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    events.emit({ type: 'proof.stage.ingested', site_id: 'acme', payload: { proof_id: 'p-1' } });
    const body = projectProofs({ fs, paths, events, registry });
    const connectionsEntry = registry.byId('connections');
    expect(body.connections.jump_off).toBe(connectionsEntry.jump_off);
    expect(body.connections.id).toBe('connections');
  });
});

describe('/api/proofs route: read-only, verified', () => {
  function fakeApp() {
    const routes = [];
    return {
      routes,
      route(method, pattern, handler, opts) {
        routes.push({ method, pattern, handler, opts });
      },
    };
  }

  it('registers only GET for /api/proofs, no mutating verb reachable', () => {
    const app = fakeApp();
    const events = createEvents({ paths });
    const registry = createRegistry();
    platformModule.register({ app, paths, events, registry });

    const proofsRoutes = app.routes.filter((r) => r.pattern === '/api/proofs');
    expect(proofsRoutes.length).toBeGreaterThan(0);
    expect(proofsRoutes.map((r) => r.method)).toEqual(['GET']);

    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const mutatingProofRoutes = app.routes.filter(
      (r) => r.pattern.startsWith('/api/proofs') && mutating.includes(r.method),
    );
    expect(mutatingProofRoutes).toEqual([]);
  });

  it('the live handler returns a real projection body, not a mutation acknowledgement', async () => {
    const app = fakeApp();
    const events = createEvents({ paths });
    const registry = createRegistry();
    platformModule.register({ app, paths, events, registry });
    const proofsGet = app.routes.find((r) => r.pattern === '/api/proofs' && r.method === 'GET');
    const result = await proofsGet.handler({});
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('not_configured'); // nothing emitted in this test
    expect(Array.isArray(result.body.entries)).toBe(true);
  });
});

// Finding C regression: an unreadable event log (corrupt file, permission
// failure) is a distinct honest state from both "genuinely empty" and
// "never configured" -- it used to be silently swallowed (`catch { continue }`)
// and could then collapse into a plain empty result. A fake `events.replay`
// that throws for a chosen site simulates the read failure without needing an
// actually-corrupt file on disk; the site's log still has to really exist
// (via the real events kernel) for discoverSiteIds to hand it to replay() at
// all, matching the real "log exists but can't be read" shape.
describe('projectProofs: unreadable evidence is distinct from empty and not_configured (finding C)', () => {
  function withSimulatedReadFailure(realEvents, failingSiteIds) {
    return {
      replay: (siteId, afterSeq) => {
        if (failingSiteIds.has(siteId)) {
          throw new Error(`simulated read failure for site '${siteId}': corrupt or permission-denied event log`);
        }
        return realEvents.replay(siteId, afterSeq);
      },
    };
  }

  it('reports status "error", never "empty" or "not_configured", when the only site log cannot be read', () => {
    const realEvents = createEvents({ paths });
    realEvents.emit({ type: 'site.updated', site_id: 'corrupt-site', payload: {} });
    const events = withSimulatedReadFailure(realEvents, new Set(['corrupt-site']));
    const registry = createRegistry();

    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('error');
    expect(body.status).not.toBe('empty');
    expect(body.status).not.toBe('not_configured');
    expect(body.reason).toMatch(/could not be read/);
    expect(body.entries).toEqual([]);
    expect(body.unreadable).toHaveLength(1);
    expect(body.unreadable[0].site_id).toBe('corrupt-site');
    expect(body.unreadable_count).toBe(1);
  });

  it('reports status "partial" with the readable data plus a named gap when some (not all) site logs cannot be read', () => {
    const realEvents = createEvents({ paths });
    realEvents.emit({ type: 'proof.stage.ingested', site_id: 'readable-site', payload: { proof_id: 'p-1' } });
    realEvents.emit({ type: 'site.updated', site_id: 'corrupt-site', payload: {} });
    const events = withSimulatedReadFailure(realEvents, new Set(['corrupt-site']));
    const registry = createRegistry();

    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('partial');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].site_id).toBe('readable-site');
    expect(body.unreadable_count).toBe(1);
    expect(body.unreadable[0].site_id).toBe('corrupt-site');
  });

  it('reports status "partial", never a silent "empty", when the only readable log has no proof events and another log is unreadable', () => {
    const realEvents = createEvents({ paths });
    realEvents.emit({ type: 'site.updated', site_id: 'quiet-site', payload: {} });
    realEvents.emit({ type: 'site.updated', site_id: 'corrupt-site', payload: {} });
    const events = withSimulatedReadFailure(realEvents, new Set(['corrupt-site']));
    const registry = createRegistry();

    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('partial');
    expect(body.status).not.toBe('empty');
    expect(body.entries).toEqual([]);
    expect(body.unreadable_count).toBe(1);
  });

  it('still reports a plain "empty" (no unreadable field noise) when every log is genuinely readable and just carries nothing', () => {
    const events = createEvents({ paths });
    const registry = createRegistry();
    events.emit({ type: 'site.updated', site_id: 'acme', payload: {} });
    const body = projectProofs({ fs, paths, events, registry });
    expect(body.status).toBe('empty');
    expect(body.unreadable).toBeUndefined();
    expect(body.unreadable_count).toBeUndefined();
  });
});

// Finding C regression: region.js and region-honesty.mjs must treat
// not_configured, error, and partial as distinct from empty, not collapse
// them. These are pure functions (no DOM needed), so exercised directly;
// public/kit/region.js's actual DOM rendering is covered by `npm run smoke`'s
// region-honesty cross-check, which this file's exported logic backs.
describe('region-honesty.mjs: not_configured/error/partial classify distinctly from empty (finding C)', () => {
  it('derives not_configured as its own expected state, distinct from empty, and satisfies it against the not_implemented DOM-class family region.js renders it in', async () => {
    const { deriveExpectedRegionState, regionStateSatisfies } = await import('../scripts/region-honesty.mjs');
    const body = { status: 'not_configured', reason: 'no integration has ever emitted a proof event', entries: [] };
    const expected = deriveExpectedRegionState({ httpStatus: 200, body, parseFailed: false, collectionKey: 'entries' });
    expect(expected).toBe('not_configured');
    expect(expected).not.toBe('empty');
    expect(regionStateSatisfies(expected, 'not_implemented')).toBe(true);
    expect(regionStateSatisfies(expected, 'empty')).toBe(false);
  });

  it('derives error for a body-level status "error" even though the HTTP response itself is 200', async () => {
    const { deriveExpectedRegionState } = await import('../scripts/region-honesty.mjs');
    const body = { status: 'error', reason: 'all site event logs unreadable', entries: [] };
    expect(deriveExpectedRegionState({ httpStatus: 200, body, parseFailed: false, collectionKey: 'entries' })).toBe('error');
  });

  it('derives available for a body-level status "partial" that still carries real entries, and error when it carries none', async () => {
    const { deriveExpectedRegionState } = await import('../scripts/region-honesty.mjs');
    const withData = { status: 'partial', reason: 'one log unreadable', entries: [{ proof_id: 'p-1' }] };
    const withoutData = { status: 'partial', reason: 'one log unreadable', entries: [] };
    expect(deriveExpectedRegionState({ httpStatus: 200, body: withData, parseFailed: false, collectionKey: 'entries' })).toBe('available');
    expect(deriveExpectedRegionState({ httpStatus: 200, body: withoutData, parseFailed: false, collectionKey: 'entries' })).toBe('error');
  });
});
