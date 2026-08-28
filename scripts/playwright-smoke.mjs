#!/usr/bin/env node
// Boots the real server on a free port against a temp STUDIO_DATA_ROOT, then walks the
// console through real user navigation with a Chromium tab. Certifies console function,
// not just shell presence: config/pages.json matches the expected 12 pages as full
// tuples (id, title, path, rail, endpoint); every page after Work is reached by
// CLICKING its nav link with URL + h1 asserted after; no same-origin request fails
// (status >= 400 or a response-less 'requestfailed') and no console error fires;
// /app.css and every /kit/*.js return 200; each page has >= 1 region backed by its
// own config/pages.json endpoint unless named in REGION_EXEMPT_PAGE_REASONS; each
// region reaches a truthful terminal state, never stuck "loading"; every
// endpoint-backed region is individually cross-checked against a direct re-fetch of
// its own endpoint (see deriveExpectedRegionState / public/kit/region.js) so a
// dishonest region is never masked by a correct sibling on the same endpoint; the
// Shay rail is present on exactly the four rail pages. Also gates amendment A10: the
// resolved playwright package must live inside this repo, match package.json's pin,
// and its chromium executable must exist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'pages.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const screensDir = path.join(root, 'docs', 'env', 'm0-screens');
const reportFile = path.join(root, 'docs', 'env', 'm0-smoke-report.json');

fs.mkdirSync(screensDir, { recursive: true });

// Full expected tuple per page (not just the id) -- an id-only comparison misses a
// page whose title/path/rail/endpoint silently drifts.
const EXPECTED_PAGES = [
  { id: 'work', title: 'Ingestion Hub', path: '/', rail: true, endpoint: '/api/work/items' },
  { id: 'sites', title: 'Sites', path: '/sites', rail: false, endpoint: '/api/portfolio' },
  { id: 'site-view', title: 'Editor', path: '/site', rail: true, endpoint: '/api/sites/current' },
  { id: 'proofs', title: 'Proofs', path: '/proofs', rail: false, endpoint: '/api/proofs' },
  { id: 'applications', title: 'Applications', path: '/applications', rail: false, endpoint: '/api/applications' },
  { id: 'deployments', title: 'Deployments', path: '/deployments', rail: true, endpoint: '/api/deployments' },
  { id: 'media', title: 'Media', path: '/media', rail: false, endpoint: '/api/media' },
  { id: 'components', title: 'Components', path: '/components', rail: false, endpoint: '/api/components' },
  { id: 'seo', title: 'SEO', path: '/seo', rail: false, endpoint: '/api/seo' },
  { id: 'gate', title: 'Quality Gate', path: '/gate', rail: false, endpoint: '/api/gate' },
  { id: 'builds', title: 'Build run', path: '/builds', rail: true, endpoint: '/api/builds' },
  { id: 'automations', title: "Shay's Skills Leash", path: '/automations', rail: false, endpoint: '/api/automations' },
  { id: 'shadow', title: 'Shadow Runs', path: '/shadow', rail: false, endpoint: '/api/shadow/runs' },
  { id: 'settings', title: 'Settings / Admin', path: '/settings', rail: false, endpoint: '/api/admin/paths' },
];
const EXPECTED_PAGE_IDS = EXPECTED_PAGES.map((p) => p.id);
const RAIL_PAGE_IDS = new Set(['work', 'site-view', 'deployments', 'builds']);
const REGION_WAIT_TIMEOUT_MS = 8000;

