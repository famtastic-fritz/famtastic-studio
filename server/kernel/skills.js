/**
 * Shay's skills: the six named background capabilities from the cockpit
 * mockup (docs/plans/reference/shay-operator-console-mockup.html's
 * .skillgrid), reported honestly rather than fabricated.
 *
 * Every one of the six names in that mockup -- broken-link-crawler,
 * famtastic-proof-worker, seo-analyzer, ssl-watchdog, asset-optimizer,
 * nightly-backup -- is a purely illustrative label in that file: its
 * toggles are a client-side CSS class flip with no backend behind them at
 * all, and its stats ("last run 06:00 check", "2 jobs today") are
 * hand-written strings, not measurements. A repo-wide search (this session,
 * 2026-08-27) confirms none of the six correspond to a real, scheduled,
 * logged background job anywhere in this codebase or the wider FAMtastic
 * tree today.
 *
 * One of the six is real right now: seo-analyzer, backed by the actual
 * server/kernel/seo.js this session already shipped -- but as an on-demand,
 * per-site analyzer (see /api/seo), not a scheduled background job, so it
 * is reported that way, not with an invented cadence or run history.
 *
 * famtastic-proof-worker additionally cannot be implemented as a real
 * ingress worker in THIS server regardless of future work: P0-I1
 * (server/kernel/invariants.js) refuses to boot if any route matches a
 * proof-job ingress pattern.
 *
 * Every card here reports honestly rather than invents: `implemented: false`
 * skills carry no schedule, no last_run, no log_href, and their toggle is
 * disabled with a stated reason (matching public/kit/toolbar.js's own
 * established contract: a disabled control must say why).
 */

const SKILL_DEFINITIONS = [
  {
    id: 'broken-link-crawler',
    name: 'broken-link-crawler',
    description: 'Would walk every real page of every real site and flag dead links, missing images, and offline forms.',
    implemented: false,
  },
  {
    id: 'famtastic-proof-worker',
    name: 'famtastic-proof-worker',
    description: 'Would listen for signed briefs from famtasticdesigns.com and draft visual proofs per lead.',
    implemented: false,
    blocked_reason: 'P0-I1 (server/kernel/invariants.js): this server refuses to boot if a proof-job ingress route is ever registered, so a real worker for this cannot live in this server.',
  },
  {
    id: 'seo-analyzer',
    name: 'seo-analyzer',
    description: "Scores a site's real pages for SEO -- title/description length, headings, alt text, OpenGraph -- and drafts fixes.",
    implemented: true,
    mode: 'on_demand',
    detail: 'Real, working capability (server/kernel/seo.js). Computed live per site, on demand -- see /seo. Not a background job: there is no schedule or run history to report honestly.',
  },
  {
    id: 'ssl-watchdog',
    name: 'ssl-watchdog',
    description: 'Would check certificate expiry across every real domain in the portfolio.',
    implemented: false,
  },
  {
    id: 'asset-optimizer',
    name: 'asset-optimizer',
    description: 'Would compress and right-size real media assets found across imported sites.',
    implemented: false,
  },
  {
    id: 'nightly-backup',
    name: 'nightly-backup',
    description: 'Would back up real site content on a recurring schedule.',
    implemented: false,
  },
];

function toCard(def) {
  const base = {
    id: def.id,
    name: def.name,
    description: def.description,
    implemented: def.implemented,
    schedule: null,
    last_run: null,
    log_href: null,
    // Present at the top level (not just nested in toggle.disabled_reason)
    // so a consumer can surface a structural blocker like P0-I1 prominently,
    // not only as a hover tooltip on the disabled switch.
    blocked_reason: def.blocked_reason || null,
    toggle: { enabled: null, disabled: true, disabled_reason: null },
  };
  if (!def.implemented) {
    base.toggle.disabled_reason = def.blocked_reason || `not implemented: no ${def.id} worker exists yet`;
    return base;
  }
  // Implemented but on-demand: still nothing to toggle (there is no
  // background job to start/stop), so the toggle stays disabled -- with the
  // real reason, not the "not implemented" one.
  base.mode = def.mode || null;
  base.detail = def.detail || null;
  base.toggle.disabled_reason = 'this capability runs on demand per request, not as a background job -- there is nothing here to toggle on or off';
  return base;
}

/**
 * listSkills(): the six skill cards, honestly reported. No filesystem/
 * network access -- pure, so it is trivially testable and can never itself
 * become a source of a fabricated value.
 */
export function listSkills() {
  return SKILL_DEFINITIONS.map(toCard);
}

/**
 * killSwitch(): reported as 'unknown', not false -- there is no real
 * kill-switch source to read from yet, and claiming "not engaged" without
 * ever having checked could hide a real engaged stop behind an
 * honest-looking page. Kept identical to the pre-existing honest handling
 * in server/modules/operations/index.js, just relocated.
 */
export function killSwitch() {
  return {
    state: 'unknown',
    reason: 'no kill-switch source has been wired up yet; this is not a read of a real value',
  };
}
