import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { claimNextJob, completeJob, failJob } from './attempts.js';
import { migrateExecutionSchema } from './schema.js';

const CONTROL_KEYS = new Set(['global_pause', 'dispatch_enabled', 'worker_enabled']);
const EXECUTION_APPLICATION_ID = 0x46414D53;

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function defaultIdFactory(kind) {
  const id = crypto.randomUUID();
  return kind === 'task' ? id : `${kind}_${id}`;
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  if (value === undefined) return null;
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function stagingPacketDigest(packet) {
  return crypto.createHash('sha256').update(canonicalJson(packet)).digest('hex');
}

function validateDisposableDatabase(dbPath, safeRoot) {
  if (!dbPath || typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) {
    throw failure(503, 'execution_db_required', 'An absolute disposable execution database path is required');
  }
  if (!safeRoot || typeof safeRoot !== 'string' || !path.isAbsolute(safeRoot)) {
    throw failure(503, 'execution_safe_root_required', 'An absolute execution safe root is required');
  }
  const resolvedPath = path.resolve(dbPath);
  const resolvedRoot = path.resolve(safeRoot);
  if (path.dirname(resolvedPath) !== resolvedRoot) {
    throw failure(503, 'execution_db_outside_safe_root', 'The execution database must be a direct child of its safe root');
  }
  if (!/\.phase1-disposable\.(?:db|sqlite)$/.test(path.basename(resolvedPath))) {
    throw failure(503, 'authoritative_db_denied', 'Phase 1 refuses a database not explicitly named as disposable');
  }
  let rootStat;
  try { rootStat = fs.lstatSync(resolvedRoot); } catch (error) {
    if (error.code === 'ENOENT') throw failure(503, 'execution_safe_root_missing', 'The execution safe root does not exist');
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw failure(503, 'execution_safe_root_invalid', 'The execution safe root must be a real directory');
  }
  if (fs.existsSync(resolvedPath)) {
    const stat = fs.lstatSync(resolvedPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw failure(503, 'execution_db_identity_denied', 'The execution database must be a single-link regular file');
    }
  }
  return resolvedPath;
}

function packetReference(packet) {
  return {
    schema: packet.schema,
    packet_id: packet.packet_id,
    request_id: packet.request_id,
    project_id: packet.project_id,
    build_class: packet.build_class,
    selected_direction_ids: packet.selected_direction_ids,
    artifact_manifest_sha256: packet.artifact_manifest_sha256,
    artifacts: packet.artifacts.map(({ role, path, sha256, bytes }) => ({ role, path, sha256, bytes })),
    selected_artifacts: packet.selected_artifacts,
  };
}

function inTransaction(db, operation) {
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

function exposedJob(row, duplicate = false) {
  if (!row) return null;
  return {
    job_id: row.job_id,
    task_id: row.task_id,
    receipt_id: row.receipt_id,
    site_id: row.site_id,
    packet_id: row.packet_id,
    request_id: row.request_id,
    project_id: row.project_id,
    state: row.state,
    attempts_started: row.attempts_started,
    max_attempts: row.max_attempts,
    idempotency_key: row.idempotency_key,
    packet_digest: row.packet_digest,
    duplicate,
  };
}

function boundedLimit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(numeric)));
}

