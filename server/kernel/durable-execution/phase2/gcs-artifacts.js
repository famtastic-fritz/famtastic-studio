import crypto from 'node:crypto';

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUCKET_RE = /^(?!goog)[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const GENERATION_RE = /^[1-9][0-9]{0,30}$/;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const IMMUTABLE_WRITE_TIMEOUT_MS = 60_000;

function failure(statusCode, code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { statusCode, code });
}

function safeSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT_RE.test(value)) {
    throw failure(400, 'gcs_artifact_identity_invalid', `${label} is not a safe identifier`);
  }
  return value;
}

function safePrefix(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/')) {
    throw failure(400, 'gcs_artifact_config_invalid', 'GCS prefix must be a nonempty relative path');
  }
  const segments = value.split('/');
  if (!segments.every((segment) => SAFE_SEGMENT_RE.test(segment))) {
    throw failure(400, 'gcs_artifact_config_invalid', 'GCS prefix contains an unsafe segment');
  }
  return segments.join('/');
}

function normalizeJson(value, seen = new WeakSet(), depth = 0) {
  if (depth > 64) throw failure(400, 'artifact_output_invalid', 'Artifact output exceeds the maximum JSON depth');
  if (value === null) return null;
  if (value === undefined) {
    throw failure(400, 'artifact_output_invalid', 'Artifact output must not contain undefined values');
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw failure(400, 'artifact_output_invalid', 'Artifact output contains a non-finite number');
    return value;
  }
  if (typeof value !== 'object') {
    throw failure(400, 'artifact_output_invalid', 'Artifact output must contain only JSON values');
  }
  if (seen.has(value)) throw failure(400, 'artifact_output_invalid', 'Artifact output contains a cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1
        || keys.some((key, index) => (index < value.length ? key !== String(index) : key !== 'length'))) {
        throw failure(400, 'artifact_output_invalid', 'Artifact output arrays must be dense JSON arrays');
      }
      return value.map((item) => normalizeJson(item, seen, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw failure(400, 'artifact_output_invalid', 'Artifact output must use plain JSON objects');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string'
      || !Object.prototype.propertyIsEnumerable.call(value, key)
      || typeof Object.getOwnPropertyDescriptor(value, key)?.get === 'function'
      || typeof Object.getOwnPropertyDescriptor(value, key)?.set === 'function')) {
      throw failure(400, 'artifact_output_invalid', 'Artifact output must use plain enumerable JSON fields');
    }
    return Object.fromEntries(keys.sort().map((key) => {
      if (!key || key.length > 256 || key.includes('\0')) {
        throw failure(400, 'artifact_output_invalid', 'Artifact output contains an invalid object key');
      }
      return [key, normalizeJson(value[key], seen, depth + 1)];
    }));
  } finally {
    seen.delete(value);
  }
}

function canonicalBytes(value) {
  const bytes = Buffer.from(JSON.stringify(normalizeJson(value)), 'utf8');
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    throw failure(413, 'artifact_too_large', 'Artifact output exceeds 10 MiB');
  }
  return bytes;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function firstResponse(value) {
  return Array.isArray(value) ? value[0] : value;
}

function metadataGeneration(metadata) {
  const generation = metadata?.generation;
  const value = typeof generation === 'bigint' ? generation.toString() : String(generation || '');
  if (!GENERATION_RE.test(value)) {
    throw failure(503, 'gcs_artifact_generation_invalid', 'GCS did not return a valid immutable generation');
  }
  return value;
}

function preconditionFailed(error) {
  return error?.code === 412 || error?.statusCode === 412 || error?.status === 412;
}

function objectNotFound(error) {
  return error?.code === 404 || error?.statusCode === 404 || error?.status === 404;
}

function downloadBytes(value) {
  const body = firstResponse(value);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw failure(503, 'gcs_artifact_read_invalid', 'GCS did not return artifact bytes');
}

