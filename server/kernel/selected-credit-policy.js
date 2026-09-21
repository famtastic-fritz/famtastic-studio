import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { creatorCreditRow, appendCreatorCredit, CREATOR_LOGO_PATH } from '../../vendor/site-foundation/index.js';
import { materializeArtifactBundle } from './artifact-bundle.js';
import { creditSourceProjection } from './selected-credit-source.js';
import { creditNodes } from '../../vendor/site-foundation/credit-html.js';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(`source_association_credit_${code}`), { code: `source_association_credit_${code}` });

// Ordered, installation-owned policy. PHP hashes these same UTF-8 JSON bytes.
// This is not the agency's presentation decorator or a worker-supplied policy.
export function selectedCreditPolicy() {
  return {
    id: 'famtastic.canonical-root-credit.v1',
    foundation_commit: '2937a3bf58c52f146734b8779375ec884c6417ae',
    public_base_path: '/',
    row_sha256: '0cffde4586bb4dbc1c9163f5154b1f94f26e82e3c4f7541b840b67fb67566bc4',
    row_bytes: 694,
    system_asset: { path: CREATOR_LOGO_PATH, sha256: 'ebb0477344132d32e449ba19e2b622921585aa71af0decdbcf8abfbe033fa950', bytes: 2020725 },
    authorization: 'owner_creator_attribution_only',
    customer_acceptance_changed: false,
    publication_authorized: false,
  };
}

export function projectSelectedCredit(html, artifact) {
  if (typeof html !== 'string' || artifact?.sha256 !== sha(html) || artifact.bytes !== Buffer.byteLength(html)
    || typeof artifact.path !== 'string') throw fail('original_changed');
  const policy = selectedCreditPolicy(), row = creatorCreditRow();
  if (sha(row) !== policy.row_sha256 || Buffer.byteLength(row) !== policy.row_bytes) throw fail('policy_changed');
  if (Buffer.byteLength(html) > 25 * 1024 * 1024 || html.includes('\0') || (html.match(/<\/body>/gi) || []).length !== 1
    || !/<\/body>\s*(?:<\/html>\s*)?$/i.test(html)) throw fail('document_unsupported');
  const derived = appendCreatorCredit(html);
  // Identity is allowed only for the exact pinned final root row, never an
  // independently styled credit or a claimed equivalent version.
  if (derived.split(row).length !== 2 || !/^\n<\/body>\s*(?:<\/html>\s*)?$/i.test(derived.slice(derived.indexOf(row) + row.length))) throw fail('existing_unsupported');
  const nodes = creditNodes(derived), rows = nodes.filter(n => 'data-famtastic-creator-credit' in n.attrs);
  if (rows.length !== 1 || rows[0].parent?.tag !== 'body' || nodes.some(n => n.tag === 'base')) throw fail('document_unsupported');
  return {
    schema: 'famtastic.creator-credit-projection.v1', policy, policy_sha256: sha(JSON.stringify(policy)),
    mode: derived === html ? 'identity' : 'append_missing_root_row',
    original_home: { source_path: artifact.path, sha256: sha(html), bytes: Buffer.byteLength(html) },
    derived_home: { path: 'index.html', sha256: sha(derived), bytes: Buffer.byteLength(derived) },
  };
}

export function assertCreditPolicyHeader(projection, artifact) {
  const policy = selectedCreditPolicy();
  if (!projection || !isDeepStrictEqual(Object.keys(projection).sort(), ['schema', 'policy', 'policy_sha256', 'mode', 'original_home', 'derived_home'].sort())
    || projection.schema !== 'famtastic.creator-credit-projection.v1' || !isDeepStrictEqual(projection.policy, policy)
    || projection.policy_sha256 !== sha(JSON.stringify(policy)) || !['identity', 'append_missing_root_row'].includes(projection.mode)
    || !isDeepStrictEqual(projection.original_home, { source_path: artifact?.path, sha256: artifact?.sha256, bytes: artifact?.bytes })
    || !isDeepStrictEqual(Object.keys(projection.derived_home || {}).sort(), ['path', 'sha256', 'bytes'].sort())
    || projection.derived_home.path !== 'index.html' || !/^[a-f0-9]{64}$/.test(projection.derived_home.sha256)
    || !Number.isSafeInteger(projection.derived_home.bytes) || projection.derived_home.bytes < 1
    || projection.derived_home.bytes > 25 * 1024 * 1024 + policy.row_bytes + 1) throw fail('projection_mismatch');
}

// Validates an actually finalized source before QA, never accepting a receipt
// in place of original bytes. Export finalization already checked the Git tree.
export function assertAssociatedCredit(record, grant) {
  assertCreditPolicyHeader(grant.creator_credit_projection, grant.intent.source.artifacts[0]);
  const original = record.spec_snapshot?.artifact_bundle;
  const files = materializeArtifactBundle(original);
  if (original.files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes !== Buffer.from(file.content_base64, 'base64').length)) throw fail('original_changed');
  const home = files.find(f => f.path === 'index.html');
  const expected = projectSelectedCredit(home?.html, grant.intent.source.artifacts[0]);
  if (!isDeepStrictEqual(grant.creator_credit_projection, expected)) throw fail('projection_mismatch');
  const current = record.files.find(f => f.path === 'index.html');
  const logo = record.files.find(f => f.path === CREATOR_LOGO_PATH);
  if (!isDeepStrictEqual(current, expected.derived_home)) throw fail('home_changed');
  if (!isDeepStrictEqual(logo, expected.policy.system_asset)) throw fail('asset_changed');
  if (new Set(record.files.map(f => f.path)).size !== record.files.length) throw fail('manifest_invalid');
  if (expected.mode === 'append_missing_root_row' && !creditSourceProjection(record)) throw fail('receipt_required');
  return original;
}
