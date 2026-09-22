// End-to-end pipeline tests (ENDGAME items 8-12). Runs the REAL pipeline --
// real research adapter, real spec derivation, real deterministic composer,
// real file writes via mutation, real Playwright/Chromium verification --
// against a hermetic temp STUDIO_DATA_ROOT. No kernel logic is reimplemented
// here; this drives server/kernel/pipeline.js exactly as the HTTP module does.
import { stubResearchOptions, makeResearchStub } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';
import { makeImageryStub } from './imagery-stub.mjs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createRecipe } from '../server/kernel/recipe.js';
import {
  createPipeline, STAGES, MODEL_ROUTING, resolveTreeIdentity, assertManifestComplete,
} from '../server/kernel/pipeline.js';
import { composeSite } from '../server/kernel/compose.js';
import { verifySite } from '../server/kernel/verify.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-pipeline-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeKernels() {
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  const recipe = createRecipe({ paths, dna });
  const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation, researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });
  return { paths, journal, events, dna, mutation, spec, recipe, pipeline };
}

function honestBrief(overrides = {}) {
  // No sourced facts -- the shay-native adapter must honestly report
  // execution_status reflects what research actually achieved, never a default.
  return {
    business: { name: 'Acme Bakery', description: 'A neighborhood bakery.' },
    site_needs: { pages: ['home', 'about', 'contact'], offers: ['Sourdough loaves', 'Custom cakes'], ctas: ['Order now'] },
    ...overrides,
  };
}

describe('pipeline: end to end from a brief to a built, verified site', () => {
  it('runs research -> spec -> compose -> build -> verify -> record and produces a real site on disk', async () => {
    const { paths, dna, recipe, pipeline } = makeKernels();
    const site_id = 'acme-bakery';

    const result = await pipeline.run({ site_id, brief: honestBrief() });

    expect(result.outcome, JSON.stringify(result.error)).toBe('success');
    expect(result.run_id).toBeTruthy();
    console.log('pipeline run_id:', result.run_id);

    // Honest research state. The adapter is now real, so under the test stub it
    // returns 'partial': it produced strategic content (brand, site needs) while
    // verifying zero facts, which is exactly the honest outcome for a thin brief
    // whose sources could not be confirmed. What must stay true is that no fact
    // was invented to fill the gap.
    // spec must say so plainly rather than pretending research happened.
    expect(['partial', 'no_findings']).toContain(result.packet.execution_status);
    expect(result.packet.facts, 'no fact may be invented when nothing was verified').toEqual([]);
    expect(result.spec.generated_from.derivation).toBe('brief-derived');
    expect(result.spec.generated_from.note).toMatch(/No research provider is connected/);

    // Real files landed on disk under the site directory.
    const siteDir = paths.within('sites', site_id);
    const tree = fs.readdirSync(siteDir).sort();
    console.log('built file tree for', site_id, ':', tree);
    expect(tree).toContain('spec.json');
    expect(tree).toContain('index.html');
    expect(tree).toContain('about.html');
    expect(tree).toContain('contact.html');
    expect(tree).toContain('styles.css');

    const indexHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    expect(indexHtml).toMatch(/^<!doctype html>/);
    expect((indexHtml.match(/<h1[ >]/g) || [])).toHaveLength(1);
    expect(indexHtml).not.toMatch(/\{\{|\}\}/);
    expect(indexHtml).toContain('Acme Bakery');
    expect(indexHtml).toContain('Sourdough loaves');

    // Verify stage actually ran a real browser and passed.
    expect(result.verify.passed).toBe(true);
    expect(result.verify.checks.length).toBeGreaterThan(0);
    for (const check of result.verify.checks) {
      expect(check.h1_count).toBe(1);
      expect(check.console_errors).toEqual([]);
      expect(check.placeholder_tokens).toBe(false);
      expect(check.broken_links).toEqual([]);
    }

    // DNA carries every stage of the resolved graph, with a full replay manifest.
    const record = dna.read(result.run_id);
    expect(record.outcome.status).toBe('success');
    expect(record.replay_manifest.stage_graph.map((s) => s.stage)).toEqual(STAGES);
    expect(record.replay_manifest.source_commit).toBeTruthy();
    expect(record.replay_manifest.tree_hash).toBeTruthy();
    const stagesRun = record.stages.map((s) => s.stage);
    for (const stage of STAGES) expect(stagesRun).toContain(stage);
    for (const attempt of record.stages) {
      expect(attempt.status).toBe('success');
    }
    // Research is the one stage with a live provider. It must NOT record 'none':
    // that was true before the claude CLI was wired and became a false claim on
    // the DNA proof surface once research went live.
    const researchAttempt = record.stages.find((s) => s.stage === 'research');
    expect(researchAttempt.model).toBe('cli-selected');
    expect(researchAttempt.agent).toBe('claude-cli');
    // Spec is ALSO model-backed now: the copy stage runs inside it and spawns a
    // CLI per page. It recorded 'none' until 2026-08-25, which understated every
    // cost and premium-share figure computed from this field.
    const specAttempt = record.stages.find((s) => s.stage === 'spec');
    expect(specAttempt.model).toBe('cli-selected');
    expect(specAttempt.agent).toBe('claude-cli');
    for (const attempt of record.stages.filter((s) => !['research', 'spec'].includes(s.stage))) {
      expect(attempt.model).toBe('none'); // genuinely no provider on these
    }
    const composeAttempt = record.stages.find((s) => s.stage === 'compose');
    expect(composeAttempt.agent).toBe('deterministic');

    // Model routing table is data, keyed by stage, every stage present.
    for (const stage of STAGES) {
      expect(MODEL_ROUTING[stage]).toBeTruthy();
      expect(typeof MODEL_ROUTING[stage].model).toBe('string');
    }
    expect(MODEL_ROUTING.research.model).toBe('cli-selected');

    // A completed run can be saved as a recipe via the existing recipe kernel.
    const savedRecipe = recipe.fromRun(result.run_id, { name: 'acme bakery starter' });
    console.log('saved recipe_id:', savedRecipe.recipe_id, 'version:', savedRecipe.version);
    expect(savedRecipe.stages.map((s) => s.stage)).toEqual(STAGES);
    expect(savedRecipe.source_run_id).toBe(result.run_id);
  });

  it('honors a facts-bearing brief as research-derived, still with no fabricated facts', async () => {
    const { pipeline } = makeKernels();
    // This brief carries a genuinely sourced fact, so the stub's fetch must
    // confirm it. An unverifiable source is correctly demoted, which is what the
    // default stub proves elsewhere.
    const k = makeKernels();
    const verifying = createPipeline({ paths: k.paths, journal: k.journal, events: k.events, dna: k.dna, spec: k.spec, mutation: k.mutation, researchOptions: makeResearchStub({ verifySources: true }), copyOptions: makeCopyStub() });
    const brief = honestBrief({
      facts: [{ claim: 'Acme Bakery opened in 2019', source_uri: 'https://acmebakery.example/about', design_use: 'Establishes the founding year used in the about-page copy.', mutable: false }],
    });
    const result = await verifying.run({ site_id: 'acme-bakery-2', brief });
    expect(result.outcome).toBe('success');
    // 'ok' because every cited source verified and none was rejected. This
    // previously asserted 'partial' only because status used to be downgraded
    // by open questions, which made 'ok' unreachable for any real run.
    expect(result.packet.execution_status).toBe('ok');
    expect(result.spec.generated_from.derivation).toBe('research-derived');
  });
});

