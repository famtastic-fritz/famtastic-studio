function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw error;
  }
}

function cleanReason(value) {
  return String(value || 'unspecified failure').slice(0, 1000);
}

function requireActiveLease(db, lease, now) {
  const row = db.prepare(`SELECT * FROM ExecutionJobs
    WHERE job_id = ? AND state = 'running' AND lease_owner = ?
      AND lease_token = ? AND fencing_token = ? AND lease_expires_at_ms > ?`)
    .get(lease.job_id, lease.worker_id, lease.lease_token, lease.fencing_token, now);
  if (!row) throw failure(409, 'stale_lease', 'The worker lease is no longer active');
  return row;
}

function insertTransition(db, { nextId, jobId, from, to, reason, now }) {
  db.prepare(`INSERT INTO ExecutionTaskEvents
    (task_event_id, job_id, from_state, to_state, reason, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nextId('transition'), jobId, from, to, reason, now);
}

function insertDeadLetter(db, { nextId, job, failureClass, reason, now, iso }) {
  db.prepare(`INSERT OR IGNORE INTO ExecutionDeadLetters
    (dead_letter_id, job_id, failure_class, failure_reason, attempts, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nextId('deadletter'), job.job_id, failureClass, reason, job.attempts_started, now);
  db.prepare(`UPDATE AgentTaskLog SET cost_actual = 0, qa_result = 'fail',
    failure_reason = ?, lesson_candidate = 1, decision_summary = ?, completed_at = ?
    WHERE task_id = ?`)
    .run(
      JSON.stringify({ code: failureClass, text: reason }),
      `Mock execution stopped in dead letter after ${job.attempts_started} attempt(s).`,
      iso(now),
      job.task_id,
    );
}

function expireLeases(db, { now, iso, nextId }) {
  const expired = db.prepare(`SELECT * FROM ExecutionJobs
    WHERE phase_tag = 'phase1_mock' AND state = 'running'
      AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?
    ORDER BY lease_expires_at_ms, job_id`).all(now);
  for (const job of expired) {
    db.prepare(`UPDATE ExecutionAttempts SET state = 'lease_expired',
      failure_class = 'lease_expired', failure_reason = 'Worker lease expired', completed_at_ms = ?
      WHERE job_id = ? AND lease_token = ? AND state = 'running'`)
      .run(now, job.job_id, job.lease_token);
    if (job.attempts_started >= job.max_attempts) {
      const reason = 'Worker lease expired after the maximum attempt count';
      db.prepare(`UPDATE ExecutionJobs SET state = 'dead_letter', lease_owner = NULL,
        lease_token = NULL, lease_expires_at_ms = NULL, last_failure_class = 'lease_expired',
        last_failure_reason = ?, updated_at_ms = ? WHERE job_id = ? AND state = 'running'`)
        .run(reason, now, job.job_id);
      insertDeadLetter(db, { nextId, job, failureClass: 'lease_expired', reason, now, iso });
      insertTransition(db, { nextId, jobId: job.job_id, from: 'running', to: 'dead_letter', reason: 'lease-expired-attempts-exhausted', now });
    } else {
      db.prepare(`UPDATE ExecutionJobs SET state = 'retry_wait', available_at_ms = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL,
        last_failure_class = 'lease_expired', last_failure_reason = 'Worker lease expired',
        updated_at_ms = ? WHERE job_id = ? AND state = 'running'`)
        .run(now, now, job.job_id);
      insertTransition(db, { nextId, jobId: job.job_id, from: 'running', to: 'retry_wait', reason: 'lease-expired', now });
    }
  }
  return expired.length;
}

export function claimNextJob({ db, at, iso, nextId, workerId, leaseMs = 30_000 }) {
  if (typeof workerId !== 'string' || !workerId.trim()) throw failure(400, 'worker_id_required', 'A worker id is required');
  const duration = Number(leaseMs);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3_600_000) {
    throw failure(400, 'lease_duration_invalid', 'Lease duration must be between 1 ms and 1 hour');
  }
  return transaction(db, () => {
    const now = at();
    const paused = db.prepare("SELECT control_value FROM ExecutionControls WHERE control_key = 'global_pause'").get()?.control_value;
    const enabled = db.prepare("SELECT control_value FROM ExecutionControls WHERE control_key = 'worker_enabled'").get()?.control_value;
    if (paused !== '0') throw failure(423, 'execution_paused', 'Durable execution is globally paused');
    if (enabled !== '1') throw failure(503, 'worker_disabled', 'Worker execution is disabled');
    expireLeases(db, { now, iso, nextId });
    const job = db.prepare(`SELECT * FROM ExecutionJobs
      WHERE phase_tag = 'phase1_mock' AND state IN ('queued', 'retry_wait')
        AND available_at_ms <= ?
      ORDER BY available_at_ms, created_at_ms, job_id LIMIT 1`).get(now);
    if (!job) return null;
    if (job.attempts_started >= job.max_attempts) {
      throw failure(409, 'attempt_limit_invariant', 'An exhausted job remained eligible for execution');
    }

    const attemptNumber = job.attempts_started + 1;
    const fencingToken = job.fencing_token + 1;
    const leaseToken = nextId('lease');
    const attemptId = nextId('attempt');
    const changed = db.prepare(`UPDATE ExecutionJobs SET state = 'running',
      attempts_started = ?, lease_owner = ?, lease_token = ?, lease_expires_at_ms = ?,
      fencing_token = ?, updated_at_ms = ?
      WHERE job_id = ? AND fencing_token = ? AND state IN ('queued', 'retry_wait')`)
      .run(attemptNumber, workerId, leaseToken, now + duration, fencingToken, now, job.job_id, job.fencing_token);
    if (Number(changed.changes) !== 1) throw failure(409, 'lease_conflict', 'The job was claimed by another worker');

    db.prepare(`INSERT INTO ExecutionAttempts (
      attempt_id, job_id, attempt_number, worker_id, lease_token, fencing_token,
      state, started_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`)
      .run(attemptId, job.job_id, attemptNumber, workerId, leaseToken, fencingToken, now);
    insertTransition(db, { nextId, jobId: job.job_id, from: job.state, to: 'running', reason: 'worker-lease-acquired', now });
    return {
      job_id: job.job_id,
      task_id: job.task_id,
      attempt_id: attemptId,
      attempt_number: attemptNumber,
      worker_id: workerId,
      lease_token: leaseToken,
      fencing_token: fencingToken,
      lease_expires_at_ms: now + duration,
      packet_ref: JSON.parse(job.packet_ref),
      project_id: job.project_id,
      packet_id: job.packet_id,
    };
  });
}

