// Shared learning spine contracts (v1).
//
// A site repo remains the source of truth for its implementation.  This module
// defines the small, portable records that let FAMtastic, Site Studio Next,
// and individual sites exchange evidence without exchanging customer data or
// copying whole repositories into a global "skill" store.
//
// The records are intentionally boring JSON.  They can be committed beside a
// site, emitted through the event spine, or persisted by createLearningSpine.
// Promotion is explicit: a lesson is a candidate until an owner reviews it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LEARNING_SPINE_SCHEMA_VERSION = 1;
export const SITE_MANIFEST_SCHEMA_VERSION = 1;
export const RECIPE_METADATA_SCHEMA_VERSION = 1;
export const LIFECYCLE_EVENT_SCHEMA_VERSION = 1;
export const LESSON_SCHEMA_VERSION = 1;
export const EVIDENCE_RECEIPT_SCHEMA_VERSION = 1;

export const CAPABILITY_CLASSES = ['brochure', 'application'];
export const ENVIRONMENTS = ['local', 'staging', 'production'];
export const PARITY_GATES = ['required', 'optional', 'not_applicable'];
export const RECIPE_MATURITY = ['experimental', 'candidate', 'standard', 'deprecated'];
export const PROMOTION_STATES = ['local', 'candidate', 'approved', 'rejected', 'deprecated'];
export const PRIVACY_REVIEW_STATES = ['pending', 'passed', 'failed'];
export const RECEIPT_STATUSES = ['passed', 'failed', 'pending', 'skipped'];

