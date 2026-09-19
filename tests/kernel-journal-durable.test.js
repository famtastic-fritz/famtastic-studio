import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJournal } from '../server/kernel/journal.js';
import { createPaths } from '../server/kernel/paths.js';

const roots = [];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-journal-'));
  roots.push(root);
  const envKey = `JOURNAL_TEST_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  process.env[envKey] = root;
  const paths = createPaths({
    schema_version: 1,
    data_root_env: envKey,
    data_root_default: root,
    source_root_default: null,
    roots: { journal: 'journal' },
    preview: { port: 3400, bind_lan: false },
    portfolio_roots: {},
  });
  return { root, envKey, paths, journal: createJournal({ paths }) };
}

afterEach(() => {
  for (const item of roots.splice(0)) fs.rmSync(item, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (key.startsWith('JOURNAL_TEST_')) delete process.env[key];
});

describe('durable journal projection support', () => {
  it('deduplicates a stable entry id and rejects conflicting content', () => {
    const { journal } = setup();
    const input = { entry_id: 'je_stable_1', site_id: 'site-a', initiator: 'test', intent: 'project', changes: [{ value: 1 }] };
    expect(journal.append(input)).toEqual(journal.append(input));
    expect(journal.read('site-a')).toHaveLength(1);
    expect(() => journal.append({ ...input, changes: [{ value: 2 }] }))
      .toThrowError(expect.objectContaining({ code: 'journal_idempotency_conflict' }));
  });

  it('quarantines a torn tail before appending a durable stable projection', () => {
    const { paths, journal } = setup();
    paths.ensure('journal');
    const file = paths.within('journal', 'site-a.jsonl');
    fs.writeFileSync(file, '{"entry_id":"torn"');
    const entry = journal.append({ entry_id: 'je_stable_2', site_id: 'site-a', initiator: 'test', intent: 'project' });
    expect(journal.read('site-a')).toEqual([entry]);
    expect(fs.readFileSync(`${file}.quarantine`, 'utf8')).toContain('{"entry_id":"torn"');
  });
});
