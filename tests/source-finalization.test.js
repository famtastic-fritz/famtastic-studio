import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture, packet } from './staging-worker-fixture.mjs';
import { exportFinalizedSource } from '../server/kernel/source-finalization.js';
import { planSelectedSource } from '../server/kernel/selected-source-plan.js';
let f;
afterEach(() => { f?.cleanup(); f = null; });
it('exports real committed pipeline output without equating pipeline success with completed scope', async () => {
  f = fixture(); const done = await f.worker().run(f.store.accept(packet()).id);
  const initial = done.build.source_export;
  expect(initial.repository.commit).toBe(done.build.repository.commit);
  expect(initial.files.find(file => file.path === 'index.html').sha256).toBe(packet().artifacts[0].sha256);
  expect(initial.scope_complete).toBe(false);
  const scope = { site_id: done.build.site_id, evidence_ref: 'synthetic-recorded-static-scope', required_pages: ['index.html'], features: ['static_navigation'], pending_revisions: [] };
  const complete = exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: scope }, reviewQa: done.qa });
  expect(complete.scope_complete).toBe(true);
  expect(complete.human_accepted).toBe(false); expect(complete.hosting_verified).toBe(false);
  for (const change of [{ required_pages: ['index.html', 'about.html'] }, { features: ['booking'] }, { pending_revisions: ['Change contact details'] }]) {
    expect(exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: { ...scope, ...change } }, reviewQa: done.qa }).scope_complete).toBe(false);
  }
  expect(exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: scope }, reviewQa: { ...done.qa, passed: false } }).scope_complete).toBe(false);
  for (const source_binding of [{ ...done.qa.source_binding, site_id: 'another-site' }, { ...done.qa.source_binding, run_id: 'another-run' }, { ...done.qa.source_binding, manifest_sha256: '0'.repeat(64) }]) {
    expect(exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: scope }, reviewQa: { ...done.qa, source_binding } }).scope_complete).toBe(false);
  }
  expect(exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: { ...scope, site_id: 'another-site' } }, reviewQa: done.qa }).scope_complete).toBe(false);
  expect(() => exportFinalizedSource({ paths: f.paths, result: { ...done.build, repository: { ...done.build.repository, commit: '0'.repeat(40) } }, brief: { completion_scope: scope }, reviewQa: done.qa })).toThrow('source_repository_changed');
  fs.appendFileSync(f.paths.within('sites', done.build.site_id, 'index.html'), '<p>Changed after QA</p>');
  expect(() => exportFinalizedSource({ paths: f.paths, result: done.build, brief: { completion_scope: scope }, reviewQa: done.qa })).toThrow('source_repository_changed');
  const cwd = done.build.repository.repository_path;
  execFileSync('git', ['add', 'index.html'], { cwd });
  execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Synthetic post-QA change'], { cwd });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  expect(() => exportFinalizedSource({ paths: f.paths, result: { ...done.build, repository: { ...done.build.repository, commit } }, brief: { completion_scope: scope }, reviewQa: done.qa })).toThrow('source_verification_bytes_changed');
});
const harness = process.env.SELECTED_SOURCE_INTENT_HARNESS;
it.skipIf(!harness)('plans actual portal-seam legacy-shaped output as remaining work with distinct authority issues', () => {
  const intent = JSON.parse(execFileSync('php', [harness, '--intent'], { encoding: 'utf8' }));
  const plan = planSelectedSource(intent);
  expect(plan.operation).toBe('continue_build'); expect(plan.ready).toBe(false);
  expect(plan.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['scope_features_require_recipe', 'requested_revisions_pending', 'selected_preserving_executor_required', 'output_rights_binding_missing']));
  expect(plan.source_artifacts).toEqual(intent.source.artifacts);
});
