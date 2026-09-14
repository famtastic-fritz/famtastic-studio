// Dependency-free, reproducible verification for generated static source repos.
export function repositoryTools({ name, description, publicFiles = [] }) {
  const pkg = { name, version: '1.0.0', private: true, type: 'module', description,
    scripts: { dev: 'node .famtastic/preview.mjs', test: 'node --test tests/site-contract.test.mjs', build: 'node .famtastic/verify-repository.mjs && node --test tests/site-contract.test.mjs && node .famtastic/build.mjs' } };
  const lock = { name, version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '1.0.0' } } };
  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { requireRepositoryContract } from '../.famtastic/site-foundation/index.js';
test('independent source records and actual generated HTML', () => {
  const manifest = requireRepositoryContract(process.cwd());
  assert.equal(manifest.format, 'source_repository');
  const pages = fs.readdirSync('.').filter(file => file.endsWith('.html'));
  assert.ok(pages.includes('index.html'), 'Homepage must exist');
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<!doctype html>/i, file + ' doctype');
    assert.match(html, /<title>[^<]+<\\/title>/i, file + ' title');
    assert.equal((html.match(/<h1[ >]/gi) || []).length, 1, file + ' heading');
  }
});
`;
  const publicBoundary = `import fs from 'node:fs';
import path from 'node:path';
export const root = fs.realpathSync(process.cwd());
export const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.mp4':'video/mp4', '.webm':'video/webm', '.txt':'text/plain', '.xml':'application/xml' };
const blocked = new Set(['docs', 'tests', 'node_modules', 'vendor', 'backend', 'application']);
export function publicFiles() {
  const config = JSON.parse(fs.readFileSync('.famtastic/public-files.json', 'utf8'));
  if (config.schema_version !== 1 || !Array.isArray(config.files)) throw new Error('Invalid public file allowlist');
  return [...new Set(config.files)].map(rel => {
    if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.includes('\\\\')) throw new Error('Invalid public path');
    const pieces = rel.split('/'); const ext = path.extname(rel).toLowerCase();
    if (pieces.some(piece => !piece || piece.startsWith('.') || blocked.has(piece)) || !types[ext] || (ext === '.txt' && rel !== 'robots.txt') || (ext === '.xml' && rel !== 'sitemap.xml')) throw new Error('Private or unsupported public path: ' + rel);
    let current = root;
    for (const piece of pieces) { current = path.join(current, piece); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Public symlinks are forbidden'); }
    if (!fs.statSync(current).isFile()) throw new Error('Public file missing: ' + rel);
    return rel;
  });
}
`;
  const build = `import fs from 'node:fs';
import path from 'node:path';
import { root, publicFiles } from './public-boundary.mjs';
const files = publicFiles(); // Validate every source before modifying an earlier artifact.
const destination = path.join(root, 'dist');
if (fs.existsSync(destination) && (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isDirectory())) throw new Error('dist must be a real local output directory');
const staging = fs.mkdtempSync(path.join(root, '.site-build-'));
try {
  for (const rel of files) { const target = path.join(staging, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, rel), target); }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(staging, destination);
  console.log('Built ' + files.length + ' allowlisted public files into dist/');
} finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
`;
  const preview = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root, types, publicFiles } from './public-boundary.mjs';
const server = http.createServer((req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\\/+/, '') || 'index.html';
    const ext = path.extname(rel).toLowerCase();
    if (!publicFiles().includes(rel)) throw new Error('not public');
    const file = fs.realpathSync(path.resolve(root, rel));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': types[ext], 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Local preview http://127.0.0.1:' + server.address().port));
`;
  return [
    { path: 'package.json', contents: `${JSON.stringify(pkg, null, 2)}\n` },
    { path: 'package-lock.json', contents: `${JSON.stringify(lock, null, 2)}\n` },
    { path: '.famtastic/public-files.json', contents: `${JSON.stringify({ schema_version: 1, files: [...new Set(publicFiles)] }, null, 2)}\n` },
    { path: '.famtastic/public-boundary.mjs', contents: publicBoundary },
    { path: '.famtastic/build.mjs', contents: build },
    { path: '.famtastic/preview.mjs', contents: preview },
    { path: 'tests/site-contract.test.mjs', contents: test },
    { path: 'docs/STATIC-BUILD.md', contents: '# Static source build and public boundary\n\nUse Node.js 24. Run `npm ci`, `npm test`, then `npm run build`. Build validates the independent source contract and actual HTML before producing `dist/` from `.famtastic/public-files.json`. Only deploy `dist/`, never the repository root. `npm run dev` uses the same allowlist on localhost.\n\nJSON, Markdown, hidden paths, docs, tests, backend/application paths and symlinks are rejected from the static artifact. Add approved pages and assets explicitly to the allowlist. Runtime JSON or PHP needs its own reviewed application build recipe; do not broaden this static recipe to publish source. Existing backend and server configuration are preserved in Git, not copied to static output.\n\nThis artifact remains staging until the business approves its policies, canonical URL, crawler settings and hosting/rollback instructions. The build does not publish or authorize production.\n' },
    { path: '.github/workflows/verify.yml', contents: 'name: Verify independent source\non: [push, pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm ci\n      - run: npm test\n      - run: npm run build\n' },
  ];
}
