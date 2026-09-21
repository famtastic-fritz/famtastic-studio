// Append-only mutation journal, one file per site, identity bound (A1, plan 2.8).
import fs from 'node:fs';
import path from 'node:path';

const ENTRY_ID_RE = /^je_[A-Za-z0-9._:-]{1,190}$/;

export function createJournal({ paths }) {
  function fileFor(siteId) { return paths.within('journal', `${siteId}.jsonl`); }

  function withAppendLock(siteId, operation) {
    paths.ensure('journal');
    const lock = paths.within('journal', `.${siteId}.append.lock`);
    const deadline = Date.now() + 5000;
    let fd;
    for (;;) {
      try {
        fd = fs.openSync(lock, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 10000) {
            fs.unlinkSync(lock);
            continue;
          }
        } catch { /* lock vanished, retry */ }
        if (Date.now() > deadline) {
          throw Object.assign(new Error('journal append lock timeout'), { statusCode: 503, code: 'journal_locked' });
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try {
      return operation();
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.unlinkSync(lock); } catch { /* already removed */ }
    }
  }

  function findByEntryId(siteId, entryId) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.entry_id === entryId) return entry;
      } catch { /* a torn unrelated line does not create a duplicate */ }
    }
    return null;
  }

  function quarantineTornTail(siteId) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || raw.endsWith('\n')) return;
    const newline = raw.lastIndexOf('\n');
    const prefix = newline >= 0 ? raw.slice(0, newline + 1) : '';
    const trailing = newline >= 0 ? raw.slice(newline + 1) : raw;
    try {
      JSON.parse(trailing);
      const fd = fs.openSync(file, 'a');
      try { fs.writeSync(fd, '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch {
      const quarantine = `${file}.quarantine`;
      fs.appendFileSync(quarantine, `${new Date().toISOString()} ${trailing}\n`);
      fs.writeFileSync(file, prefix);
    }
  }

  function sameProjection(existing, intended) {
    const fields = ['entry_id', 'site_id', 'initiator', 'intent', 'changes', 'result', 'evidence', 'rollback_ref'];
    return fields.every((field) => JSON.stringify(existing[field] ?? null) === JSON.stringify(intended[field] ?? null));
  }

  function append({ entry_id = null, site_id, initiator, intent, changes = [], result = null, evidence = null, rollback_ref = null }) {
    if (!site_id) throw new Error('journal entries require site_id (no ambient site)');
    if (!initiator) throw new Error('journal entries require an initiator');
    const hasStableId = entry_id !== null;
    const stableEntryId = entry_id || `je_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    if (!ENTRY_ID_RE.test(stableEntryId)) throw new Error('journal entry_id is invalid');
    return withAppendLock(site_id, () => {
      quarantineTornTail(site_id);
      const intended = {
        entry_id: stableEntryId,
        site_id, initiator, intent, changes, result, evidence, rollback_ref,
      };
      const existing = hasStableId ? findByEntryId(site_id, stableEntryId) : null;
      if (existing) {
        if (!sameProjection(existing, intended)) {
          throw Object.assign(new Error('journal entry_id is already bound to different content'), {
            statusCode: 409,
            code: 'journal_idempotency_conflict',
          });
        }
        return existing;
      }
      const entry = { ...intended, ts: new Date().toISOString() };
      const file = fileFor(site_id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(file, 'a', 0o600);
      try {
        fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return entry;
    });
  }

  function read(siteId, { limit = 100 } = {}) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line)).reverse();
  }

  return { append, read };
}
