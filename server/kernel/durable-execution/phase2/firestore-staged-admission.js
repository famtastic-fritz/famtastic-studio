import {
  PHASE_TAG,
  assertPhase2,
  boundedInteger,
  canonicalJson,
  deterministicDocumentId,
  envelopeDigest,
  exactBoolean,
  idempotencyDocumentId,
  requiredString,
  snapshotData,
  snapshotRows,
  storeFailure,
  validateControls,
} from './firestore-values.js';
import { assertPhase2WorkEnvelope } from './work-envelope.js';

const IDENTITY_FIELDS = [
  'site_id', 'pilot_run_id', 'job_id', 'task_id', 'packet_id',
  'idempotency_key', 'request_id', 'project_id', 'packet_digest',
  'artifact_manifest_sha256', 'selected_direction_id',
];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const ADMISSION_RECOVERY_MS = 15 * 60 * 1000;

function admissionIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...IDENTITY_FIELDS].sort().join('\0')) {
    throw storeFailure(422, 'admission_identity_invalid', 'Admission identity fields do not match the Phase 2 contract');
  }
  for (const key of ['pilot_run_id', 'job_id', 'task_id', 'packet_id', 'idempotency_key', 'request_id', 'project_id', 'selected_direction_id']) {
    requiredString(value[key], `identity.${key}`, { max: 128, pattern: ID_RE });
  }
  requiredString(value.site_id, 'identity.site_id', { max: 63, pattern: SITE_RE });
  requiredString(value.packet_digest, 'identity.packet_digest', { max: 64, pattern: SHA_RE });
  requiredString(value.artifact_manifest_sha256, 'identity.artifact_manifest_sha256', { max: 64, pattern: SHA_RE });
  return Object.freeze(JSON.parse(canonicalJson(value)));
}

function identityFromEnvelope(envelope) {
  return admissionIdentity(Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, envelope[key]])));
}

function acceptance(job, outbox, duplicate) {
  return {
    job_id: job.job_id, task_id: job.task_id, receipt_id: job.receipt_id,
    intent_id: job.intent_id, site_id: job.site_id, packet_id: job.packet_id,
    request_id: job.request_id, project_id: job.project_id,
    idempotency_key: job.idempotency_key, envelope_digest: job.envelope_digest,
    packet_digest: job.packet_digest, state: job.state,
    dispatch_state: outbox?.state || 'missing',
    dispatch_generation: outbox?.dispatch_generation || null, duplicate,
  };
}

function assertCallerBinding(identity, { siteId, pilotRunId, idempotencyKey }) {
  requiredString(siteId, 'siteId', { max: 200 });
  requiredString(pilotRunId, 'pilotRunId', { max: 128 });
  requiredString(idempotencyKey, 'idempotencyKey', { max: 200 });
  if (siteId !== identity.site_id || pilotRunId !== identity.pilot_run_id
    || idempotencyKey !== identity.idempotency_key) {
    throw storeFailure(409, 'work_envelope_binding_mismatch', 'Caller scope does not match the Phase 2 admission identity');
  }
}