describe('pipeline: a failed stage is located and retryable at the stage level', () => {
  it('records the failure, leaves earlier stages intact, and a stage-level retry succeeds', async () => {
    const { dna, pipeline } = makeKernels();
    const site_id = 'broken-composer-site';

    // Deliberately request a composer that does not exist -- the compose
    // stage must fail honestly (composer_not_implemented), never fall back
    // silently to a fake success.
    const failed = await pipeline.run({ site_id, brief: honestBrief(), composer: 'not-a-real-composer' });

    expect(failed.outcome).toBe('failed');
    expect(failed.failed_stage).toBe('compose');
    console.log('deliberately failed run_id:', failed.run_id, 'at stage:', failed.failed_stage);

    const failedRecord = dna.read(failed.run_id);
    expect(failedRecord.outcome.status).toBe('failed');
    expect(failedRecord.outcome.failed_stage).toBe('compose');

    // Earlier stages ran and succeeded; nothing after the failure ran at all.
    const byStage = Object.fromEntries(STAGES.map((s) => [s, failedRecord.stages.filter((a) => a.stage === s)]));
    expect(byStage.research).toHaveLength(1);
    expect(byStage.research[0].status).toBe('success');
    expect(byStage.spec).toHaveLength(1);
    expect(byStage.spec[0].status).toBe('success');
    expect(byStage.compose).toHaveLength(1);
    expect(byStage.compose[0].status).toBe('failed');
    expect(byStage.build).toHaveLength(0);
    expect(byStage.verify).toHaveLength(0);
    expect(byStage.record).toHaveLength(0);

    // The failed attempt is locatable via the DNA convenience accessor.
    const located = dna.failedStages(failed.run_id);
    expect(located).toHaveLength(1);
    expect(located[0].stage).toBe('compose');
    const failedAttemptId = located[0].attempt_id;

    // Retry ONLY the compose stage, this time with a real composer. It must
    // succeed without re-running research or spec.
    const retried = await pipeline.retryStage({ site_id, run_id: failed.run_id, stage: 'compose', composer: 'deterministic' });
    expect(retried.outcome).toBe('stage_retried');
    expect(retried.stage).toBe('compose');

    const afterRetry = dna.read(failed.run_id);
    const composeAttempts = afterRetry.stages.filter((a) => a.stage === 'compose');
    expect(composeAttempts).toHaveLength(2);
    const [firstAttempt, secondAttempt] = composeAttempts;
    expect(firstAttempt.status).toBe('failed');
    expect(secondAttempt.status).toBe('success');
    expect(secondAttempt.retry_of).toBe(failedAttemptId);

    // research and spec were never re-run by the retry.
    const afterByStage = Object.fromEntries(STAGES.map((s) => [s, afterRetry.stages.filter((a) => a.stage === s)]));
    expect(afterByStage.research).toHaveLength(1);
    expect(afterByStage.spec).toHaveLength(1);
  });

  it('retrying an unknown stage or a stage with no failed attempt is refused, not silently accepted', async () => {
    const { pipeline } = makeKernels();
    const site_id = 'clean-run-site';
    const ok = await pipeline.run({ site_id, brief: honestBrief() });
    expect(ok.outcome).toBe('success');

    await expect(pipeline.retryStage({ site_id, run_id: ok.run_id, stage: 'not-a-stage' })).rejects.toThrow(/unknown stage/);
    await expect(pipeline.retryStage({ site_id, run_id: ok.run_id, stage: 'compose' })).rejects.toThrow(/no failed attempt/);
    await expect(pipeline.retryStage({ site_id, run_id: 'run_does_not_exist', stage: 'compose' })).rejects.toThrow(/no DNA record/);
  });
});

