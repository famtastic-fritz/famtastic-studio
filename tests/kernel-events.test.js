// Event spine contract (amendment A5). Covers what the Phase 0 gate found missing:
// envelope validation, locked sequence allocation across instances, durability
// before broadcast, per-site delivery isolation, replay, resync, and torn tails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaths } from '../server/kernel/paths.js';
import { createEvents } from '../server/kernel/events.js';

let root;
let paths;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  process.env.STUDIO_DATA_ROOT = root;
  paths = createPaths();
});
afterEach(() => {
  delete process.env.STUDIO_DATA_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function eventsFile(siteId) { return paths.within('events', `${siteId}.jsonl`); }

describe('event envelope', () => {
  it('emits a complete, valid envelope', () => {
    const events = createEvents({ paths });
    const e = events.emit({ type: 'site.updated', site_id: 'acme', payload: { a: 1 } });
    expect(e.schema_version).toBe(1);
    expect(e.event_id).toHaveLength(26);
    expect(e.seq).toBe(1);
    expect(e.site_id).toBe('acme');
    expect(Number.isNaN(Date.parse(e.ts))).toBe(false);
    expect(e.payload).toEqual({ a: 1 });
  });

  it('refuses an event with no site_id (no ambient site)', () => {
    const events = createEvents({ paths });
    expect(() => events.emit({ type: 'x', payload: {} })).toThrow(/site_id/);
  });

  it('refuses an event with no type', () => {
    const events = createEvents({ paths });
    expect(() => events.emit({ site_id: 'acme', payload: {} })).toThrow(/type/);
  });
});

describe('persistence and sequence', () => {
  it('persists to disk before broadcasting', () => {
    const events = createEvents({ paths });
    let seenOnDiskAtBroadcast = null;
    events.clients.add({
      site_id: 'acme',
      socket: {
        readyState: 1,
        send() { seenOnDiskAtBroadcast = fs.existsSync(eventsFile('acme')) && fs.readFileSync(eventsFile('acme'), 'utf8').includes('site.updated'); },
      },
    });
    events.emit({ type: 'site.updated', site_id: 'acme', payload: {} });
    expect(seenOnDiskAtBroadcast, 'event must be durable on disk before any client sees it').toBe(true);
  });

  it('increments seq per site and keeps sites independent', () => {
    const events = createEvents({ paths });
    expect(events.emit({ type: 't', site_id: 'a', payload: {} }).seq).toBe(1);
    expect(events.emit({ type: 't', site_id: 'a', payload: {} }).seq).toBe(2);
    expect(events.emit({ type: 't', site_id: 'b', payload: {} }).seq).toBe(1);
    expect(events.emit({ type: 't', site_id: 'a', payload: {} }).seq).toBe(3);
  });

  it('a second instance over the same root continues the sequence', () => {
    createEvents({ paths }).emit({ type: 't', site_id: 'a', payload: {} });
    const second = createEvents({ paths });
    expect(second.emit({ type: 't', site_id: 'a', payload: {} }).seq).toBe(2);
  });

  it('two concurrent instances never allocate the same seq', () => {
    // The Phase 0 gate found instance-local caching let two processes both emit
    // seq 1 for one site. Interleaving two live instances must not reproduce it.
    const a = createEvents({ paths });
    const b = createEvents({ paths });
    const seqs = [];
    for (let i = 0; i < 6; i += 1) {
      seqs.push((i % 2 === 0 ? a : b).emit({ type: 't', site_id: 'shared', payload: { i } }).seq);
    }
    expect(new Set(seqs).size, `duplicate sequences allocated: ${seqs.join(',')}`).toBe(6);
    expect([...seqs].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('delivery isolation and replay', () => {
  it('delivers only to clients bound to that site', () => {
    const events = createEvents({ paths });
    const acme = [];
    const other = [];
    events.clients.add({ site_id: 'acme', socket: { readyState: 1, send: (f) => acme.push(JSON.parse(f)) } });
    events.clients.add({ site_id: 'other', socket: { readyState: 1, send: (f) => other.push(JSON.parse(f)) } });
    events.emit({ type: 'site.updated', site_id: 'acme', payload: {} });
    expect(acme).toHaveLength(1);
    expect(other, 'a client bound to another site must never see these events').toHaveLength(0);
  });

  it('replays only events after the cursor', () => {
    const events = createEvents({ paths });
    for (let i = 0; i < 4; i += 1) events.emit({ type: 't', site_id: 'a', payload: { i } });
    expect(events.replay('a', 2).map((e) => e.seq)).toEqual([3, 4]);
    expect(events.replay('a', 0)).toHaveLength(4);
    expect(events.replay('a', 99)).toHaveLength(0);
  });

  it('reports the retained high-water mark so a cursor ahead of history is detectable', () => {
    const events = createEvents({ paths });
    events.emit({ type: 't', site_id: 'a', payload: {} });
    expect(events.lastSeq('a')).toBe(1);
    expect(events.lastSeq('never-seen')).toBe(0);
  });

  it('quarantines a torn final line and keeps the recovered event replayable', () => {
    // The phase gate found the first fix incomplete: lastSeq() skipped the torn
    // tail, but emit() then appended onto that unterminated fragment, so the NEW
    // event was itself unreplayable and its sequence could be reused. Assert
    // recovery all the way through replay, not just the returned sequence.
    const events = createEvents({ paths });
    events.emit({ type: 't', site_id: 'a', payload: {} });
    events.emit({ type: 't', site_id: 'a', payload: {} });
    fs.appendFileSync(eventsFile('a'), '{"seq":3,"partial'); // simulated power loss mid-write

    expect(events.replay('a', 0).map((e) => e.seq), 'torn tail must be skipped, not fatal').toEqual([1, 2]);

    const recovered = events.emit({ type: 't', site_id: 'a', payload: { recovered: true } });
    expect(recovered.seq, 'sequence continues past a torn line').toBe(3);
    expect(events.replay('a', 0).map((e) => e.seq), 'the recovered event must itself be replayable').toEqual([1, 2, 3]);
    expect(events.replay('a', 2)[0].payload).toEqual({ recovered: true });

    const next = events.emit({ type: 't', site_id: 'a', payload: {} });
    expect(next.seq, 'the sequence after recovery must not be reused').toBe(4);
    expect(events.replay('a', 0).map((e) => e.seq)).toEqual([1, 2, 3, 4]);

    expect(fs.existsSync(`${eventsFile('a')}.quarantine`), 'the torn fragment is preserved, not silently dropped').toBe(true);
  });

  it('terminates a well-formed final line that lost only its newline', () => {
    const events = createEvents({ paths });
    const first = events.emit({ type: 't', site_id: 'a', payload: {} });
    const raw = fs.readFileSync(eventsFile('a'), 'utf8');
    fs.writeFileSync(eventsFile('a'), raw.replace(/\n$/, '')); // newline lost
    const second = events.emit({ type: 't', site_id: 'a', payload: {} });
    expect(second.seq).toBe(first.seq + 1);
    expect(events.replay('a', 0).map((e) => e.seq)).toEqual([1, 2]);
    expect(fs.existsSync(`${eventsFile('a')}.quarantine`), 'a valid line must not be quarantined').toBe(false);
  });
});

describe('idempotency', () => {
  it('returns the original event instead of emitting a duplicate for a repeated key', () => {
    // The key was stored but never enforced, so a retried emit produced a second
    // sequence and consumers saw the same event twice. Found by the PROVE list.
    const events = createEvents({ paths });
    const first = events.emit({ type: 't', site_id: 'a', payload: { n: 1 }, idempotency_key: 'k1' });
    const again = events.emit({ type: 't', site_id: 'a', payload: { n: 1 }, idempotency_key: 'k1' });
    expect(again.event_id).toBe(first.event_id);
    expect(again.seq).toBe(first.seq);
    expect(events.replay('a', 0).filter((e) => e.idempotency_key === 'k1')).toHaveLength(1);
  });

  it('does not collapse distinct keys, and keeps keys scoped per site', () => {
    const events = createEvents({ paths });
    events.emit({ type: 't', site_id: 'a', payload: {}, idempotency_key: 'k1' });
    events.emit({ type: 't', site_id: 'a', payload: {}, idempotency_key: 'k2' });
    expect(events.replay('a', 0)).toHaveLength(2);
    const onB = events.emit({ type: 't', site_id: 'b', payload: {}, idempotency_key: 'k1' });
    expect(onB.seq, 'the same key on another site is a different event').toBe(1);
    expect(events.replay('b', 0)).toHaveLength(1);
  });
});
