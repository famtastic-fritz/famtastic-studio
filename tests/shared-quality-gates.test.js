import { describe, expect, it } from 'vitest';
import { evaluateSharedQualityGates } from '../server/kernel/shared-quality-gates.js';

describe('shared quality gates', () => {
  it('passes only when every required evidence lane passes', () => {
    const report = evaluateSharedQualityGates({
      artifact_parity: { passed: true, receipt_id: 'parity-1' },
      quality_gate: { verdict: 'PASS', receipt_id: 'quality-1' },
      behavior: { passed: true, receipt_id: 'behavior-1' },
      target: { provider: 'famtasticinc', root_target_rejected: true, handoff_id: 'handoff-1' },
    });
    expect(report.status).toBe('passed');
    expect(report.ready_for_staging).toBe(true);
  });

  it('distinguishes absent evidence from a failing gate', () => {
    const report = evaluateSharedQualityGates({
      artifact_parity: { passed: false, receipt_id: 'parity-fail' },
      target: { provider: 'famtasticinc', root_target_rejected: true, handoff_id: 'handoff-1' },
    });
    expect(report.status).toBe('blocked');
    expect(report.failed).toEqual(['artifact_parity']);
    expect(report.missing).toContain('quality_gate');
    expect(report.missing).toContain('behavior');
    expect(report.ready_for_staging).toBe(false);
  });
});

