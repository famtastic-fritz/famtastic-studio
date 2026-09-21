import { deriveSelectedReviewArtifact } from './selected-review-artifact.js';

// Installation-owned, hash-verified finalized source may contain the exact
// mandatory footer derivative of an older selected bundle. Recompute it, never
// accept a caller's claimed transformation or a mere presence of a logo.
export function creditSourceProjection(record) {
  if (!record.provenance?.creator_credit_transform) return null;
  const original = record.spec_snapshot?.artifact_bundle;
  const expected = deriveSelectedReviewArtifact(original);
  const inventory = files => files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!expected.credit || JSON.stringify(expected.credit) !== JSON.stringify(record.provenance.creator_credit_transform)
    || JSON.stringify(inventory(expected.files)) !== JSON.stringify(inventory(record.files))) {
    throw Object.assign(new Error('creator_credit_source_binding_invalid'), { code: 'creator_credit_source_binding_invalid' });
  }
  return { originals: original.files, added: expected.files.filter(f => !original.files.some(o => o.path === f.path)) };
}

export function matchesSourceArtifact(file, artifact, projection) {
  if (artifact?.sha256 === file.sha256 && artifact?.bytes === file.bytes) return true;
  const original = projection?.originals.find(f => f.path === file.path);
  return !!original && artifact?.sha256 === original.sha256 && artifact?.bytes === original.bytes;
}

export function sourcePathsMatch(paths, record, projection) {
  const missing = projection?.added.map(f => f.path).filter(p => !paths.includes(p)) || [];
  return JSON.stringify([...paths, ...missing].sort()) === JSON.stringify(record.files.map(f => f.path).sort());
}
