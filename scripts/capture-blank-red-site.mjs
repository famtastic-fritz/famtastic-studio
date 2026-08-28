#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screensDir = path.join(root, 'docs', 'env', 'm0-screens');
const artifactsDir = '/Users/famtastic-fritz/.gemini/antigravity-ide/brain/daaa58f1-a00d-49ca-baa2-872ddfe550d3';
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
      if (Date.now() - start > timeoutMs) return finish(reject, new Error('timeout'));
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); finish(resolve); });
      socket.once('error', () => { socket.destroy(); setTimeout(tryConnect, 200); });
    };
    child.once('exit', (code) => finish(reject, new Error(`exit ${code}`)));
    tryConnect();
  });
}

async function main() {
  const port = await findFreePort();
  const server = spawn('node', ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), BIND_LAN: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForListening(server, port);
    console.log(`Server listening on port ${port}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const siteId = 'site-blank-red-site';

    // 1. Capture Editor in Visual Mode
    await page.goto(`http://127.0.0.1:${port}/site?site_id=${siteId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const visualPath = path.join(screensDir, 'red-site-visual.png');
    await page.screenshot({ path: visualPath, fullPage: false });
    fs.copyFileSync(visualPath, path.join(artifactsDir, 'red-site-visual.png'));
    console.log('Saved red-site-visual.png');

    // 2. Capture Editor in Code Mode with styles.css open
    const codeBtn = await page.$('#ide-mode-code');
    if (codeBtn) {
      await codeBtn.click();
      await page.waitForTimeout(500);
    }
    const stylesTab = await page.$('text=styles.css');
    if (stylesTab) {
      await stylesTab.click();
      await page.waitForTimeout(500);
    }
    const codePath = path.join(screensDir, 'red-site-code.png');
    await page.screenshot({ path: codePath, fullPage: false });
    fs.copyFileSync(codePath, path.join(artifactsDir, 'red-site-code.png'));
    console.log('Saved red-site-code.png');

    // 3. Capture Site Settings
    await page.goto(`http://127.0.0.1:${port}/settings?site_id=${siteId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const settingsPath = path.join(screensDir, 'red-site-settings.png');
    await page.screenshot({ path: settingsPath, fullPage: false });
    fs.copyFileSync(settingsPath, path.join(artifactsDir, 'red-site-settings.png'));
    console.log('Saved red-site-settings.png');

    // 4. Capture Storage Paths Tab (Editable Roots)
    const pathsTab = await page.$('text=Storage Paths');
    if (pathsTab) {
      await pathsTab.click();
      await page.waitForTimeout(600);
    }
    const pathsPath = path.join(screensDir, 'red-site-paths-editable.png');
    await page.screenshot({ path: pathsPath, fullPage: false });
    fs.copyFileSync(pathsPath, path.join(artifactsDir, 'red-site-paths-editable.png'));
    console.log('Saved red-site-paths-editable.png');

    // 5. Capture New Site Builder on /builds with Recipe Presets
    await page.goto(`http://127.0.0.1:${port}/builds`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const buildsPath = path.join(screensDir, 'new-site-builder-recipes.png');
    await page.screenshot({ path: buildsPath, fullPage: false });
    fs.copyFileSync(buildsPath, path.join(artifactsDir, 'new-site-builder-recipes.png'));
    console.log('Saved new-site-builder-recipes.png');

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
