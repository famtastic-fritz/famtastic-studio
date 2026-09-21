import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './staging-worker-fixture.mjs';
import { digest } from '../server/kernel/staging-store.js';
let f;
afterEach(() => f?.cleanup());
it('restores exact private backup and refuses third-party changes', async () => {
  f = fixture(); fs.mkdirSync(f.paths.within('staging', 'backup-test'), { recursive: true });
  f.remote.set('index.html', Buffer.from('old'));
  const args = { target: f.binding, operation_id: 'backup-test', manifest: [{ path: 'index.html', sha256: digest('new') }] };
  const backup = await f.transport.backup(args);
  f.remote.set('index.html', Buffer.from('foreign'));
  await expect(f.transport.restore({ ...args, backup, uploaded: { 'index.html': digest('new') } })).rejects.toThrow('rollback_remote_changed');
  expect(f.remote.get('index.html').toString()).toBe('foreign');
  f.remote.set('index.html', Buffer.from('new'));
  expect(await f.transport.restore({ ...args, backup, uploaded: { 'index.html': digest('new') } })).toMatchObject({ verified: true });
  expect(f.remote.get('index.html').toString()).toBe('old');
});
it('rejects stale public files before retaining a new backup', async () => {
  f = fixture(); fs.mkdirSync(f.paths.within('staging', 'backup-test'), { recursive: true }); f.remote.set('old.html', Buffer.from('stale'));
  await expect(f.transport.backup({ target: f.binding, operation_id: 'backup-test', manifest: [{ path: 'index.html' }] })).rejects.toThrow('stale_remote_inventory');
});
