// P0-I1: the greenfield server never loads the legacy proof route and never reads
// FAMTASTIC_PROOF_*. Text search is not enough: modules are auto-discovered, so the
// real defence is preflighting the exact module closure before anything is imported.
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_ENV_PREFIX = 'FAMTASTIC_PROOF_';
const FORBIDDEN_MODULE_NAMES = ['famtastic-proof-job-routes'];
const FORBIDDEN_CONFIG_ROOTS = ['proof-jobs', 'proof-output'];
// D3 requires a read-only /api/proofs view, so "contains proof" is the wrong test.
// What is forbidden is a proof *ingress*: anything that accepts a dispatch or
// callback for proof jobs.
const FORBIDDEN_ROUTE_RES = [/proof-jobs/i, /integrations\/famtastic/i, /proof.*callback/i];
const IMPORT_RE = /(?:^|[^.\w])(?:import\s+[^'"]*?from\s*|import\s*|export\s+[^'"]*?from\s*)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function assertInvariants(env = process.env) {
  const leaked = Object.keys(env).filter((k) => k.startsWith(FORBIDDEN_ENV_PREFIX));
  if (leaked.length) {
    throw new Error(`P0-I1 violated: ${leaked.join(', ')} present in environment. The greenfield server must not run with proof pipeline secrets.`);
  }
}

// Walks the static closure of `entry` and every candidate module file, without
// importing anything. Rejects forbidden names, forbidden env reads, escapes out of
// the tree, and symlinks pointing outside it.
export function preflightModuleClosure({ entryFiles, treeRoot }) {
  const root = fs.realpathSync(treeRoot);
  const seen = new Set();
  const violations = [];
  const queue = [...entryFiles];

  while (queue.length) {
    const file = queue.pop();
    let real;
    try { real = fs.realpathSync(file); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);

    if (!real.startsWith(root + path.sep) && real !== root) {
      violations.push(`escapes tree: ${file} -> ${real}`);
      continue;
    }
    const base = path.basename(real);
    if (FORBIDDEN_MODULE_NAMES.some((n) => base.includes(n) || real.includes(n))) {
      violations.push(`forbidden module in closure: ${path.relative(root, real)}`);
      continue;
    }

    const src = fs.readFileSync(real, 'utf8');
    if (src.includes(FORBIDDEN_ENV_PREFIX) && path.basename(real) !== 'invariants.js') {
      violations.push(`reads forbidden env prefix: ${path.relative(root, real)}`);
    }
    if (path.basename(real) !== 'invariants.js') {
      for (const r of FORBIDDEN_CONFIG_ROOTS) {
        if (src.includes(`'${r}'`) || src.includes(`"${r}"`)) {
          violations.push(`references forbidden config root '${r}': ${path.relative(root, real)}`);
        }
      }
    }

    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      const spec = m[1] || m[2];
      if (!spec || !spec.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(real), spec);
      for (const cand of [resolved, `${resolved}.js`, path.join(resolved, 'index.js')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { queue.push(cand); break; }
      }
    }
  }

  if (violations.length) {
    throw new Error(`P0-I1 violated by the module closure:\n  ${violations.join('\n  ')}`);
  }
  return { checked: seen.size, files: [...seen] };
}

// After registration, no route may expose a proof ingress.
export function assertNoProofRoutes(routes) {
  const bad = routes.filter((r) => FORBIDDEN_ROUTE_RES.some((re) => re.test(r.pattern || '')));
  if (bad.length) {
    throw new Error(`P0-I1 violated: proof ingress registered: ${bad.map((r) => `${r.method} ${r.pattern}`).join(', ')}`);
  }
}

export const forbiddenModuleNames = FORBIDDEN_MODULE_NAMES;
export const forbiddenEnvPrefix = FORBIDDEN_ENV_PREFIX;
export const forbiddenConfigRoots = FORBIDDEN_CONFIG_ROOTS;
