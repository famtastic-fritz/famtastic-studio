import { afterEach, expect, it } from 'vitest';
import { shellFixture, css } from './legacy-shared-shell-fixture.mjs';
import { assembleLegacySharedShell } from '../server/kernel/legacy-shared-shell.js';
import { continuationPlanErrors } from '../server/kernel/selected-continuation-plan.js';
import { fixture } from './staging-worker-fixture.mjs';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { createSelectedSourceResolver } from '../server/kernel/selected-source-binding.js';
import { digest } from '../server/kernel/staging-store.js';
import fs from 'node:fs';
let f;
afterEach(() => { f?.cleanup(); f = null; });
it.each([false, true])('assembles only the absent authored page with actual browser QA and callback (external CSS: %s)', async externalCss => {
  const s = shellFixture({ externalCss }); f = fixture();
  const options = { ...f.options(), fetchArtifact: async ({ url }) => s.source.get(new URL(url).pathname.slice(1)) };
  const worker = createStagingWorker(options), job = f.store.accept(s.p);
  const done = await worker.run(job.id);
  expect(done.failure).toBeUndefined(); expect(done.state, JSON.stringify({ history: done.history, qa: done.qa?.problems })).toBe('complete');
  expect(f.remote.get('index.html').toString()).toBe(s.selected);
  const about = f.remote.get('about.html').toString();
  expect(about).toContain('Customer authored &lt;story&gt; &amp; care.');
  expect(about).toContain('<title>About the synthetic business</title>');
  expect(about).not.toContain('Original home description');
  if (externalCss) expect(f.remote.get('assets/styles.css').toString()).toBe(css);
  expect(done.qa.evidence.filter(e => e.path === 'about.html').map(e => e.width)).toEqual([390, 768, 1280]);
  expect(done.source_export.scope_complete).toBe(true);
  expect(done.selected.transformations[0]).toMatchObject({ recipe: 'legacy-shared-shell-v1', content_record_id: 'owned-content:about', content_revision: 1, generation_provider_calls: 0 });
  expect(done.selected.transformations[0].head_changes).toEqual(['head/title', 'head/description']);
  expect(f.counters.generation).toBe(0); expect(f.counters.builds).toBe(1);
  f.restart(); await createStagingWorker({ ...options, store: f.store }).run(job.id); expect(f.counters.builds).toBe(1);
});
it.each([
  [{ selected: s => s.replace('</h1>', '') }, 'shell_nesting_ambiguous'],
  [{ selected: s => s.replace('data-field-id="body"', 'data-field-id="heading"') }, 'shell_identity_ambiguous'],
  [{ selected: s => s.replace('<main', '<script>alert(1)</script><main') }, 'shell_active_content_unsupported'],
  [{ selected: s => s.replace('<section ', '<section onclick="alert(1)" ') }, 'shell_attribute_unsafe'],
  [{ selected: s => s.replace('href="index.html"', 'href="javascript:alert(1)"') }, 'shell_url_unsafe'],
  [{ selected: s => s.replace('</head>', '<link rel="stylesheet" href="https://example.test/remote.css"></head>') }, 'shell_external_resource_unsupported'],
  [{ selected: s => s.replace('<section ', '<form><section ').replace('</section>', '</section></form>') }, 'shell_active_content_unsupported'],
  [{ selected: s => s.replace('data-field-type="text"', 'data-field-type="html"') }, 'shell_field_type_unsupported'],
  [{ template: s => s.replace('>Home</a>', '>Different</a>') }, 'shell_chrome_mismatch'],
  [{ template: s => s.replace('margin:0', 'margin:5px') }, 'shell_shared_style_mismatch'],
  [{ content: c => { delete c.fields['intro/body']; } }, 'shell_content_fields_incomplete'],
  [{ staleContent: c => { c.revision++; } }, 'shell_transformation_permission_stale'],
  [{ permission: p => { p.status = 'revoked'; } }, 'shell_transformation_permission_stale'],
  [{ permission: p => { p.output_path = 'different.html'; } }, 'shell_transformation_permission_stale'],
  [{ selected: s => s.replace('</head>', '<link rel="canonical" href="index.html"></head>') }, 'shell_head_metadata_unsupported'],
])('refuses ambiguous renderer source or missing/stale content authority (%s)', (options, code) => {
  expect(() => assembleLegacySharedShell(shellFixture(options).renderer)).toThrow(code);
});
it('rejects duplicate, existing, nested outputs and changed record digests before rendering', () => {
  const s = shellFixture();
  s.p.continuation.recipe.steps.push({ ...s.step }); expect(continuationPlanErrors(s.p)).toContain('continuation_target_invalid');
  s.p.continuation.recipe.steps = [{ ...s.step, path: 'index.html' }]; expect(continuationPlanErrors(s.p)).toContain('continuation_target_invalid');
  s.p.continuation.recipe.steps = [{ ...s.step, path: 'Index.html' }]; expect(continuationPlanErrors(s.p)).toContain('continuation_target_invalid');
  s.p.continuation.recipe.steps = [{ ...s.step, path: 'nested/about.html' }]; expect(continuationPlanErrors(s.p)).toContain('continuation_target_invalid');
  s.p.continuation.recipe.steps = [{ ...s.step, permission_sha256: '0'.repeat(64) }]; expect(continuationPlanErrors(s.p)).toContain('shell_permission_record_unbound');
});
it('never emits ready callback when assembled-page resources fail browser QA', async () => {
  const s = shellFixture({ selected: html => html.replace('</head>', '<link rel="stylesheet" href="missing.css"></head>') }); f = fixture();
  const worker = createStagingWorker({ ...f.options(), fetchArtifact: async ({ url }) => s.source.get(new URL(url).pathname.slice(1)) });
  const job = f.store.accept(s.p); let done;
  for (let i = 0; i < 3; i++) done = await worker.run(job.id);
  expect(['qa_failed', 'build_failed']).toContain(done.failure.code); expect(f.counters.uploads).toBe(0);
  if (done.failure.code === 'build_failed') expect(done.build.failed_stage).toBe('verify');
  expect(done.callback_body.schema).toBe('famtastic.site-studio.staging-failure.v1');
  expect(done.callback_body).not.toHaveProperty('staging_url'); expect(f.counters.builds).toBe(1);
});
it('continues a mapped existing source in its one repository while preserving completed pages and authored records', async () => {
  const first = shellFixture(); f = fixture();
  const initialWorker = createStagingWorker({ ...f.options(), fetchArtifact: async ({ url }) => first.source.get(new URL(url).pathname.slice(1)) });
  const initial = await initialWorker.run(f.store.accept(first.p).id);
  expect(initial.state).toBe('complete');
  const aboutBytes = Buffer.from(f.remote.get('about.html'));
  const readme = fs.readFileSync(f.paths.within('sites', initial.build.site_id, 'README.md'));
  const next = shellFixture({ outputPath: 'team.html', content: c => { c.fields['head/title'] = 'Our team'; c.fields['intro/heading'] = 'Our team'; } });
  next.p.packet_id = 'packet-2'; next.p.idempotency_key = 'idem-2'; next.p.continuation.selection_revision = 2;
  next.p.continuation.initiating_system = 'studio'; next.p.continuation.source_export_sha256 = initial.source_export.sha256;
  next.p.continuation.required_pages.push('about.html'); next.source.set('proof/about.html', aboutBytes);
  next.p.artifacts.push({ role: 'source_material', path: 'proof/about.html', bytes: aboutBytes.length, sha256: digest(aboutBytes) });
  next.p.continuation.files.push({ path: 'about.html', source_path: 'proof/about.html', url: 'https://assets.example.invalid/proof/about.html', rights: { status: 'approved', evidence_ref: 'existing-authorized-about-record' } });
  next.p.artifact_manifest_sha256 = digest(next.p.artifacts.map(a => ({ bytes: a.bytes, path: a.path, role: a.role, sha256: a.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const resolveSource = createSelectedSourceResolver({ paths: f.paths, mappings: [{ project_id: '42', customer_id: 'customer-1', evidence_ref: 'existing-source-mapping',
    site_id: initial.build.site_id, repository_path: initial.build.repository.repository_path, run_id: initial.source_export.run_id, source_export_sha256: initial.source_export.sha256 }] });
  const worker = createStagingWorker({ ...f.options(), resolveSource, fetchArtifact: async ({ url }) => next.source.get(new URL(url).pathname.slice(1)) });
  const done = await worker.run(f.store.accept(next.p).id);
  expect(done.failure).toBeUndefined(); expect(done.state).toBe('complete');
  expect(done.build.repository.repository_path).toBe(initial.build.repository.repository_path);
  expect(f.remote.get('index.html').toString()).toBe(first.selected); expect(f.remote.get('about.html')).toEqual(aboutBytes);
  expect(f.remote.get('team.html').toString()).toContain('<title>Our team</title>');
  expect(fs.readFileSync(f.paths.within('sites', done.build.site_id, 'README.md'))).toEqual(readme);
  expect(f.counters.builds).toBe(2); expect(f.counters.generation).toBe(0);
  expect((await worker.run(done.id)).state).toBe('complete'); expect(f.counters.builds).toBe(2);
  await expect(f.pipeline.run({ site_id: done.build.site_id, brief: { handoff: { transformations: [{ path: 'About.html' }] } } })).rejects.toMatchObject({ code: 'continuation_target_already_exists' });
  expect(fs.readFileSync(f.paths.within('sites', done.build.site_id, 'about.html'))).toEqual(aboutBytes);
});