// This is deliberately finite. A typo must create a visible unknown event,
// not a record that appears valid but can never be queried or aggregated.
export const LIFECYCLE_EVENT_TYPES = [
  'request.received', 'research.completed', 'proof.generated', 'proof.revised',
  'proof.selected', 'payment.confirmed', 'handoff.created', 'build.started',
  'build.succeeded', 'build.failed', 'parity.passed', 'parity.failed',
  'qa.completed', 'staging.deployed', 'launch.completed', 'rollback.completed',
  'incident.opened', 'lesson.proposed', 'recipe.promoted',
];

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Version references may be either a plain semantic version or a pinned
// contract/recipe reference such as design-contract@1 and event-cinema@1.
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+/@-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function iso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function id(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function version(value) {
  return typeof value === 'string' && SAFE_VERSION.test(value);
}

function stringList(value) {
  return Array.isArray(value) && value.every((item) => nonEmpty(item));
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableId(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 24)}`;
}

function commonRef(value, label, errors) {
  add(errors, isObject(value), `${label}: must be an object`);
  if (!isObject(value)) return;
  add(errors, id(value.id), `${label}.id: required safe id`);
  add(errors, nonEmpty(value.kind), `${label}.kind: required`);
  if (value.version !== undefined) add(errors, version(value.version), `${label}.version: invalid version`);
}

function validateSiteManifest(value) {
  const errors = [];
  add(errors, isObject(value), 'manifest: must be an object');
  if (!isObject(value)) return errors;
  add(errors, value.schema_version === SITE_MANIFEST_SCHEMA_VERSION, `schema_version: must equal ${SITE_MANIFEST_SCHEMA_VERSION}`);
  add(errors, id(value.site_id), 'site_id: required safe id');
  add(errors, nonEmpty(value.name), 'name: required');
  add(errors, nonEmpty(value.owner), 'owner: required');
  add(errors, value.capability_class && CAPABILITY_CLASSES.includes(value.capability_class), `capability_class: must be one of ${CAPABILITY_CLASSES.join(' | ')}`);
  add(errors, stringList(value.environments) && value.environments.length > 0 && value.environments.every((item) => ENVIRONMENTS.includes(item)), 'environments: must contain valid environments');
  add(errors, PARITY_GATES.includes(value.parity_gate), `parity_gate: must be one of ${PARITY_GATES.join(' | ')}`);
  add(errors, value.contract && version(value.contract), 'contract: required version reference');
  add(errors, Array.isArray(value.recipes), 'recipes: required array');
  if (Array.isArray(value.recipes)) value.recipes.forEach((recipe, i) => {
    add(errors, version(recipe), `recipes[${i}]: required version reference`);
  });
  if (value.repository != null) add(errors, nonEmpty(value.repository), 'repository: must be a non-empty string when supplied');
  if (value.authorities !== undefined) add(errors, isObject(value.authorities), 'authorities: must be an object when supplied');
  return errors;
}

export function createSiteManifest(fields = {}) {
  const manifest = {
    schema_version: SITE_MANIFEST_SCHEMA_VERSION,
    site_id: fields.site_id,
    name: fields.name,
    owner: fields.owner,
    repository: fields.repository ?? null,
    contract: fields.contract,
    recipes: fields.recipes || [],
    capability_class: fields.capability_class,
    environments: fields.environments || ['local'],
    parity_gate: fields.parity_gate || 'required',
    authorities: fields.authorities || {},
  };
  const errors = validateSiteManifest(manifest);
  if (errors.length) throw new Error(`invalid site manifest: ${errors.join('; ')}`);
  return manifest;
}

export function validateSiteManifestRecord(value) {
  const errors = validateSiteManifest(value);
  return { ok: errors.length === 0, errors };
}

function validateRecipeMetadata(value) {
  const errors = [];
  add(errors, isObject(value), 'recipe: must be an object');
  if (!isObject(value)) return errors;
  add(errors, value.schema_version === RECIPE_METADATA_SCHEMA_VERSION, `schema_version: must equal ${RECIPE_METADATA_SCHEMA_VERSION}`);
  add(errors, id(value.id), 'id: required safe id');
  add(errors, version(value.version), 'version: required valid version');
  add(errors, nonEmpty(value.name), 'name: required');
  add(errors, nonEmpty(value.owner), 'owner: required');
  add(errors, RECIPE_MATURITY.includes(value.maturity), `maturity: must be one of ${RECIPE_MATURITY.join(' | ')}`);
  add(errors, stringList(value.capabilities), 'capabilities: required string array');
  add(errors, stringList(value.inputs), 'inputs: required string array');
  add(errors, stringList(value.acceptance_tests) && value.acceptance_tests.length > 0, 'acceptance_tests: required non-empty string array');
  if (value.contract != null) add(errors, version(value.contract), 'contract: invalid version reference');
  if (value.repository != null) add(errors, nonEmpty(value.repository), 'repository: must be non-empty when supplied');
  return errors;
}

export function createRecipeMetadata(fields = {}) {
  const recipe = {
    schema_version: RECIPE_METADATA_SCHEMA_VERSION,
    id: fields.id,
    version: fields.version,
    name: fields.name,
    owner: fields.owner,
    maturity: fields.maturity || 'candidate',
    capabilities: fields.capabilities || [],
    inputs: fields.inputs || [],
    acceptance_tests: fields.acceptance_tests || [],
    contract: fields.contract ?? null,
    repository: fields.repository ?? null,
    description: fields.description || '',
  };
  const errors = validateRecipeMetadata(recipe);
  if (errors.length) throw new Error(`invalid recipe metadata: ${errors.join('; ')}`);
  return recipe;
}

export function validateRecipeMetadataRecord(value) {
  const errors = validateRecipeMetadata(value);
  return { ok: errors.length === 0, errors };
}

function validateLifecycleEvent(value) {
  const errors = [];
  add(errors, isObject(value), 'event: must be an object');
  if (!isObject(value)) return errors;
  add(errors, value.schema_version === LIFECYCLE_EVENT_SCHEMA_VERSION, `schema_version: must equal ${LIFECYCLE_EVENT_SCHEMA_VERSION}`);
  add(errors, id(value.event_id), 'event_id: required safe id');
  add(errors, LIFECYCLE_EVENT_TYPES.includes(value.type), `type: must be one of ${LIFECYCLE_EVENT_TYPES.join(' | ')}`);
  add(errors, id(value.site_id), 'site_id: required safe id');
  add(errors, value.run_id == null || id(value.run_id), 'run_id: must be a safe id when supplied');
  add(errors, iso(value.occurred_at), 'occurred_at: required ISO date');
  add(errors, value.environment == null || ENVIRONMENTS.includes(value.environment), 'environment: invalid');
  add(errors, value.status == null || nonEmpty(value.status), 'status: must be non-empty when supplied');
  add(errors, value.payload == null || isObject(value.payload), 'payload: must be an object when supplied');
  add(errors, value.contract_version == null || version(value.contract_version), 'contract_version: invalid when supplied');
  add(errors, value.recipe_versions == null || (stringList(value.recipe_versions) && value.recipe_versions.every(version)), 'recipe_versions: invalid when supplied');
  add(errors, value.evidence_refs == null || stringList(value.evidence_refs), 'evidence_refs: must be a string array when supplied');
  return errors;
}

export function createLifecycleEvent(fields = {}) {
  const event = {
    schema_version: LIFECYCLE_EVENT_SCHEMA_VERSION,
    event_id: fields.event_id || `evt_${crypto.randomUUID().replaceAll('-', '')}`,
    type: fields.type,
    site_id: fields.site_id,
    run_id: fields.run_id ?? null,
    occurred_at: fields.occurred_at || new Date().toISOString(),
    environment: fields.environment ?? null,
    status: fields.status ?? null,
    contract_version: fields.contract_version ?? null,
    recipe_versions: fields.recipe_versions || [],
    evidence_refs: fields.evidence_refs || [],
    payload: fields.payload || {},
  };
  const errors = validateLifecycleEvent(event);
  if (errors.length) throw new Error(`invalid lifecycle event: ${errors.join('; ')}`);
  return event;
}

export function validateLifecycleEventRecord(value) {
  const errors = validateLifecycleEvent(value);
  return { ok: errors.length === 0, errors };
}

function validateLesson(value) {
  const errors = [];
  add(errors, isObject(value), 'lesson: must be an object');
  if (!isObject(value)) return errors;
  add(errors, value.schema_version === LESSON_SCHEMA_VERSION, `schema_version: must equal ${LESSON_SCHEMA_VERSION}`);
  add(errors, id(value.lesson_id), 'lesson_id: required safe id');
  add(errors, id(value.site_id), 'site_id: required safe id');
  add(errors, nonEmpty(value.symptom), 'symptom: required');
  add(errors, nonEmpty(value.root_cause), 'root_cause: required');
  add(errors, nonEmpty(value.generalizable_pattern), 'generalizable_pattern: required');
  add(errors, Array.isArray(value.evidence_refs) && value.evidence_refs.length > 0 && stringList(value.evidence_refs), 'evidence_refs: required non-empty string array');
  add(errors, PROMOTION_STATES.includes(value.promotion_state), `promotion_state: must be one of ${PROMOTION_STATES.join(' | ')}`);
  add(errors, PRIVACY_REVIEW_STATES.includes(value.privacy_review), `privacy_review: must be one of ${PRIVACY_REVIEW_STATES.join(' | ')}`);
  add(errors, iso(value.created_at), 'created_at: required ISO date');
  if (value.recipe_candidate !== undefined) add(errors, value.recipe_candidate === null || version(value.recipe_candidate), 'recipe_candidate: invalid version reference');
  return errors;
}

export function createLessonRecord(fields = {}) {
  const lesson = {
    schema_version: LESSON_SCHEMA_VERSION,
    lesson_id: fields.lesson_id || stableId('lesson', fields),
    site_id: fields.site_id,
    created_at: fields.created_at || new Date().toISOString(),
    symptom: fields.symptom,
    root_cause: fields.root_cause,
    generalizable_pattern: fields.generalizable_pattern,
    evidence_refs: fields.evidence_refs || [],
    recipe_candidate: fields.recipe_candidate ?? null,
    promotion_state: fields.promotion_state || 'local',
    privacy_review: fields.privacy_review || 'pending',
    owner: fields.owner || null,
    resolution: fields.resolution || null,
  };
  const errors = validateLesson(lesson);
  if (errors.length) throw new Error(`invalid lesson record: ${errors.join('; ')}`);
  return lesson;
}

export function validateLessonRecord(value) {
  const errors = validateLesson(value);
  return { ok: errors.length === 0, errors };
}

function validateReceipt(value) {
  const errors = [];
  add(errors, isObject(value), 'receipt: must be an object');
  if (!isObject(value)) return errors;
  add(errors, value.schema_version === EVIDENCE_RECEIPT_SCHEMA_VERSION, `schema_version: must equal ${EVIDENCE_RECEIPT_SCHEMA_VERSION}`);
  add(errors, id(value.receipt_id), 'receipt_id: required safe id');
  add(errors, id(value.site_id), 'site_id: required safe id');
  add(errors, value.run_id == null || id(value.run_id), 'run_id: invalid when supplied');
  add(errors, nonEmpty(value.kind), 'kind: required');
  add(errors, RECEIPT_STATUSES.includes(value.status), `status: must be one of ${RECEIPT_STATUSES.join(' | ')}`);
  add(errors, Array.isArray(value.artifact_refs) && stringList(value.artifact_refs), 'artifact_refs: required string array');
  add(errors, iso(value.recorded_at), 'recorded_at: required ISO date');
  add(errors, value.digest == null || SHA256.test(value.digest), 'digest: must be a sha256 hex string when supplied');
  return errors;
}

export function createEvidenceReceipt(fields = {}) {
  const receipt = {
    schema_version: EVIDENCE_RECEIPT_SCHEMA_VERSION,
    receipt_id: fields.receipt_id || `receipt_${crypto.randomUUID().replaceAll('-', '')}`,
    site_id: fields.site_id,
    run_id: fields.run_id ?? null,
    kind: fields.kind,
    status: fields.status || 'pending',
    artifact_refs: fields.artifact_refs || [],
    recorded_at: fields.recorded_at || new Date().toISOString(),
    digest: fields.digest ?? null,
    details: fields.details || {},
  };
  const errors = validateReceipt(receipt);
  if (errors.length) throw new Error(`invalid evidence receipt: ${errors.join('; ')}`);
  return receipt;
}

export function validateEvidenceReceipt(value) {
  const errors = validateReceipt(value);
  return { ok: errors.length === 0, errors };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(dir, name)));
}

/**
 * File-backed persistence for the portable records. This is deliberately
 * additive to the existing event spine: lifecycle events may be emitted to
 * WebSocket consumers and also recorded as evidence without coupling either
 * layer to a database.
 */
export function createLearningSpine({ paths }) {
  if (!paths || typeof paths.within !== 'function') throw new Error('learning spine requires paths');
  const ensure = () => paths.ensure('learning');
  const file = (kind, idValue, suffix = '.json') => paths.within('learning', kind, `${idValue}${suffix}`);
  const write = (kind, idValue, value) => { ensure(); atomicWrite(file(kind, idValue), value); return value; };
  const read = (kind, idValue) => readJson(file(kind, idValue));
  const list = (kind) => listJson(paths.within('learning', kind));

  return {
    writeSiteManifest(manifest) {
      const result = validateSiteManifestRecord(manifest);
      if (!result.ok) throw new Error(`invalid site manifest: ${result.errors.join('; ')}`);
      return write('sites', manifest.site_id, manifest);
    },
    readSiteManifest(siteId) { return read('sites', siteId); },
    listSiteManifests() { return list('sites'); },
    listSites({ capability_class, environment, recipe } = {}) {
      return list('sites').filter((site) => {
        if (capability_class && site.capability_class !== capability_class) return false;
        if (environment && !site.environments.includes(environment)) return false;
        if (recipe && !site.recipes.includes(recipe)) return false;
        return true;
      });
    },
    writeRecipeMetadata(recipe) {
      const result = validateRecipeMetadataRecord(recipe);
      if (!result.ok) throw new Error(`invalid recipe metadata: ${result.errors.join('; ')}`);
      return write('recipes', `${recipe.id}@${recipe.version}`, recipe);
    },
    readRecipeMetadata(recipeId, recipeVersion) { return read('recipes', `${recipeId}@${recipeVersion}`); },
    listRecipeMetadata() { return list('recipes'); },
    writeLifecycleEvent(event) {
      const result = validateLifecycleEventRecord(event);
      if (!result.ok) throw new Error(`invalid lifecycle event: ${result.errors.join('; ')}`);
      return write('events', event.event_id, event);
    },
    readLifecycleEvent(eventId) { return read('events', eventId); },
    listLifecycleEvents({ site_id, type, status } = {}) {
      return list('events').filter((event) => (!site_id || event.site_id === site_id) && (!type || event.type === type) && (!status || event.status === status));
    },
    writeLesson(lesson) {
      const result = validateLessonRecord(lesson);
      if (!result.ok) throw new Error(`invalid lesson record: ${result.errors.join('; ')}`);
      return write('lessons', lesson.lesson_id, lesson);
    },
    readLesson(lessonId) { return read('lessons', lessonId); },
    listLessons() { return list('lessons'); },
    findLessons({ site_id, promotion_state, privacy_review } = {}) {
      return list('lessons').filter((lesson) => {
        if (site_id && lesson.site_id !== site_id) return false;
        if (promotion_state && lesson.promotion_state !== promotion_state) return false;
        if (privacy_review && lesson.privacy_review !== privacy_review) return false;
        return true;
      });
    },
    promoteLesson({ lesson_id, recipe, validation_receipt_ids = [], owner, resolution } = {}) {
      const lesson = read('lessons', lesson_id);
      if (!lesson) throw new Error(`lesson not found: ${lesson_id}`);
      if (lesson.privacy_review !== 'passed') throw new Error('lesson promotion requires privacy_review=passed');
      if (lesson.promotion_state !== 'candidate') throw new Error('lesson promotion requires promotion_state=candidate');
      if (!nonEmpty(owner)) throw new Error('lesson promotion requires an owner');
      if (!recipe) throw new Error('lesson promotion requires a versioned recipe');
      const recipeResult = validateRecipeMetadataRecord(recipe);
      if (!recipeResult.ok) throw new Error(`invalid promoted recipe: ${recipeResult.errors.join('; ')}`);
      const receipts = validation_receipt_ids.map((receiptId) => read('receipts', receiptId));
      if (receipts.length !== validation_receipt_ids.length || receipts.some((receipt) => !receipt || receipt.status !== 'passed')) {
        throw new Error('lesson promotion requires passed validation receipts');
      }
      const updatedLesson = createLessonRecord({
        ...lesson,
        promotion_state: 'approved',
        recipe_candidate: `${recipe.id}@${recipe.version}`,
        owner,
        resolution: resolution || lesson.resolution || 'Promoted after privacy review and synthetic validation.',
      });
      write('recipes', `${recipe.id}@${recipe.version}`, recipe);
      return write('lessons', updatedLesson.lesson_id, updatedLesson);
    },
    writeReceipt(receipt) {
      const result = validateEvidenceReceipt(receipt);
      if (!result.ok) throw new Error(`invalid evidence receipt: ${result.errors.join('; ')}`);
      return write('receipts', receipt.receipt_id, receipt);
    },
    readReceipt(receiptId) { return read('receipts', receiptId); },
    listReceipts() { return list('receipts'); },
  };
}
