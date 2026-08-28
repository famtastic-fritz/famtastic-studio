// Proofs projection (plan section 3 item 5, Decision 3). Read-only pipeline
// visibility over REAL integration events on the event spine (kernel/events.js).
// This module owns no ingress: it only reads what a future famtasticdesigns
// integration would emit onto <events root>/<site_id>.jsonl, using events.replay
// (the same torn-tail-safe reader the WebSocket resync path uses). It never
// calls out to the live FAMtastic Designs proof pipeline, never reads the
// forbidden proof-pipeline secret prefix (see kernel/invariants.js for the
// exact name), and exposes no mutating route -- see
// server/modules/platform/index.js, which registers GET only.
//
// Stage vocabulary (plan 3.5, binding): ingested -> generating ->
// ready for review -> delivered -> client reviewing -> revision requested.
// The wire contract this projection reads is `proof.stage.<code>` events with
// `payload.proof_id` and optional `payload.evidence`. No adapter on this
// machine emits that contract yet, which is exactly why the honest states
// below exist: not_configured (no event log has ever carried one) and empty
// (a log exists but carries none).
//
// Unreadable evidence is a FOURTH state, distinct from both: a corrupt file
// or a permission failure on a site's event log is not "nothing was ever
// written" (not_configured) and it is not "we read it and there was nothing"
// (empty) -- it is "we could not read it", which this projection used to
// silently swallow (`catch { continue; }`) and then, if every other site log
// happened to be readable-but-event-free, report as a plain empty. That
// collapse hid a real evidence-integrity problem behind a comforting
// "nothing to see" message. Unreadable logs are now counted and surfaced:
// status 'error' when every discovered site log is unreadable (there is
// nothing honest left to show), status 'partial' when some are readable and
// some are not (the readable data is shown, with the gap named), carrying
// `unreadable` (per-site reasons) and `unreadable_count`.

const STAGE_ORDER = ['ingested', 'generating', 'proof_ready', 'delivered', 'client_reviewing', 'revision_requested'];

// Registry entries can override a code's display label (registry.js already
// carries proof_ready -> 'ready for review' and proof_delivered -> 'delivered'
// on the connections entry). Local labels are the full fallback vocabulary so
// every stage renders even before the registry knows about it.
const DEFAULT_STAGE_LABELS = {
  ingested: 'ingested',
  generating: 'generating',
  proof_ready: 'ready for review',
  delivered: 'delivered',
  client_reviewing: 'client reviewing',
  revision_requested: 'revision requested',
};

const TYPE_PREFIX = 'proof.stage.';

// A real famtasticdesigns.com intake could carry brief-level detail on any
// proof.stage.* event's payload -- a brief number, the client's name, a
// snippet of their original quote-form text, whether their signature was
// verified, and which visual variants (A/B/C) exist. No adapter on this
// machine has ever emitted one, so every field here reads null on real data
// today (see the not_configured/empty states above) -- this exists so the
// Ingestion Hub can render whichever fields a real event DOES carry, once
// one exists, without a schema change. Never invents a value: an absent
// field stays null, never a guessed default.
function briefFrom(payload) {
  const p = payload || {};
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const variants = Array.isArray(p.proof_variants)
    ? p.proof_variants
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ id: str(v.id), label: str(v.label), href: str(v.href) }))
    : null;
  return {
    brief_number: str(p.brief_number),
    client_name: str(p.client_name),
    quote_snippet: str(p.quote_snippet),
    signature_verified: typeof p.signature_verified === 'boolean' ? p.signature_verified : null,
    proof_variants: variants && variants.length ? variants : null,
  };
}

function labelFor(code, projection) {
  if (projection && typeof projection[code] === 'string' && projection[code].trim()) return projection[code];
  return DEFAULT_STAGE_LABELS[code] || code;
}

// Discovers which site event logs exist under the events root, without
// assuming any particular site_id (convention 5: no ambient site). Returns
// [] when the root itself does not exist.
function discoverSiteIds(fs, eventsRoot) {
  if (!fs.existsSync(eventsRoot)) return null; // root missing entirely
  return fs.readdirSync(eventsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name.slice(0, -'.jsonl'.length));
}

function notConfigured(reason) {
  return { status: 'not_configured', reason, note: `Not configured: ${reason}`, entries: [], stages: STAGE_ORDER.map((code) => ({ code, label: DEFAULT_STAGE_LABELS[code] })), source: 'events' };
}

function empty(reason, extra = {}) {
  return { status: 'empty', reason, note: `Empty: ${reason}`, entries: [], stages: STAGE_ORDER.map((code) => ({ code, label: DEFAULT_STAGE_LABELS[code] })), source: 'events', ...extra };
}

