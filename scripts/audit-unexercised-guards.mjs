#!/usr/bin/env node
/**
 * Audit: guards that have never fired.
 *
 * WHY
 *
 * `deriveSpecFromPacket`'s `packet_required` guard called a `fail` helper the
 * module never defined or imported. It threw a ReferenceError instead of its
 * structured error, and it had never once worked -- because no test ever took
 * that path. A guard that has never fired is indistinguishable from one that
 * cannot fire.
 *
 * HOW
 *
 * Extract every error CODE thrown by kernel/module code, then check whether any
 * test mentions that code. Codes, not messages: the code is the contract, the
 * message is prose that changes.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a coverage signal for error paths, which line coverage reports badly.
 * It is NOT proof a guard is broken -- an uncovered guard may be perfectly
 * correct. It says only: nothing has ever demonstrated this fires. Every
 * finding needs a human read, and the exit code is deliberately 0 so this
 * informs rather than blocks.
 *
 * Usage: node scripts/audit-unexercised-guards.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIRS = ['server'];
const TEST_DIR = 'tests';
const asJson = process.argv.includes('--json');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const srcFiles = SRC_DIRS.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));
const testBlob = fs.existsSync(TEST_DIR)
  ? walk(TEST_DIR).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  : '';

// throw fail(status, 'code', ...) | error.code = 'code' | { code: 'code' }
const PATTERNS = [
  /\bfail\(\s*\d+\s*,\s*['"`]([a-z0-9_]+)['"`]/g,
  /\.code\s*=\s*['"`]([A-Za-z0-9_]+)['"`]/g,
  /\bcode:\s*['"`]([A-Za-z0-9_]+)['"`]/g,
];

const found = new Map(); // code -> [{file, line}]
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const code = m[1];
      const line = text.slice(0, m.index).split('\n').length;
      // Skip obvious non-guards: a code being READ rather than thrown.
      const src = lines[line - 1] || '';
      if (/===|!==|\.includes\(|switch|case /.test(src) && !/throw|fail\(/.test(src)) continue;
      if (!found.has(code)) found.set(code, []);
      found.get(code).push({ file, line });
    }
  }
}

const unexercised = [];
for (const [code, sites] of found) {
  if (!testBlob.includes(code)) unexercised.push({ code, sites });
}
unexercised.sort((a, b) => a.sites[0].file.localeCompare(b.sites[0].file));

const total = found.size;
if (asJson) {
  console.log(JSON.stringify({ total_codes: total, unexercised_count: unexercised.length, unexercised }, null, 2));
} else {
  console.log(`error codes found in source: ${total}`);
  console.log(`never mentioned by any test: ${unexercised.length}\n`);
  const byFile = new Map();
  for (const u of unexercised) {
    const f = u.sites[0].file;
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(u);
  }
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(2)}  ${file}`);
    for (const u of list) console.log(`        ${u.code}  (line ${u.sites[0].line})`);
  }
  console.log('\nAn uncovered guard is not proven broken. It is proven undemonstrated.');
}
