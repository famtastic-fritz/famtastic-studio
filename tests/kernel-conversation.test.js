import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createConversation } from '../server/kernel/conversation.js';
import { buildCard } from '../server/kernel/cards.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-conversation-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createConversation', () => {
  it('append requires site_id', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    expect(() =>
      conversation.append({ conversation_id: 'conv_a', role: 'operator', text: 'hello' }),
    ).toThrow(/site_id/);
  });

  it('append requires conversation_id', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    expect(() =>
      conversation.append({ site_id: 'site-a', role: 'operator', text: 'hello' }),
    ).toThrow(/conversation_id/);
  });

  it('append rejects an unrecognized role (no fake assistant persona)', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    expect(() =>
      conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'assistant', text: 'hi' }),
    ).toThrow(/role/);
  });

  it('append/read round-trips entries with entry_id and ts stamped', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    const entry = conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'first note' });
    expect(entry.entry_id).toMatch(/^ce_/);
    expect(typeof entry.ts).toBe('string');
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);

    const entries = conversation.read('site-a');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'first note' });
  });

  it('entries are append-only: two appends yield two lines on disk', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'one' });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'two' });

    const file = paths.within('conversations', 'site-a.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
  });

  it('read() returns entries newest-last', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'first' });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'second' });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'third' });

    const entries = conversation.read('site-a');
    expect(entries.map((e) => e.text)).toEqual(['first', 'second', 'third']);
  });

  it('read() respects limit, keeping the newest entries', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'first' });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'second' });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'third' });

    const limited = conversation.read('site-a', { limit: 2 });
    expect(limited.map((e) => e.text)).toEqual(['second', 'third']);
  });

  it('read() returns an empty array for a site with no history', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    expect(conversation.read('never-heard-of-it')).toEqual([]);
  });

  it('read() requires site_id', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    expect(() => conversation.read()).toThrow(/site_id/);
  });

  it('two sites never see each others entries (cross-site isolation)', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'a-entry' });
    conversation.append({ site_id: 'site-b', conversation_id: 'conv_b', role: 'operator', text: 'b-entry' });

    const aEntries = conversation.read('site-a');
    const bEntries = conversation.read('site-b');
    expect(aEntries.map((e) => e.text)).toEqual(['a-entry']);
    expect(bEntries.map((e) => e.text)).toEqual(['b-entry']);
  });

  it('newConversation() returns a fresh conversation_id without destroying history', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'before' });

    const { conversation_id: freshId } = conversation.newConversation('site-a');
    expect(typeof freshId).toBe('string');
    expect(freshId).not.toBe('conv_a');

    conversation.append({ site_id: 'site-a', conversation_id: freshId, role: 'operator', text: 'after' });

    const entries = conversation.read('site-a');
    expect(entries.map((e) => e.text)).toEqual(['before', 'after']);
    expect(entries.map((e) => e.conversation_id)).toEqual(['conv_a', freshId]);
  });

  it('newConversation() called twice returns two distinct ids', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    const first = conversation.newConversation('site-a').conversation_id;
    const second = conversation.newConversation('site-a').conversation_id;
    expect(first).not.toBe(second);
  });

  it('restart continuity: a second kernel instance over the same directory sees the same history', () => {
    const pathsA = createPaths();
    const conversationA = createConversation({ paths: pathsA });
    conversationA.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'persisted note' });

    // Simulate a server restart: a brand new kernel instance, same STUDIO_DATA_ROOT.
    const pathsB = createPaths();
    const conversationB = createConversation({ paths: pathsB });
    const entries = conversationB.read('site-a');
    expect(entries.map((e) => e.text)).toEqual(['persisted note']);
  });

  it('embeds a valid card built via buildCard and round-trips it', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    const built = buildCard({
      type: 'plan',
      site_id: 'site-a',
      conversation_id: 'conv_a',
      title: 'Ship the thing',
      evidence: [{ kind: 'journal', ref: 'je_abc123', note: 'prior mutation' }],
    });
    const entry = conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'system', text: '', card: built });
    const [read] = conversation.read('site-a');
    expect(read.card).toMatchObject({ type: 'plan', title: 'Ship the thing', card_id: built.card_id });
    expect(entry.card.card_id).toBe(built.card_id);
  });

  it('rejects a card whose site_id does not match the entry site_id (no cross-site card bleed)', () => {
    const paths = createPaths();
    const conversation = createConversation({ paths });
    const built = buildCard({ type: 'plan', site_id: 'site-b', conversation_id: 'conv_a', title: 'Foreign card' });
    expect(() =>
      conversation.append({ site_id: 'site-a', conversation_id: 'conv_a', role: 'system', text: '', card: built }),
    ).toThrow(/site_id/);
  });
});
