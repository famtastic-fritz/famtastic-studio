#!/usr/bin/env node
// Fails if any .js/.mjs file under server/, public/, scripts/, tests/ exceeds 500 lines,
// unless the file's first 10 lines carry a `LINT-EXCEPTION: <reason>` comment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanDirs = ['server', 'public', 'scripts', 'tests'];
const exceptionRe = /LINT-EXCEPTION:\s*\S+/;
const MAX_LINES = 500;

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

let files = [];
for (const dir of scanDirs) files = files.concat(walk(path.join(root, dir)));

const results = files.map((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const lineCount = lines.length;
  const head = lines.slice(0, 10).join('\n');
  const excepted = exceptionRe.test(head);
  return { file: path.relative(root, file), lineCount, excepted };
});

const largest = [...results].sort((a, b) => b.lineCount - a.lineCount).slice(0, 5);
console.log('Largest files:');
console.log('  lines  file');
for (const r of largest) {
  console.log(`  ${String(r.lineCount).padStart(5)}  ${r.file}`);
}

const violations = results.filter((r) => r.lineCount > MAX_LINES && !r.excepted);

if (violations.length) {
  console.error('\nlint-no-monolith: violations (file exceeds 500 lines with no LINT-EXCEPTION comment):');
  for (const v of violations) {
    console.error(`  ${v.file} (${v.lineCount} lines)`);
  }
  process.exit(1);
}

console.log('\nlint-no-monolith: OK');
