import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import { createShayRoutine } from '../server/kernel/shay-routine.js';
import { git, requireRepositoryContract } from '../vendor/site-foundation/index.js';
import { stubResearchOptions } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';

let root; let previous;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-guard-')); previous = process.env.STUDIO_DATA_ROOT; process.env.STUDIO_DATA_ROOT = root; });
afterEach(() => { if (previous === undefined) delete process.env.STUDIO_DATA_ROOT; else process.env.STUDIO_DATA_ROOT = previous; fs.rmSync(root, { recursive: true }); });
function context(config = loadPathsConfig()) {
  const paths = createPaths(config); const journal = createJournal({ paths }); const events = createEvents({ paths }); const dna = createDna({ paths }); const mutation = createMutation({ paths, journal, events }); const spec = createSpec({ paths, mutation });
  const options = { paths, journal, events, dna, mutation, spec, researchOptions: stubResearchOptions, copyOptions: makeCopyStub() };
  return { ...options, pipeline: createPipeline(options) };
}
const brief = { business: { name: 'Independent Fixture' }, site_needs: { pages: ['home'] } };
describe('all creation paths require the source repository contract', () => {
  it('direct pipeline creates the same foundation and rebuild preserves authored source', async () => {
    const { paths, pipeline } = context();
    const first = await pipeline.run({ site_id: 'independent-fixture', brief });
    expect(first.outcome).toBe('success');
    const dir = paths.within('sites', 'independent-fixture');
    expect(requireRepositoryContract(dir).format).toBe('source_repository');
    expect(first.repository.repository_state).toBe('local_only');
    const clone = path.join(root, 'independent-clone');
    git(root, ['clone', '--no-hardlinks', dir, clone]);
    const standalone = JSON.parse(execFileSync(process.execPath, ['.famtastic/verify-repository.mjs'], { cwd: clone, encoding: 'utf8' }));
    expect(standalone.valid).toBe(true);
    fs.appendFileSync(path.join(dir, 'design.md'), '\nCustomer-authored approved refinement.\n');
    fs.mkdirSync(path.join(dir, 'backend')); fs.writeFileSync(path.join(dir, 'backend/notes.md'), 'Do not delete backend sources.');
    git(dir, ['add', '--all']); git(dir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Authored baseline']);
    const design = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
    expect((await pipeline.run({ site_id: 'independent-fixture', brief })).outcome).toBe('success');
    expect(fs.readFileSync(path.join(dir, 'design.md'), 'utf8')).toBe(design);
    expect(fs.readFileSync(path.join(dir, 'backend/notes.md'), 'utf8')).toContain('Do not delete');
    expect(fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
  it('conversational and direct paths reject an agency child before target writes', async () => {
    const config = loadPathsConfig(); const { paths, pipeline, ...options } = context(config);
    fs.mkdirSync(paths.root('sites'), { recursive: true }); git(paths.root('sites'), ['init', '-b', 'main']);
    await expect(pipeline.run({ site_id: 'blocked-site', brief })).rejects.toThrow(/inside another Git/);
    await expect(createShayRoutine({ paths, ...options }).executeIntakeAndBuild({ prompt: 'Build Blocked Site', site_id: 'blocked-site', brief })).rejects.toThrow(/inside another Git/);
    expect(fs.existsSync(paths.within('sites', 'blocked-site'))).toBe(false);
  });
  it('dirty targets and duplicate identities stop without overwriting authored files', async () => {
    const { paths, pipeline } = context();
    await pipeline.run({ site_id: 'independent-fixture', brief });
    const dir = paths.within('sites', 'independent-fixture');
    fs.appendFileSync(path.join(dir, 'design.md'), '\nUncommitted client decision.');
    const before = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
    await expect(pipeline.run({ site_id: 'independent-fixture', brief })).rejects.toThrow(/uncommitted/);
    expect(fs.readFileSync(path.join(dir, 'design.md'), 'utf8')).toBe(before);
  });
  it('a pending operator design change is not overwritten by a new derived palette', async () => {
    const { paths, pipeline } = context();
    await pipeline.run({ site_id: 'independent-fixture', brief });
    const dir = paths.within('sites', 'independent-fixture');
    const before = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
    const changed = await pipeline.run({ site_id: 'independent-fixture', brief: { ...brief, business: { ...brief.business, palette_direction: 'Crimson red #e11d48 and white #ffffff' }, brand: { palette_direction: 'Crimson red #e11d48 and white #ffffff' } } });
    expect(changed.outcome).toBe('failed');
    expect(changed.error.code).toBe('design_revision_required');
    expect(fs.readFileSync(path.join(dir, 'styles.css'), 'utf8')).toBe(before);
  });
});
