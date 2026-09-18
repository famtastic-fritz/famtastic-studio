import fs from 'node:fs';
import { decodeSourceExport } from './source-export-wire.js';
import { git } from '../../vendor/site-foundation/index.js';
import { digest, stagingError } from './staging-store.js';

function verifiedPartialAssociation(record, mapping) {
  const qa = record.review_qa;
  return !!mapping.association_id && /^[a-f0-9]{64}$/.test(mapping.association_scope_sha256 || '')
    && record.scope?.evidence_ref === `association:${mapping.association_id}` && record.scope.request_scope_sha256 === mapping.association_scope_sha256
    && record.issues?.length === 1 && record.issues[0] === 'required_pages_incomplete' && record.source_verification?.passed === true
    && qa?.passed === true && qa.verifier === 'selected-static-browser-v2' && !qa.problems?.length && qa.evidence?.length > 0
    && qa.source_binding?.site_id === record.site_id && qa.source_binding.run_id === record.run_id && qa.source_binding.manifest_sha256 === record.manifest_sha256;
}

// Mapping is installation-owned capability data, never inferred from a packet ID.
export function createSelectedSourceResolver({ paths, mappings = [], getMappings = () => [] }) {
  return async (packet, { reconcile = false } = {}) => {
    const c = packet.continuation;
    const owned = getMappings().filter(m => String(m.project_id) === String(packet.project_id) && String(m.customer_id) === String(c.customer.id));
    const configured = mappings.filter(m => String(m.project_id) === String(packet.project_id) && String(m.customer_id) === String(c.customer.id));
    if (owned.length && configured.some(m => m.site_id !== owned[0].site_id || m.repository_path !== owned[0].repository_path)) throw stagingError('source_repository_mapping_conflict');
    const matches = owned.length ? owned : configured;
    if (matches.length !== 1) throw stagingError('source_repository_mapping_required');
    const m = matches[0];
    const ancestor = reconcile && c.source_export_sha256 && m.source_history?.find(h => h.source_export_sha256 === c.source_export_sha256);
    if (!m.evidence_ref || ((!reconcile || c.source_export_sha256) && m.source_export_sha256 !== c.source_export_sha256 && !ancestor) || m.request_id && m.request_id !== packet.request_id) throw stagingError('source_repository_mapping_stale');
    const wire = JSON.parse(fs.readFileSync(paths.within('dna', m.run_id, `source-${m.source_export_sha256}.json`), 'utf8'));
    const record = decodeSourceExport(wire);
    if (record.sha256 !== m.source_export_sha256 || (!record.scope_complete && !verifiedPartialAssociation(record, m)) || record.site_id !== m.site_id) throw stagingError('source_export_invalid');
    const dir = paths.within('sites', m.site_id);
    if (fs.realpathSync(dir) !== fs.realpathSync(m.repository_path) || fs.realpathSync(dir) !== fs.realpathSync(record.repository.repository_path)
      || git(dir, ['rev-parse', 'HEAD']) !== record.repository.commit || git(dir, ['branch', '--show-current']) !== record.repository.branch || git(dir, ['status', '--porcelain']) !== '') throw stagingError('source_repository_changed');
    let remote = null;
    if (git(dir, ['remote']).split('\n').includes('origin')) remote = git(dir, ['remote', 'get-url', 'origin']);
    if (remote !== (record.repository.remote_url || null) || (m.remote_url !== undefined && remote !== m.remote_url)) throw stagingError('source_repository_remote_changed');
    const pathsInPacket = c.files.map(f => f.path).sort();
    if (ancestor) {
      const old = decodeSourceExport(JSON.parse(fs.readFileSync(paths.within('dna', ancestor.run_id, `source-${ancestor.source_export_sha256}.json`), 'utf8')));
      if (old.sha256 !== ancestor.source_export_sha256 || old.run_id !== ancestor.run_id || (!old.scope_complete && !verifiedPartialAssociation(old, m)) || old.site_id !== record.site_id || old.repository.repository_path !== record.repository.repository_path
        || old.repository.branch !== record.repository.branch || old.repository.remote_url !== record.repository.remote_url
        || JSON.stringify(pathsInPacket) !== JSON.stringify(old.files.map(f => f.path).sort())) throw stagingError('source_repository_ancestor_mismatch');
      try { git(dir, ['merge-base', '--is-ancestor', old.repository.commit, record.repository.commit]); }
      catch { throw stagingError('source_repository_ancestor_mismatch'); }
      for (const file of old.files) {
        const declared = c.files.find(f => f.path === file.path), artifact = packet.artifacts.find(a => a.path === declared.source_path);
        if (artifact?.sha256 !== file.sha256 || artifact?.bytes !== file.bytes) throw stagingError('source_repository_ancestor_bytes_changed');
      }
    }
    if (!reconcile && JSON.stringify(pathsInPacket) !== JSON.stringify(record.files.map(f => f.path).sort())) throw stagingError('source_export_manifest_mismatch');
    if (reconcile && (pathsInPacket.some(p => !record.files.some(f => f.path === p)) || record.files.some(f => f.path.endsWith('.html') && !c.required_pages.includes(f.path)))) throw stagingError('source_export_manifest_mismatch');
    for (const file of record.files) {
      const bytes = fs.readFileSync(paths.within('sites', m.site_id, file.path));
      const declared = c.files.find(f => f.path === file.path);
      const artifact = packet.artifacts.find(a => a.path === declared?.source_path);
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256 || (declared || !reconcile) && (artifact?.sha256 !== file.sha256 || artifact?.bytes !== file.bytes)) throw stagingError('source_export_bytes_changed');
    }
    return { outcome: 'success', site_id: record.site_id, run_id: record.run_id,
      repository: record.repository, verify: record.source_verification,
      source_export: wire, reused_existing_source: true, source_mapping_ref: m.evidence_ref, mapping: m };
  };
}
