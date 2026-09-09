/**
 * Receipt-backed Git delivery seam.
 *
 * This module deliberately separates three claims:
 *   1. the artifact was materialized locally;
 *   2. a local Git commit exists and the worktree is clean; and
 *   3. a configured remote accepted that commit.
 *
 * No provider fallback is permitted. A caller must supply an explicit remote
 * and opt into push() after owner approval. Tests may inject a local bare
 * remote; that is still reported as a local proof, never as production.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const GIT_DELIVERY_SCHEMA_VERSION = 1;

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function safeBranch(value) { return text(value) && /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith('/') && !value.includes('..'); }
function safeSiteId(value) { return text(value) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function assertRemote(value) {
  if (!text(value)) throw fail('remote_required', 'an explicit Git remote URL is required before push');
  if (/[\s\n\r]|https?:\/\/[^/]+:[^/@]+@/i.test(value)) throw fail('remote_invalid', 'Git remote must not contain whitespace or embedded credentials');
  if (/^https:\/\/[^/]+\/[^/]+(?:\/[^/]+)*\.git$/i.test(value)) return value;
  if (/^git@[^:]+:[^/]+\/[^/]+\.git$/i.test(value)) return value;
  if (/^file:\/\//i.test(value) || path.isAbsolute(value)) return value;
  throw fail('remote_invalid', 'Git remote must be an explicit HTTPS, SSH, file URL, or absolute local path');
}

function relativePath(value) {
  if (!text(value) || path.isAbsolute(value) || value.split('/').includes('..')) throw fail('artifact_path_invalid', 'artifact paths must be relative and traversal-free');
  return value;
}

function writeFiles(root, files) {
  for (const file of files || []) {
    if (!file || !text(file.path) || typeof file.contents !== 'string') throw fail('artifact_invalid', 'each artifact file needs a path and string contents');
    const relative = relativePath(file.path);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.contents, 'utf8');
  }
}

export function createGitDelivery({ exec = execFileSync, now = () => new Date().toISOString() } = {}) {
  function run(repositoryPath, args) {
    try {
      return exec('git', args, { cwd: repositoryPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      throw fail('git_command_failed', `git ${args.join(' ')} failed`, { command: args, stderr: String(error.stderr || ''), cause: error.message });
    }
  }

  function prepare({ repository_path, site_id, target_path, hosting_root, branch = 'main', remote_url = null, files = [], author = { name: 'FAMtastic Site Studio', email: 'site-studio@famtastic.invalid' }, message = 'Build selected proof artifact' } = {}) {
    if (!text(repository_path)) throw fail('repository_path_required', 'repository_path is required');
    if (!safeSiteId(site_id)) throw fail('identity_invalid', 'site_id must be lowercase kebab-case');
    if (!safeBranch(branch)) throw fail('branch_invalid', 'branch must be a safe Git branch name');
    if (!text(target_path) || !text(hosting_root) || target_path === hosting_root || !target_path.startsWith(`${hosting_root}/`)) {
      throw fail('root_target_rejected', 'Git delivery must target a declared per-site subdirectory, never the hosting root');
    }
    const absolute = path.resolve(repository_path);
    fs.mkdirSync(absolute, { recursive: true });
    writeFiles(absolute, files);
    const gitDir = path.join(absolute, '.git');
    if (!fs.existsSync(gitDir)) run(absolute, ['init', '-b', branch]);
    run(absolute, ['config', 'user.name', author.name]);
    run(absolute, ['config', 'user.email', author.email]);
    if (remote_url) {
      const remote = assertRemote(remote_url);
      const existing = (() => { try { return run(absolute, ['remote', 'get-url', 'origin']); } catch { return null; } })();
      if (!existing) run(absolute, ['remote', 'add', 'origin', remote]);
      else if (existing !== remote) run(absolute, ['remote', 'set-url', 'origin', remote]);
    }
    run(absolute, ['add', '--all']);
    const changed = run(absolute, ['status', '--porcelain']);
    let commit = null;
    if (changed) {
      run(absolute, ['commit', '-m', message]);
      commit = run(absolute, ['rev-parse', 'HEAD']);
    } else {
      commit = run(absolute, ['rev-parse', 'HEAD']);
    }
    const clean = run(absolute, ['status', '--porcelain']) === '';
    if (!clean) throw fail('worktree_dirty', 'Git worktree is not clean after commit');
    return {
      schema_version: GIT_DELIVERY_SCHEMA_VERSION,
      status: 'committed',
      repository_path: absolute,
      site_id,
      branch,
      commit,
      remote_url: remote_url || null,
      remote_configured: Boolean(remote_url),
      target_path,
      hosting_root,
      root_target_rejected: true,
      worktree_clean: true,
      receipt_id: `git_${digest(`${site_id}:${commit}`).slice(0, 24)}`,
      created_at: now(),
    };
  }

  function push(record, { owner_approved = false } = {}) {
    if (!record || record.schema_version !== GIT_DELIVERY_SCHEMA_VERSION || record.status !== 'committed') throw fail('record_invalid', 'a committed Git delivery record is required');
    if (!owner_approved) throw fail('approval_required', 'external Git push requires explicit owner approval');
    const remote = assertRemote(record.remote_url);
    run(record.repository_path, ['push', '--set-upstream', 'origin', record.branch]);
    const pushed = run(record.repository_path, ['rev-parse', 'HEAD']);
    if (pushed !== record.commit) throw fail('commit_mismatch', 'remote push did not preserve the committed artifact');
    return { ...record, status: 'pushed', pushed: true, remote_url: remote, push_receipt_id: `push_${digest(`${remote}:${pushed}`).slice(0, 24)}`, pushed_at: now() };
  }

  return { prepare, push };
}

