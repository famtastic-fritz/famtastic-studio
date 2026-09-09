import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaths } from '../server/kernel/paths.js';
import {
  createEvidenceReceipt,
  createLearningSpine,
  createLessonRecord,
  createLifecycleEvent,
  createRecipeMetadata,
  createSiteManifest,
  validateEvidenceReceipt,
  validateLessonRecord,
  validateLifecycleEventRecord,
  validateRecipeMetadataRecord,
  validateSiteManifestRecord,
} from '../server/kernel/learning-spine.js';

let root;
let paths;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-spine-'));
  process.env.STUDIO_DATA_ROOT = root;
  paths = createPaths();
});

afterEach(() => {
  delete process.env.STUDIO_DATA_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('learning spine contracts', () => {
  it('creates and validates a site manifest with pinned contracts and recipes', () => {
    const manifest = createSiteManifest({
      site_id: 'mbsh96reunion',
      name: 'MBSH Reunion',
      owner: 'team/famtastic-platform',
      repository: 'site-mbsh-reunion-event-cinema',
      contract: 'design-contract@1',
      recipes: ['event-cinema@1', 'portal@1'],
      capability_class: 'application',
      environments: ['local', 'staging', 'production'],
    });
    expect(validateSiteManifestRecord(manifest)).toEqual({ ok: true, errors: [] });
    expect(manifest.parity_gate).toBe('required');
  });

  it('rejects an unpinned recipe or unknown capability', () => {
    const result = validateSiteManifestRecord({
      schema_version: 1,
      site_id: 'acme', name: 'Acme', owner: 'team/acme', contract: 'design-contract@1',
      recipes: ['event-cinema'], capability_class: 'unknown', environments: ['local'], parity_gate: 'required',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/recipes|capability_class/);
  });

  it('requires acceptance tests and maturity for a reusable recipe', () => {
    const recipe = createRecipeMetadata({
      id: 'event-cinema', version: '1.0.0', name: 'Event Cinema', owner: 'team/platform',
      maturity: 'candidate', capabilities: ['shared-shell', 'portal'], inputs: ['brand', 'pages'],
      acceptance_tests: ['public shell parity', 'portal authorization'], contract: 'design-contract@1',
    });
    expect(validateRecipeMetadataRecord(recipe).ok).toBe(true);
    expect(validateRecipeMetadataRecord({ ...recipe, acceptance_tests: [] }).ok).toBe(false);
  });

  it('creates a lifecycle event that links contracts, recipes, and evidence', () => {
    const event = createLifecycleEvent({
      type: 'build.succeeded', site_id: 'shay-locs', run_id: 'run-123', environment: 'staging', status: 'passed',
      contract_version: 'design-contract@1', recipe_versions: ['web-basics@1'], evidence_refs: ['receipt_123'],
      payload: { artifact_manifest_sha: 'sha256:fixture' },
    });
    expect(validateLifecycleEventRecord(event)).toEqual({ ok: true, errors: [] });
    expect(event.schema_version).toBe(1);
    expect(validateLifecycleEventRecord({ ...event, type: 'unknown.event' }).ok).toBe(false);
  });

  it('does not allow lessons to promote without evidence and privacy review', () => {
    const lesson = createLessonRecord({
      site_id: 'mbsh96reunion', symptom: 'navigation diverged', root_cause: 'pages owned nav markup',
      generalizable_pattern: 'all public pages mount shared shell', evidence_refs: ['receipt-shell-qa'],
      recipe_candidate: 'public-shell@1', promotion_state: 'candidate', privacy_review: 'passed', owner: 'team/platform',
    });
    expect(validateLessonRecord(lesson).ok).toBe(true);
    expect(validateLessonRecord({ ...lesson, evidence_refs: [], privacy_review: 'pending' }).ok).toBe(false);
  });

  it('requires a receipt status and retains a digest when supplied', () => {
    const receipt = createEvidenceReceipt({
      site_id: 'shay-locs', run_id: 'run-123', kind: 'visual-parity', status: 'passed',
      artifact_refs: ['screenshots/mobile.png', 'screenshots/desktop.png'], digest: 'a'.repeat(64),
    });
    expect(validateEvidenceReceipt(receipt).ok).toBe(true);
    expect(validateEvidenceReceipt({ ...receipt, digest: 'not-a-digest' }).ok).toBe(false);
  });
});

describe('learning spine persistence', () => {
  it('persists records atomically and keeps lists scoped by record type', () => {
    const spine = createLearningSpine({ paths });
    const manifest = createSiteManifest({
      site_id: 'acme', name: 'Acme', owner: 'team/acme', contract: 'design-contract@1',
      recipes: ['web-basics@1'], capability_class: 'brochure', environments: ['local'],
    });
    const recipe = createRecipeMetadata({
      id: 'web-basics', version: '1.0.0', name: 'Web Basics', owner: 'team/platform',
      capabilities: ['static-site'], inputs: ['brand'], acceptance_tests: ['visual parity'],
    });
    const lesson = createLessonRecord({
      site_id: 'acme', symptom: 'slow proof review', root_cause: 'unclear next step',
      generalizable_pattern: 'show one next action', evidence_refs: ['receipt-1'],
    });
    spine.writeSiteManifest(manifest);
    spine.writeRecipeMetadata(recipe);
    spine.writeLesson(lesson);
    expect(spine.readSiteManifest('acme')).toEqual(manifest);
    expect(spine.readRecipeMetadata('web-basics', '1.0.0')).toEqual(recipe);
    expect(spine.listLessons()).toHaveLength(1);
    expect(fs.existsSync(paths.within('learning', 'sites', 'acme.json'))).toBe(true);
    expect(spine.readSiteManifest('other')).toBeNull();
  });

  it('refuses traversal through the persisted identity boundary', () => {
    const spine = createLearningSpine({ paths });
    expect(() => spine.readSiteManifest('../other')).toThrow(/path traversal|path escapes/);
  });

  it('queries the site catalog and promotes only a privacy-reviewed, validated lesson', () => {
    const spine = createLearningSpine({ paths });
    const manifest = createSiteManifest({
      site_id: 'mbsh96reunion', name: 'MBSH Reunion', owner: 'team/platform', contract: 'design-contract@1',
      recipes: ['event-cinema@1'], capability_class: 'application', environments: ['local', 'staging'],
    });
    const receipt = createEvidenceReceipt({ site_id: 'mbsh96reunion', kind: 'synthetic-recipe-validation', status: 'passed', artifact_refs: ['fixture/report.json'] });
    const lesson = createLessonRecord({
      site_id: 'mbsh96reunion', symptom: 'shared shell drifted', root_cause: 'pages owned navigation markup',
      generalizable_pattern: 'mount one shared shell from a versioned recipe', evidence_refs: [receipt.receipt_id],
      promotion_state: 'candidate', privacy_review: 'passed', recipe_candidate: 'event-cinema@1',
    });
    const recipe = createRecipeMetadata({
      id: 'event-cinema', version: '1.0.0', name: 'Event Cinema', owner: 'team/platform', maturity: 'standard',
      capabilities: ['shared-shell'], inputs: ['design-contract'], acceptance_tests: ['shell parity'], contract: 'design-contract@1',
    });
    spine.writeSiteManifest(manifest); spine.writeReceipt(receipt); spine.writeLesson(lesson);
    expect(spine.listSites({ capability_class: 'application', environment: 'staging' })).toHaveLength(1);
    const promoted = spine.promoteLesson({ lesson_id: lesson.lesson_id, recipe, validation_receipt_ids: [receipt.receipt_id], owner: 'team/platform' });
    expect(promoted.promotion_state).toBe('approved');
    expect(spine.readRecipeMetadata('event-cinema', '1.0.0').maturity).toBe('standard');
    expect(spine.findLessons({ promotion_state: 'approved' })).toHaveLength(1);
  });
});
