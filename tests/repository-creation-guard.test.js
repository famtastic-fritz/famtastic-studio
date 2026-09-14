import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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
    const lockBefore = fs.readFileSync(path.join(clone, 'package-lock.json'), 'utf8');
    execFileSync('npm', ['ci', '--ignore-scripts'], { cwd: clone, stdio: 'pipe' });
    execFileSync('npm', ['test'], { cwd: clone, stdio: 'pipe' });
    const built = execFileSync('npm', ['run', 'build'], { cwd: clone, encoding: 'utf8' });
    expect(built).toContain('independent source records and actual generated HTML');
    expect(built).toContain('allowlisted public files into dist/');
    expect(JSON.parse(fs.readFileSync(path.join(clone, 'package.json'))).scripts.build).not.toContain('echo');
    expect(fs.readFileSync(path.join(clone, 'package-lock.json'), 'utf8')).toBe(lockBefore);
    const privateFiles = ['AGENTS.md', 'docs/research/README.md', '.git/config', '.famtastic/site-manifest.json', 'package.json', 'package-lock.json', 'spec.json', 'blueprint.json', 'design-dna.json'];
    expect(fs.readFileSync(path.join(clone, 'dist/index.html'), 'utf8')).toContain('<!doctype html>');
    for (const file of privateFiles) expect(fs.existsSync(path.join(clone, 'dist', file))).toBe(false);
    const homepage = fs.readFileSync(path.join(clone, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(clone, 'index.html'), homepage.replace(/<h1[\s\S]*?<\/h1>/, ''));
    expect(() => execFileSync('npm', ['run', 'build'], { cwd: clone, stdio: 'pipe' })).toThrow();
    expect(fs.readFileSync(path.join(clone, 'dist/index.html'), 'utf8')).toBe(homepage);
    fs.writeFileSync(path.join(clone, 'index.html'), homepage);
    const publicList = fs.readFileSync(path.join(clone, '.famtastic/public-files.json'), 'utf8');
    fs.writeFileSync(path.join(clone, '.famtastic/public-files.json'), JSON.stringify(JSON.parse(publicList).files));
    expect(execFileSync(process.execPath, ['.famtastic/build.mjs'], { cwd: clone, encoding: 'utf8' })).toContain('allowlisted public files into dist/');
    fs.writeFileSync(path.join(clone, '.famtastic/public-files.json'), JSON.stringify({ schema_version: 1, files: ['index.html', 'spec.json'] }));
    expect(() => execFileSync(process.execPath, ['.famtastic/build.mjs'], { cwd: clone, stdio: 'pipe' })).toThrow();
    expect(fs.readFileSync(path.join(clone, 'dist/index.html'), 'utf8')).toBe(homepage);
    fs.writeFileSync(path.join(clone, '.famtastic/public-files.json'), publicList);
    const preview = spawn(process.execPath, ['.famtastic/preview.mjs'], { cwd: clone, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
        preview.stdout.on('data', chunk => { const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk)); if (match) { clearTimeout(timer); resolve(match[0]); } });
        preview.on('error', reject);
      });
      expect((await fetch(`${url}/index.html`)).status).toBe(200);
      for (const file of privateFiles) expect((await fetch(`${url}/${file}`)).status).toBe(404);
    } finally { preview.kill('SIGTERM'); }
    fs.appendFileSync(path.join(dir, 'design.md'), '\nCustomer-authored approved refinement.\n');
    fs.mkdirSync(path.join(dir, 'backend')); fs.writeFileSync(path.join(dir, 'backend/notes.md'), 'Do not delete backend sources.');
    fs.writeFileSync(path.join(dir, '.htaccess'), '# Authored server boundary\n');
    fs.writeFileSync(path.join(dir, 'backend/handler.php'), '<?php /* preserve the application */');
    git(dir, ['add', '--all']); git(dir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Authored baseline']);
    const design = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
    expect((await pipeline.run({ site_id: 'independent-fixture', brief })).outcome).toBe('success');
    expect(fs.readFileSync(path.join(dir, 'design.md'), 'utf8')).toBe(design);
    expect(fs.readFileSync(path.join(dir, 'backend/notes.md'), 'utf8')).toContain('Do not delete');
    expect(fs.readFileSync(path.join(dir, '.htaccess'), 'utf8')).toBe('# Authored server boundary\n');
    expect(fs.readFileSync(path.join(dir, 'backend/handler.php'), 'utf8')).toContain('preserve the application');
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
