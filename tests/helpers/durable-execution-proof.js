import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import {
  createExecutionRuntime,
  createMockArtifactStore,
  createMockProvider,
} from '../../server/kernel/durable-execution/index.js';
import {
  createExecutionFixture,
  seedSyntheticLegacy,
  stagingPacket,
  tableHash,
} from './durable-execution-fixture.js';

const OUTCOME_PLAN = Object.freeze({
  '15:1': { type: 'transient_failure', failureClass: 'mock_timeout' },
  '16:1': { type: 'transient_failure', failureClass: 'mock_timeout' },
  '17:1': { type: 'transient_failure', failureClass: 'mock_timeout' },
  '18:*': { type: 'permanent_failure', failureClass: 'mock_policy' },
  '19:*': { type: 'transient_failure', failureClass: 'mock_timeout' },
});

function installNetworkGuard() {
  const attempts = { fetch: 0, http: 0, https: 0, net: 0, tls: 0 };
  const originals = [];
  const block = (target, key, counter) => {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = () => {
      attempts[counter] += 1;
      throw new Error(`network denied during durable execution proof: ${counter}`);
    };
  };
  if (typeof globalThis.fetch === 'function') block(globalThis, 'fetch', 'fetch');
  block(http, 'request', 'http');
  block(http, 'get', 'http');
  block(https, 'request', 'https');
  block(https, 'get', 'https');
  block(net, 'connect', 'net');
  block(net, 'createConnection', 'net');
  block(tls, 'connect', 'tls');
  return {
    attempts,
    restore() {
      for (const restore of originals.reverse()) restore();
    },
  };
}

function artifactFileCount(root) {
  let count = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /mock-result-v1\.json$/.test(entry.name)) count += 1;
    }
  };
  visit(root);
  return count;
}

function runtimeFor(fixture, store) {
  const provider = createMockProvider({ outcomes: OUTCOME_PLAN });
  const runtime = createExecutionRuntime({
    store,
    provider,
    artifactStore: createMockArtifactStore({ paths: fixture.paths }),
    enabled: true,
    workerId: 'proof-worker',
    leaseMs: 1000,
    baseBackoffMs: 100,
  });
  return { runtime };
}

function sumTelemetry(samples) {
  const total = {
    mock_calls: 0,
    external_calls: 0,
    attempted: { callback: 0, outbound: 0, publish: 0, deploy: 0 },
    completed: { callback: 0, outbound: 0, publish: 0, deploy: 0 },
  };
  for (const sample of samples) {
    total.mock_calls += sample.provider.mock_calls;
    total.external_calls += sample.provider.external_calls;
    for (const key of Object.keys(total.attempted)) {
      total.attempted[key] += sample.effects.attempted[key];
      total.completed[key] += sample.effects.completed[key];
    }
  }
  return total;
}

function requireProof(condition, message) {
  if (!condition) throw new Error(`durable execution proof failed: ${message}`);
}

