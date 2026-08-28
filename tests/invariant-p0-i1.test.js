// P0-I1: the greenfield server must never import the legacy proof route module,
// nor reference the FAMTASTIC_PROOF_* env prefix anywhere outside the file that
// deliberately names the forbidden prefix (server/kernel/invariants.js).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInvariants } from '../server/kernel/invariants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'server', 'index.js');

const IMPORT_RE = /(?:import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"])|(?:await\s+import\(\s*['"]([^'"]+)['"]\s*\))/g;

function resolveSpecifier(fromFile, specifier) {
  // Ignore bare node: and package specifiers.
  if (specifier.startsWith('node:')) return null;
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  let resolved = path.resolve(path.dirname(fromFile), specifier);
  if (!fs.existsSync(resolved)) {
    // try common extensions / index resolution
    const candidates = [resolved, `${resolved}.js`, `${resolved}.mjs`, path.join(resolved, 'index.js')];
    resolved = candidates.find((c) => fs.existsSync(c)) || resolved;
  }
  return resolved;
}

function walkImportGraph(startFile) {
  const visited = new Set();
  const queue = [path.resolve(startFile)];
  const files = [];

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (!fs.existsSync(current) || fs.statSync(current).isDirectory()) continue;
    files.push(current);

    const source = fs.readFileSync(current, 'utf8');
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source))) {
      const specifier = match[1] || match[2];
      if (!specifier) continue;
      const resolved = resolveSpecifier(current, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return files;
}

describe('P0-I1: no legacy proof pipeline in the greenfield import graph', () => {
  const graph = walkImportGraph(entry);

  it('walks a non-trivial import graph starting at server/index.js', () => {
    expect(graph.length).toBeGreaterThan(1);
  });

  it('never resolves a file named famtastic-proof-job-routes', () => {
    const offenders = graph.filter((f) => f.includes('famtastic-proof-job-routes'));
    expect(offenders).toEqual([]);
  });

  it('never resolves a file outside this worktree (ROOT)', () => {
    const outside = graph.filter((f) => !f.startsWith(root + path.sep) && f !== root);
    expect(outside).toEqual([]);
  });

  it('never references FAMTASTIC_PROOF outside server/kernel/invariants.js', () => {
    const invariantsFile = path.join(root, 'server', 'kernel', 'invariants.js');
    const offenders = [];
    for (const file of graph) {
      if (path.resolve(file) === path.resolve(invariantsFile)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('FAMTASTIC_PROOF')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('assertInvariants()', () => {
  it('throws when FAMTASTIC_PROOF_DISPATCH_SECRET is present in env', () => {
    expect(() => assertInvariants({ FAMTASTIC_PROOF_DISPATCH_SECRET: 'x' })).toThrow();
  });

  it('does not throw for a clean env', () => {
    expect(() => assertInvariants({ PATH: '/usr/bin', NODE_ENV: 'test' })).not.toThrow();
  });
});

function bootIndexPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/index.js');
}

describe('P0-I1 preflight covers everything boot executes', () => {
  // The first version of this guard compared BOOT_KERNELS against itself, so
  // removing a kernel from the list silently removed it from checking too. The
  // loader is now the gate: it refuses any file the preflight did not clear.
  it('lists every dynamically loaded kernel in the preflight entry set', async () => {
    const indexSrc = fs.readFileSync(bootIndexPath(), 'utf8');
    // Scan only the BOOT_KERNELS initializer. Scanning the whole file would also
    // match kernel paths mentioned anywhere else, making this weaker than its name.
    const decl = indexSrc.match(/const BOOT_KERNELS\s*=\s*\[([^\]]*)\]/);
    expect(decl, 'BOOT_KERNELS must be a literal array in server/index.js').toBeTruthy();
    const listed = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const loaded = [...indexSrc.matchAll(/await load\('([^']+)'\)/g)].map((m) => m[1]);
    expect(loaded.length, 'boot should dynamically load kernels').toBeGreaterThan(0);
    for (const rel of loaded) {
      expect(listed, `${rel} is loaded at boot so it must be in BOOT_KERNELS`).toContain(rel);
    }
  });

  it('gates the loader on the preflight result rather than on the list itself', async () => {
    const indexSrc = fs.readFileSync(bootIndexPath(), 'utf8');
    expect(indexSrc, 'load() must consult the cleared set').toMatch(/cleared\.has\(abs\)/);
    expect(indexSrc).toMatch(/refusing to load/);
  });
});
