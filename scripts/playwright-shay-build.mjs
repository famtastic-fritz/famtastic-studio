#!/usr/bin/env node
// Playwright End-to-End Verification of Shay Conversational Site Building & Studio Editor
// Proves that a site requested via natural conversation with Shay builds to disk,
// registers in the portfolio, and opens seamlessly in the 3-pane visual editor.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createShayRoutine } from '../server/kernel/shay-routine.js';
import { stubResearchOptions } from '../tests/research-stub.mjs';
import { makeCopyStub } from '../tests/copy-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screensDir = path.join(root, 'docs', 'env', 'm0-screens');
fs.mkdirSync(screensDir, { recursive: true });

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
      const sock = net.connect({ port, host: '127.0.0.1' }, () => {
        sock.destroy();
        finish(resolve, undefined);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          finish(reject, new Error(`Server did not listen on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
    };
    tryConnect();
    child.on('exit', (code, sig) => {
      finish(reject, new Error(`Server exited prematurely (code: ${code}, signal: ${sig})`));
    });
  });
}

async function main() {
  console.log('=== Shay Conversational Build & Studio Editor Verification ===\n');

  const config = loadPathsConfig();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shay-build-'));
  process.env[config.data_root_env] = tmpRoot;

  try {
    // 1. Run Shay Conversational Intake & Site Creation
    console.log('[1/4] Executing Shay conversational intake for "Big Mike\'s Movers"...');
    const paths = createPaths();
    const routine = createShayRoutine({
      paths,
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });

    const userPrompt = "shay build me a site for my home boy, trucking business... Big Mike's Movers in Port St. Lucie, colorful with a 50% discount coupon hook";
    const buildResult = await routine.executeIntakeAndBuild({
      prompt: userPrompt,
      conversationId: 'shay-e2e-session',
    });

    console.log(`      Site ID: ${buildResult.site_id}`);
    console.log(`      Outcome: ${buildResult.outcome}`);

    // 2. Verify Files on Disk
    console.log('[2/4] Verifying generated site filesystem structure...');
    const siteDir = paths.within('sites', buildResult.site_id);
    const expectedFiles = ['index.html', 'about.html', 'services.html', 'contact.html', 'spec.json', 'styles.css'];
    for (const f of expectedFiles) {
      const exists = fs.existsSync(path.join(siteDir, f));
      if (!exists) throw new Error(`Missing expected build file on disk: ${f}`);
      console.log(`      ✓ ${f} verified on disk`);
    }

    // 3. Boot Server on Free Port
    console.log('[3/4] Starting Site Studio Next server with generated site...');
    const port = await findFreePort();
    const serverProcess = spawn('node', ['server/index.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BIND_LAN: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stderr.on('data', (d) => process.stderr.write(d));
    serverProcess.stdout.on('data', (d) => process.stdout.write(d));

    try {
      await waitForListening(serverProcess, port);
      console.log(`      Server listening on http://127.0.0.1:${port}`);

      // 4. Drive Playwright Browser Verification
      console.log('[4/4] Launching Playwright browser to verify UI navigation & 3-pane editor...');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      // Navigate to /sites portfolio
      await page.goto(`http://127.0.0.1:${port}/sites`, { waitUntil: 'networkidle' });
      const siteCard = page.locator(`.pcard[href*="${buildResult.site_id}"]`);
      await siteCard.waitFor({ state: 'visible', timeout: 8000 });
      console.log('      ✓ Discovered site card in /sites portfolio grid');

      // Click site card to navigate to site editor
      await siteCard.click();
      await page.waitForURL(`**/site?site_id=${buildResult.site_id}**`, { timeout: 8000 });
      console.log('      ✓ Successfully navigated to /site editor view');

      // Click Canvas tab to open the 3-pane visual workstation
      const canvasTabBtn = page.locator('#tab-canvas');
      await canvasTabBtn.waitFor({ state: 'visible', timeout: 8000 });
      await canvasTabBtn.click();
      console.log('      ✓ Switched to Canvas tab');

      // Verify 3-Pane Workstation DOM elements
      await page.waitForSelector('.editor-workstation', { state: 'visible', timeout: 8000 });
      await page.waitForSelector('.editor-layers', { state: 'visible', timeout: 8000 });
      await page.waitForSelector('.editor-stage', { state: 'visible', timeout: 8000 });
      await page.waitForSelector('.editor-inspector', { state: 'visible', timeout: 8000 });

      // Verify 2nd side nav pages tree & sections
      await page.locator('.editor-layers .layers-item').first().waitFor({ state: 'visible', timeout: 8000 });
      const layersCount = await page.locator('.editor-layers .layers-item').count();
      console.log(`      ✓ 2nd Side Nav rendered ${layersCount} structural layer items`);

      // Verify center iframe
      const frameLocator = page.locator('iframe.canvas-tab__frame');
      await frameLocator.waitFor({ state: 'visible', timeout: 8000 });
      const iframeSrc = await frameLocator.getAttribute('src');
      console.log(`      ✓ Center stage frame rendering: ${iframeSrc || 'mounted'}`);

      // 5. Test Live Chat with Shay inside Site Studio GUI (Conversation Tab)
      console.log('[5/5] Testing interactive chat with Shay through the browser GUI...');
      const convoTabBtn = page.locator('#tab-conversation');
      await convoTabBtn.waitFor({ state: 'visible', timeout: 8000 });
      await convoTabBtn.click();
      console.log('      ✓ Switched to Conversation tab');

      const convoComposer = page.locator('.conversation-tab__composer textarea');
      await convoComposer.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForFunction(() => {
        const el = document.querySelector('.conversation-tab__composer textarea');
        return el && !el.disabled;
      }, { timeout: 8000 });

      await convoComposer.fill("Hey Shay, please tweak the hero headline for Big Mike's Movers");
      await page.locator('.conversation-tab__composer button[type="submit"]').click();
      console.log('      ✓ Submitted chat message to Shay via GUI composer');

      // Verify operator chat entry appears in conversation feed
      await page.locator('.conversation-log__entry--operator').last().waitFor({ state: 'visible', timeout: 8000 });
      const lastMessageText = await page.locator('.conversation-log__entry--operator .conversation-log__text').last().textContent();
      console.log(`      ✓ Live conversation feed rendered message: "${lastMessageText}"`);

      // 6. Test Shay Rail Live Chat (Side Panel)
      console.log('      Testing Shay Rail live workspace & chat panel...');
      const railNotesTab = page.locator('.shell__rail .tabs__btn:has-text("Notes")');
      await railNotesTab.waitFor({ state: 'visible', timeout: 8000 });
      await railNotesTab.click();

      const railTextarea = page.locator('.shell__rail-composer textarea');
      await page.waitForFunction(() => {
        const el = document.querySelector('.shell__rail-composer textarea');
        return el && !el.disabled;
      }, { timeout: 8000 });

      await railTextarea.fill("Approved for stage 2 polish, let's ship!");
      await page.locator('.shell__rail-composer button[type="submit"]').click();
      console.log('      ✓ Submitted note via Shay Rail GUI composer');

      // Capture visual verification screenshot
      const screenPath = path.join(screensDir, 'shay-built-big-mikes-movers.png');
      await page.screenshot({ path: screenPath });
      console.log(`      ✓ Screenshot captured: docs/env/m0-screens/shay-built-big-mikes-movers.png`);

      await browser.close();
      console.log('\nVERDICT: PASS');
    } finally {
      serverProcess.kill('SIGTERM');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env[config.data_root_env];
  }
}

main().catch((err) => {
  console.error('\nFAIL:', err);
  process.exit(1);
});
