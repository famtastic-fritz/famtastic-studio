import { describe, expect, it } from 'vitest';
import { runDurableExecutionProof } from './helpers/durable-execution-proof.js';

describe('20-job durable execution recovery proof', () => {
  it('accounts for every synthetic job with no external effect or cost', () => {
    const report = runDurableExecutionProof();
    expect(report).toMatchObject({
      status: 'passed',
      proof_scope: 'synthetic_fixture_only',
      authoritative_database_touched: false,
      authoritative_preservation_verified: false,
      jobs: 20,
      states: { awaiting_approval: 18, dead_letter: 2 },
      active_leases: 0,
      orphaned_jobs: 0,
      duplicate_logical_artifacts: 0,
      max_attempts: 3,
      actual_model_cost_micros: 0,
      mock_provider_calls: 25,
      on_disk_artifacts: 18,
      post_crash_runtime_restarts: 1,
      schedules_run: 0,
      external_calls: 0,
      process_network_attempts: { fetch: 0, http: 0, https: 0, net: 0, tls: 0 },
      callbacks: 0,
      messages_sent: 0,
      deployments: 0,
      integrity_check: 'ok',
      foreign_key_violations: 0,
      synthetic_legacy_fixture: { hashes_unchanged: true },
      reconciliation: {
        missing_before: 1,
        repaired: true,
        schedules_considered: 0,
        legacy_jobs_considered: 0,
      },
    });
    expect(report.counts).toMatchObject({
      AgentTaskLog: 20,
      ExecutionJobs: 20,
      ExecutionOutbox: 20,
      ExecutionAttempts: 27,
      ExecutionModelCalls: 25,
      ExecutionArtifacts: 18,
      ExecutionApprovals: 18,
      ExecutionDeadLetters: 2,
    });
  });
});