// Finding A regression: tree_hash must be CONTENT-derived, not a porcelain
// summary. Two dirty trees whose only difference is the CONTENT of the same
// changed file used to hash identically (same path, same status letter);
// they must not any more.
describe('resolveTreeIdentity (A4): content-derived tree_hash', () => {
  it('produces different tree_hash values for two different dirty trees with the same changed path', () => {
    const scratchPath = path.join(repoRoot, `.tmp-tree-hash-probe-${process.pid}.txt`);
    try {
      fs.writeFileSync(scratchPath, 'dirty state A');
      const identityA = resolveTreeIdentity();

      fs.writeFileSync(scratchPath, 'dirty state B -- completely different content, same path');
      const identityB = resolveTreeIdentity();

      // Same commit, same changed path -- a porcelain-summary hash (path +
      // status letter) would be identical for both. Content-derived must not be.
      expect(identityA.source_commit).toBe(identityB.source_commit);
      expect(identityA.tree_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(identityA.tree_hash).not.toBe(identityB.tree_hash);
    } finally {
      fs.rmSync(scratchPath, { force: true });
    }
  });

  it('is stable when nothing in the tree changed between two calls', () => {
    const first = resolveTreeIdentity();
    const second = resolveTreeIdentity();
    expect(first.tree_hash).toBe(second.tree_hash);
  });
});

// Finding A regression: a run must never finish success while a required
// replay-manifest field is null. assertManifestComplete is the guard;
// exercised directly (every required field) and via a real successful run.
describe('assertManifestComplete (A4): success cannot land with a null required manifest field', () => {
  function completeRecord() {
    return {
      research_packet_ref: 'packets/acme/rp_1.json',
      replay_manifest: {
        source_commit: 'abc123',
        tree_hash: 'deadbeef',
        recipe_snapshot: { snapshot: null, reason: 'no recipe_ref supplied' },
        stage_graph: [{ stage: 'research', depends_on: [] }],
      },
      stages: [{
        stage: 'research', status: 'success',
        usage: { input_tokens: 0 }, cost_estimate: { amount_usd: 0 },
        outputs: [{ ref: 'x', sha256: 'a'.repeat(64) }], inputs: [],
      }],
    };
  }

  it('accepts a fully populated record', () => {
    expect(() => assertManifestComplete(completeRecord())).not.toThrow();
  });

  it.each([
    ['research_packet_ref', (r) => { r.research_packet_ref = null; }],
    ['replay_manifest.source_commit', (r) => { r.replay_manifest.source_commit = null; }],
    ['replay_manifest.tree_hash', (r) => { r.replay_manifest.tree_hash = null; }],
    ['replay_manifest.recipe_snapshot', (r) => { r.replay_manifest.recipe_snapshot = null; }],
    ['replay_manifest.stage_graph', (r) => { r.replay_manifest.stage_graph = []; }],
    ['a successful stage usage', (r) => { r.stages[0].usage = null; }],
    ['a successful stage cost_estimate', (r) => { r.stages[0].cost_estimate = undefined; }],
    ['a successful stage output digest', (r) => { r.stages[0].outputs[0].sha256 = null; }],
  ])('refuses to let outcome success land when %s is missing', (_label, mutate) => {
    const record = completeRecord();
    mutate(record);
    expect(() => assertManifestComplete(record)).toThrow(/refusing to record a successful run with an incomplete replay manifest/);
  });

  it('a real successful pipeline run has a research_packet_ref and a recipe_snapshot object, never bare null', async () => {
    const { dna, pipeline } = makeKernels();
    const result = await pipeline.run({ site_id: 'acme-manifest-check', brief: honestBrief() });
    expect(result.outcome).toBe('success');
    const record = dna.read(result.run_id);
    expect(record.research_packet_ref).toBeTruthy();
    expect(record.replay_manifest.recipe_snapshot).not.toBeNull();
    expect(record.replay_manifest.recipe_snapshot.reason).toMatch(/no recipe_ref/);
    for (const attempt of record.stages) {
      expect(attempt.usage).not.toBeNull();
      expect(attempt.cost_estimate).not.toBeNull();
    }
  });
});

// Finding B regression: the default composer's home CTA must resolve to a
// real target, and verify.js must actually check same-page fragment links
// (it used to skip every one, so a dangling #contact link still verified).
describe('compose + verify: the default home CTA resolves to a real target (finding B)', () => {
  it('links the home CTA to contact.html when a dedicated contact page exists, and verify does not flag it broken', async () => {
    const { paths, pipeline } = makeKernels();
    const site_id = 'acme-cta-check';
    const result = await pipeline.run({ site_id, brief: honestBrief() });
    expect(result.outcome).toBe('success');

    const indexHtml = fs.readFileSync(path.join(paths.within('sites', site_id), 'index.html'), 'utf8');
    expect(indexHtml).toMatch(/<a class="cta" href="contact\.html">/);
    expect(indexHtml).not.toMatch(/href="#contact"/);
    expect(result.verify.passed).toBe(true);
  });

  it('verify.js checks same-page fragment link targets instead of skipping them: a dangling #contact link fails verification', async () => {
    const spec = {
      brand: { name: 'Dangling Co' },
      seo_targets: {},
      pages: [{
        id: 'home', path: 'index.html', title: 'Dangling Co', heading: 'Dangling Co',
        sections: [{ id: 'cta', type: 'cta', heading: 'Get started', items: ['Go'] }],
      }],
    };
    const composed = composeSite({ spec });
    // Simulate the exact old bug directly: a CTA href pointing at a same-page
    // fragment nothing on the page provides.
    const broken = composed.pages[0].html.replace('class="cta" href="index.html"', 'class="cta" href="#contact"');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fragment-'));
    try {
      fs.writeFileSync(path.join(tmp, 'index.html'), broken);
      for (const asset of composed.assets) {
        const dest = path.join(tmp, asset.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, asset.contents);
      }
      const verifyResult = await verifySite({ siteDir: tmp, pages: [{ path: 'index.html', title: 'Dangling Co', html: broken }] });
      expect(verifyResult.passed).toBe(false);
      expect(verifyResult.errors.some((e) => /same-page fragment link does not resolve/.test(e))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('verify.js does not flag a fragment link whose target really exists on the page', async () => {
    const spec = {
      brand: { name: 'Anchor Co' },
      seo_targets: {},
      pages: [{
        id: 'home', path: 'index.html', title: 'Anchor Co', heading: 'Anchor Co',
        sections: [
          { id: 'cta', type: 'cta', heading: 'Get started', items: ['Go'] },
          { id: 'contact', type: 'text', heading: 'Contact', body: 'Reach us here.' },
        ],
      }],
    };
    const composed = composeSite({ spec });
    const withRealAnchor = composed.pages[0].html.replace('class="cta" href="index.html"', 'class="cta" href="#contact"');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fragment-ok-'));
    try {
      fs.writeFileSync(path.join(tmp, 'index.html'), withRealAnchor);
      for (const asset of composed.assets) {
        const dest = path.join(tmp, asset.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, asset.contents);
      }
      const verifyResult = await verifySite({ siteDir: tmp, pages: [{ path: 'index.html', title: 'Anchor Co', html: withRealAnchor }] });
      expect(verifyResult.passed).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves relative links from the page directory in a multi-page artifact tree', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-relative-links-'));
    try {
      const pages = [
        { path: 'index.html', title: 'Home', html: '<!doctype html><html><body><h1>Home</h1><a href="owner/">Owner</a></body></html>' },
        { path: 'owner/index.html', title: 'Owner', html: '<!doctype html><html><body><h1>Owner</h1><a href="../research.md">Research</a></body></html>' },
      ];
      fs.mkdirSync(path.join(tmp, 'owner'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'index.html'), pages[0].html);
      fs.writeFileSync(path.join(tmp, 'owner/index.html'), pages[1].html);
      fs.writeFileSync(path.join(tmp, 'research.md'), '# Research');
      const verifyResult = await verifySite({ siteDir: tmp, pages });
      expect(verifyResult.passed).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('per-stage routing comes from the recipe, not one global provider', () => {
  // The pipeline resolved routing per stage but from a hardcoded module
  // constant, so a recipe's per-stage model/agent was ignored and every stage
  // ran on the same brain. A recipe exists precisely so stages can differ.
  it('a recipe stage overrides the default model and agent for that stage only', async () => {
    const { resolveStageRouting } = await import('../server/kernel/pipeline.js');
    const snapshot = {
      stages: [
        { stage: 'compose', model: 'claude', agent: 'cli:claude' },
        { stage: 'verify', model: 'gemini' },
      ],
    };
    const compose = resolveStageRouting('compose', snapshot);
    expect(compose.model).toBe('claude');
    expect(compose.agent).toBe('cli:claude');
    expect(compose.routing_source).toBe('recipe');

    const verify = resolveStageRouting('verify', snapshot);
    expect(verify.model, 'a stage may name a different brain than its neighbour').toBe('gemini');

    const build = resolveStageRouting('build', snapshot);
    expect(build.model, 'a stage absent from the recipe keeps the default').toBe('none');
    expect(build.routing_source).toBe('default');
  });

  it('falls back to the default routing when no recipe is resolved', async () => {
    const { resolveStageRouting, MODEL_ROUTING } = await import('../server/kernel/pipeline.js');
    for (const stage of Object.keys(MODEL_ROUTING)) {
      const r = resolveStageRouting(stage, null);
      expect(r.model).toBe(MODEL_ROUTING[stage].model);
      expect(r.routing_source).toBe('default');
    }
  });

  it('records where each stage routing came from, so a DNA record can be audited', async () => {
    const { resolveStageRouting } = await import('../server/kernel/pipeline.js');
    expect(resolveStageRouting('compose', { stages: [{ stage: 'compose', model: 'claude' }] }).routing_source).toBe('recipe');
    expect(resolveStageRouting('compose', { stages: [] }).routing_source).toBe('default');
  });
});

// A subscription-backed CLI cannot report tokens or dollars. Recording zero
// would claim the run was free; recording null would be rejected as missing by
// assertManifestComplete. Both are wrong, so it records an explicit
// did-not-report and the run still succeeds.
describe('usage and cost for a CLI-managed stage are honestly unknown, never zero', () => {
  it('records provider_did_not_report for research rather than a fabricated zero', async () => {
    const { pipeline, dna } = makeKernels();
    const result = await pipeline.run({ site_id: 'usage-honesty', brief: honestBrief() });
    expect(result.outcome).toBe('success');

    const record = dna.read(result.run_id);
    const research = record.stages.find((s) => s.stage === 'research');
    expect(research.usage.status).toBe('provider_did_not_report');
    expect(research.usage.input_tokens).toBeNull();
    expect(research.cost_estimate.status).toBe('provider_did_not_report_currency_cost');
    expect(research.cost_estimate.amount_usd).toBeNull();
    // Never a zero that would read as "this was free".
    expect(research.cost_estimate.amount_usd).not.toBe(0);

    // Stages with genuinely no provider keep the explicit, checkable zero.
    const build = record.stages.find((s) => s.stage === 'build');
    expect(build.usage.input_tokens).toBe(0);
    expect(build.cost_estimate.amount_usd).toBe(0);

    // REGRESSION: routing provenance must survive into DNA. The pipeline always
    // computed routing_source; recordStage dropped it on the floor, which made
    // the field unanswerable from the record it exists to annotate.
    for (const attempt of record.stages) {
      expect(attempt.routing_source).toBeTruthy();
    }
  });
});
