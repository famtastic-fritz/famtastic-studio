#!/usr/bin/env node
// Enforces amendment A1: no ambient current-site state anywhere on the server.
// Scans server/ only (scripts/ and tests/ legitimately mention these patterns).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoot = path.join(root, 'server');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const SITE_ISH_NAME = /\b(currentSite|activeSite|selectedSite|siteTag|TAG)\b/;

// Line-level patterns: [name, regex]. Each is checked against every non-comment line.
const PATTERNS = [
  { name: 'global.<TAG> ambient global', re: /\bglobal\.[A-Za-z_$][A-Za-z0-9_$]*\s*=/ },
  { name: 'globalThis.<TAG> ambient global', re: /\bglobalThis\.[A-Za-z_$][A-Za-z0-9_$]*\s*=/ },

  // Bracketed global access: global['TAG'], globalThis["site"], etc. Read or write,
  // any quote style -- bracket access is exactly how ambient state hides from a plain
  // dotted-name grep.
  { name: "global['...'] bracketed ambient global", re: /\bglobal\s*\[\s*['"`][^'"`]+['"`]\s*\]/ },
  { name: "globalThis['...'] bracketed ambient global", re: /\bglobalThis\s*\[\s*['"`][^'"`]+['"`]\s*\]/ },

  // Dotted access to a site-ish name on global/globalThis, READ or WRITE. The two
  // patterns above only fire on an assignment (`global.X =`), so a read such as
  // `const x = global.currentSite` sailed through undetected -- exactly the ambient
  // state amendment A1 forbids, just approached from the read side instead of the
  // write side. This pattern has no trailing `=` requirement, so it catches both:
  // `global.currentSite = x` (already also caught above, intentionally redundant)
  // and `const x = global.currentSite` / `if (globalThis.siteTag) {...}` (previously
  // missed entirely).
  { name: 'global/globalThis dotted read or write of a site-ish name', re: /\bglobal(?:This)?\.(currentSite|activeSite|selectedSite|siteTag|TAG)\b/ },

  // Module-scope const/let/var declarations of a site-ish binding. Anchored at line
  // start (module scope, not inside a function body one indent level in -- those are
  // caught by the module-scope walk below via indentation, so this stays a simple
  // start-of-line const/let/var check for the common flat-file case).
  {
    name: 'module-scope const/let/var of a site-ish binding',
    re: /^\s*(export\s+)?(const|let|var)\s+(currentSite|activeSite|selectedSite|siteTag|TAG)\b/,
  },

  // process.env read whose variable name contains SITE or TAG, any case, any of the
  // bracket/dot access forms.
  { name: 'process.env read of a SITE/TAG-named variable', re: /process\.env\.[A-Za-z0-9_]*(SITE|TAG)[A-Za-z0-9_]*\b/i },
  { name: 'process.env read of a SITE/TAG-named variable (bracket form)', re: /process\.env\s*\[\s*['"`][A-Za-z0-9_]*(SITE|TAG)[A-Za-z0-9_]*['"`]\s*\]/i },
];

const hits = [];

for (const file of walk(scanRoot)) {
  const rel = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  // Track module-scope site-ish bindings declared anywhere in the file (const/let/var,
  // any indentation depth 0 -- i.e. not inside a function/block). We approximate
  // "module scope" as: the declaration line's leading whitespace is empty, which is
  // how every file in this codebase is formatted (no top-level indentation).
  const moduleScopeSiteBindings = new Set();

  lines.forEach((line, idx) => {
    if (isCommentLine(line)) return;

    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        hits.push({ rel, lineNo: idx + 1, name: pattern.name, text: line.trim() });
      }
    }

    // Collect module-scope site-ish bindings declared with any keyword (const/let/var),
    // regardless of whether they matched the strict pattern above (e.g. destructured or
    // multi-declarator forms), so the "helper reads a module-scope site-ish binding"
    // check below has a real name list to work from.
    const declMatch = line.match(/^(export\s+)?(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (declMatch && SITE_ISH_NAME.test(declMatch[3])) {
      moduleScopeSiteBindings.add(declMatch[3]);
    }

    // function named resolveTag / siteRootOf without a site_id parameter
    const fnMatch = line.match(/function\s+(resolveTag|siteRootOf)\s*\(([^)]*)\)/);
    if (fnMatch) {
      const params = fnMatch[2];
      const hasSiteId = /site_id|siteId/.test(params);
      if (!hasSiteId) {
        hits.push({
          rel,
          lineNo: idx + 1,
          name: `function ${fnMatch[1]}() without a site_id parameter`,
          text: line.trim(),
        });
      }
    }
  });

  // Helper functions that take no site parameter but read a module-scope site-ish
  // binding: any named function declaration whose parameter list has no site_id/siteId
  // and whose body (up to the next module-scope-indented line, i.e. the closing brace)
  // references one of the bindings collected above.
  if (moduleScopeSiteBindings.size > 0) {
    const bindingNames = Array.from(moduleScopeSiteBindings);
    const bindingRe = new RegExp(`\\b(${bindingNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!isCommentLine(line)) {
        const fnDeclMatch = line.match(/^\s*(export\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/);
        if (fnDeclMatch) {
          const [, , , fnName, params] = fnDeclMatch;
          const hasSiteId = /site_id|siteId/.test(params);
          if (!hasSiteId && !bindingNames.includes(fnName)) {
            // Walk forward collecting the function body by brace depth, stopping at
            // depth 0 (the closing brace of this function).
            let depth = 0;
            let started = false;
            let bodyLines = [];
            for (let j = i; j < lines.length; j += 1) {
              const bodyLine = lines[j];
              for (const ch of bodyLine) {
                if (ch === '{') { depth += 1; started = true; }
                else if (ch === '}') depth -= 1;
              }
              bodyLines.push(bodyLine);
              if (started && depth <= 0) break;
            }
            const bodyText = bodyLines.join('\n');
            if (bindingRe.test(bodyText.split('\n').slice(1, -1).join('\n'))) {
              hits.push({
                rel,
                lineNo: i + 1,
                name: `function ${fnName}() has no site_id/siteId parameter but reads module-scope binding(s) ${bindingNames.join(', ')}`,
                text: line.trim(),
              });
            }
          }
        }
      }
      i += 1;
    }
  }
}

if (hits.length) {
  console.error('lint-no-ambient-site: violations (amendment A1 - no ambient current-site state):');
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.lineNo}  [${h.name}]  ${h.text}`);
  }
  process.exit(1);
}

console.log('lint-no-ambient-site: OK');
