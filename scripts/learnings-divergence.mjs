#!/usr/bin/env node
/**
 * Learnings divergence detector (ADR-0011 R6).
 *
 * A learnings file that silently forks is worse than none, because it is
 * trusted. On 2026-08-25 the lineage existed in 14+ copies and the canonical
 * file was NOT the largest: a worktree copy carried 1236 sections' worth of
 * material the canonical had never seen, including a full Phase 0 security
 * containment write-up.
 *
 * This compares every copy on disk against the canonical file BY SECTION TITLE
 * and reports what only exists elsewhere. Title comparison, not diff: these
 * files are append-heavy and a line diff is unreadable, while a section present
 * in one file and absent from another is exactly the failure being detected.
 *
 * Exit 0 when nothing is orphaned, 1 when something is. Intended for a session
 * end check, not a build gate -- an orphaned section is a merge task, not a
 * broken build.
 *
 * Usage: node scripts/learnings-divergence.mjs [--root <dir>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const SEARCH_ROOT = rootIdx >= 0 ? args[rootIdx + 1] : path.join(process.env.HOME, 'Development');
const asJson = args.includes('--json');
const CANONICAL = path.join(process.env.HOME, 'Development/FAMtastic/SITE-LEARNINGS.md');

// Directories that are archives or unrelated documents under the same name.
const SKIP = [/node_modules/, /famtastic-local-archive/, /\/Development\/Notes\//];

function findCopies(dir, depth = 0, found = []) {
  if (depth > 6) return found;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (SKIP.some((re) => re.test(full))) continue;
    if (e.isDirectory()) findCopies(full, depth + 1, found);
    else if (/^SITE[-_]LEARNINGS.*\.md$/i.test(e.name)) found.push(full);
  }
  return found;
}

function sectionTitles(file) {
  try {
    return new Set(
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('## '))
        .map((l) => l.slice(3).trim()),
    );
  } catch { return new Set(); }
}

if (!fs.existsSync(CANONICAL)) {
  console.error(`canonical learnings file not found: ${CANONICAL}`);
  process.exit(2);
}

const canonical = sectionTitles(CANONICAL);
const copies = findCopies(SEARCH_ROOT).filter((f) => path.resolve(f) !== path.resolve(CANONICAL));

// A DIFFERENT repo's own learnings file is not a fork of this lineage, and
// reporting it as one is how a detector trains people to ignore it. Lineage is
// decided by overlap: a worktree copy of this file shares most of its sections,
// while another repo's file shares almost none.
const LINEAGE_OVERLAP_MIN = 0.30;

const report = [];
const separate = [];
for (const f of copies) {
  const titles = sectionTitles(f);
  if (!titles.size) continue;
  const shared = [...titles].filter((t) => canonical.has(t)).length;
  const overlap = shared / titles.size;
  const orphaned = [...titles].filter((t) => !canonical.has(t));
  if (overlap < LINEAGE_OVERLAP_MIN) {
    // Its own document. Recorded so it is visible, never merged.
    separate.push({ file: f, sections: titles.size, overlap: +overlap.toFixed(2) });
    continue;
  }
  if (orphaned.length) report.push({ file: f, orphaned_count: orphaned.length, overlap: +overlap.toFixed(2), orphaned });
}
report.sort((a, b) => b.orphaned_count - a.orphaned_count);

if (asJson) {
  console.log(JSON.stringify({ canonical: CANONICAL, canonical_sections: canonical.size, copies_scanned: copies.length, diverged: report, separate_documents: separate }, null, 2));
} else {
  console.log(`canonical: ${CANONICAL}`);
  console.log(`  ${canonical.size} sections | ${copies.length} other copies scanned`);
  if (!report.length) {
    console.log('\nOK: no copy carries a section the canonical file lacks.');
  } else {
    console.log(`\nDIVERGED: ${report.length} copy/copies carry sections the canonical file lacks.\n`);
    for (const r of report) {
      console.log(`  ${r.orphaned_count} orphaned  ${r.file}`);
      for (const t of r.orphaned.slice(0, 5)) console.log(`      - ${t}`);
      if (r.orphaned.length > 5) console.log(`      ... and ${r.orphaned.length - 5} more`);
    }
    console.log('\nThese are merge tasks, not build failures. See ADR-0011 R1.');
  }
  if (separate.length) {
    console.log(`\nSeparate documents (own lineage, not forks -- never merge these):`);
    for (const s2 of separate) console.log(`  ${String(s2.sections).padStart(4)} sections, ${Math.round(s2.overlap * 100)}% overlap  ${s2.file}`);
  }
}
process.exit(report.length ? 1 : 0);
