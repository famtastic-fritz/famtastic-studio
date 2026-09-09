import { describe, expect, it } from 'vitest';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { prepareFulfillmentReadiness } from '../server/kernel/fulfillment-readiness.js';

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
const artifact = createArtifactBundle([{ path: 'index.html', contents: '<!doctype html><html><body>fixture</body></html>' }]);
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
  });

  it('can describe the configurable branch, repository, and subdirectory without switching providers', () => {
    const result = prepareFulfillmentReadiness({ ...common, target: { repo_url: 'git@github.com:example/synthetic-paid-site.git', branch: 'main', remote_subdirectory: 'customers/synthetic-paid-site', hosting_class: 'vps' } });
    expect(result.deployment.repository).toMatchObject({ mode: 'create_or_existing', url: 'git@github.com:example/synthetic-paid-site.git', branch: 'main' });
    expect(result.deployment.remote_subdirectory).toBe('customers/synthetic-paid-site');
    expect(result.deployment.hosting_class).toBe('vps');
  });
});