function recordModelCall(db, { call, lease, nextId, now }) {
  if (!call || call.provider !== 'mock') throw failure(503, 'real_provider_denied', 'Phase 1 accepts only the deterministic mock provider');
  if (call.model !== 'deterministic-mock-v1' || call.provider_request_id !== `mock:${lease.attempt_id}`) {
    throw failure(500, 'model_call_invalid', 'Mock model identity is not bound to this attempt');
  }
  if (Number(call.actual_cost_micros) !== 0) throw failure(500, 'mock_cost_invalid', 'Mock provider cost must be exactly zero');
  for (const field of ['input_tokens', 'output_tokens', 'latency_ms']) {
    if (!Number.isInteger(call[field]) || call[field] < 0) throw failure(500, 'model_call_invalid', `${field} must be a nonnegative integer`);
  }
  const outcome = call.outcome;
  if (!['success', 'transient_failure', 'permanent_failure'].includes(outcome)) {
    throw failure(500, 'model_call_invalid', `Unsupported mock outcome: ${outcome}`);
  }
  const modelCallId = call.model_call_id || nextId('call');
  db.prepare(`INSERT INTO ExecutionModelCalls (
    model_call_id, job_id, attempt_id, call_index, provider, model,
    provider_request_id, input_tokens, output_tokens, latency_ms,
    reserved_cost_micros, actual_cost_micros, outcome, failure_class, created_at_ms
  ) VALUES (?, ?, ?, 1, 'mock', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`)
    .run(
      modelCallId, lease.job_id, lease.attempt_id, call.model,
      call.provider_request_id || null, call.input_tokens, call.output_tokens,
      call.latency_ms, outcome, call.failure_class || null, now,
    );
  return modelCallId;
}