function exactMetadata(metadata, expectedBytes, expectedGeneration = null) {
  const generation = metadataGeneration(metadata);
  if (expectedGeneration !== null && generation !== expectedGeneration) {
    throw failure(409, 'artifact_identity_conflict', 'GCS artifact generation does not match its reference');
  }
  if (Number(metadata?.size) !== expectedBytes) {
    throw failure(409, 'artifact_identity_conflict', 'GCS artifact size does not match the declared identity');
  }
  if (metadata?.contentEncoding) {
    throw failure(409, 'artifact_identity_conflict', 'Encoded GCS artifacts are not accepted');
  }
  return generation;
}

export function createGcsArtifactStore({ storage, bucketName, prefix = 'phase2' } = {}) {
  if (!storage || typeof storage.bucket !== 'function') {
    throw failure(500, 'gcs_client_invalid', 'An injected GCS client is required');
  }
  if (typeof bucketName !== 'string'
    || !BUCKET_RE.test(bucketName)
    || bucketName.includes('..')
    || /^\d+(?:\.\d+){3}$/.test(bucketName)) {
    throw failure(400, 'gcs_artifact_config_invalid', 'GCS bucket name is invalid');
  }
  const safeRoot = safePrefix(prefix);
  const bucket = storage.bucket(bucketName);
  if (!bucket || typeof bucket.file !== 'function') {
    throw failure(500, 'gcs_client_invalid', 'Injected GCS bucket must provide file handles');
  }

  function artifactRef(objectName, generation) {
    return `gs://${bucketName}/${objectName}#${generation}`;
  }

  function parseArtifactRef(reference) {
    if (typeof reference !== 'string' || reference.length > 1024) {
      throw failure(400, 'gcs_artifact_ref_invalid', 'A generation-pinned GCS artifact reference is required');
    }
    const root = `gs://${bucketName}/`;
    if (!reference.startsWith(root) || reference.includes('%') || reference.includes('?') || reference.includes('\\')) {
      throw failure(400, 'gcs_artifact_ref_invalid', 'Artifact reference is outside the configured GCS boundary');
    }
    const remainder = reference.slice(root.length);
    const marker = remainder.lastIndexOf('#');
    if (marker <= 0 || remainder.indexOf('#') !== marker) {
      throw failure(400, 'gcs_artifact_ref_invalid', 'Artifact reference must include exactly one GCS generation');
    }
    const objectName = remainder.slice(0, marker);
    const generation = remainder.slice(marker + 1);
    if (!GENERATION_RE.test(generation)
      || !objectName.startsWith(`${safeRoot}/`)
      || !objectName.split('/').every((segment) => SAFE_SEGMENT_RE.test(segment))) {
      throw failure(400, 'gcs_artifact_ref_invalid', 'Artifact reference is outside the configured GCS boundary');
    }
    return { objectName, generation };
  }

  async function readPinned(objectName, { expectedBytes, expectedSha256, expectedGeneration = null }) {
    const baseFile = bucket.file(objectName, expectedGeneration ? { generation: expectedGeneration } : undefined);
    let metadata;
    try {
      metadata = firstResponse(await baseFile.getMetadata());
    } catch (error) {
      throw failure(503, 'gcs_artifact_metadata_unavailable', 'GCS artifact metadata could not be verified', error);
    }
    const generation = exactMetadata(metadata, expectedBytes, expectedGeneration);
    const pinnedFile = expectedGeneration
      ? baseFile
      : bucket.file(objectName, { generation });
    let body;
    try {
      body = downloadBytes(await pinnedFile.download());
    } catch (error) {
      if (error?.code === 'gcs_artifact_read_invalid') throw error;
      throw failure(503, 'gcs_artifact_read_unavailable', 'GCS artifact bytes could not be verified', error);
    }
    if (body.length !== expectedBytes || digest(body) !== expectedSha256) {
      throw failure(409, 'artifact_identity_conflict', 'GCS artifact bytes do not match the declared identity');
    }
    return { generation, body };
  }

  async function write({ jobId, logicalKey = 'phase2-result', version = 1, output } = {}) {
    const job = safeSegment(jobId, 'jobId');
    const logical = safeSegment(logicalKey, 'logicalKey');
    if (!Number.isInteger(version) || version < 1 || version > 100) {
      throw failure(400, 'gcs_artifact_identity_invalid', 'Artifact version must be an integer from 1 through 100');
    }
    const body = canonicalBytes(output);
    const sha256 = digest(body);
    const objectName = `${safeRoot}/jobs/${job}/artifacts/${logical}-v${version}.json`;
    const file = bucket.file(objectName);
    let deduplicated = false;
    let ambiguousWriteError = null;
    try {
      await file.save(body, {
        resumable: false,
        timeout: IMMUTABLE_WRITE_TIMEOUT_MS,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-store, max-age=0',
          metadata: {
            'famtastic-sha256': sha256,
            'famtastic-bytes': String(body.length),
          },
        },
      });
    } catch (error) {
      deduplicated = true;
      if (!preconditionFailed(error)) ambiguousWriteError = error;
    }

    let verified;
    try {
      verified = await readPinned(objectName, {
        expectedBytes: body.length,
        expectedSha256: sha256,
      });
    } catch (verificationError) {
      if (verificationError?.code === 'artifact_identity_conflict') throw verificationError;
      if (ambiguousWriteError) {
        throw failure(503, 'gcs_artifact_write_failed', 'GCS artifact create failed and could not be recovered', ambiguousWriteError);
      }
      throw verificationError;
    }
    return {
      logical_key: logical,
      version,
      artifact_ref: artifactRef(objectName, verified.generation),
      sha256,
      bytes: body.length,
      generation: verified.generation,
      deduplicated,
      recovered_after_write_error: Boolean(ambiguousWriteError),
    };
  }

  async function readExact({ artifactRef: reference, sha256, bytes } = {}) {
    if (!SHA256_RE.test(sha256 || '')) {
      throw failure(400, 'gcs_artifact_identity_invalid', 'Expected artifact SHA-256 is invalid');
    }
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > MAX_INPUT_BYTES) {
      throw failure(413, 'gcs_input_too_large', 'Input artifact bytes must be an integer no greater than 1 MiB');
    }
    const parsed = parseArtifactRef(reference);
    const verified = await readPinned(parsed.objectName, {
      expectedBytes: bytes,
      expectedSha256: sha256,
      expectedGeneration: parsed.generation,
    });
    return {
      artifact_ref: reference,
      sha256,
      bytes,
      generation: verified.generation,
      body: verified.body,
    };
  }

  async function readDeterministic({ jobId, logicalKey = 'phase2-result', version = 1 } = {}) {
    const job = safeSegment(jobId, 'jobId');
    const logical = safeSegment(logicalKey, 'logicalKey');
    if (!Number.isInteger(version) || version < 1 || version > 100) {
      throw failure(400, 'gcs_artifact_identity_invalid', 'Artifact version must be an integer from 1 through 100');
    }
    const objectName = `${safeRoot}/jobs/${job}/artifacts/${logical}-v${version}.json`;
    const file = bucket.file(objectName);
    let metadata;
    try {
      metadata = firstResponse(await file.getMetadata());
    } catch (error) {
      if (objectNotFound(error)) return null;
      throw failure(503, 'gcs_artifact_metadata_unavailable', 'GCS artifact metadata could not be verified', error);
    }
    const bytes = Number(metadata?.size);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_INPUT_BYTES) {
      throw failure(413, 'gcs_input_too_large', 'Deterministic input artifact must be from 1 byte through 1 MiB');
    }
    const generation = exactMetadata(metadata, bytes);
    const pinnedFile = bucket.file(objectName, { generation });
    let body;
    try {
      body = downloadBytes(await pinnedFile.download());
    } catch (error) {
      if (error?.code === 'gcs_artifact_read_invalid') throw error;
      throw failure(503, 'gcs_artifact_read_unavailable', 'GCS artifact bytes could not be verified', error);
    }
    if (body.length !== bytes) {
      throw failure(409, 'artifact_identity_conflict', 'GCS artifact bytes do not match their metadata');
    }
    const sha256 = digest(body);
    return {
      logical_key: logical,
      version,
      artifact_ref: artifactRef(objectName, generation),
      sha256,
      bytes,
      generation,
      body,
    };
  }

  return Object.freeze({ write, readExact, readDeterministic, bucket_name: bucketName, prefix: safeRoot });
}

export { MAX_INPUT_BYTES as phase2MaxInputBytes };
