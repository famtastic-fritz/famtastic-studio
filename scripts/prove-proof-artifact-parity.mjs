#!/usr/bin/env node
/**
 * Same-artifact parity proof.
 *
 * Reads one real FAMtastic proof directory, sends its complete bytes through
 * the selected-build packet and the real Next pipeline, then proves:
 *   1. every source file has the same SHA-256 after the local build;
 *   2. the built proof passes Chromium verification; and
 *   3. source and built renders have identical screenshots at 390/768/1280.
 *
 * This is deliberately an offline fixture run. It does not contact FAMtastic,
 * Stripe, GitHub, DNS, email, Site Studio legacy, or production.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { stubResearchOptions } from '../tests/research-stub.mjs';
import { makeCopyStub } from '../tests/copy-stub.mjs';
import { createPaths } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline } from '../server/kernel/pipeline.js';
import { createDeploy } from '../server/kernel/deploy.js';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { packetToBuildBrief, prepareSelectedBuildPacket } from '../server/kernel/selected-build-adapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = process.env.FAMTASTIC_PROOF_DIR
  ? path.resolve(process.env.FAMTASTIC_PROOF_DIR)
  : '/Users/famtastic-fritz/Development/FAMtastic/sites/site-famtastic-designs/backend/web/proofs/pc-autonomous-journey-1786410155-21-3cec1c3cc2450f31/a';
const outDir = path.join(os.tmpdir(), `famtastic-artifact-parity-${Date.now()}`);
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-artifact-parity-'));

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(abs, base);
    return [{ path: path.relative(base, abs).split(path.sep).join('/'), abs }];
  });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function screenshot(browser, dir, name, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(dir, 'index.html')}`, { waitUntil: 'load' });
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  return { name, width, digest: digest(image), bytes: image.length };
}

async function main() {
  assert(fs.existsSync(path.join(sourceDir, 'index.html')), `proof directory has no index.html: ${sourceDir}`);
  const sourceFiles = walk(sourceDir);
  const bundle = createArtifactBundle(sourceFiles.map(({ path: rel, abs }) => ({ path: rel, bytes: fs.readFileSync(abs) })));
  const packet = prepareSelectedBuildPacket({
    source: {
      website_request_public_id: 'req_parity_fixture', proof_campaign_id: 'pc_parity_fixture',
      campaign_id: 'campaign_parity_fixture', customer_id: 'cust_parity_fixture',
      current_proof_hash: 'parity-proof-hash', source_commit: 'offline-fixture',
    },
    customer: { id: 'cust_parity_fixture', name: 'Parity Fixture', email: 'fixture@example.invalid' },
    selection: {
      approved: true, direction_id: 'direction-a', direction_name: 'Approved proof artifact',
      proof_variant_id: 'variant-a', proof_version: 'proof-v1', proof_hash: 'parity-proof-hash',
      approval_id: 'approval_parity_fixture', approval_direction_id: 'direction-a', approved_at: new Date().toISOString(),
    },
    payment: {
      order_id: 'order_parity_fixture', payment_status: 'paid', payment_event_id: 'evt_parity_fixture',
      package_sku: 'web-basics-199', terms_version: 'terms-2026-09', terms_acceptance_hash: 'terms-parity',
    },
    spec: {
      business: { name: 'Parity Fixture', description: 'An offline proof parity fixture.' },
      site_needs: { pages: ['home'] },
    },
    brand: {
      palette: ['#0c0f0a', '#b8f135'],
      design_contract: {
        schema_version: 1,
        tokens: { bg: '#0c0f0a', fg: '#f4f7ee', accent: '#b8f135', muted: '#8f998b' },
        typography: { body: 'Inter, sans-serif', headings: 'Inter, sans-serif' },
        component_recipe: ['proof-shell', 'hero', 'cta'],
        layout: { max_width: '72rem', gutter: 'clamp(1rem, 4vw, 4rem)', grid: '12-column' },
        responsive: { mobile: 'stack', tablet: 'two-column', desktop: 'max-width' },
        asset_policy: { preserve: true, rights_safe_only: true },
        evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
      },
    },
    artifact_bundle: bundle,
    research_packet_ref: { packet_id: 'rp_parity_fixture', brief_hash: 'brief-parity', source_adapter: 'offline-fixture' },
    origin: 'test', boundary: { external_mutation_allowed: false, deploy_authorized: false },
  }).packet;

  const previousRoot = process.env.STUDIO_DATA_ROOT;
  process.env.STUDIO_DATA_ROOT = dataRoot;
  try {
    const paths = createPaths();
    const journal = createJournal({ paths });
    const events = createEvents({ paths });
    const dna = createDna({ paths });
    const mutation = createMutation({ paths, journal, events });
    const spec = createSpec({ paths, mutation });
    const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation, researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });
    const result = await pipeline.run({ site_id: 'parity-fixture', brief: packetToBuildBrief(packet), adapter: 'shay-native', initiator: 'artifact-parity', composer: 'artifact' });
    assert(result.outcome === 'success', `pipeline failed: ${JSON.stringify(result.error || result)}`);
    const builtDir = paths.within('sites', 'parity-fixture');
    // spec.json is Site Studio's operational record and is intentionally
    // excluded by deploy-helpers.isPublishable; it must not contaminate the
    // customer artifact parity check.
    const builtFiles = walk(builtDir).filter(({ path: rel }) => rel !== 'spec.json' && !rel.startsWith('.'));
    const expected = new Map(sourceFiles.map(({ path: rel, abs }) => [rel, digest(fs.readFileSync(abs))]));
    const actual = new Map(builtFiles.map(({ path: rel, abs }) => [rel, digest(fs.readFileSync(abs))]));
    const mismatches = [];
    for (const [rel, hash] of expected) if (actual.get(rel) !== hash) mismatches.push({ path: rel, expected: hash, actual: actual.get(rel) || null });
    for (const rel of actual.keys()) if (!expected.has(rel)) mismatches.push({ path: rel, reason: 'unexpected_file' });
    assert(mismatches.length === 0, `byte parity failed: ${JSON.stringify(mismatches)}`);
    const deployPlan = createDeploy({ paths, journal, events }).plan({ site_id: 'parity-fixture' });
    assert(deployPlan.file_count === expected.size, `publishable manifest count differs: ${deployPlan.file_count} vs ${expected.size}`);
    for (const item of deployPlan.files) assert(expected.get(item.path) === item.sha256, `publishable manifest digest differs for ${item.path}`);

    fs.mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const screenshots = [];
    for (const width of [390, 768, 1280]) {
      const sourceShot = await screenshot(browser, sourceDir, 'source', width);
      const builtShot = await screenshot(browser, builtDir, 'built', width);
      screenshots.push({ width, source: sourceShot, built: builtShot, identical: sourceShot.digest === builtShot.digest });
      assert(sourceShot.digest === builtShot.digest, `screenshot parity failed at ${width}px`);
    }
    await browser.close();
    const report = {
      status: 'passed', source_dir: sourceDir, built_dir: builtDir, file_count: expected.size,
      artifact_bundle_sha256: digest(Buffer.from(JSON.stringify(bundle))), screenshots,
      pipeline_run_id: result.run_id, verification: result.verify, deploy_plan: {
        file_count: deployPlan.file_count, manifest_hash: deployPlan.manifest_hash, dispatched: deployPlan.dispatched,
      },
    };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (previousRoot === undefined) delete process.env.STUDIO_DATA_ROOT;
    else process.env.STUDIO_DATA_ROOT = previousRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
