// Pure deploy helpers: no closure state, no filesystem policy beyond walking a
// tree. Split out of deploy.js to keep that file under the size rule.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function fail(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Recursively lists every file under `dir`, relative to `base`, POSIX-separated.
export function walkAllFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAllFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const OPERATIONAL_FILENAMES = new Set(['spec.json', 'conversation.jsonl']);

export function isPublishable(relPath) {
  const segments = relPath.split('/');
  if (segments.some((seg) => seg.startsWith('.'))) return false;
  if (OPERATIONAL_FILENAMES.has(segments[segments.length - 1])) return false;
  return true;
}

// Order-independent: sorted (path, sha256) pairs, content hashes only.
export function computeManifestHash(manifest) {
  const sorted = manifest
    .map(({ path: p, sha256: h }) => ({ path: p, sha256: h }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(JSON.stringify(sorted));
}

export function stripContent(receipt) {
  return {
    ...receipt,
    manifest: (receipt.manifest || []).map(({ path: p, sha256: h, bytes }) => ({ path: p, sha256: h, bytes })),
  };
}

