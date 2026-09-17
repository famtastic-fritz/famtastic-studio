import fs from 'node:fs';
import { digest } from './staging-store.js';
import { safePublicPath } from './staging-contract.js';

/** Export actual finalized source. Success is not scope completion or human assent. */
export function exportFinalizedSource({ paths, result, brief, reviewQa = null }) {
  if (result?.outcome !== 'success' || !result.repository?.worktree_clean || !result.repository?.commit) throw new Error('source_finalization_requires_committed_build');
  const issues = [];
  const files = [...result.composed.pages, ...result.composed.assets].filter(file => {
    if (safePublicPath(file.path)) return true;
    issues.push('unsupported_public_export_path'); return false;
  }).map(file => {
    const bytes = fs.readFileSync(paths.within('sites', result.site_id, file.path));
    return { path: file.path, sha256: digest(bytes), bytes: bytes.length };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const scope = brief.completion_scope || null;
  if (!scope?.evidence_ref || !Array.isArray(scope.required_pages) || !scope.required_pages.length) issues.push('scope_binding_missing');
  if ((scope?.required_pages || []).some(name => !files.some(file => file.path === name && name.endsWith('.html')))) issues.push('required_pages_incomplete');
  // Static navigation is the sole verified feature class; no application claims.
  if (!Array.isArray(scope?.features) || scope.features.some(feature => feature !== 'static_navigation') || result.spec?.backend || result.spec?.capability_class === 'application') issues.push('feature_recipe_missing');
  if (!Array.isArray(scope?.pending_revisions) || scope.pending_revisions.length) issues.push('requested_revisions_pending');
  if (result.verify?.passed !== true || !result.verify.checks?.length) issues.push('source_verification_incomplete');
  if (reviewQa?.passed !== true || reviewQa.verifier !== 'selected-static-browser-v2' || !reviewQa.evidence?.length || reviewQa.problems?.length) issues.push('review_qa_pending');
  const record = { schema: 'famtastic.finalized-source.v1', site_id: result.site_id, run_id: result.run_id,
    repository: result.repository, files, spec_snapshot: result.spec,
    provenance: { packet_id: result.packet.packet_id, packet_sha256: digest(result.packet), inherited: result.packet.inherited_provenance || null },
    scope, scope_complete: issues.length === 0, issues, source_verification: result.verify,
    review_qa: reviewQa, human_accepted: false, hosting_verified: false };
  const exported = { ...record, sha256: digest(record) };
  const dir = paths.within('dna', result.run_id);
  fs.mkdirSync(dir, { recursive: true });
  const file = paths.within('dna', result.run_id, `source-${exported.sha256}.json`);
  fs.writeFileSync(file, JSON.stringify(exported, null, 2), { mode: 0o600, flag: 'w' });
  return exported;
}
