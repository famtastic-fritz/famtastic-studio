// The copy stage. Its whole reason for existing is that five consecutive builds
// published their own planning notes, so the tests that matter are the ones
// proving it cannot happen again — including when the writer itself echoes.
import { describe, it, expect } from 'vitest';
import { writeCopy, buildCopyPrompt } from '../server/kernel/copy.js';

const SECTIONS = [
  { id: 'hero', instruction: 'name, one-line clinical positioning, primary Book CTA', body: null },
  { id: 'core', heading: 'Core treatment overview', instruction: 'facials, chemical peels, dermaplaning — four short cards linking into Services', body: null },
];
const BUSINESS = { name: 'Starlight Skin Bar', voice_anti_patterns: ['pamper', 'indulge'] };

// A fake child process: emits the JSON we choose on stdout, then closes 0.
// runCli takes spawnImpl, so this exercises the real parse-and-guard path
// rather than stubbing the module.
import { EventEmitter } from 'node:events';

function fakeSpawn(payload, { exitCode = 0 } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (payload !== null) child.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
      child.emit('close', exitCode, null);
    });
    return child;
  };
}

describe('copy stage — the echo guard is the point', () => {
  it('REJECTS a body that repeats its own instruction and leaves it null', async () => {
    // The writer hands the instruction straight back — the exact failure mode.
    const out = await writeCopy({
      business: BUSINESS, page: { id: 'home' }, sections: SECTIONS,
      adapter: { command: 'fake' },
      spawnImpl: fakeSpawn({ sections: [
        { id: 'hero', body: 'name, one-line clinical positioning, primary Book CTA' },
        { id: 'core', body: 'facials, chemical peels, dermaplaning — four short cards linking into Services' },
      ] }),
    });
    expect(out.summary.rejected_echo).toBe(2);
    expect(out.summary.written).toBe(0);
    for (const s of out.sections) {
      expect(s.body, `${s.id} must not publish its own instruction`).toBeFalsy();
      expect(s.copy_error).toMatch(/repeats its own instruction/);
    }
  });

  it('ACCEPTS real prose written from the same instruction', async () => {
    const out = await writeCopy({
      business: BUSINESS, page: { id: 'home' }, sections: SECTIONS,
      adapter: { command: 'fake' },
      spawnImpl: fakeSpawn({ sections: [
        { id: 'hero', body: 'Starlight Skin Bar is a private treatment room in Studio 6. One licensed esthetician sees one client at a time, and you can book a first visit online.' },
        { id: 'core', body: 'Treatments run from deep-cleansing work through to resurfacing. Each one is chosen for what your skin needs on the day, not sold as a package.' },
      ] }),
    });
    expect(out.summary.written).toBe(2);
    expect(out.summary.rejected_echo).toBe(0);
    expect(out.sections[0].body).toMatch(/private treatment room/);
    expect(out.sections[0].copy_echo_similarity).toBeLessThan(0.6);
  });

  it('leaves a section null when the writer returns nothing for it', async () => {
    const out = await writeCopy({
      business: BUSINESS, page: { id: 'home' }, sections: SECTIONS,
      adapter: { command: 'fake' },
      spawnImpl: fakeSpawn({ sections: [{ id: 'hero', body: 'Starlight Skin Bar is one esthetician in one room, seeing one client at a time.' }] }),
    });
    expect(out.summary.written).toBe(1);
    expect(out.summary.returned_empty).toBe(1);
    expect(out.sections.find((s) => s.id === 'core').body).toBeFalsy();
  });

  it('never invents copy when the adapter fails', async () => {
    const out = await writeCopy({
      business: BUSINESS, page: { id: 'home' }, sections: SECTIONS,
      adapter: { command: 'fake' }, spawnImpl: fakeSpawn(null, { exitCode: 1 }),
    });
    expect(out.summary.adapter_failed).toBe(true);
    expect(out.sections.every((s) => !s.body)).toBe(true);
    expect(out.summary.note).toMatch(/render empty rather than carrying invented text/);
  });

  it('never invents copy when the adapter is missing', async () => {
    await expect(writeCopy({ business: BUSINESS, sections: SECTIONS })).rejects.toMatchObject({ code: 'copy_adapter_unavailable' });
  });

  it('does nothing when no section needs copy', async () => {
    const done = [{ id: 'hero', instruction: 'x', body: 'Already written prose.' }];
    const out = await writeCopy({ business: BUSINESS, sections: done, adapter: { command: 'fake' } });
    expect(out.summary.requested).toBe(0);
    expect(out.sections[0].body).toBe('Already written prose.');
  });
});

describe('copy prompt', () => {
  it('tells the writer the note is not the copy, and names the prior failure', () => {
    const p = buildCopyPrompt({ business: BUSINESS, page: { id: 'home' }, sections: SECTIONS });
    expect(p).toMatch(/It is NOT the copy/);
    expect(p).toMatch(/published\s+those notes to customers/);
  });

  it('carries the brand voice anti-patterns as a prohibition', () => {
    const p = buildCopyPrompt({ business: BUSINESS, page: {}, sections: SECTIONS });
    expect(p).toMatch(/explicitly forbidden them: pamper, indulge/);
  });

  it('forbids inventing facts', () => {
    const p = buildCopyPrompt({ business: BUSINESS, page: {}, sections: SECTIONS });
    expect(p).toMatch(/Never invent a fact you were not given/);
    expect(p).toMatch(/An empty section is\s+better than an invented one/);
  });
});
