import {
  PHASE_TAG,
  assertPhase2,
  boundedInteger,
  exactBoolean,
  requiredString,
  snapshotData,
  storeFailure,
  validateControls,
} from './firestore-values.js';
import { createStagedAdmissionOperations } from './firestore-staged-admission.js';

const CONTROL_KEYS = ['global_pause', 'dispatch_enabled', 'worker_enabled', 'provider_enabled'];

export function createAdmissionOperations(context) {
  const { db, refs, at } = context;
  const staged = createStagedAdmissionOperations(context);

  async function bootstrapControls({
    pilotRunId,
    maxJobs = 20,
    maxTotalCostMicros = 0,
    actor = 'phase2-schema-default',
  } = {}) {
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    boundedInteger(maxJobs, 'maxJobs', { min: 1, max: 100 });
    boundedInteger(maxTotalCostMicros, 'maxTotalCostMicros');
    requiredString(actor, 'actor', { max: 128 });
    const now = at();
    const controlRef = refs.control();
    const budgetRef = refs.budget(pilotRunId);
    return db.runTransaction(async (tx) => {
      const [controlSnapshot, budgetSnapshot] = await Promise.all([
        tx.get(controlRef), tx.get(budgetRef),
      ]);
      const existingControls = snapshotData(controlSnapshot);
      const existingBudget = snapshotData(budgetSnapshot);
      if (existingControls) {
        validateControls(existingControls);
        if (existingControls.global_pause !== true
          || existingControls.dispatch_enabled !== false
          || existingControls.worker_enabled !== false
          || existingControls.provider_enabled !== false) {
          throw storeFailure(409, 'bootstrap_controls_not_safe', 'Bootstrap requires existing controls to be paused and disabled');
        }
        if (existingControls.active_pilot_run_id !== pilotRunId) {
          throw storeFailure(409, 'pilot_scope_conflict', 'Execution controls are bound to another pilot run');
        }
      }
      if (existingBudget) {
        assertPhase2(existingBudget, 'Execution budget');
        if (existingBudget.accepted_jobs !== 0
          || existingBudget.reserved_cost_micros !== 0
          || existingBudget.settled_cost_micros !== 0
          || existingBudget.uncertain_cost_micros !== 0) {
          throw storeFailure(409, 'bootstrap_budget_not_empty', 'Bootstrap requires an empty existing pilot budget');
        }
        if (existingBudget.max_jobs !== maxJobs
          || existingBudget.max_total_cost_micros !== maxTotalCostMicros) {
          throw storeFailure(409, 'pilot_budget_conflict', 'Pilot budget already exists with different limits');
        }
      }
      const controls = existingControls || {
        phase_tag: PHASE_TAG, active_pilot_run_id: pilotRunId,
        global_pause: true, dispatch_enabled: false,
        worker_enabled: false, provider_enabled: false,
        updated_at_ms: now, updated_by: actor,
      };
      const budget = existingBudget || {
        phase_tag: PHASE_TAG, pilot_run_id: pilotRunId,
        max_jobs: maxJobs, accepted_jobs: 0,
        max_total_cost_micros: maxTotalCostMicros,
        reserved_cost_micros: 0, settled_cost_micros: 0,
        uncertain_cost_micros: 0, created_at_ms: now, updated_at_ms: now,
      };
      if (!existingControls) tx.create(controlRef, controls);
      if (!existingBudget) tx.create(budgetRef, budget);
      return { controls, budget, duplicate: Boolean(existingControls && existingBudget) };
    });
  }

  async function setControls(patch, actor = 'phase2-operator') {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw storeFailure(400, 'execution_controls_invalid', 'Control patch must be an object');
    }
    const keys = Object.keys(patch);
    if (!keys.length || keys.some((key) => !CONTROL_KEYS.includes(key))) {
      throw storeFailure(400, 'execution_controls_invalid', 'Control patch contains an unknown key');
    }
    for (const key of keys) exactBoolean(patch[key], key);
    requiredString(actor, 'actor', { max: 128 });
    const now = at();
    return db.runTransaction(async (tx) => {
      const ref = refs.control();
      const controls = validateControls(snapshotData(await tx.get(ref)));
      const updated = { ...controls, ...patch, updated_at_ms: now, updated_by: actor };
      tx.set(ref, updated);
      return updated;
    });
  }

  async function pauseControls({ pilotRunId, actor = 'phase2-pause-operator' } = {}) {
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    requiredString(actor, 'actor', { max: 128 });
    const now = at();
    return db.runTransaction(async (tx) => {
      const ref = refs.control();
      const controls = validateControls(snapshotData(await tx.get(ref)));
      if (controls.active_pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Execution controls are bound to another pilot run');
      }
      const alreadyPaused = controls.global_pause === true
        && controls.dispatch_enabled === false
        && controls.worker_enabled === false
        && controls.provider_enabled === false;
      if (alreadyPaused) return { controls, duplicate: true };
      const updated = {
        ...controls,
        global_pause: true,
        dispatch_enabled: false,
        worker_enabled: false,
        provider_enabled: false,
        updated_at_ms: now,
        updated_by: actor,
      };
      tx.set(ref, updated);
      return { controls: updated, duplicate: false };
    });
  }

  return { bootstrapControls, setControls, pauseControls, ...staged };
}