export function assertDurableExecutionReport(report) {
  requireProof(report.proof_scope === 'synthetic_fixture_only', 'scope is not synthetic-only');
  requireProof(report.authoritative_database_touched === false, 'authoritative database was touched');
  requireProof(report.authoritative_preservation_verified === false, 'synthetic proof claimed authoritative preservation');
  requireProof(report.synthetic_legacy_fixture?.hashes_unchanged === true, 'synthetic legacy rows changed');
  requireProof(report.jobs === 20, 'job count is not 20');
  requireProof(report.states?.awaiting_approval === 18 && report.states?.dead_letter === 2, 'terminal state accounting differs from 18/2');
  const expectedCounts = {
    AgentTaskLog: 20,
    ExecutionJobs: 20,
    ExecutionOutbox: 20,
    ExecutionAttempts: 27,
    ExecutionModelCalls: 25,
    ExecutionArtifacts: 18,
    ExecutionApprovals: 18,
    ExecutionDeadLetters: 2,
  };
  for (const [table, expected] of Object.entries(expectedCounts)) {
    requireProof(report.counts?.[table] === expected, `${table} count is not ${expected}`);
  }
  requireProof(report.on_disk_artifacts === 18, 'on-disk artifact count is not 18');
  requireProof(report.active_leases === 0, 'active leases remain');
  requireProof(report.orphaned_jobs === 0, 'orphaned jobs remain');
  requireProof(report.duplicate_logical_artifacts === 0, 'duplicate logical artifacts exist');
  requireProof(report.max_attempts === 3, 'retry bound was not exercised');
  requireProof(report.actual_model_cost_micros === 0, 'mock model cost is not zero');
  requireProof(report.mock_provider_calls === 25 && report.external_calls === 0, 'provider telemetry is inconsistent');
  requireProof(Object.values(report.process_network_attempts || {}).every((value) => value === 0), 'a process network hook was invoked');
  requireProof(report.schedules_run === 0, 'a schedule row changed');
  requireProof(report.callbacks === 0 && report.messages_sent === 0 && report.deployments === 0, 'an external effect completed');
  requireProof(Object.values(report.effect_attempts || {}).every((value) => value === 0), 'an external effect was attempted');
  requireProof(report.post_crash_runtime_restarts === 1, 'post-crash runtime was not rebuilt');
  requireProof(report.integrity_check === 'ok' && report.foreign_key_violations === 0, 'SQLite integrity failed');
  requireProof(report.reconciliation?.missing_before === 1 && report.reconciliation?.repaired === true, 'outbox reconciliation failed');
  requireProof(report.reconciliation?.schedules_considered === 0 && report.reconciliation?.legacy_jobs_considered === 0, 'reconciliation escaped Phase 1 scope');
  return report;
}

