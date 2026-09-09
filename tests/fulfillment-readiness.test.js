import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { createPaths } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import { prepareFulfillmentReadiness, runLocalBuildFromReadiness } from '../server/kernel/fulfillment-readiness.js';
import { stubResearchOptions } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';

const contract = {
  schema_version: 1,
  tokens: { bg: '#0a0a0a', fg: '#fff', accent: '#7cfc00', muted: '#888' },
  typography: { body: 'Inter', headings: 'Inter' },
  component_recipe: ['proof-shell'],
  layout: { max_width: '72rem', gutter: '1rem', grid: '1-col' },
  responsive: { mobile: 'stack', tablet: 'stack', desktop: 'rail' },
  asset_policy: { preserve: true, rights_safe_only: true },
  evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
};
const artifact = createArtifactBundle([{ path: 'index.html', contents: '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>' }]);
const common = {
  site_id: 'synthetic-paid-site',
  source: { website_request_public_id: 'req-1', proof_campaign_id: 'proof-1', campaign_id: 'campaign-1', customer_id: 'cust-1', current_proof_hash: 'proof-hash', origin: 'test' },
  customer: { id: 'cust-1', name: 'Synthetic Paid Site', email: 'test@example.invalid' },
  selection: { approved: true, direction_id: 'direction-a', direction_name: 'Approved', proof_variant_id: 'variant-a', proof_version: 'v1', proof_hash: 'proof-hash', approval_id: 'approval-1', approval_direction_id: 'direction-a', approved_at: '2026-09-09T12:00:00.000Z' },
  payment: { payment_status: 'paid', order_id: 'order-1', payment_event_id: 'evt-1', package_sku: 'web-basics-199', terms_version: 'terms-1', terms_acceptance_hash: 'terms-hash' },
  spec: { business: { name: 'Synthetic Paid Site' }, site_needs: { pages: ['home'] } },
  brand: { design_contract: contract }, artifact_bundle: artifact,
  research_packet_ref: { packet_id: 'rp-1', brief_hash: 'brief-1', source_adapter: 'synthetic-fixture' },
};

describe('post-payment fulfillment readiness', () => {
  it('fails closed before payment', () => {
    expect(() => prepareFulfillmentReadiness({ ...common, payment: { ...common.payment, payment_status: 'pending' } })).toThrow(/paid snapshot/);
  });

  it('creates a selected packet and honest local-ready plan without external credentials', () => {
    const result = prepareFulfillmentReadiness(common);
    expect(result.status).toBe('ready_for_local_build');
    expect(result.packet.boundary.deploy_authorized).toBe(false);
    expect(result.gates.remote_push).toBe(false);
    expect(result.gates.cpanel_upload).toBe(false);
    expect(result.deployment.target_path).toContain('/synthetic-paid-site');
    expect(result.quality_gates.status).toBe('not_proven');
    expect(result.quality_gates.missing).toContain('artifact_parity');
  });

  it('can describe the configurable branch, repository, and subdirectory without switching providers', () => {
    const result = prepareFulfillmentReadiness({ ...common, target: { repo_url: 'git@github.com:example/synthetic-paid-site.git', branch: 'main', remote_subdirectory: 'customers/synthetic-paid-site', hosting_class: 'vps' } });
    expect(result.deployment.repository).toMatchObject({ mode: 'create_or_existing', url: 'git@github.com:example/synthetic-paid-site.git', branch: 'main' });
    expect(result.deployment.remote_subdirectory).toBe('customers/synthetic-paid-site');
    expect(result.deployment.hosting_class).toBe('vps');
  });

  it('runs the paid packet through the real local pipeline while keeping external deploy denied', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fulfillment-readiness-pipeline-'));
    const previous = process.env.STUDIO_DATA_ROOT;
    process.env.STUDIO_DATA_ROOT = root;
    try {
      const paths = createPaths();
      const journal = createJournal({ paths });
      const events = createEvents({ paths });
      const dna = createDna({ paths });
      const mutation = createMutation({ paths, journal, events });
      const spec = createSpec({ paths, mutation });
      const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation, researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });
      const readiness = prepareFulfillmentReadiness(common);
      const built = await runLocalBuildFromReadiness({ readiness, pipeline, initiator: 'synthetic-paid-handoff-test' });
      expect(built.status).toBe('local_build_verified');
      expect(built.local_build.verified).toBe(true);
      expect(built.packet.boundary.deploy_authorized).toBe(false);
      expect(built.quality_gates.status).toBe('not_proven');
      expect(built.quality_gates.missing).toContain('artifact_parity');
      expect(fs.existsSync(paths.within('sites', 'synthetic-paid-site', 'index.html'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.STUDIO_DATA_ROOT;
      else process.env.STUDIO_DATA_ROOT = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
