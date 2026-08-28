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

    // 1. Capture Editor in Visual Mode
    await page.goto(`http://127.0.0.1:${port}/site?site_id=site-big-mikes-movers`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const editorScreen = path.join(screensDir, 'ide-editor-visual.png');
    await page.screenshot({ path: editorScreen });
    if (fs.existsSync(artifactsDir)) {
      fs.copyFileSync(editorScreen, path.join(artifactsDir, 'ide-editor-visual.png'));
    }
    console.log(`Captured ${editorScreen}`);

    // 2. Click Code Mode and capture Code Editor
    await page.click('#btn-mode-code');
    await page.waitForTimeout(600);
    const codeScreen = path.join(screensDir, 'ide-editor-code.png');
    await page.screenshot({ path: codeScreen });
    if (fs.existsSync(artifactsDir)) {
      fs.copyFileSync(codeScreen, path.join(artifactsDir, 'ide-editor-code.png'));
    }
    console.log(`Captured ${codeScreen}`);

    // 3. Switch to Tablet Viewport
    await page.click('#btn-mode-visual');
    await page.click('#btn-tablet');
    await page.waitForTimeout(600);
    const tabletScreen = path.join(screensDir, 'ide-editor-tablet.png');
    await page.screenshot({ path: tabletScreen });
    if (fs.existsSync(artifactsDir)) {
      fs.copyFileSync(tabletScreen, path.join(artifactsDir, 'ide-editor-tablet.png'));
    }
    console.log(`Captured ${tabletScreen}`);

    // 4. Capture Settings page with Site-Level configuration
    await page.goto(`http://127.0.0.1:${port}/settings?site_id=site-big-mikes-movers`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const settingsScreen = path.join(screensDir, 'ide-settings-site-level.png');
    await page.screenshot({ path: settingsScreen });
    if (fs.existsSync(artifactsDir)) {
      fs.copyFileSync(settingsScreen, path.join(artifactsDir, 'ide-settings-site-level.png'));
    }
    console.log(`Captured ${settingsScreen}`);

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
