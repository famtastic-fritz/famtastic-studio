import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createGitDelivery } from '../server/kernel/git-delivery.js';

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'git-delivery-test-')); }
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }

describe('git delivery seam', () => {
  it('commits a site artifact and rejects the shared hosting root', () => {
    const root = temp();
    const delivery = createGitDelivery();
    expect(() => delivery.prepare({ repository_path: path.join(root, 'repo'), site_id: 'shay-locs', hosting_root: '/srv/sites', target_path: '/srv/sites', files: [] })).toThrowError(/per-site subdirectory/);
    const record = delivery.prepare({ repository_path: path.join(root, 'repo'), site_id: 'shay-locs', hosting_root: '/srv/sites', target_path: '/srv/sites/shay-locs', files: [{ path: 'index.html', contents: '<h1>Approved</h1>' }] });
    expect(record.status).toBe('committed');
    expect(record.branch).toBe('main');
    expect(record.worktree_clean).toBe(true);
    expect(git(record.repository_path, ['show', '--stat', '--oneline', 'HEAD'])).toContain('Build selected proof artifact');
  });

  it('proves a local bare-remote push only with explicit approval', () => {
    const root = temp();
    const remote = path.join(root, 'remote.git');
    fs.mkdirSync(remote);
    git(remote, ['init', '--bare']);
    const delivery = createGitDelivery();
    const record = delivery.prepare({ repository_path: path.join(root, 'repo'), site_id: 'demo-site', hosting_root: '/srv/sites', target_path: '/srv/sites/demo-site', remote_url: remote, files: [{ path: 'index.html', contents: 'ok' }] });
    expect(() => delivery.push(record)).toThrowError(/explicit owner approval/);
    const pushed = delivery.push(record, { owner_approved: true });
    expect(pushed.status).toBe('pushed');
    expect(pushed.pushed).toBe(true);
    expect(git(remote, ['rev-parse', 'refs/heads/main'])).toBe(record.commit);
  });

  it('refuses embedded credentials and unapproved providers by shape', () => {
    const delivery = createGitDelivery();
    expect(() => delivery.prepare({ repository_path: temp(), site_id: 'demo-site', hosting_root: '/srv/sites', target_path: '/srv/sites/demo-site', remote_url: 'https://user:secret@example.com/org/site.git', files: [] })).toThrowError(/embedded credentials/);
  });
});

