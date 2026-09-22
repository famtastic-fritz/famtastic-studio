import crypto from 'node:crypto';
export function stagingPacketErrors(packet) {
  const errors = [];
  if (!packet || packet.schema !== 'famtastic.site-studio.build-packet.v1') errors.push('packet.schema');
  for (const field of ['packet_id', 'idempotency_key', 'request_id', 'project_id', 'build_class']) {
    if (typeof packet?.[field] !== 'string' || !packet[field].trim()) errors.push(`packet.${field}`);
  }
  if (packet?.build_class !== 'prepayment_selected_direction_staging') errors.push('packet.build_class');
  if (!Array.isArray(packet?.selected_direction_ids) || packet.selected_direction_ids.length !== 1) errors.push('packet.selected_direction_ids');
  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts : [];
  if (!artifacts.length) errors.push('packet.artifacts');
  const paths = new Set();
  for (const artifact of artifacts) {
    const valid = artifact
      && ['source_material', 'selected_preview', 'render_evidence'].includes(artifact.role)
      && typeof artifact.path === 'string'
      && artifact.path.length > 0
      && /^[A-Za-z0-9_-]+(?:[/.][A-Za-z0-9_-]+)*$/.test(artifact.path)
      && !artifact.path.startsWith('/')
      && !artifact.path.includes('..')
      && /^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      && Number.isInteger(artifact.bytes)
      && artifact.bytes >= 0
      && !paths.has(artifact.path);
    if (!valid) errors.push('packet.artifacts');
    if (artifact?.path) paths.add(artifact.path);
  }
  if (errors.includes('packet.artifacts')) return [...new Set(errors)];
  const canonicalManifest = artifacts
    .filter(artifact => artifact && typeof artifact === 'object')
    .map((artifact) => ({ bytes: artifact.bytes, path: artifact.path, role: artifact.role, sha256: artifact.sha256 }))
    // Contract paths are ASCII. Match PHP strcmp; locale collation is not a wire format.
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifestDigest = crypto.createHash('sha256').update(JSON.stringify(canonicalManifest)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(packet?.artifact_manifest_sha256 || '') || packet?.artifact_manifest_sha256 !== manifestDigest) {
    errors.push('packet.artifact_manifest_sha256');
  }
  const selected = Array.isArray(packet?.selected_artifacts) ? packet.selected_artifacts : [];
  if (selected.length !== 1) {
    errors.push('packet.selected_artifacts');
  } else {
    const bound = selected[0];
    const match = artifacts.filter((artifact) => artifact.role === 'selected_preview'
      && artifact.path === bound?.source_artifact_path
      && artifact.sha256 === bound?.source_artifact_sha256
      && artifact.bytes === bound?.source_artifact_bytes);
    if (bound?.direction_id !== packet.selected_direction_ids?.[0] || match.length !== 1) errors.push('packet.selected_artifacts');
  }
  if (typeof packet?.project_id !== 'string' || !/^[A-Za-z0-9-]+$/.test(packet.project_id)) errors.push('packet.project_id');
  if (artifacts.length > 500 || artifacts.reduce((n, a) => n + (a?.bytes || 0), 0) > 100 * 1024 * 1024) errors.push('packet.size_limit');
  if (packet?.boundary?.deploy_authorized === true) errors.push('packet.boundary.deploy_authorized');
  return [...new Set(errors)];
}


