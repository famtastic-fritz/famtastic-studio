#!/usr/bin/env node
/**
 * Audit: field names a producer emits that no consumer reads, and vice versa.
 *
 * WHY
 *
 * `sanitizeMediaPrompts` has always emitted `{slot, prompt}`. `deriveMediaSlots`
 * read `entry.role`. Neither was wrong on its own and nothing errored: the
 * consumer simply fell through to a numbered default, so every
 * research-declared slot name was discarded and every spec on disk shows
 * `media-1`, `media-2`. Months of it.
 *
 * A contract mismatch between two stages is invisible when the consuming stage
 * never runs (see the copy and imagery stages, which never ran in any pipeline
 * test), and it is *still* invisible when the consumer has a fallback — because
 * a fallback turns a mismatch into a plausible default.
 *
 * HOW
 *
 * For each declared inter-stage payload, list the keys the producer writes and
 * the keys the consumer reads, and report the asymmetry. This is a REVIEW aid,
 * not a gate: an unread key may be intentional provenance, and a read key with a
 * fallback may be a legitimate optional. It answers "did anyone check these
 * against each other?", which for the media slot the answer was no.
 *
 * Usage: node scripts/audit-contract-mismatch.mjs [--json]
 */
import fs from 'node:fs';

const asJson = process.argv.includes('--json');

// Declared seams: what one stage hands the next. Kept explicit rather than
// inferred, because guessing seams from imports produces noise, and a noisy
// detector trains people to ignore it.
const SEAMS = [
  {
    name: 'research media_prompts -> spec media slots',
    producer: { file: 'server/kernel/research-prompts.js', fn: 'sanitizeMediaPrompts' },
    consumer: { file: 'server/kernel/spec-derive.js', fn: 'deriveMediaSlots' },
  },
  {
    name: 'research site_needs -> spec pages/sections',
    producer: { file: 'server/kernel/research-prompts.js', fn: 'sanitizeSiteNeeds' },
    consumer: { file: 'server/kernel/spec-derive.js', fn: 'deriveSpecFromPacket' },
  },
  {
    name: 'research brand -> tokens',
    producer: { file: 'server/kernel/research-prompts.js', fn: 'sanitizeBrand' },
    consumer: { file: 'server/kernel/tokens.js', fn: 'deriveTokens' },
  },
  {
    name: 'spec sections -> copy stage',
    producer: { file: 'server/kernel/spec-derive.js', fn: 'normalizeSection' },
    consumer: { file: 'server/kernel/copy.js', fn: 'writeCopy' },
  },
  {
    name: 'spec sections -> compose',
    producer: { file: 'server/kernel/spec-derive.js', fn: 'normalizeSection' },
    consumer: { file: 'server/kernel/compose.js', fn: 'composeSite' },
  },
  {
    name: 'imagery slots -> compose',
    producer: { file: 'server/kernel/imagery.js', fn: 'fillMediaSlots' },
    consumer: { file: 'server/kernel/compose.js', fn: 'composeSite' },
  },
];

function body(file, fn) {
  if (!fs.existsSync(file)) return '';
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return '';
  // Skip the PARAMETER LIST before looking for the body brace. A destructured
  // signature -- function f({ a, b }) -- puts a brace inside the parens, and
  // matching from the first brace treated the parameter list as the entire
  // body. That produced "(none detected)" for every destructured function and a
  // false positive claiming site_needs keys were unread when they are read three
  // lines into the function.
  let paren = src.indexOf('(', m.index);
  if (paren < 0) return '';
  let pd = 0;
  let afterParams = -1;
  for (let j = paren; j < src.length; j += 1) {
    if (src[j] === '(') pd += 1;
    else if (src[j] === ')') { pd -= 1; if (!pd) { afterParams = j + 1; break; } }
  }
  if (afterParams < 0) return '';
  let i = src.indexOf('{', afterParams);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') { depth -= 1; if (!depth) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}

const NOISE = new Set(['length', 'map', 'filter', 'trim', 'push', 'find', 'slice', 'join', 'includes', 'toString', 'forEach', 'some', 'every', 'sort', 'replace', 'split', 'test', 'exec', 'keys', 'values', 'entries', 'then', 'catch', 'concat', 'match', 'startsWith', 'endsWith', 'padStart', 'toFixed']);

// Comments are prose, not contract. `// Already typed: keep it` was matching the
// `word:` pattern and reporting "typed" as an emitted field.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const writes = (b0) => ((b) => new Set([...b.matchAll(/(?:^|[{,\s])([a-z_][a-z0-9_]*)\s*:/gim)].map((m) => m[1]).filter((k) => !NOISE.has(k))))(stripComments(b0));
const reads = (b0) => ((b) => new Set([...b.matchAll(/\.([a-z_][a-z0-9_]*)\b/gim)].map((m) => m[1]).filter((k) => !NOISE.has(k))))(stripComments(b0));

const report = [];
for (const seam of SEAMS) {
  const p = body(seam.producer.file, seam.producer.fn);
  // Consumer scope is the WHOLE MODULE, not one function: compose reads section
  // and slot fields inside render helpers, so a function-scoped read set flagged
  // every one of them as unread. Producer stays function-scoped because that is
  // where the payload's shape is actually decided.
  const c = fs.existsSync(seam.consumer.file) ? fs.readFileSync(seam.consumer.file, 'utf8') : '';
  if (!p || !c) { report.push({ seam: seam.name, error: `could not locate ${!p ? seam.producer.fn : seam.consumer.file}` }); continue; }
  const emitted = writes(p);
  const consumed = reads(c);
  const unread = [...emitted].filter((k) => !consumed.has(k));
  report.push({ seam: seam.name, emitted: [...emitted], unread });
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of report) {
    if (r.error) { console.log(`\n?? ${r.seam}\n     ${r.error}`); continue; }
    console.log(`\n${r.seam}`);
    console.log(`  producer emits: ${r.emitted.join(', ') || '(none detected)'}`);
    console.log(`  never read by the consumer: ${r.unread.length ? r.unread.join(', ') : 'nothing'}`);
  }
  console.log('\nAn unread key may be intentional provenance. This asks whether anyone checked, not whether it is wrong.');
}
