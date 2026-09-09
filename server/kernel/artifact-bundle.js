/**
 * Immutable proof artifact bundle crossing from FAMtastic Designs to Studio.
 *
 * The approved proof is already a rendered site. Re-composing it from prose is
 * the source of the visual drift this contract prevents. A bundle therefore
 * carries the exact HTML, CSS, JavaScript, and media bytes that were approved;
 * Studio verifies each digest and materializes those bytes without rewriting.
 */
import crypto from 'node:crypto';

export const ARTIFACT_BUNDLE_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\/-]+$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(message, details = {}) {
  return Object.assign(new Error(message), { code: 'invalid_artifact_bundle', details });
}

function decodeFile(file, index) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw fail(`files[${index}] must be an object`);
  if (typeof file.path !== 'string' || !SAFE_PATH.test(file.path)) throw fail(`files[${index}].path is not a safe relative path`);
  if (typeof file.content_base64 !== 'string' || file.content_base64.length === 0) throw fail(`files[${index}].content_base64 is required`);
  let bytes;
  try { bytes = Buffer.from(file.content_base64, 'base64'); } catch { throw fail(`files[${index}].content_base64 is not valid base64`); }
  if (bytes.length > MAX_FILE_BYTES) throw fail(`files[${index}] exceeds ${MAX_FILE_BYTES} byte limit`);
  if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail(`files[${index}].sha256 is required`);
  if (sha256(bytes) !== file.sha256) throw fail(`files[${index}] digest does not match content`);
  return { path: file.path, bytes };
}

export function validateArtifactBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return ['artifact_bundle: must be an object'];
  if (bundle.schema_version !== ARTIFACT_BUNDLE_SCHEMA_VERSION) errors.push(`artifact_bundle.schema_version: must equal ${ARTIFACT_BUNDLE_SCHEMA_VERSION}`);
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    errors.push('artifact_bundle.files: must contain at least one file');
    return errors;
  }
  let total = 0;
  const paths = new Set();
  let htmlCount = 0;
  bundle.files.forEach((file, i) => {
    try {
      const decoded = decodeFile(file, i);
      total += decoded.bytes.length;
      if (paths.has(decoded.path)) errors.push(`artifact_bundle.files[${i}].path: duplicate ${decoded.path}`);
      paths.add(decoded.path);
      if (/\.html?$/i.test(decoded.path)) htmlCount += 1;
    } catch (error) { errors.push(error.message); }
  });
  if (total > MAX_TOTAL_BYTES) errors.push(`artifact_bundle.files: total exceeds ${MAX_TOTAL_BYTES} byte limit`);
  if (htmlCount === 0) errors.push('artifact_bundle.files: at least one HTML page is required');
  return errors;
}

export function createArtifactBundle(files = []) {
  const encoded = files.map((file, index) => {
    if (!file || typeof file.path !== 'string') throw fail(`files[${index}].path is required`);
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(String(file.contents ?? ''), 'utf8');
    return { path: file.path, content_base64: bytes.toString('base64'), sha256: sha256(bytes), bytes: bytes.length };
  });
  const bundle = { schema_version: ARTIFACT_BUNDLE_SCHEMA_VERSION, files: encoded };
  const errors = validateArtifactBundle(bundle);
  if (errors.length) throw fail(errors.join('; '), errors);
  return bundle;
}

export function materializeArtifactBundle(bundle) {
  const errors = validateArtifactBundle(bundle);
  if (errors.length) throw fail(errors.join('; '), errors);
  return bundle.files.map((file) => {
    const bytes = Buffer.from(file.content_base64, 'base64');
    if (/\.html?$/i.test(file.path)) return { path: file.path, title: file.path, html: bytes.toString('utf8') };
    return { path: file.path, contents: bytes };
  });
}

