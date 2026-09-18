import fs from 'node:fs';
import crypto from 'node:crypto';
import { digest, stagingError } from './staging-store.js';
import { decodeSourceExport } from './source-export-wire.js';
import { exportFinalizedSource } from './source-finalization.js';

export function verifySourceAssociation(grant, secret, now = Math.floor(Date.now() / 1000)) {
  const raw = grant?.payload_json;
  const expected = secret && typeof raw === 'string' ? crypto.createHmac('sha256', secret).update(`famtastic.source-association.v1\n${raw}`).digest('hex') : '';
  if (!expected || typeof grant.signature !== 'string' || Buffer.byteLength(grant.signature) !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(grant.signature))) throw stagingError('source_association_signature_invalid');
  let p; try { p = JSON.parse(raw); } catch { throw stagingError('source_association_payload_invalid'); }
  if (!p || typeof p !== 'object' || !p.intent) throw stagingError('source_association_payload_invalid');
  if (p.schema !== 'famtastic.source-association.v1' || p.operation !== 'associate_verified_source' || p.audience !== 'site-studio-next'
    || !/^[a-f0-9]{32}$/.test(p.association_id) || p.issued_at > now || p.expires_at < now || p.expires_at - p.issued_at > 3600) throw stagingError('source_association_invalid_or_expired');
  for (const key of ['project_id', 'customer_id', 'request_id']) if (!p[key] || p[key] !== p.intent?.[key]) throw stagingError('source_association_identity_changed');
  if (p.scope_sha256 !== p.intent.scope.snapshot_sha256 || digest(p.intent.scope.snapshot_json) !== p.scope_sha256) throw stagingError('source_association_scope_changed');
  return p;
}

