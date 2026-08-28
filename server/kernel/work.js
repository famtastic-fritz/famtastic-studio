// Work inbox (plan 3.1). Fed only by sources that are real and readable in this
// tree today: recent journal entries (needs-review), recent events, sites whose
// spec fails validation, and sites with no pages on disk. Every item names the
// site explicitly (this endpoint spans sites, so scope is 'global' at the route,
// convention 5 still applies per item).
//
// Sources named in the plan that do not exist yet in this tree (Connections
// dual-status, proof pipeline events) are reported as `not_configured` with a
// reason naming what is missing. They are never invented and never silently
// dropped -- an operator looking at an empty inbox deserves to know whether it
// is genuinely empty or just unwired (convention 7).
import { createSite } from './site.js';
import { createPage } from './page.js';
import { createSpec } from './spec.js';

const JOURNAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days: what counts as "recent"
const EVENTS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const JOURNAL_LIMIT_PER_SITE = 20;
const EVENTS_LIMIT_PER_SITE = 20;

// Sources the plan names that have no real reader in this tree yet. Kept as data
// (not invented queues) so the reason is explicit and reviewable in one place.
const NOT_CONFIGURED_SOURCES = [
  {
    id: 'connections_dual_status',
    label: 'Connections (customer status + studio status + owner + blocker + last sync)',
    reason:
      'no Connections adapter exists in this tree; server/kernel/registry.js lists connections as status "seam" with jump_off: null, so dual-status items cannot be produced honestly',
  },
  {
    id: 'proof_pipeline',
    label: 'Proof pipeline stage events',
    reason:
      'no proof-job event reader exists in this tree; P0-I1 forbids importing the legacy proof route module or reading the forbidden proof-pipeline env vars, so proof stage transitions are not observable here',
  },
];

function withinWindow(ts, windowMs, now) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return now - t >= 0 && now - t <= windowMs;
}

function siteHref(siteId) {
  return `/site?site_id=${encodeURIComponent(siteId)}`;
}

function lastEventFor(events, siteId) {
  const all = events.replay(siteId, 0);
  if (!all.length) return null;
  const last = all[all.length - 1];
  return { type: last.type, ts: last.ts, seq: last.seq };
}

