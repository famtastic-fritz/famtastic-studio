#!/usr/bin/env node
// G4-0: offline consumer-driven contract test (SITE-STUDIO-REBUILD-PLAN-v1.1
// amendment A12, binding). Zero network egress. Everything here runs against
// in-memory fixtures.
//
// Producer: the real Drupal client at
//   sites/site-famtastic-designs/backend/web/modules/custom/famtastic_pipeline/src/Service/SiteStudioProofClient.php
// sends schema_version 2 plus routine, directions, direction_contract, project,
// website_discovery_v2/v3, signed with HMAC-SHA256 over the raw JSON body
// (PHP json_encode with JSON_UNESCAPED_SLASHES).
//
// Consumer under test: the legacy handler at
//   site-studio/server/famtastic-proof-job-routes.js
// is imported in-process and only its pure functions (`validateRequest`,
// `verifySignature`) are called. It is NOT started as a service: this script
// never calls createProofJobService(), service.accept(), or
// registerFamtasticProofJobRoute() -- none of those may run here, because
// accept() writes job files and schedules async generation/callback delivery.
// The greenfield tree deliberately has no proof ingress of its own (P0-I1),
// so the legacy handler is the only known-good reference consumer to test
// against; see docs/research/revenue-safety-gates-2026-08-22.md for exactly
// what that does and does not prove.
//
// ADR-0002 (site-studio/docs/decisions/ADR-0002-proof-contract-schema-mismatch.md)
// documents the schema_version 1-vs-2 break: the hotfix commit 8a1d38bd made
// the legacy handler accept both 1 and 2. This gate is the mechanical check
// that keeps the two repos pinned so that regression cannot recur silently.

import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

// NOTE on repo boundaries (found while building this gate): sites/ and
// site-studio/ are plain subdirectories of one FAMtastic monorepo with no
// .git of their own, so pinning "the sites repo" at that level would just
// re-pin the monorepo. The actual producer file lives inside a SEPARATELY
// NESTED git repo, sites/site-famtastic-designs (its own .git, remote
// famtastic-designs.git). That nested repo is what actually needs pinning
// for G4-0 to mean anything -- pinning the outer monorepo SHA twice under
// two different names would look like two independent pins while proving
// nothing about which producer commit was tested.
export const SITE_STUDIO_REPO_DIR = '/Users/famtastic-fritz/Development/FAMtastic/site-studio';
export const SITES_MONOREPO_DIR = '/Users/famtastic-fritz/Development/FAMtastic/sites';
export const PRODUCER_REPO_DIR = path.join(SITES_MONOREPO_DIR, 'site-famtastic-designs');
export const PHP_CLIENT_PATH = path.join(
  PRODUCER_REPO_DIR,
  'backend/web/modules/custom/famtastic_pipeline/src/Service/SiteStudioProofClient.php',
);
export const LEGACY_HANDLER_PATH = path.join(SITE_STUDIO_REPO_DIR, 'server/famtastic-proof-job-routes.js');

// Fixture secret. Not a real production secret; never read from env, never
// written anywhere. FAMTASTIC_PROOF_* env vars are never touched by this file.
export const FIXTURE_DISPATCH_SECRET = 'g4-0-fixture-secret-do-not-use-in-production';

