/**
 * Media provider registry — provider-neutral BY CONSTRUCTION.
 *
 * WHY THIS EXISTS
 *
 * The imagery stage was written against exactly one generator, so its config
 * carries a single `endpoint` and a single `provider` string. That is fine until
 * a build needs video, an avatar, or a different still generator, at which point
 * the only way forward is a second bespoke code path. vNext already solved this
 * shape: separate `openai_image_worker.py` and `gemini_flash_lite_image_worker.mjs`
 * executables, each declaring its own model, its own cost per unit, and its own
 * preflight, behind one calling convention.
 *
 * This registry is that calling convention. It is a REGISTRY ONLY: it declares
 * what exists, what each provider can produce, how it authenticates, and how it
 * is reached. It deliberately wires nothing beyond the provider a real build
 * already uses. An entry with `status: 'declared'` is a slot for later, not a
 * capability being claimed.
 *
 * THE AUTH RULE IS PART OF THE REGISTRY, NOT A CONVENTION AROUND IT
 *
 * `auth` is a required field with three legal values, and the registry refuses
 * an entry that would put a raw API key inside Studio:
 *
 *   'none'        keyless public endpoint
 *   'mcp'         reached as an MCP tool on the operator's subscription
 *   'seam'        credential lives in another service; Studio calls a worker
 *
 * There is deliberately no 'api_key' value. Studio holding a provider key is the
 * accident that made preview generation look like it belonged to Designs
 * (see docs/plans/BOUNDARY-CLASSIFICATION.md), and the 2026-05-05 ruling puts
 * provider auth in the platform vault, not in a generated site's builder.
 */

export const MEDIA_KINDS = ['image', 'video', 'avatar', 'audio'];
export const AUTH_MODES = ['none', 'mcp', 'seam'];

/**
 * status:
 *   'wired'    reachable and exercised by a real build
 *   'declared' registered, not wired; selecting it is an explicit error, never
 *              a silent fallback
 */
const PROVIDERS = [
  {
    id: 'pollinations',
    kinds: ['image'],
    auth: 'none',
    status: 'wired',
    transport: 'https',
    // The only provider a real build currently uses. Its live config still comes
    // from config/imagery.json so this registry does not fork the source of truth.
    config_ref: 'config/imagery.json',
    cost: { model: 'unreported', currency: 'USD', amount_per_unit: null, status: 'keyless_public_endpoint_reports_no_cost' },
    note: 'keyless public endpoint; the generator behind the current imagery stage',
  },
  {
    id: 'designs-gemini-worker',
    kinds: ['image'],
    auth: 'seam',
    status: 'declared',
    transport: 'worker',
    // The credential lives with Designs. Studio calls the worker and never sees
    // the key. Shape taken from gemini_flash_lite_image_worker.mjs, which already
    // declares its model, its keychain SERVICE/ACCOUNT and its cost per 1k.
    worker_ref: 'website-delivery-swarm/gemini_flash_lite_image_worker.mjs',
    model: 'gemini-3.1-flash-lite-image',
    cost: { model: 'gemini-3.1-flash-lite-image', currency: 'USD', amount_per_unit: 0.0000336, status: 'declared_by_worker' },
    note: 'current Designs worker; reached across the seam so Studio holds no key',
  },
  {
    id: 'hyperframes',
    kinds: ['video'],
    auth: 'mcp',
    // WIRED 2026-08-25 (ruling 3): probed and answered clean with no separate
    // authentication, which is the subscriptions-not-keys path working. It is
    // the only wired video provider, so a video slot now resolves instead of
    // throwing NO_WIRED_PROVIDER.
    status: 'wired',
    transport: 'mcp',
    // Probed 2026-08-25: the HyperFrames MCP server exposes compose() and
    // render_video() and required no separate authentication in the operator's
    // session. This is the subscriptions-not-keys path working as intended.
    mcp_tools: ['compose', 'render_video', 'get_render_status'],
    cost: { currency: 'USD', amount_per_unit: null, status: 'paid_action_provider_does_not_report_unit_cost' },
    note: 'MCP path confirmed available without separate auth; render is a paid action',
  },
  {
    id: 'adobe',
    kinds: ['image', 'video'],
    auth: 'mcp',
    status: 'declared',
    transport: 'mcp',
    // Probed 2026-08-25: the Adobe MCP server is present but reports that it
    // requires authentication, which cannot be completed from a non-interactive
    // session. Recorded as a real blocker with its cause, not as unavailable.
    mcp_tools: ['video_render', 'video_render_frame', 'image_apply_preset'],
    blocked_by: 'operator_auth_required: the Adobe MCP server needs authorization in an interactive session before any tool can be called',
    cost: { currency: 'USD', amount_per_unit: null, status: 'unknown_until_authorized' },
    note: 'MCP path exists; blocked on operator authorization, fixable by Fritz',
  },
  {
    id: 'heygen',
    kinds: ['avatar', 'video'],
    auth: 'seam',
    status: 'declared',
    transport: 'worker',
    blocked_by: 'no_worker: no HeyGen worker or MCP server was found on this machine',
    cost: { currency: 'USD', amount_per_unit: null, status: 'unknown' },
    note: 'declared for completeness; nothing to call yet',
  },
  {
    id: 'openart',
    kinds: ['image'],
    auth: 'seam',
    status: 'declared',
    transport: 'worker',
    blocked_by: 'no_worker: no OpenArt worker or MCP server was found on this machine',
    cost: { currency: 'USD', amount_per_unit: null, status: 'unknown' },
    note: 'declared for completeness; nothing to call yet',
  },
];

