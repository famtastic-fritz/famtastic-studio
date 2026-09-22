import { createAdmissionOperations } from './firestore-admission.js';
import { createDispatchOperations } from './firestore-dispatch.js';
import { createReconcileOperations } from './firestore-reconcile.js';
import {
  COLLECTIONS,
  PHASE_TAG,
  defaultIdFactory,
  idempotencyDocumentId,
  milliseconds,
  requiredString,
  snapshotData,
  snapshotRows,
  storeFailure,
} from './firestore-values.js';
import { createWorkerOperations } from './firestore-worker.js';

function validateFirestore(firestore) {
  if (!firestore || typeof firestore.collection !== 'function' || typeof firestore.runTransaction !== 'function') {
    throw storeFailure(500, 'firestore_client_invalid', 'A Firestore-like client with collection and runTransaction is required');
  }
  return firestore;
}

function createReferences(firestore) {
  const collection = (key) => {
    const name = COLLECTIONS[key];
    if (!name) throw storeFailure(500, 'firestore_collection_invalid', `Unknown Phase 2 collection: ${key}`);
    return firestore.collection(name);
  };
  const doc = (key, id) => collection(key).doc(requiredString(id, `${key} document id`, { max: 500 }));
  return Object.freeze({
    collection,
    control: () => doc('controls', 'global'),
    budget: (id) => doc('budgets', id),
    idempotency: (id) => doc('idempotency', id),
    task: (id) => doc('tasks', id),
    job: (id) => doc('jobs', id),
    outbox: (id) => doc('outbox', id),
    attempt: (id) => doc('attempts', id),
    call: (id) => doc('calls', id),
    artifact: (id) => doc('artifacts', id),
    approval: (id) => doc('approvals', id),
    deadLetter: (id) => doc('deadLetters', id),
    event: (id) => doc('events', id),
  });
}

export function createFirestoreExecutionStore({
  firestore,
  clock = () => Date.now(),
  idFactory = defaultIdFactory,
} = {}) {
  const db = validateFirestore(firestore);
  if (typeof clock !== 'function' || typeof idFactory !== 'function') {
    throw storeFailure(500, 'firestore_store_config_invalid', 'Clock and ID factory must be functions');
  }
  const refs = createReferences(db);
  const at = () => milliseconds(clock);
  const iso = (ms) => new Date(ms).toISOString();
  const nextId = (kind) => {
    const value = idFactory(kind);
    return requiredString(value, `${kind} id`, { max: 200 });
  };
  const context = Object.freeze({ db, refs, at, iso, nextId });
  const admission = createAdmissionOperations(context);
  const dispatch = createDispatchOperations(context);
  const worker = createWorkerOperations(context);
  const recovery = createReconcileOperations(context);

  async function getRecord(ref) {
    return snapshotData(await ref.get());
  }

  async function findByKey(siteId, idempotencyKey, pilotRunId = null) {
    requiredString(siteId, 'siteId', { max: 200 });
    requiredString(idempotencyKey, 'idempotencyKey', { max: 200 });
    const binding = await getRecord(refs.idempotency(idempotencyDocumentId(siteId, idempotencyKey)));
    if (!binding) return null;
    if (pilotRunId !== null && binding.pilot_run_id !== pilotRunId) {
      throw storeFailure(409, 'pilot_scope_conflict', 'Idempotency key belongs to a different pilot run');
    }
    const [job, outbox] = await Promise.all([
      getRecord(refs.job(binding.job_id)),
      getRecord(refs.outbox(binding.intent_id)),
    ]);
    return { binding, job, outbox };
  }

  async function listJobs() {
    return snapshotRows(await refs.collection('jobs').get())
      .filter((row) => row.phase_tag === PHASE_TAG)
      .sort((left, right) => left.created_at_ms - right.created_at_ms || left.job_id.localeCompare(right.job_id));
  }

  async function count(key) {
    const snapshot = await refs.collection(key).get();
    return Number.isInteger(snapshot.size) ? snapshot.size : (snapshot.docs || []).length;
  }

  async function snapshotCounts() {
    const keys = ['tasks', 'jobs', 'outbox', 'attempts', 'calls', 'artifacts', 'approvals', 'deadLetters', 'events'];
    const values = await Promise.all(keys.map(count));
    return Object.fromEntries(keys.map((key, index) => [COLLECTIONS[key], values[index]]));
  }

  async function snapshot({ pilotRunId = null } = {}) {
    const [controls, budget, counts, jobs] = await Promise.all([
      getRecord(refs.control()),
      pilotRunId ? getRecord(refs.budget(pilotRunId)) : Promise.resolve(null),
      snapshotCounts(),
      listJobs(),
    ]);
    return { phase_tag: PHASE_TAG, controls, budget, counts, jobs };
  }

  return Object.freeze({
    phaseTag: PHASE_TAG,
    ...admission,
    ...dispatch,
    ...worker,
    ...recovery,
    findByKey,
    getControls: () => getRecord(refs.control()),
    getBudget: (id) => getRecord(refs.budget(id)),
    getTask: (id) => getRecord(refs.task(id)),
    getJob: (id) => getRecord(refs.job(id)),
    getOutbox: (id) => getRecord(refs.outbox(id)),
    getAttempt: (id) => getRecord(refs.attempt(id)),
    getModelCall: (id) => getRecord(refs.call(id)),
    getArtifact: (id) => getRecord(refs.artifact(id)),
    getDeadLetter: (id) => getRecord(refs.deadLetter(id)),
    listJobs,
    count,
    snapshotCounts,
    snapshot,
  });
}

export { PHASE_TAG as FIRESTORE_PHASE_TAG } from './firestore-values.js';
