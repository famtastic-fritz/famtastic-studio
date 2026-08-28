import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-journal-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createJournal', () => {
  it('append requires site_id', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    expect(() => journal.append({ initiator: 'operator', intent: 'test' })).toThrow();
  });

  it('append requires initiator', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    expect(() => journal.append({ site_id: 'site-a', intent: 'test' })).toThrow();
  });

  it('entries are append-only: two appends yield two lines', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'one' });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'two' });

    const file = paths.within('journal', 'site-a.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
  });

  it('read() returns newest first and respects limit', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'first' });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'second' });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'third' });

    const all = journal.read('site-a');
    expect(all.map((e) => e.intent)).toEqual(['third', 'second', 'first']);

    const limited = journal.read('site-a', { limit: 2 });
    expect(limited.map((e) => e.intent)).toEqual(['third', 'second']);
  });

  it('two sites never see each others entries', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    journal.append({ site_id: 'site-a', initiator: 'operator', intent: 'a-entry' });
    journal.append({ site_id: 'site-b', initiator: 'operator', intent: 'b-entry' });

    const aEntries = journal.read('site-a');
    const bEntries = journal.read('site-b');
    expect(aEntries.map((e) => e.intent)).toEqual(['a-entry']);
    expect(bEntries.map((e) => e.intent)).toEqual(['b-entry']);
  });

  it('read() returns empty array for an unknown site', () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    expect(journal.read('never-heard-of-it')).toEqual([]);
  });
});
