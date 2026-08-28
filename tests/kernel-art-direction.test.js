import { describe, it, expect } from 'vitest';
import { routeSlot, planSlots, kindFor } from '../server/kernel/art-direction.js';

describe('art direction: routing decided before a prompt is written', () => {
  // Ruling 3, 2026-08-25: this is a real routing rule, not a note.
  it('routes ambient UI motion to CSS and pays nothing', () => {
    const r = routeSlot({ motion: 'neon sign flicker' });
    expect(r.treatment).toBe('css');
    expect(r.paid).toBe(false);
    expect(r.reason).toMatch(/reproducible in CSS/);
  });

  it('pays for organic physics a stylesheet cannot fake', () => {
    expect(routeSlot({ motion: 'candle flame guttering' }).treatment).toBe('video_ambient');
  });

  it('routes character action to the identity-locked tier', () => {
    expect(routeSlot({ motion: 'Harry waving at camera' }).treatment).toBe('video_character');
  });

  // Organic and character cues beat the CSS cue when both appear: "fade" is
  // fakeable, a candle is not.
  it('does not send an organic-motion slot to CSS just because a fakeable word appears', () => {
    expect(routeSlot({ motion: 'candle flame fade in' }).treatment).toBe('video_ambient');
  });

  // A still of a neon sign is not motion. Cues match the motion field, not the
  // whole prompt, so a static scene description never buys video.
  it('never buys video for a still whose prompt merely describes a glowing scene', () => {
    expect(routeSlot({ prompt: 'a neon sign glowing above the bar' }).treatment).toBe('still_draft');
  });

  it('routes a hero still to the final tier and everything else to the draft tier', () => {
    expect(routeSlot({ role: 'hero', prompt: 'x' }).treatment).toBe('still_final');
    expect(routeSlot({ role: 'gallery', prompt: 'x' }).treatment).toBe('still_draft');
    expect(routeSlot({ role: 'gallery', final: true, prompt: 'x' }).treatment).toBe('still_final');
  });

  // Buying video on a guess is exactly the leak the rule exists to stop.
  it('routes unrecognised motion to CSS rather than buying video on a guess', () => {
    const r = routeSlot({ motion: 'something unclear' });
    expect(r.treatment).toBe('css');
    expect(r.paid).toBe(false);
    expect(r.reason).toMatch(/did not match a known class/);
  });

  it('reports how many paid slots the routing avoided', () => {
    const plan = planSlots([
      { id: '1', role: 'hero', prompt: 'x' },
      { id: '2', motion: 'marquee chase' },
      { id: '3', motion: 'water splashing' },
      { id: '4', motion: 'pulse' },
    ]);
    expect(plan.summary.declared).toBe(4);
    expect(plan.summary.avoided_paid_slots).toBe(2);
    expect(plan.summary.paid).toBe(2);
  });

  it('maps treatments to the media kind a provider must produce', () => {
    expect(kindFor('css')).toBeNull();
    expect(kindFor('still_final')).toBe('image');
    expect(kindFor('video_character')).toBe('video');
  });
});
