/**
 * Shared release gates for the FAMtastic -> Site Studio -> site-repository
 * lifecycle. These gates combine evidence; they never turn an absent receipt
 * into a pass. Rendering parity, deterministic quality checks, functional
 * behavior, and target safety are separate claims and remain separately
 * visible in the result.
 */
export const SHARED_QUALITY_GATE_SCHEMA_VERSION = 1;

function result(id, status, evidence = null, note = '') {
  return { id, status, evidence, note };
}

export function evaluateSharedQualityGates({ artifact_parity, quality_gate, behavior, target } = {}) {
  const gates = [
    artifact_parity?.passed === true
      ? result('artifact_parity', 'passed', artifact_parity.receipt_id || null)
      : result('artifact_parity', artifact_parity ? 'failed' : 'not_proven', artifact_parity?.receipt_id || null, 'requires byte and viewport parity evidence'),
    quality_gate?.verdict === 'PASS'
      ? result('quality_gate', 'passed', quality_gate.receipt_id || null)
      : result('quality_gate', quality_gate ? 'failed' : 'not_proven', quality_gate?.receipt_id || null, 'requires a quality-gate verdict'),
    behavior?.passed === true
      ? result('behavior', 'passed', behavior.receipt_id || null)
      : result('behavior', behavior ? 'failed' : 'not_proven', behavior?.receipt_id || null, 'requires functional behavior evidence'),
    target?.root_target_rejected === true && target?.provider === 'famtasticinc'
      ? result('target_safety', 'passed', target.handoff_id || null)
      : result('target_safety', target ? 'failed' : 'not_proven', target?.handoff_id || null, 'requires an explicit FAMtastic Inc per-site target'),
  ];
  const failed = gates.filter((gate) => gate.status === 'failed');
  const missing = gates.filter((gate) => gate.status === 'not_proven');
  return {
    schema_version: SHARED_QUALITY_GATE_SCHEMA_VERSION,
    status: failed.length ? 'blocked' : missing.length ? 'not_proven' : 'passed',
    ready_for_staging: failed.length === 0 && missing.length === 0,
    gates,
    failed: failed.map((gate) => gate.id),
    missing: missing.map((gate) => gate.id),
  };
}

