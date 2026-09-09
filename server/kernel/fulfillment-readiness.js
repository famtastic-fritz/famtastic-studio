/**
 * Post-payment fulfillment readiness.
 *
 * This is a pure coordinator: it consumes an authoritative paid snapshot,
 * builds the selected packet, and plans the Git/FAMtastic Inc target. It does
 * not read FAMtastic's database, send mail, charge, mutate a customer record,
 * push Git, upload cPanel, or change DNS. External work starts only after the
 * caller receives the plan and explicitly authorizes each side effect.
 */
import crypto from 'node:crypto';
import { prepareSelectedBuildPacket, packetToBuildBrief } from './selected-build-adapter.js';
import { createFamtasticIncAdapter } from './famtasticinc-adapter.js';

export const FULFILLMENT_READINESS_SCHEMA_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function fail(code, message, details = {}) { return Object.assign(new Error(message), { code, details }); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function prepareFulfillmentReadiness({
  site_id,
  source,
  customer,
  selection,
  payment,
  spec,
  brand,
  artifact_bundle,
  asset_refs = [],
  research_packet_ref,
  target = {},
  env = {},
  created = new Date().toISOString(),
} = {}) {
  if (!text(site_id)) throw fail('identity_required', 'site_id is required');
  if (payment?.payment_status !== 'paid') throw fail('payment_required', 'fulfillment readiness requires a verified paid snapshot');
  const adapter = createFamtasticIncAdapter({ env });
  const prepared = prepareSelectedBuildPacket({
    source, customer, selection, payment, spec, brand, artifact_bundle, asset_refs,
    research_packet_ref, origin: source?.origin || 'test',
    boundary: { external_mutation_allowed: false, deploy_authorized: false },
    created,
  });
  const manifest_hash = hash(artifact_bundle);
  const deployment = adapter.plan({
    provider: target.provider || 'famtasticinc',
    site_id,
    manifest_hash,
    repo_url: target.repo_url || null,
    repository_mode: target.repository_mode || 'create_or_existing',
    branch: target.branch || 'main',
    domain: target.domain || null,
    environment: target.environment || 'staging',
    target_root: target.target_root,
    remote_subdirectory: target.remote_subdirectory || site_id,
    hosting_class: target.hosting_class || 'shared',
  });
  const external_ready = deployment.preflight.network_dispatch_allowed && Boolean(deployment.repository.repo_url);
  return {
    schema_version: FULFILLMENT_READINESS_SCHEMA_VERSION,
    site_id,
    status: external_ready ? 'ready_for_external_handoff' : 'ready_for_local_build',
    external_ready,
    side_effects_performed: false,
    payment_event_id: payment.payment_event_id,
    packet: prepared.packet,
    build_brief: packetToBuildBrief(prepared.packet),
    deployment,
    gates: {
      selected: true,
      paid: true,
      artifact_manifest_hash: manifest_hash,
      design_contract: true,
      target_subdirectory: deployment.root_target_rejected ?? deployment.target_path !== deployment.target_root,
      remote_push: false,
      cpanel_upload: false,
      dns: false,
    },
    created_at: created,
  };
}

/**
 * Execute only the local build leg of a readiness plan. The pipeline is
 * injected so this module cannot accidentally acquire a network transport or
 * a production deploy capability. The result is a local evidence record; the
 * FAMtastic Inc plan remains pending until its own receipt-backed operation is
 * explicitly authorized.
 */
export async function runLocalBuildFromReadiness({ readiness, pipeline, initiator = 'fulfillment-readiness-local' } = {}) {
  if (!readiness || readiness.schema_version !== FULFILLMENT_READINESS_SCHEMA_VERSION) throw fail('readiness_invalid', 'a current fulfillment readiness plan is required');
  if (!pipeline || typeof pipeline.run !== 'function') throw fail('pipeline_required', 'a local pipeline is required');
  if (readiness.packet?.boundary?.external_mutation_allowed === true || readiness.packet?.boundary?.deploy_authorized === true) {
    throw fail('local_boundary_invalid', 'local readiness must keep external mutation and deploy authorization false');
  }
  const result = await pipeline.run({
    site_id: readiness.site_id,
    brief: readiness.build_brief,
    initiator,
    composer: 'artifact',
  });
  if (!result || result.outcome !== 'success' || result.verify?.passed !== true) {
    throw fail('local_build_failed', `local pipeline did not return a verified build (${result?.outcome || 'no-result'}${result?.failed_stage ? ` at ${result.failed_stage}` : ''}: ${result?.error?.message || 'no error detail'})`, { result });
  }
  return {
    ...readiness,
    status: 'local_build_verified',
    side_effects_performed: false,
    local_build: {
      outcome: result.outcome,
      run_id: result.run_id,
      verified: result.verify.passed,
      pages: result.composed?.pages?.length || 0,
      deploy_authorized: false,
    },
  };
}