export function runDurableExecutionProof({ keep = false } = {}) {
  const network = installNetworkGuard();
  const fixture = createExecutionFixture();
  try {
    seedSyntheticLegacy(fixture.dbPath);
    const legacyBefore = {
      jobs: tableHash(fixture.dbPath, 'legacy_jobs'),
      schedules: tableHash(fixture.dbPath, 'schedules'),
      performance: tableHash(fixture.dbPath, 'performance_records'),
    };
    let store = fixture.openStore();
    const accepted = [];
    for (let number = 1; number <= 20; number += 1) {
      const packet = stagingPacket(number);
      accepted.push(store.acceptStagingPacket({ packet, siteId: `project-${number}` }));
    }
    for (const number of [9, 10]) {
      const duplicate = store.acceptStagingPacket({ packet: stagingPacket(number), siteId: `project-${number}` });
      requireProof(duplicate.duplicate && duplicate.task_id === accepted[number - 1].task_id, `duplicate intake ${number}`);
    }

    const job20 = accepted[19];
    store.rawDatabaseForTests().prepare('DELETE FROM ExecutionOutbox WHERE job_id = ?').run(job20.job_id);
    store.close();
    store = fixture.openStore();
    const reconciliationDryRun = store.reconcile();
    const reconciliationApply = store.reconcile({ apply: true });
    requireProof(reconciliationDryRun.missing_intents.length === 1 && reconciliationApply.repaired, 'missing-intent reconciliation');

    store.setPaused(false, 'proof');
    store.setDispatchEnabled(true, 'proof');
    store.setWorkerEnabled(true, 'proof');
    requireProof(store.dispatchPending({ limit: 100 }).length === 20, 'initial dispatch count');
    requireProof(store.dispatchPending({ limit: 100 }).length === 0, 'duplicate dispatch');

    const telemetry = [];
    let running = runtimeFor(fixture, store);
    for (let completed = 0; completed < 12; completed += 1) {
      requireProof(running.runtime.runOne()?.state === 'awaiting_approval', 'ordinary success');
    }
    const crashed13 = store.claimNextJob({ workerId: 'crashed-worker-13', leaseMs: 1000 });
    const crashed14 = store.claimNextJob({ workerId: 'crashed-worker-14', leaseMs: 1000 });
    requireProof(crashed13.project_id === '13' && crashed14.project_id === '14', 'controlled crash selection');
    telemetry.push(running.runtime.telemetry());
    store.close();
    fixture.clock.advance(1001);

    store = fixture.openStore();
    running = runtimeFor(fixture, store);
    let safety = 0;
    while (store.listJobs().some((job) => !['awaiting_approval', 'dead_letter'].includes(job.state))) {
      const result = running.runtime.runOne();
      if (!result) fixture.clock.advance(100);
      safety += 1;
      requireProof(safety <= 100, 'deterministic safety bound');
    }
    telemetry.push(running.runtime.telemetry());

    const db = store.rawDatabaseForTests();
    const stateRows = db.prepare('SELECT state, COUNT(*) AS count FROM ExecutionJobs GROUP BY state').all();
    const states = Object.fromEntries(stateRows.map((row) => [row.state, Number(row.count)]));
    const counts = store.snapshotCounts();
    const activeLeases = Number(db.prepare("SELECT COUNT(*) AS count FROM ExecutionJobs WHERE lease_token IS NOT NULL OR state = 'running'").get().count);
    const orphanedJobs = Number(db.prepare(`SELECT COUNT(*) AS count FROM ExecutionJobs j
      LEFT JOIN ExecutionOutbox o ON o.job_id = j.job_id WHERE o.job_id IS NULL`).get().count);
    const duplicateArtifacts = Number(db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT job_id, logical_key, version, COUNT(*) AS copies FROM ExecutionArtifacts
      GROUP BY job_id, logical_key, version HAVING copies > 1
    )`).get().count);
    const maxAttempts = Number(db.prepare('SELECT MAX(attempts_started) AS value FROM ExecutionJobs').get().value);
    const totalCostMicros = Number(db.prepare('SELECT COALESCE(SUM(actual_cost_micros), 0) AS value FROM ExecutionModelCalls').get().value);
    const legacyAfter = {
      jobs: tableHash(fixture.dbPath, 'legacy_jobs'),
      schedules: tableHash(fixture.dbPath, 'schedules'),
      performance: tableHash(fixture.dbPath, 'performance_records'),
    };
    const observed = sumTelemetry(telemetry);
    const report = {
      proof_scope: 'synthetic_fixture_only',
      authoritative_database_touched: false,
      authoritative_preservation_verified: false,
      synthetic_legacy_fixture: {
        jobs: 448,
        schedules: 7,
        performance_records: 3,
        hashes_unchanged: JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter),
      },
      jobs: 20,
      states,
      counts,
      on_disk_artifacts: artifactFileCount(fixture.executionRoot),
      active_leases: activeLeases,
      orphaned_jobs: orphanedJobs,
      duplicate_logical_artifacts: duplicateArtifacts,
      max_attempts: maxAttempts,
      actual_model_cost_micros: totalCostMicros,
      mock_provider_calls: observed.mock_calls,
      schedules_run: legacyBefore.schedules === legacyAfter.schedules ? 0 : 1,
      external_calls: observed.external_calls + Object.values(network.attempts).reduce((sum, value) => sum + value, 0),
      process_network_attempts: { ...network.attempts },
      callbacks: observed.completed.callback,
      messages_sent: observed.completed.outbound,
      deployments: observed.completed.deploy,
      effect_attempts: observed.attempted,
      post_crash_runtime_restarts: 1,
      retained_fixture_root: keep ? fixture.root : null,
      integrity_check: store.integrityCheck(),
      foreign_key_violations: store.foreignKeyCheck().length,
      reconciliation: {
        missing_before: reconciliationDryRun.missing_intents.length,
        repaired: Boolean(reconciliationApply.repaired),
        schedules_considered: reconciliationApply.schedules_considered,
        legacy_jobs_considered: reconciliationApply.legacy_jobs_considered,
      },
    };
    assertDurableExecutionReport(report);
    store.close();
    return { status: 'passed', ...report };
  } finally {
    network.restore();
    if (!keep) fixture.cleanup();
  }
}