export function createWork({ paths, journal, events }) {
  const site = createSite({ paths });
  const page = createPage({ paths });
  const spec = createSpec({ paths });

  function siteIds() {
    return site.list().sites.map((s) => s.id);
  }

  // Source 1: recent journal entries, across all sites, as needs-review items.
  // A journal entry is a real mutation that landed without an operator having
  // looked at it yet -- that is the honest meaning of "needs review" here; there
  // is no separate reviewed/unreviewed flag in the journal schema (convention 10).
  function journalReviewItems(now) {
    const items = [];
    for (const siteId of siteIds()) {
      for (const entry of journal.read(siteId, { limit: JOURNAL_LIMIT_PER_SITE })) {
        if (!withinWindow(entry.ts, JOURNAL_WINDOW_MS, now)) continue;
        items.push({
          id: `journal_review:${siteId}:${entry.entry_id}`,
          source: 'journal_review',
          site_id: siteId,
          age_ts: entry.ts,
          state: 'needs_review',
          decision: `Review the "${entry.intent || 'change'}" made to ${siteId} by ${entry.initiator}`,
          next_action: 'Open Site View > History, confirm the change or roll it back',
          next_action_href: siteHref(siteId),
          last_event: lastEventFor(events, siteId),
          idempotency_key: entry.entry_id,
          detail: { intent: entry.intent, initiator: entry.initiator, result: entry.result?.status ?? null },
        });
      }
    }
    return items;
  }

  // Source 2: recent events, across all sites. Distinct from the journal -- an
  // event can be emitted for things a mutation never journals (identity binds,
  // resyncs, non-mutating activity), so this is a genuinely separate real source.
  function recentEventItems(now) {
    const items = [];
    for (const siteId of siteIds()) {
      const all = events.replay(siteId, 0).slice(-EVENTS_LIMIT_PER_SITE);
      for (const event of all) {
        if (!withinWindow(event.ts, EVENTS_WINDOW_MS, now)) continue;
        items.push({
          id: `recent_events:${siteId}:${event.event_id}`,
          source: 'recent_events',
          site_id: siteId,
          age_ts: event.ts,
          state: 'informational',
          decision: `New event on ${siteId}: ${event.type}`,
          next_action: 'Review in Site View > History; act only if it needs a decision',
          next_action_href: siteHref(siteId),
          last_event: { type: event.type, ts: event.ts, seq: event.seq },
          idempotency_key: event.event_id,
          detail: { type: event.type, seq: event.seq },
        });
      }
    }
    return items;
  }

  // Source 3: sites whose spec.json is missing or fails validation. A real,
  // actionable problem -- the site cannot progress through the denominators
  // (A6) until this is fixed.
  function specInvalidItems() {
    const items = [];
    for (const siteId of siteIds()) {
      const result = spec.read(siteId);
      if (result.valid) continue;
      items.push({
        id: `spec_invalid:${siteId}`,
        source: 'spec_invalid',
        site_id: siteId,
        age_ts: new Date().toISOString(),
        state: 'spec_invalid',
        decision: `Fix spec.json for ${siteId}: ${result.errors.join('; ')}`,
        next_action: 'Open Site View > Spec, correct the errors, then save',
        next_action_href: siteHref(siteId),
        last_event: lastEventFor(events, siteId),
        idempotency_key: `spec_invalid:${siteId}`,
        detail: { errors: result.errors },
      });
    }
    return items;
  }

  // Source 4: sites with no HTML pages on disk yet. Another real, actionable gap
  // -- the site directory exists but there is nothing to preview or deploy.
  function noPagesItems() {
    const items = [];
    for (const siteId of siteIds()) {
      const result = page.list(siteId);
      if (result.status !== 'empty') continue;
      items.push({
        id: `no_pages:${siteId}`,
        source: 'no_pages',
        site_id: siteId,
        age_ts: new Date().toISOString(),
        state: 'no_pages',
        decision: `${siteId} has no HTML pages on disk yet`,
        next_action: 'Open Site View > Pages and generate or import a first page',
        next_action_href: siteHref(siteId),
        last_event: lastEventFor(events, siteId),
        idempotency_key: `no_pages:${siteId}`,
        detail: {},
      });
    }
    return items;
  }

  function list({ now = Date.now() } = {}) {
    const journalItems = journalReviewItems(now);
    const eventItems = recentEventItems(now);
    const specItems = specInvalidItems();
    const pageItems = noPagesItems();

    const items = [...journalItems, ...eventItems, ...specItems, ...pageItems].sort(
      (a, b) => Date.parse(b.age_ts) - Date.parse(a.age_ts),
    );

    // `sources` is listed before `items` in this object, deliberately: it always
    // has 6 entries (4 real + 2 not_configured), so it is never mistaken for an
    // empty collection by anything that infers "empty" from the first array in
    // the body (see public/kit/region.js findFirstArray). `items` legitimately can
    // be empty on a quiet day; `sources` never should be, because that is the
    // honest inventory of what this endpoint even looked at.
    return {
      sources: [
        { id: 'journal_review', label: 'Recent journal entries (needs review)', scope: 'per_site', status: 'ok', count: journalItems.length },
        { id: 'recent_events', label: 'Recent events', scope: 'per_site', status: 'ok', count: eventItems.length },
        { id: 'spec_invalid', label: 'Sites with an invalid or missing spec', scope: 'per_site', status: 'ok', count: specItems.length },
        { id: 'no_pages', label: 'Sites with no pages on disk', scope: 'per_site', status: 'ok', count: pageItems.length },
        ...NOT_CONFIGURED_SOURCES.map((s) => ({ id: s.id, label: s.label, scope: 'global', status: 'not_configured', count: 0, reason: s.reason })),
      ],
      items,
      denominators: { open: items.length },
    };
  }

  return { list, NOT_CONFIGURED_SOURCES };
}
