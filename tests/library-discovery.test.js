import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { git } from '../vendor/site-foundation/index.js';
import { discoverLibrary } from '../server/kernel/library-discovery.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-contract-'));
  git(root, ['init', '-b', 'main']);
  const repository_url = 'https://github.com/test/library';
  git(root, ['remote', 'add', 'origin', `${repository_url}.git`]);
  const catalog = { schema_version: '1.0.0', kind: 'component_library', repository: { url: repository_url }, readiness: { library_available: true, platform_complete: false }, entries: [{ id: 'candidate', readiness: { installable: false } }] };
  fs.writeFileSync(path.join(root, 'catalog-v1.json'), JSON.stringify(catalog));
  git(root, ['add', '--all']); git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Catalog fixture']);
  const registry = { schema_version: '1.0.0', entries: [{ id: 'component-studio', kind: 'component_library', repository_url, revision: git(root, ['rev-parse', 'HEAD']), catalog_path: 'catalog-v1.json' }] };
  return { root, registry, paths: { libraryRoot: () => root } };
}
describe('portable pinned catalog discovery', () => {
  it('reads only the pinned JSON and preserves per-package readiness', () => {
    const context = fixture();
    const found = discoverLibrary({ id: 'component-studio', ...context });
    expect(found.status).toBe('available');
    expect(found.executable_import_proven).toBe(false);
    expect(found.entries[0].readiness.installable).toBe(false);
    fs.rmSync(context.root, { recursive: true });
  });
  it('rejects changed catalog bytes, wrong pins, origin swaps and path escapes', () => {
    const context = fixture();
    const discover = () => discoverLibrary({ id: 'component-studio', ...context });
    fs.appendFileSync(path.join(context.root, 'catalog-v1.json'), '\n{}');
    expect(discover().reason).toBe('library_catalog_modified');
    context.registry.entries[0].revision = '0'.repeat(40);
    expect(discover().reason).toBe('library_revision_mismatch');
    context.registry.entries[0].revision = git(context.root, ['rev-parse', 'HEAD']);
    context.registry.entries[0].catalog_path = '../foreign.json';
    expect(discover().reason).toBe('library_catalog_path_invalid');
    git(context.root, ['remote', 'set-url', 'origin', 'https://github.com/test/foreign']);
    expect(discover().reason).toBe('library_remote_mismatch');
    fs.rmSync(context.root, { recursive: true });
  });
  it('renders missing configuration as unavailable, never a successful empty library', () => {
    const context = fixture();
    expect(discoverLibrary({ id: 'component-studio', ...context, paths: { libraryRoot: () => null } }).reason).toBe('library_checkout_not_configured');
    context.registry.entries[0].revision = null;
    expect(discoverLibrary({ id: 'component-studio', ...context }).reason).toBe('library_revision_not_pinned');
    fs.rmSync(context.root, { recursive: true });
  });
});
