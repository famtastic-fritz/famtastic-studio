/**
 * Composer provider registry.
 *
 * WHY A REGISTRY AND NOT A SECOND COMPOSER
 *
 * Compose was the only stage in the pipeline with no model and no variation: one
 * document shape for every business, which is why five scored samples landed in
 * a 66-71 band. The archetype work fixed the shape, but it fixed it by making
 * OUR composer better. That still leaves exactly one way to build a page.
 *
 * Treating the composer as a PROVIDER, the way media and research already are,
 * means the question "which composer builds this site" becomes a recipe decision
 * with recorded provenance, and a second provider can be scored against the
 * first on the same brief rather than argued about.
 *
 * OUTPUT STACK IS PER-SITE AND DECLARED IN THE SPEC
 *
 * Different providers emit different stacks. Ours emits plain HTML and CSS,
 * which the canvas can manipulate directly. A model-authored provider may emit
 * something the canvas cannot safely edit -- and the honest answer there is to
 * SAY SO, not to offer editing controls that silently corrupt the output. Each
 * provider declares `edit_support`, the spec records `output_stack` for the site
 * it built, and the console reads that to decide what it may offer.
 *
 * AUTH FOLLOWS THE SAME RULE AS EVERYWHERE ELSE
 *
 * subscription | mcp | none. Never api_key, per the 2026-05-05 ruling.
 */

// Enums are the ruling's, verbatim. `wired` was my word for it before the
// ruling landed; the contract says live | declared | blocked.
export const OUTPUT_STACKS = ['html', 'react-tailwind', 'astro'];
export const EDIT_SUPPORT = ['full', 'view_only'];
export const AUTH_MODES = ['none', 'subscription', 'mcp'];
export const PROVIDER_STATUS = ['live', 'declared', 'blocked'];
export const COST_MODELS = ['free', 'per_build', 'per_token'];

/**
 * Provider-by-job (AMENDMENT A2). The bake-off's decisive column was timing, not
 * layout count: 0ms/reproducible against 89s/different-every-run. Those are not
 * better and worse, they are suited to different jobs.
 *
 *   proof_direction  three proofs should be three THESES, not three colourways.
 *                    Variation is the product. -> claude-cli
 *   rebuild / edit   a palette change must never silently redesign a page a
 *                    client already approved. -> archetype-native
 *
 * There is no single winner, so there is no single default.
 */
export const JOB_DEFAULTS = {
  proof_direction: 'claude-cli',
  initial_build: 'claude-cli',
  rebuild: 'archetype-native',
  edit: 'archetype-native',
  token_change: 'archetype-native',
};

const PROVIDERS = [
  {
    id: 'archetype-native',
    status: 'live',
    auth: 'none',
    output_stack: 'html',
    capability_class: ['brochure'],
    accepts: { spec: true, tokens: true, media_slots: true },
    deterministic: true,
    cost_model: 'free',
    cost_estimate: 0,
    can_multi_page: true,
    can_use_provided_media: true,
    // The canvas wrote these classes and knows every one it emitted.
    edit_support: 'full',
    note: 'four archetypes selected by business type and content shape; no model call, so it is reproducible and free. The fallback that keeps the registry honest, and the only provider guaranteed available when a subscription is down.',
  },
  {
    id: 'claude-cli',
    status: 'live',
    auth: 'subscription',
    output_stack: 'html',
    capability_class: ['brochure'],
    accepts: { spec: true, tokens: true, media_slots: true },
    deterministic: false,
    cost_model: 'per_build',
    // Rides the existing subscription; the CLI reports no per-call cost.
    cost_estimate: null,
    cost_estimate_reason: 'runs on the operator subscription and the CLI does not report per-call cost',
    can_multi_page: true,
    can_use_provided_media: true,
    // A model authored this markup; the canvas did not emit its classes and
    // cannot assume its structure.
    edit_support: 'view_only',
    note: 'wired first per A1.1: already on the subscription, already the research brain, already probed working',
  },
  {
    id: 'kimi-cli',
    status: 'declared',
    auth: 'subscription',
    output_stack: 'react-tailwind',
    capability_class: ['brochure'],
    accepts: { spec: true, tokens: true, media_slots: true },
    deterministic: false,
    cost_model: 'per_token',
    cost_estimate: null,
    cost_estimate_reason: 'unverified; must be measured before any volume run',
    can_multi_page: true,
    can_use_provided_media: true,
    edit_support: 'view_only',
    blocker: 'cost unverified; only permissible on its cheapest qualifying model, and only after a measured cost-per-build comparison. Any Kimi involvement in research, preview generation or media is POST-SHIP per A1.2.',
    note: 'declared so the registry is honest about what exists; deliberately not wired',
  },
  {
    id: 'kimi-api',
    // Registered as BLOCKED rather than omitted: a registry that simply lacks a
    // provider cannot explain why it is forbidden, and the next person to
    // consider it repeats the analysis.
    status: 'blocked',
    auth: 'subscription',
    output_stack: 'react-tailwind',
    capability_class: ['brochure'],
    accepts: { spec: true, tokens: true, media_slots: true },
    deterministic: false,
    cost_model: 'per_token',
    cost_estimate: null,
    cost_estimate_reason: 'not measured; the provider is forbidden on other grounds',
    can_multi_page: true,
    can_use_provided_media: true,
    edit_support: 'view_only',
    blocker: 'PERMANENTLY BLOCKED: requires an api_key, which violates the no-credential rule (2026-05-05, provider authentication belongs to Studio not to generators), and bills separately from the subscription.',
    note: 'recorded so the prohibition is documented rather than rediscovered',
  },
];

