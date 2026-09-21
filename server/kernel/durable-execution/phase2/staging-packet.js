import crypto from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { phase2Failure } from './errors.js';

const MAX_ARTIFACTS = 500;
const MAX_DECLARED_ARTIFACT_BYTES = 10 * 1024 * 1024 * 1024;
const PACKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeArtifactPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 500
    && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value)
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function artifactManifestDigest(artifacts) {
  const canonicalManifest = artifacts
    .map((artifact) => ({
      bytes: artifact?.bytes,
      path: artifact?.path,
      role: artifact?.role,
      sha256: artifact?.sha256,
    }))
    .sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')));
  return crypto.createHash('sha256').update(JSON.stringify(canonicalManifest)).digest('hex');
}

export function validateStagingPacket(packet) {
  const errors = [];
  if (!packet || packet.schema !== 'famtastic.site-studio.build-packet.v1') errors.push('packet.schema');
  for (const field of ['packet_id', 'idempotency_key', 'request_id', 'project_id', 'build_class']) {
    if (typeof packet?.[field] !== 'string' || !PACKET_ID_RE.test(packet[field])) errors.push(`packet.${field}`);
  }
  if (packet?.build_class !== 'prepayment_selected_direction_staging') errors.push('packet.build_class');
  if (!Array.isArray(packet?.selected_direction_ids)
    || packet.selected_direction_ids.length !== 1
    || !PACKET_ID_RE.test(packet.selected_direction_ids[0] || '')) {
    errors.push('packet.selected_direction_ids');
  }

  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts : [];
  if (!artifacts.length || artifacts.length > MAX_ARTIFACTS) errors.push('packet.artifacts');
  const paths = new Set();
  let declaredBytes = 0;
  for (const artifact of artifacts) {
    const artifactPath = artifact?.path;
    const valid = artifact
      && ['source_material', 'selected_preview', 'render_evidence'].includes(artifact.role)
      && safeArtifactPath(artifactPath)
      && /^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      && Number.isInteger(artifact.bytes)
      && artifact.bytes >= 0
      && artifact.bytes <= MAX_DECLARED_ARTIFACT_BYTES
      && !paths.has(artifactPath);
    if (!valid) errors.push('packet.artifacts');
    if (artifactPath) paths.add(artifactPath);
    if (Number.isInteger(artifact?.bytes) && artifact.bytes >= 0) declaredBytes += artifact.bytes;
  }
  if (declaredBytes > MAX_DECLARED_ARTIFACT_BYTES) errors.push('packet.artifacts');
  if (!/^[a-f0-9]{64}$/.test(packet?.artifact_manifest_sha256 || '')
    || packet.artifact_manifest_sha256 !== artifactManifestDigest(artifacts)) {
    errors.push('packet.artifact_manifest_sha256');
  }

  const selected = Array.isArray(packet?.selected_artifacts) ? packet.selected_artifacts : [];
  if (selected.length !== 1) {
    errors.push('packet.selected_artifacts');
  } else {
    const bound = selected[0];
    const matches = artifacts.filter((artifact) => artifact?.role === 'selected_preview'
      && artifact?.path === bound?.source_artifact_path
      && artifact?.sha256 === bound?.source_artifact_sha256
      && artifact?.bytes === bound?.source_artifact_bytes);
    if (bound?.direction_id !== packet.selected_direction_ids?.[0] || matches.length !== 1) {
      errors.push('packet.selected_artifacts');
    }
  }
  if (packet?.boundary?.deploy_authorized === true) errors.push('packet.boundary.deploy_authorized');
  const uniqueErrors = [...new Set(errors)];
  return { ok: uniqueErrors.length === 0, errors: uniqueErrors };
}

export function packetReference(packet) {
  const validation = validateStagingPacket(packet);
  if (!validation.ok) {
    throw phase2Failure(422, 'staging_packet_rejected', 'Staging packet failed Phase 1-compatible validation', validation);
  }
  const selectedArtifact = packet.selected_artifacts[0];
  return Object.freeze(JSON.parse(canonicalJson({
    schema: packet.schema,
    packet_id: packet.packet_id,
    request_id: packet.request_id,
    project_id: packet.project_id,
    build_class: packet.build_class,
    selected_direction_ids: packet.selected_direction_ids,
    artifact_manifest_sha256: packet.artifact_manifest_sha256,
    artifacts: packet.artifacts.map(({ role, path, sha256, bytes }) => ({ role, path, sha256, bytes })),
    selected_artifacts: [{
      direction_id: selectedArtifact.direction_id,
      source_artifact_path: selectedArtifact.source_artifact_path,
      source_artifact_sha256: selectedArtifact.source_artifact_sha256,
      source_artifact_bytes: selectedArtifact.source_artifact_bytes,
    }],
  })));
}
