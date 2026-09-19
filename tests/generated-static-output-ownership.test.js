import { test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repositoryTools } from '../server/kernel/compose-repository-tools.js';
import { createRepoScaffold, creatorLogoAsset, CREATOR_LOGO_PATH, appendCreatorCredit } from '../vendor/site-foundation/index.js';
const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-static-output-')); roots.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const scaffold = createRepoScaffold({ site_id: 'ownership-fixture', business_name: 'Fixture', design_contract: { schema_version: 1, source: 'synthetic' } });
  for (const file of [...scaffold.files, ...repositoryTools({ name: 'ownership-fixture', description: 'Test only', publicFiles: ['index.html', CREATOR_LOGO_PATH] }), creatorLogoAsset()]) {
    const absolute = path.join(dir, file.path); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, file.contents);
  }
  fs.writeFileSync(path.join(dir, 'index.html'), appendCreatorCredit('<!doctype html><html><head><title>Fixture</title></head><body><h1>Home</h1></body></html>'));
  const build = () => execFileSync(process.execPath, ['.famtastic/build.mjs'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  return { dir, build, dist: path.join(dir, 'dist') };
}
test('generated build never adopts arbitrary existing output', () => {
  const { dir, dist, build } = fixture(); fs.mkdirSync(dist); fs.writeFileSync(path.join(dist, 'authored.html'), 'Keep this');
  expect(build).toThrow(); expect(fs.readFileSync(path.join(dist, 'authored.html'), 'utf8')).toBe('Keep this');
  expect(fs.existsSync(path.join(dir, '.git/famtastic-static-dist.json'))).toBe(false);
});
test('exact generated output can rebuild but changed files and extra directories are preserved', () => {
  const { dist, build } = fixture(); expect(build()).toContain('Built 2'); expect(build()).toContain('Built 2');
  fs.mkdirSync(path.join(dist, 'keep-empty-directory'));
  expect(build).toThrow(); expect(fs.existsSync(path.join(dist, 'keep-empty-directory'))).toBe(true);
  fs.rmdirSync(path.join(dist, 'keep-empty-directory'));
  fs.writeFileSync(path.join(dist, 'index.html'), 'Authored replacement');
  expect(build).toThrow(); expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe('Authored replacement');
});
test('tracked dist and public/output symlinks fail without changing either target', () => {
  const { dir, dist, build } = fixture(); build();
  execFileSync('git', ['add', '-f', '--', 'dist/index.html'], { cwd: dir });
  expect(build).toThrow(); expect(fs.existsSync(path.join(dist, 'index.html'))).toBe(true);
  execFileSync('git', ['rm', '--cached', '--', 'dist/index.html'], { cwd: dir });
  const outside = path.join(dir, 'authored.html'); fs.writeFileSync(outside, 'Do not touch');
  fs.symlinkSync(outside, path.join(dist, 'linked.html'));
  expect(build).toThrow(); expect(fs.readFileSync(outside, 'utf8')).toBe('Do not touch');
});
test('missing credit rejects a new build before replacing the previously receipted output', () => {
  const { dir, dist, build } = fixture(); build();
  const before = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><h1>Uncredited revision</h1></body></html>');
  expect(build).toThrow(/creator_credit_required/);
  expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe(before);
});
