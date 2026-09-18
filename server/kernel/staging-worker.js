import { continuationPlanErrors, executeContinuationPlan } from './selected-continuation-plan.js';
import { continuationErrors } from './staging-contract.js';
import { digest, stagingError } from './staging-store.js';
import { createArtifactBundle } from './artifact-bundle.js';
import { prepareStagingBuildPacket, packetToBuildBrief } from './selected-build-adapter.js';
import { planSelectedSource } from './selected-source-plan.js';
import { PLANNING_SCHEMA } from './selected-planning-contract.js';
import { reconcileCompletedSelection } from './selected-completion-reconciliation.js';
import { restrictionsForPacket, revalidateReferenceAccess } from './source-use-restrictions.js';

export async function materializeSelection(packet, { fetchArtifact, allowedArtifactOrigins, readMappedArtifact, resolveCompleted }) {
  const errors = continuationErrors(packet);
  if (!errors.length) errors.push(...continuationPlanErrors(packet));
  if (errors.length) throw Object.assign(stagingError('continuation_not_executable'), { details: errors, permanent: true });
  const completed = await resolveCompleted?.(packet);
  const c = packet.continuation;
  const files = [];
  let total = 0;
  async function fetchSource(source) {
    let url;
    try { url = new URL(source.url); } catch { throw stagingError('artifact_url_rejected'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !allowedArtifactOrigins.includes(url.origin)) throw stagingError('artifact_origin_rejected');
    if (source.bytes > 25 * 1024 * 1024 || (total += source.bytes) > 100 * 1024 * 1024) throw stagingError('artifact_size_rejected');
    const bytes = await fetchArtifact({ url: source.url, maxBytes: source.bytes, redirect: 'error' });
    if (!Buffer.isBuffer(bytes) || bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw stagingError('artifact_digest_mismatch');
    return bytes;
  }
  for (const file of c.files) {
    const source = packet.artifacts.find(a => a.path === file.source_path);
    const bytes = file.source_origin === 'mapped_repository' ? await readMappedArtifact(packet, file, completed ? { reconcile: true } : undefined) : await fetchSource({ ...source, url: file.url });
    if (!Buffer.isBuffer(bytes) || bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw stagingError('artifact_digest_mismatch');
    files.push({ path: file.path, bytes });
  }
  const execution = await reconcileCompletedSelection(packet, files, fetchSource, () => completed, readMappedArtifact);
  const transformations = await executeContinuationPlan(execution, files, fetchSource);
  const prepared = prepareStagingBuildPacket({
    source: { ...c.source, website_request_public_id: packet.request_id, customer_id: c.customer.id, current_proof_hash: c.current_selected_sha256 },
    customer: c.customer, selection: { ...c.selection, approved: true, direction_id: packet.selected_direction_ids[0], proof_hash: c.current_selected_sha256 },
    spec: c.spec, brand: c.brand, artifact_bundle: createArtifactBundle(files), research_packet_ref: c.research_packet_ref,
    origin: c.origin, created: packet.created_at,
  }).packet;
  prepared.transformations = transformations;
  if (execution !== packet) prepared.execution_packet = execution;
  return prepared;
}

export function stagingCallback(job) {
  const p = job.packet, c = p.continuation;
  const identity = { event_id: `${job.id}:${job.failure ? 'failed' : 'review'}`, packet_id: p.packet_id, idempotency_key: p.idempotency_key,
    request_id: p.request_id, project_id: p.project_id, website_request_id: c?.website_request_id,
    customer_id: c?.customer?.id, selection_revision: c?.selection_revision,
    selected_direction_id: p.selected_direction_ids[0], selected_artifact_sha256: p.selected_artifacts[0].source_artifact_sha256,
    artifact_manifest_sha256: p.artifact_manifest_sha256, completed_at: job.completed_at,
    customer_accepted: false, checkout_eligible: false, final_launch: false };
  if (p.schema === PLANNING_SCHEMA) return { ...identity,
    schema: 'famtastic.site-studio.planning-result.v1', status: job.failure ? 'planning_failed' : 'planning_complete',
    intent_id: p.intent.intent_id, intent_sha256: p.intent_sha256, ready: false,
    ...(job.failure ? { error: job.failure } : { plan: job.plan }) };
  if (job.failure) return { ...identity, schema: 'famtastic.site-studio.staging-failure.v1', status: 'failed', error: job.failure };
  return { ...identity, schema: 'famtastic.site-studio.staging-receipt.v1', status: 'deployed',
    staging_url: job.host.url, artifact_sha256: job.host.manifest_sha256, target_path: job.host.target_path,
    remote_subdirectory: job.host.remote_subdirectory, repository: { mode: 'local_only', branch: job.build.repository.branch, commit: job.build.repository.commit, remote_url: job.build.repository.remote_url || null },
    qa: job.qa.checks.map(name => ({ name, status: 'passed' })), source_export_sha256: job.source_export?.sha256 || job.build.source_export?.sha256 || null, source_completion: job.source_mapping || null,
    use_restrictions: restrictionsForPacket(job.packet), evidence: job.host };
}

// Injected capabilities are mandatory. There is deliberately no ambient fetch,
// payment client, mailer, or production deploy adapter in this coordinator.
export function createStagingWorker({ store, pipeline, fetchArtifact, allowedArtifactOrigins, qa, host, callback, resolveSource = store.resolveSource, maxAttempts = 3 }) {
  async function run(id) {
    let claim;
    try { claim = store.claim(id); } catch (error) {
      if (error.code === 'project_busy' || error.code === 'source_association_not_ready') error.stagingClaimBusy = true;
      throw error;
    }
    const { job, token } = claim;
    const save = () => store.checkpoint(job, token);
    try {
      if (['complete', 'exception', 'superseded'].includes(job.state)) return job;
      // A process crash during a non-idempotent repository write is ambiguous.
      // Never duplicate it. The repository/DNA receipt needs reconciliation.
      if (job.state === 'running' && job.stage === 'build') {
        job.failure = { code: 'interrupted_build_requires_reconciliation', stage: 'build' };
        job.stage = 'callback'; job.state = 'queued';
      }
      while (job.stage !== 'done') {
        const stage = job.stage;
        job.attempts[stage] = (job.attempts[stage] || 0) + 1;
        job.state = 'running'; save();
        const started = Date.now();
        try {
          if (stage === 'plan') {
            job.plan = planSelectedSource(job.packet.intent);
            if (job.packet.dispatch_issue) job.plan.issues.push({ stage: 'dispatch', code: 'agency_execution_binding_incomplete', detail: job.packet.dispatch_issue, owner: 'designs' });
            job.stage = 'callback';
          } else if (stage === 'materialize') {
            job.selected = await materializeSelection(job.packet, { fetchArtifact, allowedArtifactOrigins, readMappedArtifact: store.readMappedArtifact, resolveCompleted: store.resolveCompleted });
            job.stage = 'build';
          } else if (stage === 'build') {
            let mapped = null;
            const executionPacket = job.selected.execution_packet || job.packet;
            if (executionPacket.continuation.initiating_system === 'studio' || executionPacket.continuation.source_export_sha256) {
              if (!resolveSource) throw Object.assign(stagingError('source_repository_mapping_required'), { permanent: true });
              mapped = await resolveSource(executionPacket);
              const source = mapped?.source_export && decodeSourceExport(mapped.source_export);
              const partial = mapped?.mapping?.association_id && executionPacket.continuation.operation === 'continue_build' && source?.issues?.length === 1 && source.issues[0] === 'required_pages_incomplete' && source.review_qa?.passed === true;
              if (mapped?.reused_existing_source !== true || (source.scope_complete !== true && !partial)) throw stagingError('source_export_invalid');
            }
            if (mapped && executionPacket.continuation.operation === 'package_existing') job.build = mapped;
            else {
              const brief = packetToBuildBrief(job.selected);
              brief.source_use_restrictions = restrictionsForPacket(job.packet);
              brief.handoff = { operation: executionPacket.continuation.operation, correlation_id: job.packet.continuation.correlation_id, initiating_system: job.packet.continuation.initiating_system, source_sha256: job.hash, transformations: job.selected.transformations };
              brief.business_owner = { id: job.packet.continuation.customer.id, name: job.packet.continuation.customer.name };
              if (mapped) brief.repository = { url: mapped.repository.remote_url, branch: mapped.repository.branch };
              job.build = await pipeline.run({ site_id: mapped?.site_id || `project-${job.packet.project_id}`, brief, composer: 'artifact', initiator: job.id });
              if (job.build?.outcome !== 'success' || job.build.verify?.passed !== true) throw Object.assign(stagingError('build_failed'), { permanent: true });
              if (mapped) job.build.source_mapping_ref = mapped.source_mapping_ref;
            }
            job.stage = 'qa';
          } else if (stage === 'qa') {
            job.qa = await qa({ job });
            const required = ['functional', 'responsive', 'accessibility', 'asset_rights', 'visual_parity'];
            if (job.qa?.passed !== true || required.some(n => !job.qa.checks?.includes(n))) throw stagingError('qa_failed');
            if (!job.build.reused_existing_source && pipeline.finalizeSource) {
              const c = job.packet.continuation;
              const resolved = new Set((c.recipe?.steps || []).flatMap(step => step.resolves_change_ids || []));
              job.source_export = pipeline.finalizeSource(job.build, { completion_scope: {
                site_id: job.build.site_id, evidence_ref: `selected-packet:${job.packet.packet_id}`,
                required_pages: c.required_pages, features: ['static_navigation'],
                pending_revisions: (c.requested_changes || []).filter(change => !resolved.has(change.id)),
              } }, job.qa);
              if (!decodeSourceExport(job.source_export).scope_complete) throw stagingError('source_scope_incomplete');
            }
            if (store.recordSource && (job.source_export || job.build.source_export)) job.source_mapping = store.recordSource(job, token);
            job.stage = 'host';
          } else if (stage === 'host') {
            await revalidateReferenceAccess(job.packet, fetchArtifact, allowedArtifactOrigins);
            job.host = await host.deploy({ job, operation_id: job.id });
            if (job.host?.verified !== true || job.host?.review_only !== true) throw stagingError('hosting_not_verified');
            job.stage = 'callback';
          } else if (stage === 'callback') {
            if (!job.failure && job.packet.schema !== PLANNING_SCHEMA) await revalidateReferenceAccess(job.packet, fetchArtifact, allowedArtifactOrigins);
            job.completed_at ||= new Date().toISOString();
            job.callback_body ||= stagingCallback(job);
            save(); // Exact callback bytes survive timeout, rejection and restart.
            const ack = await callback(job.callback_body);
            if (ack?.ok !== true) throw stagingError('callback_not_acknowledged');
            job.stage = 'done';
          }
          job.history.push({ stage, attempt: job.attempts[stage], status: 'passed', duration_ms: Date.now() - started,
            input_sha256: job.hash, output_sha256: digest(job[stage] || job.callback_body || job.selected || {}), model: 'none', cost_usd: 0 });
          job.state = job.stage === 'done' ? (job.failure ? 'exception' : 'complete') : 'queued'; save();
        } catch (error) {
          job.history.push({ stage, attempt: job.attempts[stage], status: 'failed', code: error.code || 'stage_failed', duration_ms: Date.now() - started });
          if (stage === 'callback') {
            job.state = job.attempts[stage] >= maxAttempts ? 'exception' : 'retry'; save(); return job;
          }
          if (!error.permanent && stage !== 'build' && job.attempts[stage] < maxAttempts) { job.state = 'retry'; save(); return job; }
          job.failure = { code: error.code || 'stage_failed', stage, details: error.details || [] };
          job.stage = 'callback'; job.state = 'queued'; save();
        }
      }
      return job;
    } finally { store.release(job, token); }
  }
  return { run, tick: async () => {
    const results = [];
    for (const j of store.list().filter(j => ['queued', 'retry', 'running'].includes(j.state))) {
      try { results.push(await run(j.id)); }
      catch (error) {
        if (!['project_busy', 'source_association_not_ready'].includes(error.code) || error.stagingClaimBusy !== true) throw error;
        results.push({ id: j.id, state: error.code === 'project_busy' ? 'busy' : 'waiting_source_association', stage: j.stage, code: error.code });
      }
    }
    return results;
  } };
}
import { decodeSourceExport } from './source-export-wire.js';
