import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { deriveSelectedReviewArtifact } from '../server/kernel/selected-review-artifact.js';
import { assertAssociatedCredit, projectSelectedCredit, selectedCreditPolicy } from '../server/kernel/selected-credit-policy.js';
import { verifySourceAssociation } from '../server/kernel/source-association.js';
import { appendCreatorCredit, creatorCreditRow, creatorLogoAsset } from '../vendor/site-foundation/index.js';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const html = '<!doctype html><html><head><title>Café 雪</title></head><body><main><h1>Original</h1></main></body></html>';
const artifact = text => ({ path: 'web/proofs/original.html', sha256: sha(text), bytes: Buffer.byteLength(text) });
function fixture(text = html) {
  const original = createArtifactBundle([{ path: 'index.html', contents: text }]);
  const expected = deriveSelectedReviewArtifact(original);
  const source = { spec_snapshot: { artifact_bundle: original }, files: expected.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    provenance: { creator_credit_transform: expected.credit } };
  const grant = { intent: { source: { artifacts: [artifact(text)] } }, creator_credit_projection: projectSelectedCredit(text, artifact(text)) };
  return { source, grant, original };
}
function signed(schema, projection) {
  const intent = { project_id: 'synthetic-project', customer_id: 'synthetic-owner', request_id: 'synthetic-request',
    source: { artifacts: [artifact(html)] }, scope: { snapshot_sha256: sha('{}'), snapshot_json: '{}' } };
  const p = { schema, association_id: 'a'.repeat(32), operation: 'associate_verified_source', audience: 'site-studio-next', issued_at: 1000, expires_at: 4600,
    ...Object.fromEntries(['project_id', 'customer_id', 'request_id'].map(k => [k, intent[k]])), scope_sha256: sha('{}'), intent,
    ...(projection ? { creator_credit_projection: projection } : {}) };
  const payload_json = JSON.stringify(p);
  return { payload_json, signature: crypto.createHmac('sha256', 'synthetic-secret').update(`${schema}\n${payload_json}`).digest('hex') };
}

it('pins the exact owner PNG and canonical row while keeping the original immutable', () => {
  const policy = selectedCreditPolicy(), logo = creatorLogoAsset();
  expect(sha(creatorCreditRow())).toBe(policy.row_sha256);
  expect(logo.contents.length).toBe(policy.system_asset.bytes);
  expect(sha(logo.contents)).toBe(policy.system_asset.sha256);
  const f = fixture(), before = JSON.stringify(f.original);
  expect(assertAssociatedCredit(f.source, f.grant)).toEqual(f.original);
  expect(JSON.stringify(f.original)).toBe(before);
  expect(f.grant.creator_credit_projection.derived_home.sha256).toBe(sha(appendCreatorCredit(html)));
  expect(f.grant.creator_credit_projection.policy).toMatchObject({ customer_acceptance_changed: false, publication_authorized: false });
});
it('allows only the pinned canonical identity projection, including case-insensitive closing tags', () => {
  for (const text of [appendCreatorCredit(html), appendCreatorCredit(html).replace('</body>', '</BODY>')]) {
    expect(projectSelectedCredit(text, artifact(text))).toMatchObject({ mode: 'identity', derived_home: { sha256: sha(text) } });
  }
});
it.each(['selected', 'derived', 'logo', 'original', 'original-length', 'receipt', 'policy', 'extra'])('rejects %s substitution without a wider source exception', field => {
  const f = fixture();
  if (field === 'selected') f.grant.intent.source.artifacts[0].sha256 = '0'.repeat(64);
  if (field === 'derived') f.source.files.find(f => f.path === 'index.html').sha256 = '0'.repeat(64);
  if (field === 'logo') f.source.files.find(f => f.path.endsWith('.png')).bytes++;
  if (field === 'original') f.source.spec_snapshot.artifact_bundle.files[0].content_base64 = Buffer.from('different').toString('base64');
  if (field === 'original-length') f.source.spec_snapshot.artifact_bundle.files[0].bytes++;
  if (field === 'receipt') f.source.provenance.creator_credit_transform = null;
  if (field === 'policy') f.grant.creator_credit_projection.policy.publication_authorized = true;
  if (field === 'extra') f.source.files.push({ path: 'backdoor.js', sha256: sha('x'), bytes: 1 });
  expect(() => assertAssociatedCredit(f.source, f.grant)).toThrow();
});
it('retains v1 domain separation and rejects unsigned, unknown or missing v2 policy', () => {
  const projection = projectSelectedCredit(html, artifact(html));
  expect(verifySourceAssociation(signed('famtastic.source-association.v1'), 'synthetic-secret', 1000).schema).toBe('famtastic.source-association.v1');
  const good = signed('famtastic.source-association.v2', projection);
  expect(verifySourceAssociation(good, 'synthetic-secret', 1000).creator_credit_projection).toEqual(projection);
  expect(() => verifySourceAssociation({ ...good, signature: signed('famtastic.source-association.v1').signature }, 'synthetic-secret', 1000)).toThrow('signature');
  expect(() => verifySourceAssociation(signed('famtastic.source-association.v2'), 'synthetic-secret', 1000)).toThrow('projection_mismatch');
  expect(() => verifySourceAssociation(signed('famtastic.source-association.v2', { ...projection, policy_sha256: '0'.repeat(64) }), 'synthetic-secret', 1000)).toThrow('projection_mismatch');
});
it.each([
  html.replace('</body>', '<div data-famtastic-creator-credit="1">Not the owner row</div></body>'),
  html.replace('</head>', '<base href="https://other.example.invalid/"></head>'),
  html.replace('<body>', '<body hidden>'),
  html.replace('</body>', '</body></body>'),
])('rejects ambiguous or inaccessible attribution instead of repairing it', text => {
  expect(() => projectSelectedCredit(text, artifact(text))).toThrow();
});

const php = process.env.SELECTED_CREDIT_POLICY_PHP;
it.skipIf(!php).each([html, html.replace('</body>', '</BODY>'), appendCreatorCredit(html)])('matches independent PHP projection bytes', text => {
  const result = execFileSync('php', ['-r', 'require $argv[1]; $v=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR); echo json_encode(\\Drupal\\famtastic_pipeline\\Service\\SelectedCreatorCreditProjection::project($v["html"],$v["artifact"]),JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);', php],
    { input: JSON.stringify({ html: text, artifact: artifact(text) }), encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual(projectSelectedCredit(text, artifact(text)));
});
