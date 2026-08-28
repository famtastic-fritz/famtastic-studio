import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const screensDir = path.join(repoRoot, 'docs', 'env', 'm0-screens');

fs.mkdirSync(screensDir, { recursive: true });

async function main() {
  const tmpRoot = path.join('/tmp', `studio-chat-screens-${Date.now()}`);
  fs.mkdirSync(path.join(tmpRoot, 'sites'), { recursive: true });

  const env = {
    ...process.env,
    STUDIO_DATA_ROOT: tmpRoot,
    PORT: '58890',
  };

  const serverProcess = spawn('node', ['server/index.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(d.toString()));
  serverProcess.stderr.on('data', (d) => process.stderr.write(d.toString()));

  // Wait for boot
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // 1. Home / Ingestion Hub: Capture visible bottom .cmdbar and right-side Shay rail input
    console.log('[1/3] Loading Ingestion Hub (/). Capturing bottom cmdbar and Shay rail composer...');
    await page.goto('http://127.0.0.1:58890/', { waitUntil: 'networkidle' });

    await page.waitForSelector('.cmdbar #cmdinput', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#rail-global-prompt', { state: 'visible', timeout: 5000 });

    // Type a demo prompt into the bottom command bar
    await page.fill('#cmdinput', "shay build me a site for Big Mike's Movers in Port St. Lucie, colorful with 50% discount coupon");
    await page.screenshot({ path: path.join(screensDir, 'shay-console-chat-inputs.png') });
    console.log('✓ Captured: docs/env/m0-screens/shay-console-chat-inputs.png');

    // 2. Open ⌘K Palette Modal: Capture modal input & plan preview
    console.log('[2/3] Triggering ⌘K Command Palette modal...');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.overlay.open .palette #palinput', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('.planprev', { state: 'visible', timeout: 5000 });

    await page.screenshot({ path: path.join(screensDir, 'shay-palette-modal.png') });
    console.log('✓ Captured: docs/env/m0-screens/shay-palette-modal.png');

    await browser.close();
    console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY');
  } finally {
    serverProcess.kill('SIGTERM');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
