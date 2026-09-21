const AGENT_TASK_LOG_COLUMNS = [
  'task_id',
  'parent_workflow_id',
  'agent_name',
  'campaign_key',
  'lead_id',
  'proof_id',
  'model_or_tool',
  'cost_estimate',
  'cost_actual',
  'input_refs',
  'output_refs',
  'decision_summary',
  'confidence',
  'qa_result',
  'failure_reason',
  'fallback_used',
  'human_review_required',
  'lesson_candidate',
  'skill_candidate',
  'created_at',
  'completed_at',
];

const EXECUTION_APPLICATION_ID = 0x46414D53;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ExecutionMigrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AgentTaskLog (
  task_id TEXT PRIMARY KEY,
  parent_workflow_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  campaign_key TEXT,
  lead_id TEXT,
  proof_id TEXT,
  model_or_tool TEXT NOT NULL,
  cost_estimate REAL NOT NULL DEFAULT 0 CHECK (cost_estimate >= 0),
  cost_actual REAL CHECK (cost_actual IS NULL OR cost_actual >= 0),
  input_refs TEXT NOT NULL CHECK (json_valid(input_refs)),
  output_refs TEXT NOT NULL CHECK (json_valid(output_refs)),
  decision_summary TEXT NOT NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  qa_result TEXT NOT NULL CHECK (qa_result IN ('pass', 'fail', 'flagged', 'n/a')),
  failure_reason TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0, 1)),
  human_review_required INTEGER NOT NULL DEFAULT 0 CHECK (human_review_required IN (0, 1)),
  lesson_candidate INTEGER NOT NULL DEFAULT 0 CHECK (lesson_candidate IN (0, 1)),
  skill_candidate INTEGER NOT NULL DEFAULT 0 CHECK (skill_candidate IN (0, 1)),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ExecutionJobs (
  job_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES AgentTaskLog(task_id),
  phase_tag TEXT NOT NULL CHECK (phase_tag = 'phase1_mock'),
  site_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  packet_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  packet_digest TEXT NOT NULL CHECK (length(packet_digest) = 64),
  packet_ref TEXT NOT NULL CHECK (json_valid(packet_ref)),
  state TEXT NOT NULL CHECK (state IN (
    'accepted', 'queued', 'running', 'retry_wait',
    'awaiting_approval', 'dead_letter'
  )),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  attempts_started INTEGER NOT NULL DEFAULT 0 CHECK (attempts_started >= 0),
  available_at_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at_ms INTEGER,
  fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  last_failure_class TEXT,
  last_failure_reason TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (site_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ExecutionOutbox (
  intent_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES ExecutionJobs(job_id),
  intent_type TEXT NOT NULL CHECK (intent_type = 'dispatch'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'delivered')),
  delivery_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_count >= 0),
  event_id TEXT,
  event_projected_at_ms INTEGER,
  event_projection_error TEXT,
  journal_entry_id TEXT,
  journal_projected_at_ms INTEGER,
  journal_projection_error TEXT,
  created_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS ExecutionAttempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ExecutionJobs(job_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  worker_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1),
  state TEXT NOT NULL CHECK (state IN (
    'running', 'succeeded', 'retry_scheduled',
    'failed_permanent', 'lease_expired'
  )),
  failure_class TEXT,
  failure_reason TEXT,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS ExecutionModelCalls (
  model_call_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ExecutionJobs(job_id),
  attempt_id TEXT NOT NULL REFERENCES ExecutionAttempts(attempt_id),
  call_index INTEGER NOT NULL DEFAULT 1 CHECK (call_index >= 1),
  provider TEXT NOT NULL CHECK (provider = 'mock'),
  model TEXT NOT NULL,
  provider_request_id TEXT,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  reserved_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cost_micros >= 0),
  actual_cost_micros INTEGER NOT NULL CHECK (actual_cost_micros = 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'transient_failure', 'permanent_failure')),
  failure_class TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (attempt_id, call_index)
);

CREATE TABLE IF NOT EXISTS ExecutionArtifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ExecutionJobs(job_id),
  logical_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  artifact_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (job_id, logical_key, version)
);

CREATE TABLE IF NOT EXISTS ExecutionApprovals (
  approval_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES ExecutionJobs(job_id),
  state TEXT NOT NULL CHECK (state = 'awaiting_approval'),
  artifact_id TEXT NOT NULL REFERENCES ExecutionArtifacts(artifact_id),
  artifact_sha256 TEXT NOT NULL CHECK (length(artifact_sha256) = 64),
  review_scope TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ExecutionDeadLetters (
  dead_letter_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES ExecutionJobs(job_id),
  failure_class TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ExecutionControls (
  control_key TEXT PRIMARY KEY,
  control_value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ExecutionTaskEvents (
  task_event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ExecutionJobs(job_id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ExecutionJobsEligibleIdx
  ON ExecutionJobs(phase_tag, state, available_at_ms, created_at_ms);
CREATE INDEX IF NOT EXISTS ExecutionJobsLeaseIdx
  ON ExecutionJobs(state, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS ExecutionOutboxPendingIdx
  ON ExecutionOutbox(state, created_at_ms);
CREATE INDEX IF NOT EXISTS ExecutionTaskEventsJobIdx
  ON ExecutionTaskEvents(job_id, created_at_ms);
`;

function fail(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 500 });
}

function assertAgentTaskLogContract(db) {
  const columns = new Set(db.prepare('PRAGMA table_info("AgentTaskLog")').all().map((row) => row.name));
  const missing = AGENT_TASK_LOG_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) {
    throw fail('agent_task_log_contract_mismatch', `AgentTaskLog is missing required columns: ${missing.join(', ')}`);
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

export function migrateExecutionSchema(db, { nowIso, nowMs }) {
  const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
  if (applicationId !== 0 && applicationId !== EXECUTION_APPLICATION_ID) {
    throw fail('execution_db_application_mismatch', 'SQLite application_id does not identify a FAMtastic execution database');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA_SQL);
    assertAgentTaskLogContract(db);
    ensureColumn(db, 'ExecutionOutbox', 'journal_entry_id', 'TEXT');
    ensureColumn(db, 'ExecutionOutbox', 'journal_projected_at_ms', 'INTEGER');
    ensureColumn(db, 'ExecutionOutbox', 'journal_projection_error', 'TEXT');
    db.exec(`PRAGMA application_id = ${EXECUTION_APPLICATION_ID}`);
    db.prepare(`INSERT OR IGNORE INTO ExecutionControls
      (control_key, control_value, updated_at_ms, updated_by)
      VALUES (?, ?, ?, ?)`)
      .run('global_pause', '1', nowMs, 'schema-default');
    db.prepare(`INSERT OR IGNORE INTO ExecutionControls
      (control_key, control_value, updated_at_ms, updated_by)
      VALUES (?, ?, ?, ?)`)
      .run('dispatch_enabled', '0', nowMs, 'schema-default');
    db.prepare(`INSERT OR IGNORE INTO ExecutionControls
      (control_key, control_value, updated_at_ms, updated_by)
      VALUES (?, ?, ?, ?)`)
      .run('worker_enabled', '0', nowMs, 'schema-default');
    db.prepare(`INSERT OR IGNORE INTO ExecutionMigrations
      (version, name, applied_at) VALUES (1, ?, ?)`)
      .run('durable-execution-phase1', nowIso);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw error;
  }
}

export function agentTaskLogColumns() {
  return [...AGENT_TASK_LOG_COLUMNS];
}

export function executionApplicationId() {
  return EXECUTION_APPLICATION_ID;
}