function validate(entry) {
  if (!entry.id) throw new Error('media provider requires an id');
  if (!AUTH_MODES.includes(entry.auth)) {
    // Catches the one mistake that matters: registering a provider whose key
    // Studio would have to hold.
    throw new Error(`media provider ${entry.id}: auth must be one of ${AUTH_MODES.join(', ')} (a raw API key in Studio is not a legal auth mode)`);
  }
  const bad = (entry.kinds || []).filter((k) => !MEDIA_KINDS.includes(k));
  if (bad.length) throw new Error(`media provider ${entry.id}: unknown kind(s) ${bad.join(', ')}`);
  return entry;
}

const REGISTRY = new Map(PROVIDERS.map((p) => [p.id, validate(p)]));

export function listProviders({ kind = null, status = null } = {}) {
  return [...REGISTRY.values()]
    .filter((p) => (kind ? p.kinds.includes(kind) : true))
    .filter((p) => (status ? p.status === status : true))
    .map((p) => ({ ...p }));
}

export function getProvider(id) {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`unknown media provider: ${id}`);
  return { ...p };
}

/**
 * Resolve the provider for a kind of media. A declared-but-unwired provider is
 * an ERROR when asked for by name, never a silent downgrade to a wired one: a
 * caller that asked for video and quietly got a still is the substitution
 * failure the imagery stage already refuses.
 */
export function resolveProvider({ kind, prefer = null } = {}) {
  if (!MEDIA_KINDS.includes(kind)) throw new Error(`unknown media kind: ${kind}`);
  if (prefer) {
    const p = getProvider(prefer);
    if (!p.kinds.includes(kind)) throw new Error(`provider ${prefer} does not produce ${kind}`);
    if (p.status !== 'wired') {
      const err = new Error(`provider ${prefer} is declared but not wired${p.blocked_by ? `: ${p.blocked_by}` : ''}`);
      err.code = 'PROVIDER_NOT_WIRED';
      throw err;
    }
    return p;
  }
  const wired = listProviders({ kind, status: 'wired' });
  if (!wired.length) {
    const err = new Error(`no wired provider produces ${kind}; declared candidates: ${listProviders({ kind }).map((p) => p.id).join(', ') || 'none'}`);
    err.code = 'NO_WIRED_PROVIDER';
    throw err;
  }
  return wired[0];
}

/** What the console and DNA should show: the honest state of every provider. */
export function registrySummary() {
  return listProviders().map(({ id, kinds, auth, status, blocked_by = null }) => ({ id, kinds, auth, status, blocked_by }));
}
