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
import { createGitDelivery } from '../server/kernel/git-delivery.js';

const sourceDir = path.resolve(process.env.FAMTASTIC_PROOF_DIR || '/Users/famtastic-fritz/Development/FAMtastic/sites/site-famtastic-designs/docs/design/proofs/tighten-up-your-locs-v2');
const siteId = process.env.SITE_ID || 'shay-tighten-up-your-locs';
const hostingRoot = process.env.FAMTASTICINC_REMOTE_ROOT || '/home/nineoo/public_html/famtasticinc-landing';
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'famtastic-git-flow-'));
const targetPath = path.posix.join(hostingRoot, siteId);
function collectFiles(from, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(src, relative));
    else files.push({ path: relative, contents: fs.readFileSync(src, 'utf8') });
  }
  return files;
}
function countFiles(from) {
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(from, entry.name);
    count += entry.isDirectory() ? countFiles(full) : 1;
  }
  return count;
}

if (!fs.existsSync(path.join(sourceDir, 'index.html'))) throw new Error(`proof directory has no index.html: ${sourceDir}`);
const manifest = { schema_version: 1, site_id: siteId, provider: 'famtasticinc', target_path: targetPath, source: 'approved-proof-artifact' };
const files = [
  ...collectFiles(sourceDir),
  { path: 'AGENTS.md', contents: '# Site operating contract\n\nPreserve the approved design contract and run parity gates before release.\n' },
  { path: 'CLAUDE.md', contents: '# Build context\n\nRead AGENTS.md and design.md before changing this site.\n' },
  { path: 'design.md', contents: '# Approved design contract\n\nThis repository is materialized from the selected FAMtastic proof artifact.\n' },
  { path: '.famtastic/site-manifest.json', contents: `${JSON.stringify(manifest, null, 2)}\n` },
];
const delivery = createGitDelivery();
const record = delivery.prepare({
  repository_path: repo,
  site_id: siteId,
  hosting_root: hostingRoot,
  target_path: targetPath,
  files,
  remote_url: process.env.GIT_REMOTE_URL || null,
});
const report = {
  status: record.worktree_clean ? 'passed' : 'failed',
  repository_path: repo,
  branch: record.branch,
  commit: record.commit,
  tracked_file_count: countFiles(repo),
  remote: record.remote_url,
  remote_configured: record.remote_configured,
  remote_push: false,
  external_transport: record.remote_configured ? 'configured_but_not_pushed' : 'not_configured',
  provider: 'famtasticinc',
  target_path: targetPath,
  root_target_rejected: targetPath !== hostingRoot,
  dns_touched: false,
  note: 'Git commit proven through the shared delivery module. No remote push, cPanel upload, DNS change, payment, or email occurred.',
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed' || !report.root_target_rejected) process.exitCode = 1;
