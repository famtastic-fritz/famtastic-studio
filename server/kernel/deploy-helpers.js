// Pure deploy helpers: no closure state, no filesystem policy beyond walking a
// tree. Split out of deploy.js to keep that file under the size rule.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireCreatorCreditFiles } from '../../vendor/site-foundation/index.js';

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

const PRIVATE_DIRECTORIES = new Set(['docs', 'tests', 'node_modules', 'vendor', 'backend', 'application', 'dist', 'coverage', 'research', 'scripts', 'ops']);
const PUBLIC_EXTENSIONS = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.mp4', '.webm', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.eot']);

export function isPublishable(relPath) {
  if (typeof relPath !== 'string' || path.isAbsolute(relPath) || relPath.includes('\\')) return false;
  if (relPath === '.htaccess') return true; // Exact root Apache control file, not arbitrary dot-source.
  const segments = relPath.split('/');
  if (segments.some((seg) => !seg || seg.startsWith('.') || PRIVATE_DIRECTORIES.has(seg))) return false;
  return PUBLIC_EXTENSIONS.has(path.extname(relPath).toLowerCase()) || ['robots.txt', 'sitemap.xml'].includes(relPath);
}

// Read only JSON, never execute customer package scripts during a deploy plan.
export function publishableFiles(dir) {
  const configPath = path.join(dir, '.famtastic/public-files.json');
  const sourceManifest = path.join(dir, '.famtastic/site-manifest.json');
  let files;
  let public_base_path = '/';
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    public_base_path = config.public_base_path || '/';
    const listed = Array.isArray(config) ? config : config?.schema_version === 1 ? config.files : null;
    if (!Array.isArray(listed)) throw fail(409, 'public_manifest_invalid', 'An explicit public-file array or version 1 manifest is required');
    files = [...new Set(listed)];
    if (files.some(file => !isPublishable(file))) throw fail(409, 'private_public_path', 'A source or unsupported application path cannot be included in this static release');
  } else {
    if (fs.existsSync(sourceManifest)) throw fail(409, 'public_manifest_required', 'Source repositories require an explicit public-file allowlist before static deployment');
    files = walkAllFiles(dir).filter(isPublishable);
  }
  for (const file of files) {
    let current = dir;
    for (const part of file.split('/')) {
      current = path.join(current, part);
      if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw fail(409, 'public_file_unsafe', 'A public file is missing or uses a symlink');
    }
    if (!fs.statSync(current).isFile()) throw fail(409, 'public_file_unsafe', 'A public path is not a file');
  }
  if (files.length) requireCreatorCreditFiles(files.map(file => ({ path: file, contents: fs.readFileSync(path.join(dir, file)) })), { public_base_path });
  return files;
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