// Pages with zero endpoint-backed .region elements when reached by this walk's plain
// nav-link click. Not a bypass list -- a documented, reviewable exception (Finding
// B.2) to "every page proves its config/pages.json endpoint reached a terminal state".
const REGION_EXEMPT_PAGE_REASONS = {
  'site-view': 'Reached via the "Editor" nav link with no ?site_id= in the URL. public/pages/site-view.js honestly renders "no site selected" (a link to /sites) in that case, never a fabricated site. The region-backed tab panels (public/pages/site-view/*.js) only mount with a site_id query param, which this nav-link-click walk does not construct. Re-walking with ?site_id=<id> is a separate, deeper check this script does not perform.',
  'seo': 'Reached via the "SEO" nav link with no ?site_id= in the URL. public/pages/seo.js honestly renders "no site selected" (a link to /sites) in that case, never a fabricated site.',
  'gate': 'Reached via the "Quality Gate" nav link with no ?site_id= in the URL. public/pages/gate.js honestly renders "no site selected" (a link to /sites) in that case, never a fabricated site.',
};

const INVENTORY_FIELDS = ['id', 'title', 'path', 'rail', 'endpoint'];

function comparePageInventory(actualPages) {
  const mismatches = [];
  const maxLen = Math.max(EXPECTED_PAGES.length, actualPages.length);
  for (let i = 0; i < maxLen; i += 1) {
    const expected = EXPECTED_PAGES[i];
    const actual = actualPages[i];
    if (!expected || !actual) {
      mismatches.push({ index: i, expected: expected || null, actual: actual || null, reason: 'entry missing on one side' });
      continue;
    }
    for (const field of INVENTORY_FIELDS) {
      if (expected[field] !== actual[field]) mismatches.push({ index: i, id: expected.id, field, expected: expected[field], actual: actual[field] });
    }
  }
  return mismatches;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForListening(child, port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    const tryConnect = () => {
      if (settled) return;
      if (Date.now() - start > timeoutMs) {
        return finish(reject, new Error(`server did not start listening on port ${port} within ${timeoutMs}ms`));
      }
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); finish(resolve); });
      socket.once('error', () => { socket.destroy(); setTimeout(tryConnect, 200); });
    };
    child.once('exit', (code) => finish(reject, new Error(`server process exited early with code ${code}`)));
    tryConnect();
  });
}

// --- amendment A10 evidence + gate -----------------------------------------------

async function getPlaywrightEvidence() {
  const resolvedUrl = await import.meta.resolve('playwright');
  const resolvedPath = fileURLToPath(resolvedUrl);
  let dir = path.dirname(resolvedPath);
  let pkgPath = null;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, 'utf8')).name === 'playwright') { pkgPath = candidate; break; }
    dir = path.dirname(dir);
  }
  const version = pkgPath ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version : null;
  return { resolved_entry_point: resolvedPath, package_json: pkgPath, version };
}

function gatePlaywrightEvidence(evidence) {
  const pin = rootPkg.devDependencies && rootPkg.devDependencies.playwright;
  const failures = [];
  if (!evidence.package_json) failures.push('could not locate a playwright package.json by walking up from the resolved entry point');
  else if (!fs.realpathSync(evidence.package_json).startsWith(fs.realpathSync(root) + path.sep)) failures.push(`resolved playwright package.json (${evidence.package_json}) is outside ROOT (${root}) -- looks like a parent repo's install`);
  if (!pin) failures.push('package.json has no devDependencies.playwright pin to check against');
  else if (evidence.version !== pin) failures.push(`resolved playwright version ${evidence.version} does not match the pin ${pin} in package.json`);
  if (!evidence.chromium_executable_path || !fs.existsSync(evidence.chromium_executable_path)) failures.push(`chromium executable does not exist on disk: ${evidence.chromium_executable_path}`);
  return failures;
}

// --- region terminal-state detection ----------------------------------------------