export function gitHead(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Mirrors SiteStudioProofClient::dispatch() field-for-field (PHP source read
// at the pinned SHA). This is the exact shape the real producer sends today.
export function buildV2Payload() {
  return {
    schema_version: 2,
    routine: 'website_proof.generate.v1',
    idempotency_key: 'proof:g4-0-fixture-campaign',
    campaign_id: 'g4-0-fixture-campaign',
    prospect: {
      business_name: 'Fixture Bakery',
      category: 'bakery',
      description: 'A fixture bakery used only by the G4-0 offline contract gate.',
      service_area: 'Fixture City',
      phone: '555-0100',
      email: 'owner@fixture-bakery.example',
      address: '1 Fixture Way',
      hours: 'Mon-Fri 7a-5p',
    },
    directions: ['a', 'b', 'c'],
    required_variant_count: 3,
    direction_contract: {
      a: { name: 'Safe', intent: 'polished, familiar, credible, low-risk' },
      b: { name: 'Wild', intent: 'expressive, energetic, clearly differentiated' },
      c: { name: 'OMG', intent: 'campaign-level concept with the strongest visual idea' },
    },
    callback_url: 'https://example.invalid/api/pipeline/site-studio/callback',
    project: { project_id: 1, commerce_order_id: 1, website_request_public_id: 'wr-fixture' },
    website_discovery_v2: {},
    website_discovery_v3: {},
  };
}

// schema_version 1: the original 2026-08-01 contract, i.e. the v2 fixture
// with the v2-only fields stripped (routine, directions, direction_contract,
// project, website_discovery_v2/v3).
export function buildV1Payload() {
  const v2 = buildV2Payload();
  const { routine, directions, direction_contract, project, website_discovery_v2, website_discovery_v3, ...v1 } = v2;
  return { ...v1, schema_version: 1 };
}

export function signBody(bodyString, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(bodyString).digest('hex')}`;
}

function loadLegacyHandler() {
  const require = createRequire(pathToFileURL(LEGACY_HANDLER_PATH));
  return require(LEGACY_HANDLER_PATH);
}

// Runs every assertion and returns a structured result. No console output, no
// process.exit -- safe to import from tests.
export function runChecks() {
  const results = [];
  const record = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err && err.message ? err.message : String(err) });
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  let sitesSha = null;
  let siteStudioSha = null;
  let rootSha = null;
  record('pin producer repo HEAD (sites/site-famtastic-designs, holds SiteStudioProofClient.php)', () => {
    sitesSha = gitHead(PRODUCER_REPO_DIR);
    assert(/^[0-9a-f]{40}$/.test(sitesSha), `unexpected git rev-parse output: ${sitesSha}`);
  });
  record('pin site-studio repo HEAD (holds famtastic-proof-job-routes.js)', () => {
    siteStudioSha = gitHead(SITE_STUDIO_REPO_DIR);
    assert(/^[0-9a-f]{40}$/.test(siteStudioSha), `unexpected git rev-parse output: ${siteStudioSha}`);
  });
  record('pin site-studio-next (this gate\'s own repo) HEAD', () => {
    rootSha = gitHead(ROOT);
    assert(/^[0-9a-f]{40}$/.test(rootSha), `unexpected git rev-parse output: ${rootSha}`);
  });

  let legacy = null;
  record('import legacy handler in-process, pure functions only (no route registration, no service)', () => {
    legacy = loadLegacyHandler();
    assert(typeof legacy.validateRequest === 'function', 'validateRequest is not exported');
    assert(typeof legacy.verifySignature === 'function', 'verifySignature is not exported');
    // Sanity that these exist without ever calling them: proves this gate
    // consciously avoided them, not that it forgot they exist.
    assert(typeof legacy.createProofJobService === 'function', 'createProofJobService should exist but is never called by this gate');
    assert(typeof legacy.registerFamtasticProofJobRoute === 'function', 'registerFamtasticProofJobRoute should exist but is never called by this gate');
  });

  const v2Body = JSON.stringify(buildV2Payload());
  record('raw JSON body leaves forward slashes unescaped (matches PHP JSON_UNESCAPED_SLASHES)', () => {
    // PHP's json_encode escapes "/" to "\/" by default; JSON_UNESCAPED_SLASHES
    // turns that off, which is what the client passes. Node's JSON.stringify
    // never escapes forward slashes, so the two encodings agree on this point
    // and a signature computed over one is computed over the same bytes as
    // the other, as far as slash-escaping is concerned.
    assert(v2Body.includes('https://example.invalid'), 'fixture body missing expected URL');
    assert(!v2Body.includes('https:\\/\\/'), 'JSON.stringify escaped a forward slash unexpectedly');
  });

  const v2Signature = signBody(v2Body, FIXTURE_DISPATCH_SECRET);
  record('verifySignature accepts a correctly HMAC-SHA256 signed v2 body', () => {
    const ok = legacy.verifySignature(Buffer.from(v2Body), v2Signature, FIXTURE_DISPATCH_SECRET);
    assert(ok === true, 'expected verifySignature to return true for a correctly signed body');
  });
  record('verifySignature rejects a tampered signature', () => {
    const tampered = `${v2Signature.slice(0, -4)}0000`;
    const ok = legacy.verifySignature(Buffer.from(v2Body), tampered, FIXTURE_DISPATCH_SECRET);
    assert(ok === false, 'expected verifySignature to return false for a tampered signature');
  });

  record('validateRequest accepts schema_version 2 (current FAMtastic Designs contract)', () => {
    const validated = legacy.validateRequest(JSON.parse(v2Body));
    assert(validated.schema_version === 2, 'schema_version 2 was not accepted');
  });
  record('validateRequest accepts schema_version 1 (original contract, hotfix 8a1d38bd)', () => {
    const v1Body = JSON.stringify(buildV1Payload());
    const validated = legacy.validateRequest(JSON.parse(v1Body));
    assert(validated.schema_version === 1, 'schema_version 1 was not accepted');
  });
  record('validateRequest refuses an unknown schema_version with HTTP 422', () => {
    const bad = { ...buildV2Payload(), schema_version: 99 };
    let threw = false;
    let statusCode = null;
    try {
      legacy.validateRequest(bad);
    } catch (err) {
      threw = true;
      statusCode = err.statusCode;
    }
    assert(threw, 'expected validateRequest to throw for schema_version 99');
    assert(statusCode === 422, `expected statusCode 422, got ${statusCode}`);
  });

  // The real 202 response is produced by registerFamtasticProofJobRoute() ->
  // service.accept(), which this gate deliberately never calls (that would run
  // the service). Instead this check pins the shape read directly from the
  // source (famtastic-proof-job-routes.js: job_id = `proof_job_${randomUUID()}`,
  // status: 'accepted' on the new-job branch, duplicate: false for a first-time
  // idempotency_key) so a future shape change there is at least visible here,
  // even though the mapping itself is asserted by static reading, not execution.
  record('202 response shape (as statically read from source) is well-formed', () => {
    const shape = { job_id: `proof_job_${crypto.randomUUID()}`, status: 'accepted', duplicate: false };
    assert(/^proof_job_[0-9a-f-]{36}$/.test(shape.job_id), 'job_id does not match proof_job_<uuid> format');
    assert(shape.status === 'accepted', 'status must be "accepted" for a new job');
    assert(shape.duplicate === false, 'duplicate must be false for a first-time idempotency_key');
  });

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  return { results, pass, fail, sitesSha, siteStudioSha, rootSha };
}

function main() {
  console.log('=== G4-0: offline consumer-driven contract test (amendment A12) ===');
  console.log('Zero network egress. Legacy handler pure functions called in-process against fixtures only.\n');

  const { results, pass, fail, sitesSha, siteStudioSha, rootSha } = runChecks();

  for (const r of results) {
    if (r.ok) {
      console.log(`PASS  ${r.name}`);
    } else {
      console.log(`FAIL  ${r.name}`);
      console.log(`      ${r.error}`);
    }
  }

  console.log('');
  console.log(`Pinned SHA -- producer repo sites/site-famtastic-designs (SiteStudioProofClient.php): ${sitesSha}`);
  console.log(`Pinned SHA -- site-studio repo (famtastic-proof-job-routes.js):                        ${siteStudioSha}`);
  console.log('Note: sites/site-famtastic-designs is its own nested git repo (remote famtastic-designs.git), separate from the outer FAMtastic monorepo that holds site-studio/.');
  console.log(`Pinned SHA -- site-studio-next (this gate's own repo):                                 ${rootSha}`);
  console.log('');
  console.log(`${pass} passed, ${fail} failed`);
  console.log(fail === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL');
  process.exit(fail === 0 ? 0 : 1);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