// Additive executable contract: old v1 packets remain durably accepted but
// cannot execute until the producer supplies this authoritative snapshot.
export function continuationErrors(packet) {
  const c = packet?.continuation;
  const errors = [];
  if (c?.schema_version !== 1) return ['continuation_required'];
  if (!['package_existing', 'continue_build'].includes(c.operation)) errors.push('operation_unsupported');
  if (!['designs', 'studio'].includes(c.initiating_system) || !c.correlation_id || c.requested_next_action !== 'protected_review') errors.push('handoff_intent');
  for (const key of ['id', 'name', 'email']) if (typeof c.customer?.[key] !== 'string' || !c.customer[key]) errors.push(`customer.${key}`);
  if (!Number.isSafeInteger(c.selection_revision) || c.selection_revision < 1) errors.push('selection_revision');
  if (!Number.isSafeInteger(c.website_request_id) || c.website_request_id < 1) errors.push('website_request_id');
  if (c.current_selected_sha256 !== packet.selected_artifacts?.[0]?.source_artifact_sha256) errors.push('stale_artifact');
  if (c.spec?.capability_class !== 'static' || c.spec?.backend || c.spec?.functional_contract) errors.push('unsupported_scope');
  if (c.operation === 'package_existing' && c.requested_changes?.length) errors.push('requested_revision_not_implemented');
  if (c.completed_stages !== undefined && !Array.isArray(c.completed_stages)) errors.push('completion_evidence_invalid');
  if (!Array.isArray(c.required_pages) || !c.required_pages.length || c.required_pages.some(p => !safePublicPath(p) || !p.endsWith('.html'))) errors.push('required_pages');
  if (!Array.isArray(c.files) || !c.files.length) errors.push('files');
  const names = new Set();
  for (const f of Array.isArray(c.files) ? c.files : []) {
    if (!safePublicPath(f.path) || names.has(f.path)) errors.push('public_path');
    names.add(f.path);
    if (!packet.artifacts.some(a => a.path === f.source_path && a.role !== 'render_evidence')) errors.push('source_binding');
    if (f.rights?.status !== 'approved' || !f.rights?.evidence_ref) errors.push('asset_rights');
    if (f.rights?.scope === 'protected_review_only') {
      const a = packet.artifacts.find(a => a.path === f.source_path);
      if (c.requested_next_action !== 'protected_review' || f.rights.usage !== 'exact_original_bytes' || !f.rights.request_asset_id
        || f.rights.customer_id !== c.customer.id || String(f.rights.website_request_id) !== String(c.website_request_id)
        || f.rights.sha256 !== a?.sha256 || f.rights.bytes !== a?.bytes
        || f.rights.publication_authorized !== false || f.rights.ai_transformation_authorized !== false || f.rights.legal_license_asserted !== false) errors.push('protected_reference_scope');
    }
    if (f.source_origin === 'mapped_repository') {
      if (!/^[a-f0-9]{64}$/.test(c.source_export_sha256 || '') || f.url !== undefined) errors.push('mapped_artifact_binding');
    } else try { const u = new URL(f.url); if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) errors.push('artifact_url'); } catch { errors.push('artifact_url'); }
  }
  for (const evidence of Array.isArray(c.completed_stages) ? c.completed_stages : []) {
    if (evidence.stage !== 'source_build' || evidence.artifact_manifest_sha256 !== packet.artifact_manifest_sha256
      || evidence.design_contract_sha256 !== crypto.createHash('sha256').update(JSON.stringify(c.brand?.design_contract || {})).digest('hex')
      || typeof evidence.evidence_ref !== 'string' || !evidence.evidence_ref) errors.push('completion_evidence_invalid');
  }
  for (const p of Array.isArray(c.required_pages) ? c.required_pages : []) if (!names.has(p) && !(c.operation === 'continue_build' && Array.isArray(c.recipe?.steps) && c.recipe.steps.some(s => s.path === p))) errors.push('scope_incomplete');
  if (!(Array.isArray(c.files) ? c.files : []).some(f => f.source_path === packet.selected_artifacts?.[0]?.source_artifact_path)) errors.push('selected_source_missing');
  if (packet.boundary?.deploy_authorized === true || packet.boundary?.external_mutation_allowed === true) errors.push('production_boundary');
  return [...new Set(errors)];
}
export function safePublicPath(value) {
  return typeof value === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:html|css|js|png|jpg|jpeg|webp|svg|ico|woff2|txt)$/.test(value)
    && !value.includes('..');
}