const REGION_STATE_SCRIPT = () => {
  function classify(regionEl) {
    const statusEl = regionEl.querySelector('.region__status');
    if (statusEl) {
      if (statusEl.classList.contains('region__status--loading')) return 'loading';
      // Checked before plain empty: region.js applies both --empty and --not-found
      // to a NOT_FOUND render, so empty-first would hide every NOT_FOUND as empty.
      if (statusEl.classList.contains('region__status--not-found')) return 'not_found';
      if (statusEl.classList.contains('region__status--not-implemented')) return 'not_implemented';
      if (statusEl.classList.contains('region__status--empty')) return 'empty';
      if (statusEl.classList.contains('region__status--error')) {
        return /^Stale:/.test(statusEl.textContent || '') ? 'stale' : 'error';
      }
      return 'unknown_status_modifier';
    }
    return regionEl.children.length > 0 ? 'available' : 'no_status_no_content';
  }
  return Array.from(document.querySelectorAll('.region')).map((el, index) => ({
    index,
    state: classify(el),
    endpoint: el.dataset.regionEndpoint || null,
    collectionKey: el.dataset.regionCollection || null,
  }));
};

// --- Finding A regression cross-check ----------------------------------------------
// Re-fetch every endpoint a region claims (dataset.regionEndpoint) and derive, from
// the real response, the ONE state region.js would honestly render -- checked per
// region, so a correct sibling never excuses a dishonest one.

import { deriveExpectedRegionState, regionStateSatisfies, crossCheckRegionHonesty } from './region-honesty.mjs';


async function waitForHonestRegionStates(page) {
  await page.waitForFunction(
    () => {
      const regions = Array.from(document.querySelectorAll('.region'));
      if (regions.length === 0) return true; // no region on this page; nothing to wait for
      return regions.every((el) => !el.querySelector('.region__status--loading'));
    },
    { timeout: REGION_WAIT_TIMEOUT_MS },
  ).catch(() => {
    // swallow: the state snapshot below will report the still-loading regions as failures
  });
  return page.evaluate(REGION_STATE_SCRIPT);
}

// --- per-page navigation + assertion -----------------------------------------------

