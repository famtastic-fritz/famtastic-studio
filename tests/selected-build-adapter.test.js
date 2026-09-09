import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { stubResearchOptions } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import {
  createHandoffReceiptStore,
  packetToBuildBrief,
  prepareSelectedBuildPacket,
} from '../server/kernel/selected-build-adapter.js';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';

const config = loadPathsConfig();
let tmpRoot;
let previousDataRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-selected-build-'));
  previousDataRoot = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (previousDataRoot === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = previousDataRoot;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sourceSnapshot() {
  return {
    website_request_public_id: 'req_test_12',
    proof_campaign_id: 'pc_test_12',
    campaign_id: 'campaign_test_12',
    customer_id: 'cust_test_12',
    current_proof_hash: 'proofhash-b',
    source_commit: 'test-commit',
  };
}

function selectionSnapshot(overrides = {}) {
  return {
    approved: true,
    direction_id: 'direction-b',
    direction_name: 'Warm Signal',
    proof_variant_id: 'variant-b',
    proof_version: 'proof-v2',
    proof_hash: 'proofhash-b',
    approval_id: 'approval_test_12',
    approval_direction_id: 'direction-b',
    approved_at: '2026-09-09T12:00:00.000Z',
    ...overrides,
  };
}

function paymentSnapshot(overrides = {}) {
  return {
    order_id: 'order_test_12',
    payment_status: 'paid',
    payment_event_id: 'evt_test_12',
    package_sku: 'web-basics-199',
    terms_version: 'terms-2026-09',
    terms_acceptance_hash: 'terms-hash-test',
    ...overrides,
  };
}

function makePacket(overrides = {}) {
  const artifact_bundle = createArtifactBundle([
    { path: 'index.html', contents: '<!doctype html><html lang="en"><head><title>Synthetic</title></head><body><h1>Synthetic Studio</h1><p>Exact proof bytes.</p></body></html>' },
    { path: 'styles.css', contents: 'body { background: #0a0a0a; color: #eaeaea; }' },
    { path: 'js/main.js', contents: 'document.documentElement.dataset.proof = "exact";' },
  ]);
  return prepareSelectedBuildPacket({
    source: sourceSnapshot(),
    customer: { id: 'cust_test_12', name: 'Synthetic Studio', email: 'test@example.invalid' },
    selection: selectionSnapshot(),
    payment: paymentSnapshot(),
    spec: {
      business: { name: 'Synthetic Studio', description: 'A hermetic selected-build fixture.' },
      site_needs: { pages: ['home', 'about', 'contact'], offers: ['Consultation'], ctas: ['Request a consultation'] },
    },
    brand: {
      palette: ['#161B2E', '#F5F0E8'],
      voice: 'clear and welcoming',
      design_contract: {
        schema_version: 1,
        tokens: { bg: '#0a0a0a', fg: '#eaeaea', accent: '#7cfc00', muted: '#888888' },
        typography: { body: 'Inter, sans-serif', headings: 'Space Grotesk, Inter, sans-serif' },
        component_recipe: ['proof-shell', 'hero', 'cta'],
        layout: { max_width: '72rem', gutter: 'clamp(1rem, 4vw, 4rem)', grid: '12-column' },
        responsive: { mobile: 'stack', tablet: 'two-column', desktop: 'max-width' },
        asset_policy: { preserve: true, rights_safe_only: true },
        evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
      },
    },
    artifact_bundle,
    research_packet_ref: { packet_id: 'rp_test_12', brief_hash: 'brief-hash-test', source_adapter: 'synthetic-fixture' },
    origin: 'test',
    boundary: { external_mutation_allowed: false, deploy_authorized: false },
    ...overrides,
  }).packet;
}

describe('selected-build adapter: fail-closed source gate', () => {
  it('refuses a selected build without the approved design contract', () => {
    const packet = makePacket();
    const brand = { ...packet.brand };
    delete brand.design_contract;
    expect(() => prepareSelectedBuildPacket({
      source: sourceSnapshot(),
      customer: { id: 'cust_test_12', name: 'Synthetic Studio', email: 'test@example.invalid' },
      selection: selectionSnapshot(),
      payment: paymentSnapshot(),
      spec: { business: { name: 'Synthetic Studio' }, site_needs: { pages: ['home'] } },
      brand,
      research_packet_ref: { packet_id: 'rp_test_12', brief_hash: 'brief-hash-test', source_adapter: 'synthetic-fixture' },
      origin: 'test',
      boundary: { external_mutation_allowed: false, deploy_authorized: false },
    })).toThrow(/design_contract/);
  });

  it('refuses an unpaid selection before producing a packet', () => {
    expect(() => makePacket({ payment: paymentSnapshot({ payment_status: 'pending' }) }))
      .toThrow(/payment_required/);
  });

  it('refuses a selection whose approved proof is no longer current', () => {
    expect(() => makePacket({ selection: selectionSnapshot({ proof_hash: 'old-proof' }) }))
      .toThrow(/stale|current|mismatch/i);
  });

  it('refuses identity drift between the request and customer snapshots', () => {
    expect(() => makePacket({ customer: { id: 'other-customer', name: 'Synthetic Studio', email: 'test@example.invalid' } }))
      .toThrow(/identity_mismatch/);
  });
});

describe('selected-build adapter: synthetic handoff and build proof', () => {
  it('carries application recipe and backend declarations into the Studio brief', () => {
    const packet = makePacket({
      spec: {
        business: { name: 'Synthetic Studio' },
        capability_class: 'application',
        recipe: 'drupal-decoupled-tri-tier-v1',
        backend: { root: 'backend', runtime: 'drupal-jsonapi' },
        functional_contract: { portal: ['login'] },
      },
    });
    expect(packetToBuildBrief(packet)).toMatchObject({
      capability_class: 'application',
      recipe: 'drupal-decoupled-tri-tier-v1',
      backend: { root: 'backend', runtime: 'drupal-jsonapi' },
      functional_contract: { portal: ['login'] },
    });
  });

  it('accepts once, returns the same receipt for a duplicate, and builds locally with deploy denied', async () => {
    const packet = makePacket();
    const store = createHandoffReceiptStore();
    const first = store.record(packet.adapter.idempotency_key, packet);
    const duplicate = store.record(packet.adapter.idempotency_key, packet);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.receipt_id).toBe(first.receipt_id);

    const paths = createPaths();
    const journal = createJournal({ paths });
    const events = createEvents({ paths });
    const dna = createDna({ paths });
    const mutation = createMutation({ paths, journal, events });
    const spec = createSpec({ paths, mutation });
    const pipeline = createPipeline({
      paths, journal, events, dna, spec, mutation,
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });
    const result = await pipeline.run({
      site_id: 'synthetic-studio',
      brief: packetToBuildBrief(packet),
      adapter: 'shay-native',
      initiator: 'selected-build-smoke',
      composer: 'artifact',
    });

    expect(result.outcome).toBe('success');
    expect(result.verify.passed).toBe(true);
    expect(result.composed.pages.length).toBeGreaterThan(0);
    expect(packet.boundary.deploy_authorized).toBe(false);
    expect(first.status).toBe('accepted_for_test');
    const built = fs.readFileSync(path.join(paths.within('sites', 'synthetic-studio'), 'index.html'), 'utf8');
    expect(built).toBe('<!doctype html><html lang="en"><head><title>Synthetic</title></head><body><h1>Synthetic Studio</h1><p>Exact proof bytes.</p></body></html>');
    expect(fs.readFileSync(path.join(paths.within('sites', 'synthetic-studio'), 'styles.css'), 'utf8')).toContain('#0a0a0a');
    expect(fs.readFileSync(path.join(paths.within('sites', 'synthetic-studio'), 'js/main.js'), 'utf8')).toContain('dataset.proof');
  });
});
