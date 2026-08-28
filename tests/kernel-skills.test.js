// Shay's skills: six named cards from the cockpit mockup, reported honestly.
// The mockup's own toggles are a client-side CSS class flip with no backend
// at all, and its stats are hand-written strings. This is the one place
// that decides what is real to report -- these tests exist specifically to
// stop a fabricated stat or a falsely-enabled toggle from ever landing here.
import { describe, it, expect } from 'vitest';
import { listSkills, killSwitch } from '../server/kernel/skills.js';

describe('listSkills: honest by construction', () => {
  const skills = listSkills();

  it('reports exactly the six named skills from the mockup, in a stable order', () => {
    expect(skills.map((s) => s.id)).toEqual([
      'broken-link-crawler',
      'famtastic-proof-worker',
      'seo-analyzer',
      'ssl-watchdog',
      'asset-optimizer',
      'nightly-backup',
    ]);
  });

  it('never reports a schedule, last_run, or log_href for any skill -- none of these are real anywhere in this codebase', () => {
    for (const s of skills) {
      expect(s.schedule).toBeNull();
      expect(s.last_run).toBeNull();
      expect(s.log_href).toBeNull();
    }
  });

  it('disables the toggle on every single skill, each with a real, stated reason -- never a silently-enabled switch', () => {
    for (const s of skills) {
      expect(s.toggle.disabled).toBe(true);
      expect(s.toggle.enabled).toBeNull();
      expect(typeof s.toggle.disabled_reason).toBe('string');
      expect(s.toggle.disabled_reason.length).toBeGreaterThan(0);
    }
  });

  it('marks five of six as not implemented, and only seo-analyzer as implemented', () => {
    const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
    expect(byId['seo-analyzer'].implemented).toBe(true);
    for (const id of ['broken-link-crawler', 'famtastic-proof-worker', 'ssl-watchdog', 'asset-optimizer', 'nightly-backup']) {
      expect(byId[id].implemented).toBe(false);
    }
  });

  it('gives famtastic-proof-worker a P0-I1-specific blocked reason, not the generic not-implemented one', () => {
    const worker = skills.find((s) => s.id === 'famtastic-proof-worker');
    expect(worker.toggle.disabled_reason).toMatch(/P0-I1/);
  });

  // REGRESSION: blocked_reason was only ever written onto toggle.disabled_reason,
  // never onto the card itself -- a consumer wanting to show the P0-I1
  // constraint as prominent inline text (not just a hover tooltip on the
  // disabled switch) had no field to read it from. Found live in the
  // browser: the card for famtastic-proof-worker rendered no blocked-reason
  // text at all, even though skillCard() in automations.js was written to
  // show one.
  it('also carries blocked_reason at the top level, not only nested in toggle.disabled_reason', () => {
    const worker = skills.find((s) => s.id === 'famtastic-proof-worker');
    expect(worker.blocked_reason).toMatch(/P0-I1/);
  });

  it('reports blocked_reason as null for every skill that has none, never an empty string or undefined', () => {
    for (const s of skills) {
      if (s.id === 'famtastic-proof-worker') continue;
      expect(s.blocked_reason).toBeNull();
    }
  });

  it('reports seo-analyzer as on-demand, not a scheduled background job, and still gives an honest disabled-toggle reason', () => {
    const seo = skills.find((s) => s.id === 'seo-analyzer');
    expect(seo.mode).toBe('on_demand');
    expect(seo.toggle.disabled).toBe(true);
    expect(seo.toggle.disabled_reason).toMatch(/on demand|background job/);
  });

  it('every description is present and non-empty', () => {
    for (const s of skills) {
      expect(typeof s.description).toBe('string');
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
});

describe('killSwitch: unknown, never a guessed false', () => {
  it('reports state unknown with a real reason, never a hardcoded "not engaged"', () => {
    const result = killSwitch();
    expect(result.state).toBe('unknown');
    expect(result.state).not.toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