export function completeJob({ db, at, iso, nextId, lease, call, artifact }) {
  return transaction(db, () => {
    const now = at();
    const job = requireActiveLease(db, lease, now);
    if (call?.outcome !== 'success') {
      throw failure(500, 'model_call_outcome_mismatch', 'Successful completion requires a successful model call');
    }
    recordModelCall(db, { call, lease, nextId, now });
    const version = artifact?.version;
    const expectedRef = artifact
      ? `execution-artifact:${job.job_id}/${artifact.logical_key}-v${version}.json`
      : null;
    if (!artifact
      || !/^[A-Za-z0-9_-]{1,100}$/.test(artifact.logical_key || '')
      || !Number.isInteger(version) || version < 1 || version > 100
      || artifact.artifact_ref !== expectedRef
      || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      || !Number.isInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > 10 * 1024 * 1024) {
      throw failure(500, 'artifact_invalid', 'Deterministic artifact identity, size, version, and digest are required');
    }
    const existing = db.prepare(`SELECT * FROM ExecutionArtifacts
      WHERE job_id = ? AND logical_key = ? AND version = ?`)
      .get(job.job_id, artifact.logical_key, version);
    let artifactId = existing?.artifact_id;
    if (existing) {
      if (existing.sha256 !== artifact.sha256 || existing.artifact_ref !== artifact.artifact_ref || Number(existing.bytes) !== artifact.bytes) {
        throw failure(409, 'artifact_identity_conflict', 'The logical artifact identity is already bound to different bytes');
      }
    } else {
      artifactId = artifact.artifact_id || nextId('artifact');
      db.prepare(`INSERT INTO ExecutionArtifacts (
        artifact_id, job_id, logical_key, version, artifact_ref, sha256, bytes, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(artifactId, job.job_id, artifact.logical_key, version,
          artifact.artifact_ref, artifact.sha256, artifact.bytes, now);
    }

    db.prepare(`INSERT OR IGNORE INTO ExecutionApprovals (
      approval_id, job_id, state, artifact_id, artifact_sha256, review_scope, created_at_ms
    ) VALUES (?, ?, 'awaiting_approval', ?, ?, 'phase1-pilot-manual-gate', ?)`)
      .run(nextId('approval'), job.job_id, artifactId, artifact.sha256, now);
    const attempt = db.prepare(`UPDATE ExecutionAttempts SET state = 'succeeded', completed_at_ms = ?
      WHERE attempt_id = ? AND lease_token = ? AND state = 'running'`)
      .run(now, lease.attempt_id, lease.lease_token);
    if (Number(attempt.changes) !== 1) throw failure(409, 'stale_lease', 'The attempt is no longer active');
    db.prepare(`UPDATE ExecutionJobs SET state = 'awaiting_approval', lease_owner = NULL,
      lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE job_id = ?`).run(now, job.job_id);
    db.prepare(`UPDATE AgentTaskLog SET cost_actual = 0, output_refs = ?,
      decision_summary = ?, qa_result = 'n/a', completed_at = ? WHERE task_id = ?`)
      .run(
        JSON.stringify([artifact.artifact_ref, `sha256:${artifact.sha256}`]),
        'Deterministic mock execution completed and is waiting at the Phase 1 pilot manual gate.',
        iso(now),
        job.task_id,
      );
    insertTransition(db, { nextId, jobId: job.job_id, from: 'running', to: 'awaiting_approval', reason: 'mock-artifact-ready', now });
    return { job_id: job.job_id, state: 'awaiting_approval', artifact_id: artifactId };
  });
}

export function failJob({ db, at, iso, nextId, lease, call, retryable, failureClass, reason, baseBackoffMs = 1_000 }) {
  return transaction(db, () => {
    const now = at();
    const job = requireActiveLease(db, lease, now);
    const expectedOutcome = retryable ? 'transient_failure' : 'permanent_failure';
    if (call?.outcome !== expectedOutcome) {
      throw failure(500, 'model_call_outcome_mismatch', `Failure handling requires ${expectedOutcome}`);
    }
    if (typeof failureClass !== 'string' || !failureClass.trim() || call.failure_class !== failureClass) {
      throw failure(500, 'failure_class_mismatch', 'Failure classification must match the model call');
    }
    recordModelCall(db, { call, lease, nextId, now });
    const message = cleanReason(reason);
    const canRetry = Boolean(retryable) && job.attempts_started < job.max_attempts;
    const attemptState = canRetry ? 'retry_scheduled' : 'failed_permanent';
    const changed = db.prepare(`UPDATE ExecutionAttempts SET state = ?, failure_class = ?,
      failure_reason = ?, completed_at_ms = ?
      WHERE attempt_id = ? AND lease_token = ? AND state = 'running'`)
      .run(attemptState, failureClass, message, now, lease.attempt_id, lease.lease_token);
    if (Number(changed.changes) !== 1) throw failure(409, 'stale_lease', 'The attempt is no longer active');

    if (canRetry) {
      const delay = Math.max(0, Math.trunc(baseBackoffMs)) * (2 ** (job.attempts_started - 1));
      db.prepare(`UPDATE ExecutionJobs SET state = 'retry_wait', available_at_ms = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL,
        last_failure_class = ?, last_failure_reason = ?, updated_at_ms = ?
        WHERE job_id = ?`).run(now + delay, failureClass, message, now, job.job_id);
      insertTransition(db, { nextId, jobId: job.job_id, from: 'running', to: 'retry_wait', reason: failureClass, now });
      return { job_id: job.job_id, state: 'retry_wait', available_at_ms: now + delay };
    }

    db.prepare(`UPDATE ExecutionJobs SET state = 'dead_letter', lease_owner = NULL,
      lease_token = NULL, lease_expires_at_ms = NULL, last_failure_class = ?,
      last_failure_reason = ?, updated_at_ms = ? WHERE job_id = ?`)
      .run(failureClass, message, now, job.job_id);
    insertDeadLetter(db, { nextId, job, failureClass, reason: message, now, iso });
    insertTransition(db, { nextId, jobId: job.job_id, from: 'running', to: 'dead_letter', reason: failureClass, now });
    return { job_id: job.job_id, state: 'dead_letter' };
  });
}
