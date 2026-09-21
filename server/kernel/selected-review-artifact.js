import fs from 'node:fs';
import { materializeArtifactBundle, createArtifactBundle } from './artifact-bundle.js';
import { creditComposition } from './creator-credit.js';
import { safePublicPath } from './staging-contract.js';
import { stagingError } from './staging-store.js';
import { decodeSourceExport } from './source-export-wire.js';
import { creditSourceProjection, matchesSourceArtifact } from './selected-credit-source.js';

export const CREDIT_RECEIPT_PATH = '.famtastic/creator-credit-transform.json';

// Recompute only the owner's narrow, deterministic credit transform from the
// immutable selection. Never use arbitrary build output as its own QA baseline.
// No research, model, site write, new design or new customer acceptance occurs.
export function deriveSelectedReviewArtifact(original) {
  const materialized = materializeArtifactBundle(original);
  const expected = creditComposition({
    pages: materialized.filter(f => 'html' in f),
    assets: materialized.filter(f => 'contents' in f),
  }, { immutable: true, public_base_path: original.public_base_path || '/' });
  const credit = expected.creator_credit_transform || null;
  const files = [...expected.pages.map(f => ({ path: f.path, contents: f.html })), ...expected.assets]
    .filter(f => !(credit && f.path === CREDIT_RECEIPT_PATH));
  if (files.some(f => !safePublicPath(f.path))) throw stagingError('public_file_rejected');
  return { files: createArtifactBundle(files.map(f => ({ path: f.path,
    bytes: Buffer.isBuffer(f.contents) ? f.contents : Buffer.from(f.contents),
  }))).files, credit };
}

export function selectedReviewArtifact(job, paths) {
  let original = job.selected.artifact_bundle;
  if (!job.build) return { files: original.files, credit: null }; // Source-only QA.
  if (job.build.reused_existing_source) {
    const source = decodeSourceExport(job.build.source_export);
    const projection = creditSourceProjection(source);
    if (projection) {
      for (const file of original.files) {
        const current = source.files.find(f => f.path === file.path);
        if (!current || !matchesSourceArtifact(current, file, projection)) throw stagingError('creator_credit_reused_source_mismatch');
      }
      original = source.spec_snapshot.artifact_bundle;
    }
  }
  const result = deriveSelectedReviewArtifact(original);
  assertSelectedReviewRights(job.packet, result.files);
  if (result.credit) {
    const receiptPath = paths.within('sites', job.build.site_id || `project-${job.packet.project_id}`, CREDIT_RECEIPT_PATH);
    const expectedBytes = Buffer.from(JSON.stringify(result.credit, null, 2) + '\n');
    if (!fs.existsSync(receiptPath) || !fs.lstatSync(receiptPath).isFile()
      || !fs.readFileSync(receiptPath).equals(expectedBytes)) throw stagingError('creator_credit_receipt_mismatch');
  }
  return result;
}

export function assertSelectedReviewRights(packet, files) {
  for (const restricted of packet?.continuation?.files || []) {
    if (restricted.rights?.scope !== 'protected_review_only' || restricted.rights?.usage !== 'exact_original_bytes') continue;
    const original = packet.artifacts.find(f => f.path === restricted.source_path);
    const output = files.find(f => f.path === restricted.path);
    if (!original || !output || original.sha256 !== output.sha256 || original.bytes !== output.bytes) {
      throw Object.assign(stagingError('exact_original_transform_forbidden'), { permanent: true });
    }
  }
}
