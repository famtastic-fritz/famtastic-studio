import { canonicalDigest, canonicalJson } from './canonical.js';
import { phase2Failure } from './errors.js';
import { phase2MaxInputBytes } from './gcs-artifacts.js';
import { packetReference } from './staging-packet.js';
import { createPhase2WorkEnvelope } from './work-envelope.js';

export const PHASE2_SOURCE_SCHEMA = 'famtastic.execution.phase2-source.v1';

const SOURCE_FIELDS = ['schema', 'intake_packet_digest', 'packet'];

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, fields) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sourceFailure(code, message, statusCode = 409) {
  return phase2Failure(statusCode, code, message);
}

export function createPhase2RuntimeSource(packet) {
  const safePacket = packetReference(packet);
  const packetDigest = canonicalDigest(packet);
  const output = JSON.parse(canonicalJson({
    schema: PHASE2_SOURCE_SCHEMA,
    intake_packet_digest: packetDigest,
    packet: safePacket,
  }));
  const bytes = Buffer.byteLength(canonicalJson(output), 'utf8');
  if (bytes < 1 || bytes > phase2MaxInputBytes) {
    throw sourceFailure(
      'phase2_source_too_large',
      'Projected Phase 2 source exceeds the worker input boundary',
      413,
    );
  }
  return Object.freeze({
    output: Object.freeze(output),
    packet_digest: packetDigest,
    sha256: canonicalDigest(output),
    bytes,
  });
}

export function assertPhase2RuntimeSource(value, envelope) {
  if (!exactFields(value, SOURCE_FIELDS)
    || value.schema !== PHASE2_SOURCE_SCHEMA
    || value.intake_packet_digest !== envelope.packet_digest
    || !plainObject(value.packet)) {
    throw sourceFailure('phase2_source_wrapper_invalid', 'Source wrapper does not match the Phase 2 contract');
  }
  let safePacket;
  try {
    safePacket = packetReference({
      ...value.packet,
      idempotency_key: envelope.idempotency_key,
    });
  } catch {
    throw sourceFailure('phase2_source_projection_invalid', 'Projected source packet is invalid');
  }
  if (canonicalJson(safePacket) !== canonicalJson(value.packet)) {
    throw sourceFailure('phase2_source_projection_invalid', 'Projected source packet contains fields outside the allowlist');
  }
  if (safePacket.packet_id !== envelope.packet_id
    || safePacket.request_id !== envelope.request_id
    || safePacket.project_id !== envelope.project_id
    || safePacket.artifact_manifest_sha256 !== envelope.artifact_manifest_sha256
    || safePacket.selected_direction_ids[0] !== envelope.selected_direction_id) {
    throw sourceFailure('phase2_source_identity_mismatch', 'Projected source packet does not match its work envelope');
  }
  return safePacket;
}

export async function reconcilePhase2RuntimeSources({
  store,
  sourceStore,
  pilotRunId,
  limit,
} = {}) {
  const candidates = await store.listReservedAdmissions({ pilotRunId, limit });
  const result = {
    considered: candidates.length,
    finalized: [],
    expired: [],
    invalid: [],
    pending: [],
    errors: [],
  };
  for (const candidate of candidates) {
    let source;
    try {
      source = await sourceStore.readDeterministic({
        jobId: candidate.identity.job_id,
        logicalKey: 'staging-packet',
        version: 1,
      });
    } catch (error) {
      result.errors.push({
        job_id: candidate.identity.job_id,
        code: error?.code || 'phase2_source_recovery_unavailable',
      });
      continue;
    }
    if (!source) {
      try {
        const expired = await store.expireWorkAdmission({
          jobId: candidate.identity.job_id,
          pilotRunId,
          sourceConfirmedMissing: true,
          reason: 'Deterministic admission source remained missing through the recovery window',
        });
        result.expired.push(expired.job_id);
      } catch (error) {
        if (['admission_recovery_active', 'admission_not_expirable'].includes(error?.code)) {
          result.pending.push(candidate.identity.job_id);
        } else {
          result.errors.push({
            job_id: candidate.identity.job_id,
            code: error?.code || 'phase2_admission_expiration_failed',
          });
        }
      }
      continue;
    }
    let sourceDocument;
    try {
      const sourceBody = source.body.toString('utf8');
      sourceDocument = JSON.parse(sourceBody);
      if (canonicalJson(sourceDocument) !== sourceBody
        || source.bytes !== Buffer.byteLength(sourceBody, 'utf8')
        || source.sha256 !== canonicalDigest(sourceDocument)
        || !source.artifact_ref.startsWith(`gs://${sourceStore.bucket_name}/`)) {
        throw sourceFailure('phase2_source_encoding_invalid', 'Recovered source is not canonical JSON');
      }
      assertPhase2RuntimeSource(sourceDocument, candidate.identity);
    } catch {
      try {
        const failed = await store.failWorkAdmission({
          jobId: candidate.identity.job_id,
          pilotRunId,
          failureClass: 'admission_source_invalid',
          reason: 'Deterministic admission source failed exact wrapper validation',
          sourceConfirmedInvalid: true,
        });
        result.invalid.push(failed.job_id);
      } catch (error) {
        if (error?.code === 'admission_not_failurable') result.pending.push(candidate.identity.job_id);
        else result.errors.push({
          job_id: candidate.identity.job_id,
          code: error?.code || 'phase2_admission_failure_record_failed',
        });
      }
      continue;
    }
    try {
      const envelope = createPhase2WorkEnvelope({
        ...candidate.identity,
        source: {
          ref: source.artifact_ref,
          sha256: source.sha256,
          bytes: source.bytes,
        },
      });
      const accepted = await store.finalizeWorkAdmission({
        envelope,
        siteId: candidate.identity.site_id,
        pilotRunId,
        idempotencyKey: candidate.identity.idempotency_key,
      });
      result.finalized.push(accepted.job_id);
    } catch (error) {
      result.errors.push({
        job_id: candidate.identity.job_id,
        code: error?.code || 'phase2_source_recovery_invalid',
      });
    }
  }
  return result;
}
