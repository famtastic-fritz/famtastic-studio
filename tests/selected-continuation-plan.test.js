import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture, packet, html } from './staging-worker-fixture.mjs';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { digest } from '../server/kernel/staging-store.js';
import { appendCreatorCredit, CREATOR_LOGO_PATH, creatorLogoAsset } from '../vendor/site-foundation/index.js';
let f;
afterEach(() => f?.cleanup());
function withRecipe() {
  const p = packet(), template = html.replaceAll('Synthetic', '{{TITLE}}').replace('Selected authored content.', '{{BODY}}');
  p.continuation.operation = 'continue_build'; p.continuation.required_pages.push('about.html');
  p.continuation.requested_changes = [{ id: 'about', description: 'Add authored about page' }];
  p.artifacts.push({ role: 'source_material', path: 'proof/template.html', bytes: Buffer.byteLength(template), sha256: digest(template) });
  p.artifact_manifest_sha256 = digest(p.artifacts.map(a => ({ bytes: a.bytes, path: a.path, role: a.role, sha256: a.sha256 })).sort((a,b) => a.path.localeCompare(b.path)));
  p.continuation.recipe = { id: 'selected-html-slots-v1', steps: [{ stage: 'fill_selected_template', path: 'about.html', template_source_path: 'proof/template.html', template_sha256: digest(template), template_url: 'https://assets.example.invalid/template.html', slots: { TITLE: 'About', BODY: 'Authored customer history.' }, design_contract_sha256: digest(p.continuation.brand.design_contract), rights: { status: 'approved', evidence_ref: 'selected-shell' }, resolves_change_ids: ['about'] }] };
  return { p, template };
}
it('continues only missing authored page via selected template, retains originals and transformation evidence', async () => {
  f = fixture(); const { p, template } = withRecipe();
  const opts = f.options(); opts.fetchArtifact = async ({ url }) => Buffer.from(url.endsWith('template.html') ? template : html);
  // Fixture's host handles public-file names; both pages pass real browser QA.
  const worker = createStagingWorker(opts), j = f.store.accept(p), done = await worker.run(j.id);
  expect(done.failure).toBeUndefined(); expect(done.state).toBe('complete');
  expect(f.remote.get('index.html').toString()).toBe(appendCreatorCredit(html));
  const authoredAbout = template.replaceAll('{{TITLE}}', 'About').replaceAll('{{BODY}}', 'Authored customer history.');
  expect(f.remote.get('about.html').toString()).toBe(appendCreatorCredit(authoredAbout, { page: 'about.html' }));
  expect(f.remote.get(CREATOR_LOGO_PATH)).toEqual(creatorLogoAsset().contents);
  expect(done.packet.selected_artifacts[0].source_artifact_sha256).toBe(digest(html));
  expect(done.selected.transformations).toHaveLength(1);
  expect(done.selected.transformations[0]).toMatchObject({ stage: 'fill_selected_template', input_sha256: digest(template), output_sha256: digest(authoredAbout) });
  expect(f.counters.generation).toBe(0);
  f.restart(); await f.worker().run(j.id); expect(f.counters.builds).toBe(1);
});
it('does not pretend packaging is continuation without a recipe', async () => {
  f = fixture(); const p = packet(); p.continuation.operation = 'continue_build';
  const done = await f.worker().run(f.store.accept(p).id);
  expect(done.failure.details).toContain('continuation_recipe_required'); expect(f.counters.builds).toBe(0);
});
it('rejects overwritten completed pages and tampered template evidence', async () => {
  f = fixture(); const { p } = withRecipe(); p.continuation.recipe.steps[0].path = 'index.html'; p.continuation.required_pages = ['index.html'];
  const done = await f.worker().run(f.store.accept(p).id);
  expect(done.failure.details).toContain('continuation_target_invalid'); expect(f.counters.builds).toBe(0);
});
it('rejects a tampered template digest before any missing stage runs', async () => {
  f = fixture(); const { p } = withRecipe(); p.continuation.recipe.steps[0].template_sha256 = '0'.repeat(64);
  const done = await f.worker().run(f.store.accept(p).id);
  expect(done.failure.details).toContain('continuation_template_unbound'); expect(f.counters.builds).toBe(0);
});
