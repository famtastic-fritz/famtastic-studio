#!/usr/bin/env node
/**
 * Proves the real local Git seam without contacting GitHub, cPanel, DNS, or
 * Netlify. The proof creates a site repository, commits the approved artifact
 * and default operating files, verifies a clean HEAD, and computes the exact
 * per-site hosting subdirectory that a later transport must target.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sourceDir = path.resolve(process.env.FAMTASTIC_PROOF_DIR || '/Users/famtastic-fritz/Development/FAMtastic/sites/site-famtastic-designs/docs/design/proofs/tighten-up-your-locs-v2');
const siteId = process.env.SITE_ID || 'shay-tighten-up-your-locs';
const hostingRoot = process.env.FAMTASTICINC_REMOTE_ROOT || '/home/nineoo/public_html/famtasticinc-landing';
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'famtastic-git-flow-'));
const targetPath = path.posix.join(hostingRoot, siteId);

function run(args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim(); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

if (!fs.existsSync(path.join(sourceDir, 'index.html'))) throw new Error(`proof directory has no index.html: ${sourceDir}`);
copyTree(sourceDir, repo);
fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Site operating contract\n\nPreserve the approved design contract and run parity gates before release.\n');
fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Build context\n\nRead AGENTS.md and design.md before changing this site.\n');
fs.writeFileSync(path.join(repo, 'design.md'), '# Approved design contract\n\nThis repository is materialized from the selected FAMtastic proof artifact.\n');
fs.mkdirSync(path.join(repo, '.famtastic'), { recursive: true });
const manifest = { schema_version: 1, site_id: siteId, provider: 'famtasticinc', target_path: targetPath, source: 'approved-proof-artifact' };
fs.writeFileSync(path.join(repo, '.famtastic/site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

run(['init', '-b', 'main']);
run(['config', 'user.name', 'FAMtastic Site Studio']);
run(['config', 'user.email', 'site-studio@famtastic.invalid']);
run(['add', '--all']);
run(['commit', '-m', 'Build selected proof artifact']);
const commit = run(['rev-parse', 'HEAD']);
const status = run(['status', '--porcelain']);
const tracked = run(['ls-files']).split('\n').filter(Boolean);

const report = {
  status: status === '' ? 'passed' : 'failed',
  repository_path: repo,
  branch: run(['branch', '--show-current']),
  commit,
  tracked_file_count: tracked.length,
  tracked_manifest_sha256: sha256(tracked.join('\n')),
  remote: null,
  remote_push: false,
  external_transport: 'not configured',
  provider: 'famtasticinc',
  target_path: targetPath,
  root_target_rejected: targetPath !== hostingRoot,
  dns_touched: false,
  note: 'Local Git commit proven. No remote push, cPanel upload, DNS change, payment, or email occurred.',
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed' || !report.root_target_rejected) process.exitCode = 1;

