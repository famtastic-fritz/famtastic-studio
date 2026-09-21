import crypto from 'node:crypto';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function manifestDigest(artifacts) {
  const manifest = artifacts.map(({ bytes, path, role, sha256: digest }) => ({
    bytes, path, role, sha256: digest,
  })).sort((left, right) => left.path.localeCompare(right.path));
  return sha256(JSON.stringify(manifest));
}

export function phase2ProofPacket(number) {
  const suffix = String(number).padStart(2, '0');
  const directionId = `direction-${suffix}`;
  const preview = {
    role: 'selected_preview',
    path: `previews/${directionId}.png`,
    sha256: sha256(`preview-${suffix}`),
    bytes: 1000 + number,
  };
  const artifacts = [preview];
  return {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: `packet-${suffix}`,
    idempotency_key: `phase2-proof-${suffix}`,
    request_id: `request-${suffix}`,
    project_id: `project-${suffix}`,
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: [directionId],
    artifact_manifest_sha256: manifestDigest(artifacts),
    artifacts,
    selected_artifacts: [{
      direction_id: directionId,
      source_artifact_path: preview.path,
      source_artifact_sha256: preview.sha256,
      source_artifact_bytes: preview.bytes,
    }],
    boundary: { deploy_authorized: false },
  };
}