async function assertPage({ page, pageDef, baseUrl, isFirst }) {
  const pageResult = {
    id: pageDef.id,
    path: pageDef.path,
    url: `${baseUrl}${pageDef.path}`,
    navigation: isFirst ? 'direct' : 'clicked_nav_link',
    http_status: null,
    h1_count: null,
    h1_text: null,
    page_errors: [],
    console_errors: [],
    failed_requests: [],
    undefined_or_nan_hits: [],
    asset_checks: { app_css: null, kit_js: [] },
    region_states: [],
    region_exemption_reason: REGION_EXEMPT_PAGE_REASONS[pageDef.id] || null,
    region_honesty_mismatches: [],
    rail: { expected: RAIL_PAGE_IDS.has(pageDef.id), present: null },
    screenshot: null,
    pass: false,
    reason: null,
  };

  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const sameOriginResponses = [];

  const onResponse = (response) => {
    const url = response.url();
    if (!url.startsWith(baseUrl)) return; // only same-origin requests are in scope
    sameOriginResponses.push({ url, status: response.status() });
    if (response.status() >= 400) failedRequests.push({ url, status: response.status() });
  };
  const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  const onPageError = (err) => pageErrors.push(String(err));
  // A request that never produces a response (aborted, refused, DNS failure) never
  // fires 'response', so the >= 400 check above can't see it; without this it passes
  // silently.
  const onRequestFailed = (request) => {
    const url = request.url();
    if (!url.startsWith(baseUrl)) return; // only same-origin requests are in scope
    const failure = request.failure();
    failedRequests.push({ url, status: null, failureText: failure ? failure.errorText : 'unknown requestfailed', kind: 'requestfailed' });
  };

  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);

  try {
    let response;
    if (isFirst) {
      response = await page.goto(pageResult.url, { waitUntil: 'networkidle', timeout: 15000 });
    } else {
      const link = page.locator(`a.shell__nav-link[href="${pageDef.path}"]`).first();
      await link.waitFor({ state: 'visible', timeout: 5000 });
      const [nav] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
        link.click(),
      ]);
      response = nav;
    }
    pageResult.http_status = response ? response.status() : null;

    const actualUrl = new URL(page.url());
    if (actualUrl.pathname !== pageDef.path) {
      throw new Error(`navigated to ${actualUrl.pathname}, expected ${pageDef.path}`);
    }

    const h1Count = await page.locator('h1').count();
    pageResult.h1_count = h1Count;
    pageResult.h1_text = h1Count > 0 ? (await page.locator('h1').first().textContent())?.trim() : null;

    const badTextHits = await page.evaluate(() => {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      // eslint-disable-next-line no-cond-assign
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        if (/\bundefined\b/.test(text) || /\bNaN\b/.test(text)) hits.push(text.trim().slice(0, 200));
      }
      return hits;
    });
    pageResult.undefined_or_nan_hits = badTextHits;

    pageResult.region_states = await waitForHonestRegionStates(page);
    const exemptionReason = pageResult.region_exemption_reason;
    pageResult.region_honesty_mismatches = await crossCheckRegionHonesty({ baseUrl, regionStates: pageResult.region_states, pageDef, exemptionReason });

    const railPresent = await page.evaluate(() => Boolean(document.querySelector('.shell__rail')));
    pageResult.rail.present = railPresent;

    const screenshotPath = path.join(screensDir, `${pageDef.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    pageResult.screenshot = path.relative(root, screenshotPath);

    const cssResponses = sameOriginResponses.filter((r) => r.url.endsWith('/app.css'));
    const kitJsResponses = sameOriginResponses.filter((r) => /\/kit\/.*\.js$/.test(r.url));
    pageResult.asset_checks.app_css = {
      requested: cssResponses.length > 0,
      all_200: cssResponses.length > 0 && cssResponses.every((r) => r.status === 200),
      responses: cssResponses,
    };
    pageResult.asset_checks.kit_js = kitJsResponses.map((r) => r.url);
    pageResult.asset_checks.kit_js_all_200 = kitJsResponses.length === 0 || kitJsResponses.every((r) => r.status === 200);
  } catch (error) {
    pageResult.reason = `navigation/assertion failed: ${error.message}`;
  } finally {
    page.off('response', onResponse);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
  }

  pageResult.page_errors = pageErrors.map(String);
  pageResult.console_errors = consoleErrors;
  pageResult.failed_requests = failedRequests;

  const reasons = [];
  if (pageResult.reason) reasons.push(pageResult.reason);
  if (pageResult.http_status !== 200) reasons.push(`http_status=${pageResult.http_status}`);
  if (pageResult.h1_count !== 1) reasons.push(`h1_count=${pageResult.h1_count}`);
  if (pageResult.h1_text && pageResult.h1_text !== pageDef.title) reasons.push(`h1_text="${pageResult.h1_text}" expected "${pageDef.title}"`);
  if (pageResult.page_errors.length) reasons.push(`page_errors=${pageResult.page_errors.length}`);
  if (pageResult.console_errors.length) reasons.push(`console_errors=${pageResult.console_errors.length}`);
  if (pageResult.failed_requests.length) reasons.push(`failed_requests=${pageResult.failed_requests.length}`);
  if (pageResult.undefined_or_nan_hits.length) reasons.push(`undefined_or_nan=${pageResult.undefined_or_nan_hits.length}`);
  if (pageResult.asset_checks.app_css && !pageResult.asset_checks.app_css.all_200) reasons.push(`app.css did not load 200: ${JSON.stringify(pageResult.asset_checks.app_css)}`);
  if (pageResult.asset_checks.kit_js_all_200 === false) reasons.push(`one or more /kit/*.js did not load 200: ${JSON.stringify(pageResult.asset_checks.kit_js)}`);

  const badRegions = pageResult.region_states.filter((r) => r.state === 'loading' || r.state === 'no_status_no_content' || r.state === 'unknown_status_modifier');
  if (badRegions.length) reasons.push(`dishonest_region_states=${JSON.stringify(badRegions)}`);

  const endpointBackedRegions = pageResult.region_states.filter((r) => r.endpoint);
  if (endpointBackedRegions.length === 0 && !pageResult.region_exemption_reason) reasons.push(`zero_endpoint_backed_regions and no exemption reason recorded in REGION_EXEMPT_PAGE_REASONS for page id="${pageDef.id}"`);
  if (pageResult.region_honesty_mismatches.length) reasons.push(`region_honesty_mismatches=${JSON.stringify(pageResult.region_honesty_mismatches)}`);
  if (pageResult.rail.present !== pageResult.rail.expected) reasons.push(`rail present=${pageResult.rail.present} expected=${pageResult.rail.expected}`);

  pageResult.pass = reasons.length === 0;
  pageResult.reason = reasons.length ? reasons.join(', ') : null;

  return pageResult;
}

// --- main ---------------------------------------------------------------------------

async function main() {
  const report = {
    started_at: new Date().toISOString(),
    page_inventory_check: null,
    playwright_evidence: null,
    playwright_gate_failures: [],
    pages: [],
    ok: false,
  };

  const inventoryMismatches = comparePageInventory(pagesConfig.pages);
  const inventoryOk = inventoryMismatches.length === 0;
  report.page_inventory_check = {
    expected: EXPECTED_PAGES,
    actual: pagesConfig.pages,
    mismatches: inventoryMismatches,
    ok: inventoryOk,
  };

  if (!inventoryOk) {
    console.error(`[smoke] FATAL: config/pages.json page inventory does not match the expected ${EXPECTED_PAGES.length} pages (full tuple: id, title, path, rail, endpoint).`);
    for (const m of inventoryMismatches) console.error(`  - ${JSON.stringify(m)}`);
    report.finished_at = new Date().toISOString();
    report.ok = false;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const port = await findFreePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-smoke-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[smoke] starting server on port ${port}, STUDIO_DATA_ROOT=${dataRoot}`);
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), STUDIO_DATA_ROOT: dataRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  child.stdout.on('data', (d) => { serverOutput += d.toString(); });
  child.stderr.on('data', (d) => { serverOutput += d.toString(); });

  let exitCode = 0;
  let browser = null;

  try {
    await waitForListening(child, port);
    console.log('[smoke] server is listening');

    report.playwright_evidence = await getPlaywrightEvidence();
    browser = await chromium.launch();
    report.playwright_evidence.chromium_executable_path = chromium.executablePath();
    console.log('[smoke] playwright evidence:', JSON.stringify(report.playwright_evidence, null, 2));

    report.playwright_gate_failures = gatePlaywrightEvidence(report.playwright_evidence);
    if (report.playwright_gate_failures.length) {
      console.error('[smoke] FATAL: amendment A10 gate failed:');
      for (const f of report.playwright_gate_failures) console.error(`  - ${f}`);
      throw new Error('amendment A10 playwright evidence gate failed');
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    for (let i = 0; i < pagesConfig.pages.length; i += 1) {
      const pageDef = pagesConfig.pages[i];
      const pageResult = await assertPage({ page, pageDef, baseUrl, isFirst: i === 0 });
      console.log(`[smoke] ${pageDef.id} (${pageDef.path}) -> ${pageResult.pass ? 'PASS' : 'FAIL'}${pageResult.reason ? ` (${pageResult.reason})` : ''}`);
      report.pages.push(pageResult);
    }

    await context.close();
    report.ok = report.pages.every((p) => p.pass);
  } catch (error) {
    report.error = error.message;
    report.ok = false;
    console.error('[smoke] fatal error:', error);
    console.error('[smoke] server output so far:\n', serverOutput);
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }

  report.finished_at = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`[smoke] report written to ${path.relative(root, reportFile)}`);

  if (!report.ok) exitCode = 1;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[smoke] unhandled error:', error);
  process.exit(1);
});