/** Link an actual normal pipeline result, including already completed sources. */
export function createSourceAssociation({ paths, store, qa, callback, secret, now = () => Math.floor(Date.now() / 1000) }) {
  function due(entry) {
    try { if (JSON.parse(entry.envelope.association.payload_json).expires_at < now()) return true; } catch { return true; }
    return !entry.next_attempt_at || entry.next_attempt_at <= now();
  }
  async function deliver(id) {
    const entry = store.readAssociation(id);
    if (!entry) throw stagingError('source_association_missing');
    if (entry.state !== 'callback_pending' || !due(entry)) return entry;
    const { value, token } = store.claimAssociation(id);
    let verified = false;
    try {
      verifySourceAssociation(value.envelope.association, secret, now());
      const exported = decodeSourceExport(value.envelope.source_export);
      const result = JSON.parse(fs.readFileSync(paths.within('dna', exported.run_id, 'build-result.json'), 'utf8'));
      const checked = exportFinalizedSource({ paths, result, brief: { completion_scope: exported.scope }, reviewQa: exported.review_qa });
      if (checked.sha256 !== value.envelope.source_export.sha256) throw stagingError('source_association_finalized_bytes_changed');
      verified = true;
      const ack = await callback(value.envelope);
      if (ack?.ok !== true || ack.status !== 'source_associated' || typeof ack.newly_processed !== 'boolean'
        || ack.association_id !== id || ack.source_export_sha256 !== value.envelope.source_export.sha256
        || ['project_id', 'customer_id', 'request_id'].some(key => ack[key] !== value.envelope[key])) throw Object.assign(stagingError('source_association_ack_mismatch'), { permanent: true });
      return store.settleAssociation(id, token, { state: 'acknowledged', acknowledgement: ack, last_error: null, next_attempt_at: null });
    } catch (error) {
      const permanent = !verified || error.permanent || (error.responseStatus >= 400 && error.responseStatus < 500 && ![408, 429].includes(error.responseStatus));
      store.settleAssociation(id, token, { state: permanent ? 'reconciliation_required' : 'callback_pending',
        next_attempt_at: permanent ? null : now() + Math.min(300, 5 * 2 ** Math.min(value.attempts - 1, 6)),
        last_error: { code: error.code || (/^source_[a-z_]+$/.test(error.message) ? error.message : 'source_association_transport_failed'), reason: error.reasonCode || null },
        action: permanent ? 'Reconcile the current agency selection and verified source before retrying this association.' : 'The existing worker will retry this exact source callback when its persisted backoff is due, within the grant validity window.' });
      throw error;
    } finally { store.releaseAssociation(id, token); }
  }
  async function finalize({ site_id, run_id, association }) {
    const grant = verifySourceAssociation(association, secret, now());
    const prior = store.readAssociation(grant.association_id);
    if (prior) {
      if (prior.envelope.source_completion.site_id !== site_id || prior.envelope.source_completion.run_id !== run_id || JSON.stringify(prior.envelope.association) !== JSON.stringify(association)) throw stagingError('source_association_conflicting_reuse');
      return deliver(grant.association_id);
    }
    const result = JSON.parse(fs.readFileSync(paths.within('dna', run_id, 'build-result.json'), 'utf8'));
    if (result.site_id !== site_id || result.run_id !== run_id) throw stagingError('source_association_source_identity_changed');
    // Recheck the actual Git tree and original verification before browser QA.
    const initial = decodeSourceExport(exportFinalizedSource({ paths, result, brief: {} }));
    if (initial.files.some(f => !f.path.endsWith('.html')) || initial.use_restrictions) throw stagingError('source_association_asset_authority_required');
    const home = initial.files.find(f => f.path === 'index.html'), selected = grant.intent.source.artifacts[0];
    if (!home || home.sha256 !== selected.sha256 || home.bytes !== selected.bytes) throw stagingError('source_association_selected_source_changed');
    const names = grant.intent.scope.snapshot.page_list.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length !== grant.intent.scope.snapshot.page_count || names.some(n => !/^[A-Za-z][A-Za-z0-9 -]*$/.test(n))) throw stagingError('source_association_scope_unsupported');
    const required_pages = names.map(n => n.toLowerCase() === 'home' ? 'index.html' : n.toLowerCase().replace(/ +/g, '-') + '.html');
    if (initial.files.some(f => !required_pages.includes(f.path))) throw stagingError('source_association_extra_page');
    for (const key of ['required_features', 'integrations', 'booking_details', 'ecommerce_details', 'custom_needs']) if (grant.intent.scope.snapshot[key]?.trim()) throw stagingError('source_association_scope_unsupported');
    if (grant.intent.requested_changes.length) throw stagingError('source_association_pending_revisions');
    const files = initial.files.map(f => ({ ...f, content_base64: fs.readFileSync(paths.within('sites', site_id, f.path)).toString('base64') }));
    const review = await qa({ job: { id: `association-${grant.association_id}`, build: result,
      packet: { project_id: grant.project_id, continuation: { required_pages: initial.files.map(f => f.path), files: initial.files.map(f => ({ path: f.path, rights: { status: 'approved', evidence_ref: `association:${grant.association_id}:authored-source` } })) } },
      selected: { artifact_bundle: { files } } } });
    if (!review.passed) throw stagingError('source_association_qa_failed');
    const content_records = {}, content_evidence = {};
    for (const record of grant.intent.authored_content?.pages || []) {
      const path = record.text.page_name.toLowerCase() === 'home' ? 'index.html' : record.text.page_name.toLowerCase().replace(/ +/g, '-') + '.html';
      const file = files.find(f => f.path === path); if (!file) continue;
      const evidence = review.evidence.filter(e => e.path === path);
      if (!evidence.length || evidence.some(e => ['title', 'description', 'heading', 'body'].some(key => e.authored_fields[key] !== record.text[key]))) throw stagingError('source_association_completed_content_changed');
      content_records[path] = record.record_id; content_evidence[path] = file.content_base64;
    }
    const wire = exportFinalizedSource({ paths, result, brief: { completion_scope: { site_id, evidence_ref: `association:${grant.association_id}`, required_pages, features: ['static_navigation'], pending_revisions: [], request_scope_sha256: grant.scope_sha256 } }, reviewQa: review });
    const record = decodeSourceExport(wire);
    if (record.issues.some(issue => issue !== 'required_pages_incomplete')) throw stagingError('source_association_scope_unsupported');
    const mapping = { project_id: grant.project_id, customer_id: grant.customer_id, request_id: grant.request_id, site_id, run_id,
      association_id: grant.association_id, association_scope_sha256: grant.scope_sha256, repository_path: result.repository.repository_path, source_export_sha256: wire.sha256, source_export: wire,
      evidence_ref: `source-association:${grant.association_id}`, originating_system: 'studio', handoff_initiator: 'studio', content_records, completed_steps: {}, source_history: [] };
    store.recordAssociation(mapping, { schema: 'famtastic.site-studio.source-finalized.v1', project_id: grant.project_id, customer_id: grant.customer_id, request_id: grant.request_id,
      association, source_export: wire, source_completion: mapping, content_evidence });
    return deliver(grant.association_id);
  }
  async function tick() {
    const results = [];
    let attempted = 0;
    for (const entry of store.listAssociations().filter(e => e.state === 'callback_pending' && due(e))) {
      if (attempted >= 8) break;
      try { results.push(await deliver(entry.id)); }
      catch (error) { if (error.code === 'project_busy') { results.push({ id: entry.id, state: 'busy', code: error.code }); continue; } results.push(store.readAssociation(entry.id)); }
      attempted++;
    }
    return results;
  }
  return { finalize, deliver, tick, validate: grant => verifySourceAssociation(grant, secret, now()),
    request: identity => callback({ schema: 'famtastic.site-studio.association-request.v1', project_id: identity.project_id, customer_id: identity.customer_id, request_id: identity.request_id }) };
}
