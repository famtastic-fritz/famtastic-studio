import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture, html } from './staging-worker-fixture.mjs';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { CREDIT_RECEIPT_PATH, deriveSelectedReviewArtifact, selectedReviewArtifact, assertSelectedReviewRights } from '../server/kernel/selected-review-artifact.js';
import { creditSourceProjection, matchesSourceArtifact, sourcePathsMatch } from '../server/kernel/selected-credit-source.js';
import { creatorLogoAsset, CREATOR_LOGO_SHA256 } from '../vendor/site-foundation/index.js';

const bundle = () => createArtifactBundle([{ path: 'index.html', contents: html }]);
function source() {
  const original = bundle(), expected = deriveSelectedReviewArtifact(original);
  return { spec_snapshot: { artifact_bundle: original }, provenance: { creator_credit_transform: expected.credit },
    files: expected.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) };
}
let f;
afterEach(() => { f?.cleanup(); f = null; });

it('retains the immutable source and exact binary logo, never publishing its receipt', () => {
  const original = bundle(), before = JSON.stringify(original), expected = deriveSelectedReviewArtifact(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(expected.files).toHaveLength(2);
  const logo = expected.files.find(f => f.path.endsWith('.png'));
  expect(logo.sha256).toBe(CREATOR_LOGO_SHA256);
  expect(Buffer.from(logo.content_base64, 'base64')).toEqual(creatorLogoAsset().contents);
  expect(expected.files.some(f => f.path === CREDIT_RECEIPT_PATH)).toBe(false);
  expect(expected.credit).toMatchObject({ publication_authorized: false, customer_acceptance_changed: false, original_approval_unchanged: true });
});
it('requires the exact private receipt for a built derivative', () => {
  f = fixture(); const original = bundle(), expected = deriveSelectedReviewArtifact(original);
  const job = { selected: { artifact_bundle: original }, build: { site_id: 'project-42' } };
  expect(() => selectedReviewArtifact(job, f.paths)).toThrow('creator_credit_receipt_mismatch');
  fs.mkdirSync(f.paths.within('sites', 'project-42', '.famtastic'), { recursive: true });
  const receipt = f.paths.within('sites', 'project-42', CREDIT_RECEIPT_PATH);
  fs.writeFileSync(receipt, JSON.stringify({ ...expected.credit, publication_authorized: true }, null, 2) + '\n');
  expect(() => selectedReviewArtifact(job, f.paths)).toThrow('creator_credit_receipt_mismatch');
  fs.writeFileSync(receipt, JSON.stringify(expected.credit, null, 2) + '\n');
  expect(selectedReviewArtifact(job, f.paths)).toEqual(expected);
});
it('maps only verified original or exact derived bytes across a repeated selection', () => {
  const record = source(), projection = creditSourceProjection(record);
  const current = record.files.find(f => f.path === 'index.html');
  expect(matchesSourceArtifact(current, projection.originals[0], projection)).toBe(true);
  expect(matchesSourceArtifact(current, current, projection)).toBe(true);
  expect(matchesSourceArtifact(current, { ...projection.originals[0], bytes: 1 }, projection)).toBe(false);
  expect(matchesSourceArtifact(current, { ...projection.originals[0], sha256: '0'.repeat(64) }, projection)).toBe(false);
  expect(sourcePathsMatch(['index.html'], record, projection)).toBe(true);
  expect(sourcePathsMatch([], record, projection)).toBe(false);
  expect(sourcePathsMatch(['index.html', 'extra.html'], record, projection)).toBe(false);
});
it.each(['receipt', 'derived', 'original', 'extra'])('rejects %s tampering in finalized credit provenance', field => {
  const record = source();
  if (field === 'receipt') record.provenance.creator_credit_transform.customer_acceptance_changed = true;
  if (field === 'derived') record.files[0].sha256 = '0'.repeat(64);
  if (field === 'original') record.spec_snapshot.artifact_bundle.files[0].sha256 = '0'.repeat(64);
  if (field === 'extra') record.files.push({ path: 'backdoor.js', sha256: '0'.repeat(64), bytes: 1 });
  expect(() => creditSourceProjection(record)).toThrow();
});
it('does not reinterpret a normal source record as a credit exception', () => {
  const original = bundle();
  expect(creditSourceProjection({ spec_snapshot: { artifact_bundle: original }, files: original.files })).toBeNull();
  expect(matchesSourceArtifact({ sha256: 'a', bytes: 2 }, { sha256: 'b', bytes: 2 }, null)).toBe(false);
});

it('does not let the footer mandate override exact-original source restrictions', () => {
  const original = bundle(), expected = deriveSelectedReviewArtifact(original);
  const packet = { artifacts: original.files, continuation: { files: [{ path: 'index.html', source_path: 'index.html',
    rights: { scope: 'protected_review_only', usage: 'exact_original_bytes' } }] } };
  expect(() => assertSelectedReviewRights(packet, expected.files)).toThrow('exact_original_transform_forbidden');
  expect(() => assertSelectedReviewRights(packet, original.files)).not.toThrow();
  const logo = expected.files.find(f => f.path.endsWith('.png'));
  const imagePacket = { artifacts: [logo], continuation: { files: [{ path: logo.path, source_path: logo.path,
    rights: { scope: 'protected_review_only', usage: 'exact_original_bytes' } }] } };
  expect(() => assertSelectedReviewRights(imagePacket, expected.files)).not.toThrow();
});
