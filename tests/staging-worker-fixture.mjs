import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import { createStagingStore, digest } from '../server/kernel/staging-store.js';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { createCpanelReview, createCpanelFileApi } from '../server/kernel/cpanel-review.js';
import { createReviewBackup } from '../server/kernel/review-backup.js';
import { createSelectedReviewQa } from '../server/kernel/selected-review-qa.js';
import { createStagingCallback } from '../server/kernel/staging-callback.js';
export const html = '<!doctype html><html lang="en"><head><title>Synthetic</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Synthetic</h1><p>Selected authored content.</p></body></html>';
export function packet() {
  const artifacts = [{ role: 'selected_preview', path: 'proof/index.html', bytes: Buffer.byteLength(html), sha256: digest(html) }];
  return { schema: 'famtastic.site-studio.build-packet.v1', packet_id: 'packet-1', idempotency_key: 'idem-1', request_id: 'request-1', project_id: '42',
    build_class: 'prepayment_selected_direction_staging', selected_direction_ids: ['direction-a'], artifacts,
    artifact_manifest_sha256: digest(artifacts.map(a => ({ bytes: a.bytes, path: a.path, role: a.role, sha256: a.sha256 }))),
    selected_artifacts: [{ direction_id: 'direction-a', source_artifact_path: artifacts[0].path, source_artifact_sha256: artifacts[0].sha256, source_artifact_bytes: artifacts[0].bytes }],
    created_at: '2026-09-17T12:00:00.000Z',
    continuation: { schema_version: 1, operation: 'package_existing', initiating_system: 'designs', correlation_id: 'correlation-1', requested_next_action: 'protected_review',
      hosting_target: { staging_url: 'https://synthetic.famtasticinc.com/', target_path: '/home/nineoo/public_html/synthetic', remote_subdirectory: 'synthetic' },
      customer: { id: 'customer-1', name: 'Synthetic', email: 'synthetic@example.invalid' }, selection_revision: 1, website_request_id: 1,
      current_selected_sha256: digest(html), required_pages: ['index.html'], origin: 'test',
      files: [{ path: 'index.html', source_path: 'proof/index.html', url: 'https://assets.example.invalid/proof/index.html', rights: { status: 'approved', evidence_ref: 'synthetic-authored' } }],
      source: { proof_campaign_id: 'pc-1', campaign_id: 'pc-1' },
      selection: { direction_name: 'Selected', proof_variant_id: 'pv-1', proof_version: '1', approval_id: 'sel-1', approved_at: '2026-09-17T12:00:00.000Z' },
      spec: { capability_class: 'static', business: { name: 'Synthetic' }, site_needs: { pages: ['home'] } },
      brand: { design_contract: { schema_version: 1, tokens: { bg: '#fff', fg: '#111', accent: '#070', muted: '#555' }, typography: { body: 'Arial', headings: 'Arial' }, component_recipe: ['proof-shell'], layout: { max_width: '72rem', gutter: '1rem', grid: '1-col' }, responsive: { mobile: 'stack', tablet: 'stack', desktop: 'stack' }, asset_policy: { preserve: true, rights_safe_only: true }, evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true } } },
      research_packet_ref: { packet_id: 'rp-1', brief_hash: digest('source'), source_adapter: 'selected-source' } } };
}
export function fixture({ producerPacket = null, artifactBytes = Buffer.from(html), receiptRequest = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-worker-'));
  const config = loadPathsConfig(); config.data_root_default = root; config.data_root_env = 'SYNTHETIC_STAGING_DATA_ROOT'; config.source_root_default = null; config.portfolio_roots = {};
  const paths = createPaths(config), journal = createJournal({ paths }), events = createEvents({ paths }), dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events }), spec = createSpec({ paths, mutation });
  const counters = { generation: 0, builds: 0, uploads: 0, callbacks: 0, backups: 0 };
  const forbidden = () => { counters.generation++; throw new Error('generation forbidden'); };
  const real = createPipeline({ paths, journal, events, dna, mutation, spec, researchOptions: { spawnImpl: forbidden, fetchImpl: forbidden, commandExistsImpl: forbidden }, copyOptions: { adapter: { complete: forbidden } } });
  const pipeline = { run: async o => { counters.builds++; return real.run(o); }, finalizeSource: real.finalizeSource };
  const binding = { url: 'https://synthetic.famtasticinc.com/', target_path: '/home/nineoo/public_html/synthetic', remote_subdirectory: 'synthetic', site_id: 'project-42', customer_id: 'customer-1', access: 'protected_review', host_aliases: ['mbsh.example.invalid'] };
  if (producerPacket) {
    binding.site_id = `project-${producerPacket.project_id}`; binding.customer_id = producerPacket.continuation.customer.id;
    Object.assign(binding, { url: producerPacket.continuation.hosting_target.staging_url, target_path: producerPacket.continuation.hosting_target.target_path, remote_subdirectory: producerPacket.continuation.hosting_target.remote_subdirectory });
  }
  const remote = new Map(), wire = [], callbackBodies = [];
  const controls = { qaFails: false, callbackFails: false, probeFails: false, uploadFails: false };
  const api = createCpanelFileApi({ target: binding, request: async request => {
    wire.push(request.route);
    if (request.form) { counters.uploads++; if (controls.uploadFails) throw Object.assign(new Error('upload'), { code: 'upload_failed' }); remote.set(request.form.name, request.form.bytes); return { status: 1 }; }
    return { event: { result: 1 } };
  } });
  const transport = { preflight: async () => ({ verified: true, target_path: binding.target_path, hostname: new URL(binding.url).hostname, site_id: binding.site_id }), backup: async () => { counters.backups++; return { verified: true, ref: 'private/backup', files: [...remote].map(([name, bytes]) => [name, bytes.toString('base64')]) }; }, protect: async () => {},
    verifyAccess: async () => ({ anonymous_denied: true, aliases_denied: true, noindex: true }),
    fileHash: async ({ path }) => remote.has(path) ? digest(remote.get(path)) : null,
    mkdir: api.mkdir, upload: api.upload,
    probe: async ({ path }) => ({ status: controls.probeFails ? 500 : 200, https_verified: true, noindex: true, bytes: remote.get(path) || Buffer.alloc(0) }),
    restore: async ({ backup }) => { remote.clear(); for (const [n, b] of backup.files) remote.set(n, Buffer.from(b, 'base64')); return { verified: true }; } };
  const backups = createReviewBackup({ paths, journal, binding, readFile: async name => remote.get(name) || null, writeFile: async (name, bytes) => { remote.set(name, bytes); }, removeFile: async name => { remote.delete(name); }, listFiles: async () => [...remote.keys()] });
  transport.backup = async args => { counters.backups++; return backups.backup(args); };
  transport.restore = backups.restore;
  const host = createCpanelReview({ paths, journal, binding, transport });
  const callback = createStagingCallback({ endpoint: 'https://designs.example.invalid/api/pipeline/site-studio/callback', secret: 'synthetic-callback-secret', request: async (url, request) => {
    counters.callbacks++; callbackBodies.push(request); if (receiptRequest) return receiptRequest(request); return { status: controls.callbackFails ? 503 : 200, body: { ok: !controls.callbackFails } };
  } });
  let store = createStagingStore({ paths, journal });
  const options = () => ({ store, pipeline, fetchArtifact: async () => artifactBytes, allowedArtifactOrigins: [producerPacket ? new URL(producerPacket.continuation.files[0].url).origin : 'https://assets.example.invalid'], qa: async args => controls.qaFails ? { passed: false, checks: [] } : createSelectedReviewQa({ paths })(args), host, callback });
  return { root, paths, journal, dna, pipeline, controls, remote, wire, counters, callbackBodies, binding, transport,
    get store() { return store; }, worker: () => createStagingWorker(options()), options,
    restart: () => { store.close(); store = createStagingStore({ paths, journal }); },
    cleanup: () => { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