function validate(p) {
  if (!PROVIDER_STATUS.includes(p.status)) throw new Error(`composer provider ${p.id}: unknown status ${p.status}`);
  // The contract makes a blocker REQUIRED for anything not live. A blocked
  // provider with no stated reason is exactly the "document viewer" failure:
  // a surface reporting a state it cannot explain.
  if (p.status !== 'live' && !p.blocker) throw new Error(`composer provider ${p.id}: status "${p.status}" requires a blocker explaining why`);
  if (!COST_MODELS.includes(p.cost_model)) throw new Error(`composer provider ${p.id}: unknown cost_model ${p.cost_model}`);
  if (p.cost_estimate === null && !p.cost_estimate_reason) throw new Error(`composer provider ${p.id}: a null cost_estimate requires cost_estimate_reason`);
  if (!AUTH_MODES.includes(p.auth)) {
    throw new Error(`composer provider ${p.id}: auth must be one of ${AUTH_MODES.join(', ')} (an API key in Studio is not a legal auth mode)`);
  }
  if (!OUTPUT_STACKS.includes(p.output_stack)) throw new Error(`composer provider ${p.id}: unknown output_stack ${p.output_stack}`);
  if (!EDIT_SUPPORT.includes(p.edit_support)) throw new Error(`composer provider ${p.id}: unknown edit_support ${p.edit_support}`);
  return p;
}

const REGISTRY = new Map(PROVIDERS.map((p) => [p.id, validate(p)]));

export const DEFAULT_COMPOSER_PROVIDER = 'archetype-native';

/**
 * providerForJob: the job decides, not a global winner (A2).
 * An unknown job falls back to the deterministic provider, because the failure
 * mode of unexpected variation is worse than the failure mode of a plainer page.
 */
export function providerForJob(job) {
  const id = JOB_DEFAULTS[job];
  if (!id) return { id: DEFAULT_COMPOSER_PROVIDER, reason: `no default registered for job "${job}"; falling back to the deterministic provider, because unexpected variation is the worse failure` };
  return { id, reason: `job "${job}" routes to ${id}` };
}

export function listComposerProviders({ status = null } = {}) {
  return [...REGISTRY.values()].filter((p) => (status ? p.status === status : true)).map((p) => ({ ...p }));
}

export function getComposerProvider(id) {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`unknown composer provider: ${id}`);
  return { ...p };
}

/**
 * Resolve the provider for a build. A declared-but-unwired provider asked for by
 * name is an ERROR carrying its blocker, never a silent downgrade to the
 * default: a build that quietly used a different composer than the recipe asked
 * for is unreproducible, and the recipe would still claim otherwise.
 */
export function resolveComposerProvider(id = DEFAULT_COMPOSER_PROVIDER) {
  const p = getComposerProvider(id);
  if (p.status !== 'live') {
    const err = new Error(`composer provider ${id} is ${p.status}, not live: ${p.blocker}`);
    err.code = 'COMPOSER_PROVIDER_NOT_WIRED';
    throw err;
  }
  return p;
}

/**
 * What the console may offer for a site, derived from the stack that BUILT it.
 * Read from the spec's own `output_stack`, never inferred from the files on
 * disk: the spec records what produced them, and guessing from markup is how a
 * console ends up offering an editor that corrupts what it edits.
 */
export function editSupportFor(spec) {
  const declared = spec?.output_stack;
  if (!declared) {
    // A spec with no declared stack predates this field. Honest answer is
    // view_only: we do not know what produced it, and assuming full editability
    // is the assumption that costs data.
    return { edit_support: 'view_only', reason: 'this spec predates output_stack, so what produced its markup is unknown' };
  }
  const provider = spec.composed_by ? REGISTRY.get(spec.composed_by) : null;
  if (provider) return { edit_support: provider.edit_support, reason: provider.edit_support === 'full' ? `${provider.id} emits ${provider.output_stack} the canvas wrote and can manipulate` : `${provider.id} authored this markup; the canvas cannot assume its structure` };
  return { edit_support: 'view_only', reason: `no registered provider named ${spec.composed_by || 'unknown'}, so the canvas cannot assume the markup's structure` };
}