export function createStagedAdmissionOperations(context) {
  const { db, refs, at, iso, nextId } = context;

  async function reserveWorkAdmission({
    identityWithoutSource, siteId, pilotRunId, idempotencyKey,
    maxAttempts = 3, maxDispatchGenerations = 10, jobMaxCostMicros = 0,
  } = {}) {
    const identity = admissionIdentity(identityWithoutSource);
    assertCallerBinding(identity, { siteId, pilotRunId, idempotencyKey });
    boundedInteger(maxAttempts, 'maxAttempts', { min: 1, max: 10 });
    boundedInteger(maxDispatchGenerations, 'maxDispatchGenerations', { min: 1, max: 50 });
    boundedInteger(jobMaxCostMicros, 'jobMaxCostMicros', { min: 1 });
    const identityDigest = envelopeDigest(identity);
    const keyId = idempotencyDocumentId(siteId, idempotencyKey);
    const receiptId = nextId('receipt');
    const intentId = deterministicDocumentId('intent', identity.job_id);
    return db.runTransaction(async (tx) => {
      const now = at();
      const [keySnapshot, controlSnapshot, budgetSnapshot] = await Promise.all([
        tx.get(refs.idempotency(keyId)), tx.get(refs.control()), tx.get(refs.budget(pilotRunId)),
      ]);
      const controls = validateControls(snapshotData(controlSnapshot));
      const budget = assertPhase2(snapshotData(budgetSnapshot), 'Execution budget');
      if (controls.global_pause !== false) {
        throw storeFailure(423, 'execution_paused', 'Durable execution admission is globally paused');
      }
      if (controls.active_pilot_run_id !== pilotRunId || budget.pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Admission is outside the active pilot run');
      }
      const binding = snapshotData(keySnapshot);
      if (binding) {
        assertPhase2(binding, 'Idempotency binding');
        if (binding.pilot_run_id !== pilotRunId) {
          throw storeFailure(409, 'pilot_scope_conflict', 'Idempotency key belongs to a different pilot run');
        }
        if (binding.identity_digest !== identityDigest || binding.packet_digest !== identity.packet_digest) {
          throw storeFailure(409, 'idempotency_conflict', 'The idempotency key is bound to different work content');
        }
        if (['expired', 'failed'].includes(binding.state)) {
          throw storeFailure(410, 'admission_terminal', 'Admission reservation is terminal and cannot be reused');
        }
        const job = assertPhase2(snapshotData(await tx.get(refs.job(binding.job_id))), 'Execution job');
        if (binding.state === 'finalized') {
          const outbox = snapshotData(await tx.get(refs.outbox(binding.intent_id)));
          return { finalized: true, identity, acceptance: acceptance(job, outbox, true) };
        }
        if (binding.state !== 'reserved' || job.state !== 'admission_reserved') {
          throw storeFailure(503, 'admission_reservation_corrupt', 'Admission reservation state is invalid');
        }
        if (!Number.isSafeInteger(job.admission_reservation_generation)
          || job.admission_reservation_generation < 1
          || binding.admission_reservation_generation !== job.admission_reservation_generation
          || binding.admission_expires_at_ms !== job.admission_expires_at_ms) {
          throw storeFailure(503, 'admission_reservation_corrupt', 'Admission recovery lease is invalid');
        }
        const reservationGeneration = job.admission_reservation_generation + 1;
        const expiresAt = now + ADMISSION_RECOVERY_MS;
        tx.update(refs.job(job.job_id), {
          admission_reservation_generation: reservationGeneration,
          admission_expires_at_ms: expiresAt, updated_at_ms: now,
        });
        tx.update(refs.idempotency(keyId), {
          admission_reservation_generation: reservationGeneration,
          admission_expires_at_ms: expiresAt, updated_at_ms: now,
        });
        return {
          finalized: false, identity, acceptance: null,
          reservation_generation: reservationGeneration, expires_at_ms: expiresAt,
        };
      }
      if (budget.accepted_jobs >= budget.max_jobs) {
        throw storeFailure(429, 'pilot_job_cap_reached', 'The Phase 2 pilot job cap has been reached');
      }
      const job = {
        phase_tag: PHASE_TAG, pilot_run_id: pilotRunId,
        ...identity, receipt_id: receiptId, intent_id: intentId,
        identity_digest: identityDigest, envelope_digest: null,
        envelope_ref_json: null, source_ref: null, source_bytes: null,
        state: 'admission_reserved', max_attempts: maxAttempts, attempts_started: 0,
        max_dispatch_generations: maxDispatchGenerations,
        max_cost_micros: jobMaxCostMicros, reserved_cost_micros: 0,
        settled_cost_micros: 0, uncertain_cost_micros: 0,
        available_at_ms: now, lease_owner: null, lease_token: null,
        lease_expires_at_ms: null, fencing_token: 0,
        admission_reservation_generation: 1,
        admission_expires_at_ms: now + ADMISSION_RECOVERY_MS,
        created_at_ms: now, updated_at_ms: now,
      };
      tx.create(refs.idempotency(keyId), {
        phase_tag: PHASE_TAG, pilot_run_id: pilotRunId,
        site_id: siteId, idempotency_key: idempotencyKey,
        identity_digest: identityDigest, packet_digest: identity.packet_digest,
        job_id: identity.job_id, task_id: identity.task_id,
        receipt_id: receiptId, intent_id: intentId, state: 'reserved',
        admission_reservation_generation: 1,
        admission_expires_at_ms: now + ADMISSION_RECOVERY_MS,
        reservation_owner: 'intake_retry', created_at_ms: now, updated_at_ms: now,
      });
      tx.create(refs.job(identity.job_id), job);
      tx.create(refs.task(identity.task_id), {
        task_id: identity.task_id, parent_workflow_id: identity.request_id,
        agent_name: 'site-studio-cloud-shadow', campaign_key: null,
        lead_id: null, proof_id: null, model_or_tool: 'vertex-gemini/phase2-shadow-v1',
        cost_estimate: jobMaxCostMicros / 1_000_000, cost_actual: null,
        input_refs: [`packet:sha256:${identity.packet_digest}`], output_refs: [],
        decision_summary: 'Phase 2 admission reserved before source persistence.',
        confidence: null, qa_result: 'n/a', failure_reason: null,
        fallback_used: false, human_review_required: true,
        lesson_candidate: false, skill_candidate: false,
        created_at: iso(now), completed_at: null,
      });
      tx.update(refs.budget(pilotRunId), {
        accepted_jobs: budget.accepted_jobs + 1, updated_at_ms: now,
      });
      return {
        finalized: false, identity, acceptance: null,
        reservation_generation: 1, expires_at_ms: now + ADMISSION_RECOVERY_MS,
      };
    });
  }

  async function finalizeWorkAdmission({ envelope, siteId, pilotRunId, idempotencyKey } = {}) {
    const acceptedEnvelope = assertPhase2WorkEnvelope(envelope);
    const identity = identityFromEnvelope(acceptedEnvelope);
    assertCallerBinding(identity, { siteId, pilotRunId, idempotencyKey });
    const identityDigest = envelopeDigest(identity);
    const digest = envelopeDigest(acceptedEnvelope);
    const keyId = idempotencyDocumentId(siteId, idempotencyKey);
    return db.runTransaction(async (tx) => {
      const now = at();
      const [keySnapshot, jobSnapshot, controlSnapshot, outboxSnapshot] = await Promise.all([
        tx.get(refs.idempotency(keyId)), tx.get(refs.job(identity.job_id)),
        tx.get(refs.control()), tx.get(refs.outbox(deterministicDocumentId('intent', identity.job_id))),
      ]);
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Admission is outside the active pilot run');
      }
      const binding = assertPhase2(snapshotData(keySnapshot), 'Idempotency binding');
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      if (binding.pilot_run_id !== pilotRunId || job.pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Admission reservation belongs to a different pilot run');
      }
      if (binding.identity_digest !== identityDigest || binding.packet_digest !== identity.packet_digest
        || binding.job_id !== identity.job_id || binding.task_id !== identity.task_id) {
        throw storeFailure(409, 'idempotency_conflict', 'Finalized source does not match its admission reservation');
      }
      if (binding.state === 'finalized') {
        if (binding.envelope_digest !== digest || job.envelope_digest !== digest) {
          throw storeFailure(409, 'idempotency_conflict', 'Admission was finalized with different source metadata');
        }
        return acceptance(job, snapshotData(outboxSnapshot), true);
      }
      if (binding.state !== 'reserved' || job.state !== 'admission_reserved') {
        throw storeFailure(503, 'admission_reservation_corrupt', 'Admission reservation cannot be finalized');
      }
      const finalizedJob = {
        ...job, source_ref: acceptedEnvelope.source.ref,
        source_bytes: acceptedEnvelope.source.bytes,
        source_sha256: acceptedEnvelope.source.sha256,
        envelope_digest: digest, envelope_ref_json: canonicalJson(acceptedEnvelope),
        state: 'accepted', updated_at_ms: now,
      };
      const outbox = {
        phase_tag: PHASE_TAG, intent_id: job.intent_id, job_id: job.job_id,
        pilot_run_id: pilotRunId, intent_type: 'dispatch', state: 'pending',
        dispatch_generation: 1, delivery_count: 0, submission_attempts: 0,
        retry_not_before_ms: null, available_at_ms: now,
        claim_not_after_ms: null, worker_claimed_at_ms: null,
        created_at_ms: now, updated_at_ms: now,
      };
      tx.set(refs.job(job.job_id), finalizedJob);
      tx.update(refs.idempotency(keyId), {
        state: 'finalized', envelope_digest: digest,
        source_ref: acceptedEnvelope.source.ref,
        source_sha256: acceptedEnvelope.source.sha256,
        source_bytes: acceptedEnvelope.source.bytes,
        finalized_at_ms: now, updated_at_ms: now,
      });
      tx.update(refs.task(job.task_id), {
        input_refs: [acceptedEnvelope.source.ref, `sha256:${acceptedEnvelope.source.sha256}`, `envelope:sha256:${digest}`],
        decision_summary: 'Accepted validated work into the Phase 2 cloud shadow pilot.',
      });
      tx.create(refs.outbox(job.intent_id), outbox);
      const eventId = deterministicDocumentId('event', job.job_id, 'accepted');
      tx.create(refs.event(eventId), {
        phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
        from_state: 'admission_reserved', to_state: 'accepted',
        reason: 'source-finalized', created_at_ms: now,
      });
      return acceptance(finalizedJob, outbox, false);
    });
  }

  async function listReservedAdmissions({ pilotRunId, limit = 20 } = {}) {
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    boundedInteger(limit, 'limit', { min: 1, max: 100 });
    const controls = validateControls(snapshotData(await refs.control().get()));
    if (controls.active_pilot_run_id !== pilotRunId) {
      throw storeFailure(409, 'pilot_scope_conflict', 'Admission recovery is outside the active pilot run');
    }
    return snapshotRows(await refs.collection('jobs').get())
      .filter((job) => job.phase_tag === PHASE_TAG
        && job.pilot_run_id === pilotRunId && job.state === 'admission_reserved')
      .sort((left, right) => left.created_at_ms - right.created_at_ms || left.job_id.localeCompare(right.job_id))
      .slice(0, limit)
      .map((job) => ({
        identity: Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, job[key]])),
        receipt_id: job.receipt_id,
        intent_id: job.intent_id,
        reserved_at_ms: job.created_at_ms,
        expires_at_ms: job.admission_expires_at_ms,
        recovery_owner: 'control-reconciler',
      }));
  }

  async function expireWorkAdmission({
    jobId, pilotRunId, sourceConfirmedMissing, reason = 'deterministic source confirmed missing',
  } = {}) {
    requiredString(jobId, 'jobId', { max: 128, pattern: ID_RE });
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    exactBoolean(sourceConfirmedMissing, 'sourceConfirmedMissing');
    if (!sourceConfirmedMissing) {
      throw storeFailure(409, 'admission_source_not_confirmed_missing', 'Admission cannot expire without a confirmed missing source');
    }
    requiredString(reason, 'reason', { max: 500 });
    return db.runTransaction(async (tx) => {
      const now = at();
      const jobRef = refs.job(jobId);
      const [jobSnapshot, controlSnapshot] = await Promise.all([
        tx.get(jobRef), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== pilotRunId || job.pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Admission expiration is outside the active pilot run');
      }
      const keyRef = refs.idempotency(idempotencyDocumentId(job.site_id, job.idempotency_key));
      const binding = assertPhase2(snapshotData(await tx.get(keyRef)), 'Idempotency binding');
      if (job.state === 'admission_expired' && binding.state === 'expired') {
        return { job_id: jobId, state: 'admission_expired', duplicate: true };
      }
      if (job.state !== 'admission_reserved' || binding.state !== 'reserved'
        || job.source_ref !== null || job.envelope_digest !== null) {
        throw storeFailure(409, 'admission_not_expirable', 'Only an unfinalized no-source admission can expire');
      }
      if (!Number.isSafeInteger(job.admission_reservation_generation)
        || job.admission_reservation_generation < 1
        || binding.admission_reservation_generation !== job.admission_reservation_generation
        || binding.admission_expires_at_ms !== job.admission_expires_at_ms) {
        throw storeFailure(503, 'admission_reservation_corrupt', 'Admission recovery lease is invalid');
      }
      if (job.admission_expires_at_ms > now) {
        throw storeFailure(409, 'admission_recovery_active', 'Admission recovery window is still active');
      }
      tx.update(jobRef, {
        state: 'admission_expired', last_failure_class: 'admission_source_missing',
        last_failure_reason: reason, updated_at_ms: now,
      });
      tx.update(keyRef, { state: 'expired', expired_at_ms: now, updated_at_ms: now });
      const deadLetterId = deterministicDocumentId('deadletter', jobId);
      tx.set(refs.deadLetter(deadLetterId), {
        phase_tag: PHASE_TAG, dead_letter_id: deadLetterId, job_id: jobId,
        failure_class: 'admission_source_missing', failure_reason: reason,
        attempts: 0, execution_risk: 'none', requires_operator_review: true,
        created_at_ms: now,
      });
      tx.update(refs.task(job.task_id), {
        qa_result: 'fail', failure_reason: JSON.stringify({ code: 'admission_source_missing', text: reason }),
        lesson_candidate: true, completed_at: iso(now),
      });
      const eventId = deterministicDocumentId('event', jobId, 'admission_expired');
      tx.set(refs.event(eventId), {
        phase_tag: PHASE_TAG, task_event_id: eventId, job_id: jobId,
        from_state: 'admission_reserved', to_state: 'admission_expired',
        reason: 'admission_source_missing', created_at_ms: now,
      });
      return { job_id: jobId, state: 'admission_expired', duplicate: false };
    });
  }

  async function failWorkAdmission({
    jobId, pilotRunId, sourceConfirmedInvalid,
    failureClass = 'admission_source_invalid', reason,
  } = {}) {
    requiredString(jobId, 'jobId', { max: 128, pattern: ID_RE });
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    exactBoolean(sourceConfirmedInvalid, 'sourceConfirmedInvalid');
    if (!sourceConfirmedInvalid || failureClass !== 'admission_source_invalid') {
      throw storeFailure(409, 'admission_source_not_confirmed_invalid', 'Admission failure requires a confirmed invalid deterministic source');
    }
    requiredString(reason, 'reason', { max: 500 });
    return db.runTransaction(async (tx) => {
      const now = at();
      const jobRef = refs.job(jobId);
      const [jobSnapshot, controlSnapshot] = await Promise.all([
        tx.get(jobRef), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== pilotRunId || job.pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Admission failure is outside the active pilot run');
      }
      const keyRef = refs.idempotency(idempotencyDocumentId(job.site_id, job.idempotency_key));
      const binding = assertPhase2(snapshotData(await tx.get(keyRef)), 'Idempotency binding');
      if (job.state === 'admission_failed' && binding.state === 'failed') {
        return { job_id: jobId, state: 'admission_failed', duplicate: true };
      }
      if (job.state !== 'admission_reserved' || binding.state !== 'reserved'
        || job.source_ref !== null || job.envelope_digest !== null) {
        throw storeFailure(409, 'admission_not_failurable', 'Only an unfinalized admission can record an invalid source');
      }
      tx.update(jobRef, {
        state: 'admission_failed', last_failure_class: failureClass,
        last_failure_reason: reason, updated_at_ms: now,
      });
      tx.update(keyRef, { state: 'failed', failed_at_ms: now, updated_at_ms: now });
      const deadLetterId = deterministicDocumentId('deadletter', jobId);
      tx.set(refs.deadLetter(deadLetterId), {
        phase_tag: PHASE_TAG, dead_letter_id: deadLetterId, job_id: jobId,
        failure_class: failureClass, failure_reason: reason,
        attempts: 0, execution_risk: 'none', requires_operator_review: true,
        created_at_ms: now,
      });
      tx.update(refs.task(job.task_id), {
        qa_result: 'fail', failure_reason: JSON.stringify({ code: failureClass, text: reason }),
        lesson_candidate: true, completed_at: iso(now),
      });
      const eventId = deterministicDocumentId('event', jobId, 'admission_failed');
      tx.set(refs.event(eventId), {
        phase_tag: PHASE_TAG, task_event_id: eventId, job_id: jobId,
        from_state: 'admission_reserved', to_state: 'admission_failed',
        reason: failureClass, created_at_ms: now,
      });
      return { job_id: jobId, state: 'admission_failed', duplicate: false };
    });
  }

  return {
    reserveWorkAdmission,
    finalizeWorkAdmission,
    listReservedAdmissions,
    expireWorkAdmission,
    failWorkAdmission,
  };
}
