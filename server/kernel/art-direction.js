/**
 * The art-direction decision layer — ported from skills/image-and-video-gen.
 *
 * WHY THIS IS HERE AND NOT IN THE IMAGERY STAGE
 *
 * The imagery stage begins one step too late: it receives a prompt and fills a
 * slot. Every decision that separates "generates images" from "has art
 * direction" happens BEFORE a prompt is written -- which medium the slot even
 * needs, which provider tier suits the job, and whether the thing should be
 * generated at all.
 *
 * The standing finding of 2026-08-25 is explicit that this belongs to the
 * creative-direction stage, and that improving the imagery stage cannot close
 * the gap, because the gap is not in the rendering of a prompt. It is in what
 * the prompt is asked to be.
 *
 * WHAT WAS PORTED AND WHAT WAS NOT
 *
 * Ported: the routing judgement. It is judgement, not credentials, so moving it
 * costs nothing and it has to sit next to the stage that consults it.
 *
 * NOT ported: the provider credentials. Studio calls a worker across the seam
 * and holds no key (ADR-0010). Porting the credential is the accident that made
 * preview generation look like it belonged to Designs.
 *
 * THE RULE THAT SAVES THE MOST MONEY
 *
 *   "If CSS keyframes can fake the motion, don't pay for video."
 *
 * Ruled on 2026-08-25 to be a real routing rule rather than a note. It is
 * implemented as CSS_FAKEABLE below: a slot whose motion is ambient UI motion
 * routes to `css` at zero cost and is never sent to a provider. Video budget is
 * reserved for organic physics and for character action with identity locking.
 */

/** Media tiers a slot can route to. `css` is a real destination, not a refusal. */
export const TREATMENTS = ['css', 'still_draft', 'still_final', 'video_ambient', 'video_character'];

// Ambient UI motion a stylesheet can produce. Matched on the slot's own motion
// description, never on the whole prompt: a still of a neon sign is not motion.
const CSS_FAKEABLE = /\b(breath|breathe|flicker|pulse|glow|drift|neon|marquee|chase|shimmer|fade|parallax|ken\s?burns|scroll|ticker|blink)\b/i;

// Organic physics a stylesheet cannot fake. These justify paying for video.
const ORGANIC_MOTION = /\b(flame|fire|candle|smoke|steam|water|wave|splash|pour|dust|hair blowing|fabric|curtain|rain|snow)\b/i;

// Character action with a stable identity. The expensive, identity-locked tier.
const CHARACTER_ACTION = /\b(wav(e|ing)|gestur|speak|talk|walk|dance|point|smil(e|ing) at camera|mascot|character)\b/i;

/**
 * routeSlot: decide the treatment for one declared slot BEFORE any prompt is
 * sent. Returns the treatment, whether it costs anything, and the reason -- the
 * reason is recorded in DNA so a routing decision can be argued with later.
 */
export function routeSlot(slot = {}) {
  const motion = String(slot.motion || '').trim();
  const prompt = String(slot.prompt || '');
  const wantsMotion = Boolean(motion) || slot.kind === 'video';

  if (!wantsMotion) {
    // Stills split on intent, not on quality: a draft is for iterating, a final
    // is for the page. Paying final rates to iterate is the other money leak.
    const final = slot.role === 'hero' || slot.final === true;
    return {
      treatment: final ? 'still_final' : 'still_draft',
      paid: true,
      reason: final
        ? 'a hero or explicitly final still is what the visitor actually sees, so it routes to the higher-fidelity tier'
        : 'a non-final still routes to the cheap iteration tier; promote it explicitly when it is chosen',
    };
  }

  if (CSS_FAKEABLE.test(motion) && !ORGANIC_MOTION.test(motion) && !CHARACTER_ACTION.test(motion)) {
    return {
      treatment: 'css',
      paid: false,
      reason: `ambient UI motion ("${motion}") is reproducible in CSS/SVG, so no video is purchased`,
    };
  }

  if (CHARACTER_ACTION.test(motion) || CHARACTER_ACTION.test(prompt)) {
    return {
      treatment: 'video_character',
      paid: true,
      reason: 'character action needs identity locking across frames, which is the reference-to-video tier',
    };
  }

  if (ORGANIC_MOTION.test(motion)) {
    return {
      treatment: 'video_ambient',
      paid: true,
      reason: `organic physics ("${motion}") cannot be faked in CSS, so video is justified`,
    };
  }

  // Motion was asked for but does not match a known class. Do NOT quietly buy
  // video: say so, route to the cheap path, and let a human promote it.
  return {
    treatment: 'css',
    paid: false,
    reason: `motion ("${motion}") did not match a known class; routed to CSS rather than buying video on a guess`,
  };
}

/** Which media kind a treatment needs, for provider resolution. */
export function kindFor(treatment) {
  if (treatment === 'css') return null;
  return treatment.startsWith('video') ? 'video' : 'image';
}

/**
 * planSlots: route every declared slot and summarise what the routing avoided.
 * `avoided_paid_slots` is the number the CSS rule kept off a provider bill --
 * the measurable value of the rule, reported rather than assumed.
 */
export function planSlots(slots = []) {
  const routed = slots.map((s) => ({ ...s, routing: routeSlot(s) }));
  return {
    slots: routed,
    summary: {
      declared: routed.length,
      css: routed.filter((s) => s.routing.treatment === 'css').length,
      paid: routed.filter((s) => s.routing.paid).length,
      avoided_paid_slots: routed.filter((s) => !s.routing.paid).length,
      by_treatment: TREATMENTS.reduce((acc, t) => {
        const n = routed.filter((s) => s.routing.treatment === t).length;
        if (n) acc[t] = n;
        return acc;
      }, {}),
    },
  };
}
