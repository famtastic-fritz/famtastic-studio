import fs from 'node:fs';
import { git } from '../../vendor/site-foundation/index.js';
import { digest, stagingError } from './staging-store.js';

// Mapping is installation-owned capability data, never inferred from a packet ID.
export function createSelectedSourceResolver({ paths, mappings = [] }) {
  return async packet => {
    const c = packet.continuation;
    const matches = mappings.filter(m => String(m.project_id) === String(packet.project_id) && String(m.customer_id) === String(c.customer.id));
    if (matches.length !== 1) throw stagingError('source_repository_mapping_required');
    const m = matches[0];
    if (!m.evidence_ref || m.source_export_sha256 !== c.source_export_sha256) throw stagingError('source_repository_mapping_stale');
    const record = JSON.parse(fs.readFileSync(paths.within('dna', m.run_id, `source-${m.source_export_sha256}.json`), 'utf8'));
    const { sha256, ...body } = record;
    if (digest(body) !== sha256 || sha256 !== m.source_export_sha256 || !record.scope_complete || record.site_id !== m.site_id) throw stagingError('source_export_invalid');
    const dir = paths.within('sites', m.site_id);
    if (fs.realpathSync(dir) !== fs.realpathSync(m.repository_path) || fs.realpathSync(dir) !== fs.realpathSync(record.repository.repository_path)
      || git(dir, ['rev-parse', 'HEAD']) !== record.repository.commit || git(dir, ['branch', '--show-current']) !== record.repository.branch || git(dir, ['status', '--porcelain']) !== '') throw stagingError('source_repository_changed');
    let remote = null;
    if (git(dir, ['remote']).split('\n').includes('origin')) remote = git(dir, ['remote', 'get-url', 'origin']);
    if (remote !== (record.repository.remote_url || null) || (m.remote_url !== undefined && remote !== m.remote_url)) throw stagingError('source_repository_remote_changed');
    const pathsInPacket = c.files.map(f => f.path).sort();
    if (JSON.stringify(pathsInPacket) !== JSON.stringify(record.files.map(f => f.path).sort())) throw stagingError('source_export_manifest_mismatch');
    for (const file of record.files) {
      const bytes = fs.readFileSync(paths.within('sites', m.site_id, file.path));
      const declared = c.files.find(f => f.path === file.path);
      const artifact = packet.artifacts.find(a => a.path === declared.source_path);
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256 || artifact?.sha256 !== file.sha256 || artifact?.bytes !== file.bytes) throw stagingError('source_export_bytes_changed');
    }
    return { outcome: 'success', site_id: record.site_id, run_id: record.run_id,
      repository: record.repository, verify: record.source_verification,
      source_export: record, reused_existing_source: true, source_mapping_ref: m.evidence_ref };
  };
}
