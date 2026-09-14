import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function fail(code, message) { return Object.assign(new Error(message), { code, statusCode: 409 }); }
export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function maybeGit(root, args) { try { return git(root, args); } catch { return null; } }
export function normalizeRemote(value) {
  if (!value) return null;
  if (typeof value !== 'string' || /[\s\r\n]/.test(value) || /^https?:\/\/[^/]*@/.test(value)) throw fail('remote_invalid', 'Git remote must not contain whitespace or embedded credentials');
  if (/^https:\/\/[^/]+\/.+/.test(value)) return value.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const ssh = /^git@([^:]+):(.+)$/.exec(value);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, '')}`;
  if (path.isAbsolute(value)) return path.resolve(value);
  if (value.startsWith('file:///')) return new URL(value).href;
  throw fail('remote_invalid', 'An explicit HTTPS, SSH, or local test remote is required');
}
function realCandidate(value) {
  let current = path.resolve(value);
  const tail = [];
  while (!fs.existsSync(current)) { tail.unshift(path.basename(current)); current = path.dirname(current); }
  return path.join(fs.realpathSync(current), ...tail);
}
export function readManifest(root) {
  const target = path.join(root, '.famtastic/site-manifest.json');
  if (!fs.existsSync(target)) return null;
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { throw fail('manifest_invalid', 'The existing site manifest is invalid; do not overwrite it'); }
}
export function dirtySnapshot(root) {
  const changed = new Set([
    ...git(root, ['diff', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean));
  return Object.fromEntries([...changed].sort().map(rel => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return [rel, null];
    if (fs.lstatSync(full).isSymbolicLink()) throw fail('symlink_rejected', `Changed path is a symlink: ${rel}`);
    return [rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')];
  }));
}

/** Read-only. Every rejection happens before callers may mkdir, init, or write. */
export function preflightRepository({ repository_path, site_id, remote_url = null, require_clean = true, allow_uninitialized = false, registry = [], expected_changes = null } = {}) {
  if (typeof repository_path !== 'string' || !repository_path) throw fail('repository_path_required', 'repository_path is required');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site_id || '')) throw fail('identity_invalid', 'site_id must be lowercase kebab-case');
  const expectedRemote = normalizeRemote(remote_url);
  const root = realCandidate(repository_path);
  let ancestor = fs.existsSync(root) ? root : path.dirname(root);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const top = maybeGit(ancestor, ['rev-parse', '--show-toplevel']);
  const initialized = top !== null;
  if (initialized && fs.realpathSync(top) !== root) throw fail('wrong_repository', 'Target is inside another Git repository, not an independent site root');
  const enclosing = maybeGit(path.dirname(root), ['rev-parse', '--show-toplevel']);
  if (enclosing) throw fail('nested_repository', 'Site repositories must live outside agency/platform Git roots');
  if (!initialized) {
    if (!allow_uninitialized) throw fail('repository_missing', 'A separate site Git repository is required');
    if (fs.existsSync(root) && fs.readdirSync(root).length) throw fail('unowned_directory', 'Refusing a nonempty directory without an independent Git identity');
  }
  const manifest = initialized ? readManifest(root) : null;
  if (manifest && manifest.site_id !== site_id) throw fail('site_identity_mismatch', 'The target repository belongs to a different site');
  const common = initialized ? realCandidate(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']))) : null;
  const ownGit = initialized ? realCandidate(path.resolve(root, git(root, ['rev-parse', '--git-dir']))) : null;
  const remote = initialized ? maybeGit(root, ['remote', 'get-url', 'origin']) : null;
  if (initialized && !manifest && maybeGit(root, ['rev-parse', '--verify', 'HEAD'])) throw fail('repository_identity_required', 'Existing source repositories require a matching site manifest before generation');
  if (common !== ownGit) {
    const primary = readManifest(path.dirname(common));
    if (!primary || primary.site_id !== site_id) throw fail('common_directory_mismatch', 'The worktree common directory is not owned by this customer site');
  }
  if (remote && expectedRemote && normalizeRemote(remote) !== expectedRemote) throw fail('foreign_remote', 'Existing origin differs from the requested repository; it will not be replaced');
  if (manifest?.repository?.url && normalizeRemote(manifest.repository.url) !== normalizeRemote(remote)) throw fail('manifest_remote_mismatch', 'The manifest repository URL does not match actual origin');
  for (const entry of registry) {
    if (entry.site_id === site_id && entry.repository_path && realCandidate(entry.repository_path) !== root) {
      const otherCommon = maybeGit(entry.repository_path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      if (!common || !otherCommon || realCandidate(otherCommon) !== common) throw fail('duplicate_site_identity', 'This site identity is already bound to another repository');
    }
    if (expectedRemote && entry.site_id !== site_id && normalizeRemote(entry.repository_url) === expectedRemote) throw fail('duplicate_repository_identity', 'This repository is already bound to another site');
  }
  if (initialized && git(root, ['status', '--porcelain'])) {
    if (require_clean && !expected_changes) throw fail('worktree_dirty', 'The site repository has uncommitted work; preserve it before a new build');
    if (expected_changes && JSON.stringify(dirtySnapshot(root)) !== JSON.stringify(Object.fromEntries(Object.entries(expected_changes).sort()))) throw fail('worktree_changed', 'Dirty files differ from this build receipt; refusing unrelated changes');
  }
  return { repository_path: root, site_id, initialized, common_directory: common, manifest, remote_url: remote || null, state: 'local_only' };
}
