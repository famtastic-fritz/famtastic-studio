import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRepoScaffold, scaffoldChanges, preflightRepository, requireRepositoryContract, git, dirtySnapshot } from './index.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-test-'));
const scaffold = (id = 'customer-a') => createRepoScaffold({ site_id: id, business_name: 'Customer A', design_contract: { schema_version: 1, tokens: { background: '#fff', foreground: '#111' } } });
function write(root, files) { for (const file of files) { const full = path.join(root, file.path); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, file.contents); } }
function repository(root, id = 'customer-a') {
  fs.mkdirSync(root, { recursive: true }); git(root, ['init', '-b', 'main']);
  write(root, scaffold(id).files); git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture']);
}
function tree(root) { return fs.readdirSync(root).sort(); }

test('fresh clone runs its vendored validator without a neighboring studio', () => {
  const base = temp(); const root = path.join(base, 'site'); repository(root);
  const clone = path.join(base, 'clone'); git(base, ['clone', '--no-hardlinks', root, clone]);
  assert.equal(requireRepositoryContract(clone).business_owner.name, 'Customer A');
  assert.equal(preflightRepository({ repository_path: clone, site_id: 'customer-a' }).initialized, true);
  fs.rmSync(base, { recursive: true });
});
test('wrong root and nested Git rejection leave all target bytes unchanged', () => {
  const base = temp(); const root = path.join(base, 'platform'); repository(root, 'platform');
  const before = tree(root);
  assert.throws(() => preflightRepository({ repository_path: path.join(root, 'customer'), site_id: 'customer-a', allow_uninitialized: true }), /inside another Git/);
  assert.deepEqual(tree(root), before);
  const nested = path.join(root, 'nested'); repository(nested);
  assert.throws(() => preflightRepository({ repository_path: nested, site_id: 'customer-a' }), /outside agency/);
  fs.rmSync(base, { recursive: true });
});
test('ignored checkout collections allow independent sites but reject tracked targets', () => {
  const base = temp(); const parent = path.join(base, 'ecosystem'); repository(parent, 'platform');
  fs.writeFileSync(path.join(parent, '.gitignore'), '/sites/\n');
  git(parent, ['add', '.gitignore']);
  git(parent, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Ignore customer checkouts']);
  const site = path.join(parent, 'sites/site-customer-a');
  assert.equal(preflightRepository({ repository_path: site, site_id: 'customer-a', allow_uninitialized: true }).initialized, false);
  repository(site);
  assert.equal(preflightRepository({ repository_path: site, site_id: 'customer-a' }).initialized, true);
  assert.equal(git(parent, ['status', '--porcelain']), '');
  git(parent, ['add', '-f', 'sites/site-customer-a']);
  assert.throws(() => preflightRepository({ repository_path: site, site_id: 'customer-a' }), /outside agency/);
  fs.rmSync(base, { recursive: true });
});
test('foreign remote, dirty files and duplicate site identity fail before mutations', () => {
  const base = temp(); const root = path.join(base, 'site'); repository(root);
  git(root, ['remote', 'add', 'origin', 'https://github.com/owner/site-a.git']);
  assert.throws(() => preflightRepository({ repository_path: root, site_id: 'customer-a', remote_url: 'https://github.com/owner/site-b.git' }), /differs/);
  assert.equal(git(root, ['remote', 'get-url', 'origin']), 'https://github.com/owner/site-a.git');
  assert.throws(() => preflightRepository({ repository_path: root, site_id: 'customer-b' }), /different site/);
  assert.throws(() => preflightRepository({ repository_path: root, site_id: 'customer-a', registry: [{ site_id: 'customer-a', repository_path: path.join(base, 'other') }] }), /already bound/);
  fs.writeFileSync(path.join(root, 'design.md'), 'Important authored change');
  assert.throws(() => preflightRepository({ repository_path: root, site_id: 'customer-a' }), /uncommitted/);
  const expected = dirtySnapshot(root);
  assert.doesNotThrow(() => preflightRepository({ repository_path: root, site_id: 'customer-a', expected_changes: expected }));
  fs.appendFileSync(path.join(root, 'design.md'), ' changed after receipt');
  assert.throws(() => preflightRepository({ repository_path: root, site_id: 'customer-a', expected_changes: expected }), /differ/);
  fs.rmSync(base, { recursive: true });
});
test('customer worktrees are allowed but cannot borrow agency common-directory identity', () => {
  const base = temp(); const root = path.join(base, 'source'); repository(root);
  const wt = path.join(base, 'worktree'); git(root, ['worktree', 'add', '-b', 'codex/test', wt]);
  assert.doesNotThrow(() => preflightRepository({ repository_path: wt, site_id: 'customer-a' }));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.famtastic/site-manifest.json')));
  manifest.site_id = 'agency'; fs.writeFileSync(path.join(root, '.famtastic/site-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => preflightRepository({ repository_path: wt, site_id: 'customer-a' }), /common directory/);
  fs.rmSync(base, { recursive: true });
});
test('rebuild preserves authored documentation and backend; scaffold never follows symlinks', () => {
  const base = temp(); const root = path.join(base, 'site'); repository(root);
  fs.mkdirSync(path.join(root, 'application')); fs.writeFileSync(path.join(root, 'application/server.php'), 'customer backend');
  fs.writeFileSync(path.join(root, 'design.md'), 'Customer-authored design');
  assert.deepEqual(scaffoldChanges(root, scaffold()), []);
  assert.equal(fs.readFileSync(path.join(root, 'application/server.php'), 'utf8'), 'customer backend');
  fs.unlinkSync(path.join(root, 'GEMINI.md')); fs.symlinkSync(path.join(root, 'design.md'), path.join(root, 'GEMINI.md'));
  assert.throws(() => scaffoldChanges(root, scaffold()), /symlink/);
  fs.rmSync(base, { recursive: true });
});