export function createExecutionStore({ dbPath, safeRoot, clock = () => Date.now(), idFactory = defaultIdFactory } = {}) {
  const validatedDbPath = validateDisposableDatabase(dbPath, safeRoot);
  const existed = fs.existsSync(validatedDbPath);
  if (existed) {
    let probe;
    try {
      probe = new DatabaseSync(validatedDbPath, { readOnly: true });
      const applicationId = Number(probe.prepare('PRAGMA application_id').get().application_id);
      if (applicationId !== 0 && applicationId !== EXECUTION_APPLICATION_ID) {
        throw failure(503, 'execution_db_application_mismatch', 'SQLite application_id does not identify a FAMtastic execution database');
      }
    } catch (error) {
      if (error.code === 'execution_db_application_mismatch') throw error;
      throw failure(503, 'execution_db_invalid', `Execution database could not be identified: ${error.message}`);
    } finally {
      try { probe?.close(); } catch { /* already closed */ }
    }
  } else {
    fs.chmodSync(path.resolve(safeRoot), 0o700);
    const fd = fs.openSync(validatedDbPath, 'wx', 0o600);
    fs.closeSync(fd);
  }
  const db = new DatabaseSync(validatedDbPath);
  fs.chmodSync(path.resolve(safeRoot), 0o700);
  fs.chmodSync(validatedDbPath, 0o600);
  const openedStat = fs.lstatSync(validatedDbPath);
  if (!openedStat.isFile() || openedStat.isSymbolicLink() || openedStat.nlink !== 1) {
    try { db.close(); } catch { /* already closed */ }
    throw failure(503, 'execution_db_identity_denied', 'The opened execution database failed its identity check');
  }
  const at = () => {
    const value = clock();
    const ms = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(ms)) throw failure(500, 'execution_clock_invalid', 'Execution clock returned an invalid value');
    return Math.trunc(ms);
  };
  const iso = (ms) => new Date(ms).toISOString();
  const nextId = (kind) => {
    const value = idFactory(kind);
    if (typeof value !== 'string' || !value) throw failure(500, 'execution_id_invalid', `ID factory returned no ${kind} id`);
    return value;
  };

  const migratedAt = at();
  try {
    migrateExecutionSchema(db, { nowIso: iso(migratedAt), nowMs: migratedAt });
  } catch (error) {
    try { db.close(); } catch { /* already closed */ }
    throw error;
  }

  function findByKey(siteId, idempotencyKey) {
    return db.prepare(`SELECT j.*, o.state AS dispatch_state, o.intent_id,
      o.event_projected_at_ms, o.event_projection_error,
      o.journal_entry_id, o.journal_projected_at_ms, o.journal_projection_error
      FROM ExecutionJobs j
      LEFT JOIN ExecutionOutbox o ON o.job_id = j.job_id
      WHERE j.site_id = ? AND j.idempotency_key = ?`)
      .get(siteId, idempotencyKey) || null;
  }

  function acceptedResult(row, duplicate) {
    return {
      ...exposedJob(row, duplicate),
      dispatch_state: row.dispatch_state,
      intent_id: row.intent_id,
      event_projected_at_ms: row.event_projected_at_ms,
      journal_entry_id: row.journal_entry_id,
      journal_projected_at_ms: row.journal_projected_at_ms,
    };
  }

  function acceptStagingPacket({ packet, siteId, maxAttempts = 3 }) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw failure(400, 'max_attempts_invalid', 'Maximum attempts must be an integer from 1 through 10');
    }
    const digest = stagingPacketDigest(packet);
    const existing = findByKey(siteId, packet.idempotency_key);
    if (existing) {
      if (existing.packet_digest !== digest) {
        throw failure(409, 'idempotency_conflict', 'The idempotency key is already bound to different packet content');
      }
      return acceptedResult(existing, true);
    }

    return inTransaction(db, () => {
      const lockedExisting = findByKey(siteId, packet.idempotency_key);
      if (lockedExisting) {
        if (lockedExisting.packet_digest !== digest) {
          throw failure(409, 'idempotency_conflict', 'The idempotency key is already bound to different packet content');
        }
        return acceptedResult(lockedExisting, true);
      }

      const now = at();
      const taskId = nextId('task');
      const jobId = nextId('job');
      const intentId = nextId('intent');
      const receiptId = nextId('receipt');
      const transitionId = nextId('transition');
      const inputRefs = [
        `packet:${packet.packet_id}`,
        `artifact-manifest:sha256:${packet.artifact_manifest_sha256}`,
      ];

      db.prepare(`INSERT INTO AgentTaskLog (
        task_id, parent_workflow_id, agent_name, campaign_key, lead_id, proof_id,
        model_or_tool, cost_estimate, cost_actual, input_refs, output_refs,
        decision_summary, confidence, qa_result, failure_reason, fallback_used,
        human_review_required, lesson_candidate, skill_candidate, created_at, completed_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 0, NULL, ?, '[]', ?, NULL,
        'n/a', NULL, 0, 1, 0, 0, ?, NULL)`)
        .run(
          taskId,
          packet.request_id,
          'site-studio-staging-build',
          'mock/site-studio-staging-v1',
          JSON.stringify(inputRefs),
          'Accepted a validated staging packet and recorded a durable dispatch intent.',
          iso(now),
        );

      db.prepare(`INSERT INTO ExecutionJobs (
        job_id, task_id, phase_tag, site_id, idempotency_key, receipt_id,
        packet_id, request_id, project_id, packet_digest, packet_ref, state,
        max_attempts, attempts_started, available_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'phase1_mock', ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, 0, ?, ?, ?)`)
        .run(
          jobId, taskId, siteId, packet.idempotency_key, receiptId,
          packet.packet_id, packet.request_id, packet.project_id, digest,
          canonicalJson(packetReference(packet)), maxAttempts, now, now, now,
        );

      db.prepare(`INSERT INTO ExecutionOutbox (
        intent_id, job_id, intent_type, state, delivery_count, created_at_ms
      ) VALUES (?, ?, 'dispatch', 'pending', 0, ?)`)
        .run(intentId, jobId, now);
      db.prepare(`INSERT INTO ExecutionTaskEvents (
        task_event_id, job_id, from_state, to_state, reason, created_at_ms
      ) VALUES (?, ?, NULL, 'accepted', 'signed-intake-committed', ?)`)
        .run(transitionId, jobId, now);

      const result = {
        job_id: jobId,
        task_id: taskId,
        receipt_id: receiptId,
        site_id: siteId,
        packet_id: packet.packet_id,
        request_id: packet.request_id,
        project_id: packet.project_id,
        idempotency_key: packet.idempotency_key,
        state: 'accepted',
        dispatch_state: 'pending',
        intent_id: intentId,
        duplicate: false,
        packet_digest: digest,
        event_projected_at_ms: null,
        journal_entry_id: null,
        journal_projected_at_ms: null,
      };
      return result;
    });
  }

  function setControl(key, enabled, updatedBy = 'local-test') {
    if (!CONTROL_KEYS.has(key)) throw failure(400, 'execution_control_invalid', `Unknown execution control: ${key}`);
    if (typeof enabled !== 'boolean') throw failure(400, 'execution_control_value_invalid', 'Execution controls require an exact boolean');
    const now = at();
    db.prepare(`UPDATE ExecutionControls SET control_value = ?, updated_at_ms = ?, updated_by = ?
      WHERE control_key = ?`).run(enabled ? '1' : '0', now, updatedBy, key);
  }

  function controlEnabled(key) {
    if (!CONTROL_KEYS.has(key)) throw failure(400, 'execution_control_invalid', `Unknown execution control: ${key}`);
    return db.prepare('SELECT control_value FROM ExecutionControls WHERE control_key = ?').get(key)?.control_value === '1';
  }

  function requireRunnable(control) {
    if (!CONTROL_KEYS.has(control) || control === 'global_pause') {
      throw failure(400, 'execution_control_invalid', `Unknown runnable execution control: ${control}`);
    }
    const paused = db.prepare("SELECT control_value FROM ExecutionControls WHERE control_key = 'global_pause'").get()?.control_value;
    const enabled = db.prepare('SELECT control_value FROM ExecutionControls WHERE control_key = ?').get(control)?.control_value;
    if (paused !== '0') throw failure(423, 'execution_paused', 'Durable execution is globally paused');
    if (enabled !== '1') {
      const code = control === 'dispatch_enabled' ? 'dispatch_disabled' : 'worker_disabled';
      throw failure(503, code, `${control.replace('_', ' ')} is disabled`);
    }
  }

  function dispatchPending({ limit = 1 } = {}) {
    requireRunnable('dispatch_enabled');
    const safeLimit = boundedLimit(limit, 1);
    return inTransaction(db, () => {
      const paused = db.prepare("SELECT control_value FROM ExecutionControls WHERE control_key = 'global_pause'").get()?.control_value;
      const enabled = db.prepare("SELECT control_value FROM ExecutionControls WHERE control_key = 'dispatch_enabled'").get()?.control_value;
      if (paused !== '0') throw failure(423, 'execution_paused', 'Durable execution is globally paused');
      if (enabled !== '1') throw failure(503, 'dispatch_disabled', 'Dispatch is disabled');
      const rows = db.prepare(`SELECT o.intent_id, o.job_id
        FROM ExecutionOutbox o JOIN ExecutionJobs j ON j.job_id = o.job_id
        WHERE o.state = 'pending' AND j.phase_tag = 'phase1_mock' AND j.state = 'accepted'
        ORDER BY o.created_at_ms, o.intent_id LIMIT ?`).all(safeLimit);
      const now = at();
      for (const row of rows) {
        db.prepare(`UPDATE ExecutionOutbox SET state = 'delivered',
          delivery_count = delivery_count + 1, delivered_at_ms = ?
          WHERE intent_id = ? AND state = 'pending'`).run(now, row.intent_id);
        db.prepare(`UPDATE ExecutionJobs SET state = 'queued', available_at_ms = ?, updated_at_ms = ?
          WHERE job_id = ? AND state = 'accepted'`).run(now, now, row.job_id);
        db.prepare(`INSERT INTO ExecutionTaskEvents
          (task_event_id, job_id, from_state, to_state, reason, created_at_ms)
          VALUES (?, ?, 'accepted', 'queued', 'local-dispatch', ?)`)
          .run(nextId('transition'), row.job_id, now);
      }
      return rows;
    });
  }

  function markEventProjected(intentId, eventId) {
    db.prepare(`UPDATE ExecutionOutbox SET event_id = ?, event_projected_at_ms = ?,
      event_projection_error = NULL WHERE intent_id = ?`)
      .run(eventId, at(), intentId);
  }

  function markEventProjectionFailed(intentId, error) {
    db.prepare(`UPDATE ExecutionOutbox SET event_projection_error = ? WHERE intent_id = ?`)
      .run(String(error?.message || error).slice(0, 500), intentId);
  }

  function markJournalProjected(intentId, entryId) {
    db.prepare(`UPDATE ExecutionOutbox SET journal_entry_id = ?, journal_projected_at_ms = ?,
      journal_projection_error = NULL WHERE intent_id = ?`)
      .run(entryId, at(), intentId);
  }

  function markJournalProjectionFailed(intentId, error) {
    db.prepare(`UPDATE ExecutionOutbox SET journal_projection_error = ? WHERE intent_id = ?`)
      .run(String(error?.message || error).slice(0, 500), intentId);
  }

  function listPendingAcceptanceProjections({ limit = 25 } = {}) {
    const safeLimit = boundedLimit(limit, 25);
    return db.prepare(`SELECT j.*, o.intent_id, o.event_projected_at_ms,
      o.journal_projected_at_ms
      FROM ExecutionJobs j JOIN ExecutionOutbox o ON o.job_id = j.job_id
      WHERE j.phase_tag = 'phase1_mock'
        AND (o.event_projected_at_ms IS NULL OR o.journal_projected_at_ms IS NULL)
      ORDER BY j.created_at_ms, j.job_id LIMIT ?`).all(safeLimit);
  }

  function reconcile({ apply = false } = {}) {
    if (typeof apply !== 'boolean') throw failure(400, 'reconcile_apply_invalid', 'Reconciliation apply must be an exact boolean');
    const missing = db.prepare(`SELECT j.job_id FROM ExecutionJobs j
      LEFT JOIN ExecutionOutbox o ON o.job_id = j.job_id
      WHERE j.phase_tag = 'phase1_mock' AND o.job_id IS NULL
      ORDER BY j.created_at_ms, j.job_id`).all();
    let repaired = null;
    if (apply && missing.length) {
      repaired = inTransaction(db, () => {
        const row = missing[0];
        const stillMissing = db.prepare(`SELECT j.job_id FROM ExecutionJobs j
          LEFT JOIN ExecutionOutbox o ON o.job_id = j.job_id
          WHERE j.job_id = ? AND j.phase_tag = 'phase1_mock' AND o.job_id IS NULL`).get(row.job_id);
        if (!stillMissing) return null;
        const now = at();
        const intentId = nextId('intent');
        const inserted = db.prepare(`INSERT OR IGNORE INTO ExecutionOutbox
          (intent_id, job_id, intent_type, state, delivery_count, created_at_ms)
          VALUES (?, ?, 'dispatch', 'pending', 0, ?)`)
          .run(intentId, row.job_id, now);
        return Number(inserted.changes) === 1 ? { job_id: row.job_id, intent_id: intentId } : null;
      });
    }
    return {
      dry_run: !apply,
      phase_tag: 'phase1_mock',
      missing_intents: missing.map((row) => row.job_id),
      repaired,
      schedules_considered: 0,
      legacy_jobs_considered: 0,
    };
  }

  function snapshotCounts() {
    const tables = ['AgentTaskLog', 'ExecutionJobs', 'ExecutionOutbox', 'ExecutionAttempts',
      'ExecutionModelCalls', 'ExecutionArtifacts', 'ExecutionApprovals', 'ExecutionDeadLetters'];
    return Object.fromEntries(tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count)]));
  }

  return {
    acceptStagingPacket,
    claimNextJob: (input = {}) => { requireRunnable('worker_enabled'); return claimNextJob({ ...input, db, at, iso, nextId }); },
    completeJob: (input = {}) => completeJob({ ...input, db, at, iso, nextId }),
    failJob: (input = {}) => failJob({ ...input, db, at, iso, nextId }),
    dispatchPending,
    reconcile,
    findByKey,
    getJob: (jobId) => db.prepare('SELECT * FROM ExecutionJobs WHERE job_id = ?').get(jobId) || null,
    listJobs: () => db.prepare("SELECT * FROM ExecutionJobs WHERE phase_tag = 'phase1_mock' ORDER BY created_at_ms, job_id").all(),
    setPaused: (paused, actor) => setControl('global_pause', paused, actor),
    setDispatchEnabled: (enabled, actor) => setControl('dispatch_enabled', enabled, actor),
    setWorkerEnabled: (enabled, actor) => setControl('worker_enabled', enabled, actor),
    controlEnabled,
    assertWorkerRunnable: () => requireRunnable('worker_enabled'),
    markEventProjected,
    markEventProjectionFailed,
    markJournalProjected,
    markJournalProjectionFailed,
    listPendingAcceptanceProjections,
    snapshotCounts,
    integrityCheck: () => db.prepare('PRAGMA integrity_check').get().integrity_check,
    foreignKeyCheck: () => db.prepare('PRAGMA foreign_key_check').all(),
    rawDatabaseForTests: () => db,
    close: () => db.close(),
  };
}

export { failure as executionFailure };
