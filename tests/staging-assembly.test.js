import { afterEach, expect, it } from 'vitest';
import { fixture, packet, html } from './staging-worker-fixture.mjs';
import { mockCpanelHttp } from './cpanel-http-fixture.mjs';
import { createSelectedStagingAssembly } from '../server/kernel/selected-staging-assembly.js';
let f, runtime;
afterEach(() => { runtime?.close(); f?.cleanup(); });
it('real runtime assembly serializes cPanel HTTP, protection, backup, bytes and callback with synthetic responses', async () => {
  f = fixture(); const p = packet(), callbackEndpoint = 'https://designs.example.invalid/api/pipeline/site-studio/callback';
  const mock = mockCpanelHttp({ binding: f.binding, html, artifactUrl: p.continuation.files[0].url, callbackEndpoint });
  runtime = createSelectedStagingAssembly({ paths: f.paths, bindings: [{ binding: f.binding, authFile: '/home/nineoo/.famtastic-review/synthetic.htpasswd', reviewAuthorization: 'Basic synthetic-review' }],
    credentialProvider: async () => 'synthetic-token', callbackEndpoint, callbackSecret: 'synthetic-callback', artifactOrigins: ['https://assets.example.invalid'], fetchImpl: mock.fetchImpl });
  expect(mock.calls).toHaveLength(0);
  const job = runtime.store.accept(p); const [done] = await runtime.wake();
  expect(done.failure).toBeUndefined(); expect(done.state).toBe('complete');
  expect(mock.callbacks[0]).toMatchObject({ final_launch: false, checkout_eligible: false });
  expect(mock.files.get(`${f.binding.target_path}/index.html`).toString()).toBe(html);
  expect(mock.files.has('/home/nineoo/.famtastic-review/project-42.lock.json')).toBe(false);
  expect(mock.calls.some(c => c.route === '/execute/Fileman/upload_files')).toBe(true);
  expect(runtime.store.read(job.id).state).toBe('complete');
});
it('real HTTP assembly recovers partial upload without another local build or ready callback', async () => {
  f = fixture(); const p = packet(), callbackEndpoint = 'https://designs.example.invalid/api/pipeline/site-studio/callback';
  const mock = mockCpanelHttp({ binding: f.binding, html, artifactUrl: p.continuation.files[0].url, callbackEndpoint });
  mock.controls.partial = true;
  runtime = createSelectedStagingAssembly({ paths: f.paths, bindings: [{ binding: f.binding, authFile: '/home/nineoo/.famtastic-review/synthetic.htpasswd', reviewAuthorization: 'Basic synthetic-review' }], credentialProvider: async () => 'synthetic-token', callbackEndpoint, callbackSecret: 'synthetic-callback', artifactOrigins: ['https://assets.example.invalid'], fetchImpl: mock.fetchImpl });
  runtime.store.accept(p); expect((await runtime.wake())[0].state).toBe('retry'); expect(mock.callbacks).toHaveLength(0);
  expect(f.dna.list()).toHaveLength(1);
  mock.controls.partial = false; expect((await runtime.wake())[0].state).toBe('complete');
  expect(f.dna.list()).toHaveLength(1); expect(mock.callbacks).toHaveLength(1);
});
it('preserves a foreign existing access file instead of silently replacing policy', async () => {
  f = fixture(); const p = packet(), callbackEndpoint = 'https://designs.example.invalid/api/pipeline/site-studio/callback';
  const mock = mockCpanelHttp({ binding: f.binding, html, artifactUrl: p.continuation.files[0].url, callbackEndpoint });
  mock.files.set(`${f.binding.target_path}/.htaccess`, Buffer.from('existing-authored-policy'));
  runtime = createSelectedStagingAssembly({ paths: f.paths, bindings: [{ binding: f.binding, authFile: '/home/nineoo/.famtastic-review/synthetic.htpasswd', reviewAuthorization: 'Basic synthetic-review' }], credentialProvider: async () => 'synthetic-token', callbackEndpoint, callbackSecret: 'synthetic-callback', artifactOrigins: ['https://assets.example.invalid'], fetchImpl: mock.fetchImpl });
  runtime.store.accept(p); const [result] = await runtime.wake();
  expect(result.state).toBe('retry'); expect(result.history.at(-1).code).toBe('review_access_policy_changed');
  expect(mock.files.get(`${f.binding.target_path}/.htaccess`).toString()).toBe('existing-authored-policy');
  expect(mock.files.has(`${f.binding.target_path}/index.html`)).toBe(false); expect(mock.callbacks).toHaveLength(0);
});
