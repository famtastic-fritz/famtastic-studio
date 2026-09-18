import fs from 'node:fs';
import { readSourceRestrictions } from './source-use-restrictions.js';
import { encodeSourceExport } from './source-export-wire.js';
import { digest } from './staging-store.js';
import { safePublicPath } from './staging-contract.js';
import { git, readManifest } from '../../vendor/site-foundation/index.js';

/** Export actual finalized source. Success is not scope completion or human assent. */
export function exportFinalizedSource({ paths, result, brief, reviewQa = null }) {
  if (result?.outcome !== 'success' || !result.repository?.worktree_clean || !result.repository?.commit) throw new Error('source_finalization_requires_committed_build');
  const dir = paths.within('sites', result.site_id);
  if (fs.realpathSync(dir) !== fs.realpathSync(result.repository.repository_path)
    || readManifest(dir)?.site_id !== result.site_id
    || git(dir, ['rev-parse', 'HEAD']) !== result.repository.commit
    || git(dir, ['branch', '--show-current']) !== result.repository.branch
    || git(dir, ['status', '--porcelain']) !== '') throw new Error('source_repository_changed');
  const issues = [];
  const files = [...result.composed.pages, ...result.composed.assets].filter(file => {
    if (safePublicPath(file.path)) return true;
    issues.push('unsupported_public_export_path'); return false;
  }).map(file => {
    const bytes = fs.readFileSync(paths.within('sites', result.site_id, file.path));
    const expected = result.verify?.source_manifest?.find(entry => entry.path === file.path);
    if (!expected || expected.sha256 !== digest(bytes) || expected.bytes !== bytes.length) throw new Error('source_verification_bytes_changed');
    return { path: file.path, sha256: digest(bytes), bytes: bytes.length };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const scope = brief.completion_scope || null;
  const manifestHash = digest(files);
  if (!scope?.evidence_ref || !Array.isArray(scope.required_pages) || !scope.required_pages.length) issues.push('scope_binding_missing');
  if (scope?.site_id !== result.site_id) issues.push('scope_identity_mismatch');
  if ((scope?.required_pages || []).some(name => !files.some(file => file.path === name && name.endsWith('.html')))) issues.push('required_pages_incomplete');
  // Static navigation is the sole verified feature class; no application claims.
  if (!Array.isArray(scope?.features) || scope.features.some(feature => feature !== 'static_navigation') || result.spec?.backend || result.spec?.capability_class === 'application') issues.push('feature_recipe_missing');
  if (!Array.isArray(scope?.pending_revisions) || scope.pending_revisions.length) issues.push('requested_revisions_pending');
  if (result.verify?.passed !== true || !result.verify.checks?.length) issues.push('source_verification_incomplete');
  if (reviewQa?.passed !== true || reviewQa.verifier !== 'selected-static-browser-v2' || !reviewQa.evidence?.length || reviewQa.problems?.length) issues.push('review_qa_pending');
  if (reviewQa?.source_binding?.site_id !== result.site_id || reviewQa?.source_binding?.run_id !== result.run_id || reviewQa?.source_binding?.manifest_sha256 !== manifestHash) issues.push('review_qa_binding_mismatch');
  const record = { schema: 'famtastic.finalized-source.v1', site_id: result.site_id, run_id: result.run_id,
    repository: result.repository, files, manifest_sha256: manifestHash, spec_snapshot: result.spec,
    provenance: { packet_id: result.packet.packet_id, brief_hash: result.packet.brief_hash, source_adapter: result.packet.source_adapter,
      packet_sha256: digest(result.packet), inherited: result.packet.inherited_provenance || null },
    scope, scope_complete: issues.length === 0, issues, source_verification: result.verify,
    review_qa: reviewQa, use_restrictions: readSourceRestrictions(paths, result.site_id), human_accepted: false, hosting_verified: false };
  const exported = encodeSourceExport(record);
  const exportDir = paths.within('dna', result.run_id);
  fs.mkdirSync(exportDir, { recursive: true });
  const file = paths.within('dna', result.run_id, `source-${exported.sha256}.json`);
  fs.writeFileSync(file, JSON.stringify(exported, null, 2), { mode: 0o600, flag: 'w' });
  return exported;
}
