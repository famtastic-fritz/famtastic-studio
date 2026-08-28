// Work inbox (plan 3.1): fixtures for each real source, plus an assertion that
// the two not-yet-wired sources (Connections dual-status, proof pipeline) are
// reported as not_configured, never silently omitted and never invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createWork } from '../server/kernel/work.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-work-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup() {
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const work = createWork({ paths, journal, events });
  return { paths, journal, events, work };
}

function makeSiteDir(paths, siteId) {
  const dir = paths.within('sites', siteId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSpec(paths, siteId, spec) {
  const dir = makeSiteDir(paths, siteId);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
}

function writePage(paths, siteId, relPath, html = '<html><title>t</title></html>') {
  const full = paths.within('sites', siteId, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
}

describe('createWork(paths, journal, events).list()', () => {
  it('reports the two named-but-unwired sources as not_configured with a reason, never invented, never omitted', () => {
    const { work } = setup();
    const result = work.list();
    const notConfigured = result.sources.filter((s) => s.status === 'not_configured');
    const ids = notConfigured.map((s) => s.id).sort();
    expect(ids).toEqual(['connections_dual_status', 'proof_pipeline']);
    for (const source of notConfigured) {
      expect(typeof source.reason).toBe('string');
      expect(source.reason.length).toBeGreaterThan(0);
      expect(source.count).toBe(0);
    }
  });

  it('sources is never empty, even when there are zero items (so the console never mistakes an unwired source for a quiet inbox)', () => {
    const { work } = setup();
    const result = work.list();
    expect(result.items).toEqual([]);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it('produces a journal_review item for a recent journal entry, naming its site explicitly', () => {
    const { paths, journal, work } = setup();
    makeSiteDir(paths, 'site-a');
    journal.append({
      site_id: 'site-a',
      initiator: 'operator',
      intent: 'spec.write',
      changes: [{ path: 'spec.json' }],
      result: { status: 'applied', revision: 1 },
    });

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'journal_review');
    expect(items.length).toBe(1);
    expect(items[0].site_id).toBe('site-a');
    expect(items[0].state).toBe('needs_review');
    expect(items[0].decision).toContain('site-a');
    expect(items[0].next_action_href).toBe('/site?site_id=site-a');
    expect(items[0].idempotency_key).toBeTruthy();

    const journalSource = result.sources.find((s) => s.id === 'journal_review');
    expect(journalSource.status).toBe('ok');
    expect(journalSource.count).toBe(1);
  });

  it('excludes journal entries older than the review window', () => {
    const { paths, journal, work } = setup();
    makeSiteDir(paths, 'site-old');
    journal.append({ site_id: 'site-old', initiator: 'operator', intent: 'spec.write', changes: [] });

    // Rewrite the just-appended entry with a timestamp far in the past.
    const file = paths.within('journal', 'site-old.jsonl');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    entry.ts = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, `${JSON.stringify(entry)}\n`);

    const result = work.list();
    expect(result.items.filter((i) => i.source === 'journal_review' && i.site_id === 'site-old')).toEqual([]);
  });

  it('produces a recent_events item for a recent event, naming its site explicitly', () => {
    const { paths, events, work } = setup();
    makeSiteDir(paths, 'site-b');
    events.emit({ type: 'site.touched', site_id: 'site-b', payload: { note: 'test' } });

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'recent_events');
    expect(items.length).toBe(1);
    expect(items[0].site_id).toBe('site-b');
    expect(items[0].last_event.type).toBe('site.touched');

    const eventsSource = result.sources.find((s) => s.id === 'recent_events');
    expect(eventsSource.status).toBe('ok');
    expect(eventsSource.count).toBe(1);
  });

  it('produces a spec_invalid item for a site with no spec.json at all', () => {
    const { paths, work } = setup();
    makeSiteDir(paths, 'site-no-spec');

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'spec_invalid');
    expect(items.length).toBe(1);
    expect(items[0].site_id).toBe('site-no-spec');
    expect(items[0].detail.errors).toContain('spec_not_found');
  });

  it('produces a spec_invalid item for a site whose spec.json fails structural validation', () => {
    const { paths, work } = setup();
    writeSpec(paths, 'site-bad-spec', { customer: 'not-an-object' });

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'spec_invalid' && i.site_id === 'site-bad-spec');
    expect(items.length).toBe(1);
  });

  it('does not produce a spec_invalid item for a site with a structurally valid spec', () => {
    const { paths, work } = setup();
    writeSpec(paths, 'site-good-spec', { customer: { id: 'cust-1' } });

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'spec_invalid' && i.site_id === 'site-good-spec');
    expect(items).toEqual([]);
  });

  it('produces a no_pages item for a site directory with zero HTML pages on disk', () => {
    const { paths, work } = setup();
    makeSiteDir(paths, 'site-empty');

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'no_pages' && i.site_id === 'site-empty');
    expect(items.length).toBe(1);
    expect(items[0].next_action_href).toBe('/site?site_id=site-empty');
  });

  it('does not produce a no_pages item for a site with at least one HTML page on disk', () => {
    const { paths, work } = setup();
    writePage(paths, 'site-with-page', 'dist/index.html');

    const result = work.list();
    const items = result.items.filter((i) => i.source === 'no_pages' && i.site_id === 'site-with-page');
    expect(items).toEqual([]);
  });

  it('produces at least one item per real source together, with denominators.open matching items.length', () => {
    const { paths, journal, events, work } = setup();

    makeSiteDir(paths, 'site-review');
    journal.append({ site_id: 'site-review', initiator: 'operator', intent: 'spec.write', changes: [] });

    makeSiteDir(paths, 'site-events');
    events.emit({ type: 'site.touched', site_id: 'site-events', payload: {} });

    makeSiteDir(paths, 'site-badspec'); // no spec.json -> spec_invalid
    writePage(paths, 'site-badspec', 'dist/index.html'); // has pages, so only spec_invalid fires

    makeSiteDir(paths, 'site-nopages'); // has spec-less dir too, but distinct site so it isolates no_pages
    writeSpec(paths, 'site-nopages', { customer: { id: 'cust-2' } });

    const result = work.list();
    const bySource = new Set(result.items.map((i) => i.source));
    expect(bySource.has('journal_review')).toBe(true);
    expect(bySource.has('recent_events')).toBe(true);
    expect(bySource.has('spec_invalid')).toBe(true);
    expect(bySource.has('no_pages')).toBe(true);
    expect(result.denominators.open).toBe(result.items.length);

    for (const item of result.items) {
      expect(typeof item.site_id).toBe('string');
      expect(item.site_id.length).toBeGreaterThan(0);
      expect(item.idempotency_key).toBeTruthy();
    }
  });

  it('every item carries source, site, age, state, decision, next action, last_event field, and idempotency key', () => {
    const { paths, journal, work } = setup();
    makeSiteDir(paths, 'site-shape');
    journal.append({ site_id: 'site-shape', initiator: 'operator', intent: 'spec.write', changes: [] });

    const result = work.list();
    const item = result.items.find((i) => i.site_id === 'site-shape');
    expect(item).toBeTruthy();
    expect(item.source).toBeTruthy();
    expect(item.site_id).toBeTruthy();
    expect(item.age_ts).toBeTruthy();
    expect(item.state).toBeTruthy();
    expect(item.decision).toBeTruthy();
    expect(item.next_action).toBeTruthy();
    expect('last_event' in item).toBe(true);
    expect(item.idempotency_key).toBeTruthy();
  });
});
