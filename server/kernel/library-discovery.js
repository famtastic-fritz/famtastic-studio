// Declarative, pinned JSON discovery. Never import executable sibling code.
import fs from 'node:fs';
import path from 'node:path';
import { git, normalizeRemote } from '../../vendor/site-foundation/index.js';

export function readLibraryRegistry() {
  return JSON.parse(fs.readFileSync(new URL('../../config/repositories/catalog.v1.json', import.meta.url), 'utf8'));
}
export function discoverLibrary({ id, paths, registry = readLibraryRegistry() }) {
  const unavailable = reason => ({ id, status: 'unavailable', reason, discovery_only: true, executable_import_proven: false, readiness: { library_available: false, platform_complete: false }, entries: [] });
  try {
    if (registry.schema_version !== '1.0.0' || !Array.isArray(registry.entries)) return unavailable('library_registry_invalid');
    const entry = registry.entries.find(value => value.id === id);
    if (!entry) return unavailable('library_not_registered');
    if (!/^[a-f0-9]{40}$/.test(entry.revision || '')) return unavailable('library_revision_not_pinned');
    const root = paths?.libraryRoot?.(id);
    if (!root || !fs.existsSync(root)) return unavailable('library_checkout_not_configured');
    if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync(root)) return unavailable('library_wrong_repository');
    if (normalizeRemote(git(root, ['remote', 'get-url', 'origin'])) !== normalizeRemote(entry.repository_url)) return unavailable('library_remote_mismatch');
    if (git(root, ['rev-parse', 'HEAD']) !== entry.revision) return unavailable('library_revision_mismatch');
    if (typeof entry.catalog_path !== 'string' || path.isAbsolute(entry.catalog_path) || entry.catalog_path.split(/[\\/]/).some(part => ['..', '.git'].includes(part))) return unavailable('library_catalog_path_invalid');
    const full = path.resolve(root, entry.catalog_path);
    if (!fs.realpathSync(full).startsWith(`${fs.realpathSync(root)}${path.sep}`)) return unavailable('library_catalog_path_invalid');
    const contents = fs.readFileSync(full, 'utf8');
    if (contents.trim() !== git(root, ['show', `${entry.revision}:${entry.catalog_path}`])) return unavailable('library_catalog_modified');
    const catalog = JSON.parse(contents);
    if (catalog.schema_version !== '1.0.0' || catalog.kind !== entry.kind || !Array.isArray(catalog.entries) || normalizeRemote(catalog.repository?.url) !== normalizeRemote(entry.repository_url)) return unavailable('library_catalog_invalid');
    if (catalog.readiness?.library_available !== true) return unavailable('library_not_available');
    return { id, status: 'available', reason: null, revision: entry.revision, repository_url: entry.repository_url, catalog_path: entry.catalog_path, discovery_only: true, executable_import_proven: false, readiness: catalog.readiness, entries: catalog.entries };
  } catch (error) { return unavailable(error.code === 'ENOENT' ? 'library_catalog_missing' : 'library_catalog_unavailable'); }
}