// projectProofs({ fs, paths, events, registry }) -> honest projection body.
// `fs` is injected (node:fs in production, a fake in tests) so this module
// never resolves filesystem roots itself (convention 8: only paths.js does
// that); it only asks paths.root('events') where to look and events.replay
// to read what is there.
export function projectProofs({ fs, paths, events, registry }) {
  if (!fs) throw new Error('projectProofs requires fs');
  if (!paths) throw new Error('projectProofs requires paths');
  if (!events) throw new Error('projectProofs requires events');

  const eventsRoot = paths.root('events');
  const siteIds = discoverSiteIds(fs, eventsRoot);

  if (siteIds === null) {
    return notConfigured(`the events root does not exist yet at ${eventsRoot}; no integration has ever emitted a proof event on this machine`);
  }
  if (siteIds.length === 0) {
    return notConfigured('the events root exists but contains no site event logs; no integration has ever emitted a proof event on this machine');
  }

  const connections = registry ? registry.byId('connections') : null;
  const projection = connections && connections.status_projection ? connections.status_projection : {};

  let sawProofStageEvent = 0;
  let skippedMalformed = 0;
  const groups = new Map();
  const unreadable = [];

  for (const siteId of siteIds) {
    let siteEvents;
    try {
      siteEvents = events.replay(siteId, 0);
    } catch (error) {
      unreadable.push({ site_id: siteId, reason: error.message });
      continue;
    }
    for (const event of siteEvents) {
      if (typeof event.type !== 'string' || !event.type.startsWith(TYPE_PREFIX)) continue;
      sawProofStageEvent += 1;
      const code = event.type.slice(TYPE_PREFIX.length);
      if (!STAGE_ORDER.includes(code)) { skippedMalformed += 1; continue; }
      const proofId = event.payload && typeof event.payload.proof_id === 'string' ? event.payload.proof_id.trim() : '';
      if (!proofId) { skippedMalformed += 1; continue; }

      const key = `${siteId}:${proofId}`;
      const entry = groups.get(key) || { proof_id: proofId, site_id: siteId, evidence_trail: [], payloads: [] };
      entry.evidence_trail.push({
        stage: code,
        label: labelFor(code, projection),
        at: event.ts,
        evidence: Object.prototype.hasOwnProperty.call(event.payload || {}, 'evidence') ? event.payload.evidence : null,
        event_id: event.event_id,
      });
      // Tracked separately from evidence_trail (whose exact shape existing
      // consumers already depend on): the brief-level fields a real intake
      // event could carry (see briefFrom below) live on the whole payload,
      // not just the `evidence` field evidence_trail already surfaces.
      entry.payloads.push({ at: event.ts, payload: event.payload || {} });
      groups.set(key, entry);
    }
  }

  // Every discovered site log failed to read: there is no honest reading of
  // "empty" left to report, and reporting it anyway would be indistinguishable
  // from real evidence. This is a read failure, not an absence of data.
  if (unreadable.length > 0 && unreadable.length === siteIds.length) {
    return {
      status: 'error',
      reason: `all ${siteIds.length} site event log(s) under the events root could not be read; evidence is unavailable, not empty`,
      entries: [],
      stages: STAGE_ORDER.map((code) => ({ code, label: DEFAULT_STAGE_LABELS[code] })),
      source: 'events',
      unreadable,
      unreadable_count: unreadable.length,
    };
  }

  // withUnreadability: attaches the partial-coverage envelope to whichever
  // honest body (empty or available) would otherwise be returned, when at
  // least one site log could not be read alongside others that could.
  const withUnreadability = (body) => {
    if (unreadable.length === 0) return body;
    const gap = `${unreadable.length} of ${siteIds.length} site event log(s) could not be read`;
    return {
      ...body,
      status: 'partial',
      reason: body.reason ? `${body.reason}; additionally ${gap}` : `${gap}; showing data from the readable log(s)`,
      unreadable,
      unreadable_count: unreadable.length,
    };
  };

  if (sawProofStageEvent === 0) {
    return withUnreadability(empty('event log(s) exist under the events root but carry no proof.stage.* events yet'));
  }

  const entries = [...groups.values()].map((entry) => {
    const trail = [...entry.evidence_trail].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const latest = trail[trail.length - 1];
    const latestPayloads = [...entry.payloads].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const latestPayload = latestPayloads.length ? latestPayloads[latestPayloads.length - 1].payload : {};
    return {
      proof_id: entry.proof_id,
      site_id: entry.site_id,
      stage: latest.stage,
      stage_label: latest.label,
      updated_at: latest.at,
      evidence_trail: trail,
      brief: briefFrom(latestPayload),
    };
  });

  if (entries.length === 0) {
    return withUnreadability(empty('proof.stage.* events were found but none carried a recognized stage and a proof_id', { skipped_malformed: skippedMalformed }));
  }

  entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));

  return withUnreadability({
    status: 'available',
    reason: null,
    entries,
    stages: STAGE_ORDER.map((code) => ({ code, label: labelFor(code, projection) })),
    source: 'events',
    skipped_malformed: skippedMalformed,
    connections: connections
      ? { id: connections.id, jump_off: connections.jump_off ?? null, authority: connections.authority ?? null }
      : { id: null, jump_off: null, authority: null },
  });
}

export const proofStageOrder = STAGE_ORDER;
export const proofStageDefaultLabels = DEFAULT_STAGE_LABELS;
export const proofEventTypePrefix = TYPE_PREFIX;
