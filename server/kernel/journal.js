// Append-only mutation journal, one file per site, identity bound (A1, plan 2.8).
import fs from 'node:fs';
import path from 'node:path';

export function createJournal({ paths }) {
  function fileFor(siteId) { return paths.within('journal', `${siteId}.jsonl`); }

  function append({ site_id, initiator, intent, changes = [], result = null, evidence = null, rollback_ref = null }) {
    if (!site_id) throw new Error('journal entries require site_id (no ambient site)');
    if (!initiator) throw new Error('journal entries require an initiator');
    const entry = {
      entry_id: `je_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      ts: new Date().toISOString(), site_id, initiator, intent, changes, result, evidence, rollback_ref,
    };
    paths.ensure('journal');
    fs.mkdirSync(path.dirname(fileFor(site_id)), { recursive: true });
    fs.appendFileSync(fileFor(site_id), JSON.stringify(entry) + '\n');
    return entry;
  }

  function read(siteId, { limit = 100 } = {}) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line)).reverse();
  }

  return { append, read };
}
