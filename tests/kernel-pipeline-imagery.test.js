import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import { makeResearchStub } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';
import { makeImageryStub } from './imagery-stub.mjs';

let tmp;
const KEY = loadPathsConfig().data_root_env;
const prev = process.env[KEY];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imgpipe-'));
  process.env[KEY] = tmp;
});
afterEach(() => {
  if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeKernels() {
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  return { paths, journal, events, dna, spec, mutation };
}

function honestBrief() {
  return {
    business: { name: 'Acme Bakery', description: 'A neighborhood bakery.' },
    site_needs: { pages: ['home', 'about'], offers: ['Sourdough'], ctas: ['Order now'] },
  };
}

// SEVENTH instance of one pattern, found by sweeping every stage after the copy
// stage turned out to be skipped: imagery had NEVER run in a pipeline test.
// The executor guards on `media_slots.length`, the research stub declared no
// media prompts, so zero slots were produced and the stage was never entered.
// Confirmed by probe rather than by reading: fetch was never called and no
// preflight was ever recorded.
describe('the imagery stage actually runs in the pipeline', () => {
  it('declares slots, fills them, and records a preflight', async () => {
    const { paths, journal, events, dna, spec, mutation } = makeKernels();
    const imagery = makeImageryStub();
    const pipeline = createPipeline({
      paths, journal, events, dna, spec, mutation,
      researchOptions: makeResearchStub({ mediaPrompts: ['a warm shop interior', 'a portrait at the bench'] }),
      copyOptions: makeCopyStub(),
      imageryOptions: { fetchImpl: imagery.fetchImpl, randomImpl: () => 1, sleepImpl: async () => {} },
    });
    const result = await pipeline.run({ site_id: 'imagery-runs', brief: honestBrief() });
    expect(result.outcome).toBe('success');

    const saved = JSON.parse(fs.readFileSync(paths.within('sites', 'imagery-runs', 'spec.json'), 'utf8'));
    expect(saved.media_slots.length).toBe(2);
    expect(saved.media_slots.every((m) => m.state === 'filled')).toBe(true);
    expect(saved.imagery_preflight).toBeTruthy();
    // The proof the stage was entered at all: the generator was actually called.
    expect(imagery.served).toBeGreaterThan(0);
  });

  // A generator failure must never fail the stage, and must never substitute.
  it('leaves slots declared-unfilled with a reason when the generator is unavailable', async () => {
    const { paths, journal, events, dna, spec, mutation } = makeKernels();
    const pipeline = createPipeline({
      paths, journal, events, dna, spec, mutation,
      researchOptions: makeResearchStub({ mediaPrompts: ['a warm shop interior'] }),
      copyOptions: makeCopyStub(),
      imageryOptions: { fetchImpl: makeImageryStub({ failPreflight: true }).fetchImpl },
    });
    const result = await pipeline.run({ site_id: 'imagery-down', brief: honestBrief() });
    expect(result.outcome).toBe('success');
    const saved = JSON.parse(fs.readFileSync(paths.within('sites', 'imagery-down', 'spec.json'), 'utf8'));
    expect(saved.media_slots[0].state).toBe('unfilled');
    expect(saved.media_slots[0].asset_ref).toBeFalsy();
    expect(saved.media_summary.note).toMatch(/nothing was substituted/i);
  });
});
