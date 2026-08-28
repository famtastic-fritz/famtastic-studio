// End-to-end Playwright test for Shay Multi-Turn Conversational Dialogue in Site Studio
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = 4125;
const SCREENSHOT_DIR = path.resolve('docs/env/m0-screens');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function run() {
  console.log('1. Starting test server on port', PORT);
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStarted = false;
  server.stdout.on('data', (d) => {
    if (d.toString().includes('listening on')) serverStarted = true;
  });

  for (let i = 0; i < 30; i++) {
    if (serverStarted) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('2. Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('3. Navigating to / (Ingestion Hub)...');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

    // Verify initial Shay rail welcome
    await page.waitForSelector('#rail-global-prompt');
    console.log('4. Entering Turn 1 (Vague idea)...');
    await page.fill('#rail-global-prompt', 'shay build me a site for my home boy, trucking business');
    await page.click('#rail-global-submit');

    // Wait for Shay's clarifying response
    await page.waitForSelector('.rail-msg--system:has-text("What\'s the name")');
    console.log('✓ Shay asked clarifying questions.');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shay-turn-1-clarify.png'), fullPage: true });

    // Turn 2: Provide details
    console.log('5. Entering Turn 2 (Details supplied)...');
    await page.fill('#rail-global-prompt', "Big Mike's Movers in Port St. Lucie, colorful with 50% discount coupon");
    await page.click('#rail-global-submit');

    // Wait for Proposal Card
    await page.waitForSelector('.btn-card-act');
    console.log('✓ Shay proposed build card with [⚡ Build Site Now] button.');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shay-turn-2-proposal.png'), fullPage: true });

    // Turn 3: Click Build Site Now
    console.log('6. Clicking [⚡ Build Site Now]...');
    await page.click('.btn-card-act');

    // Wait for redirection to Canvas editor
    await page.waitForURL(/site\?site_id=site-big-mikes-movers/, { timeout: 15000 });
    console.log('✓ Site built and redirected to Canvas editor!');

    // Wait for 3-pane canvas elements
    await page.waitForSelector('.tab--active');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shay-turn-3-built-canvas.png'), fullPage: true });
    console.log('✓ Captured final built canvas screenshot!');

  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('Playwright test failed:', err);
  process.exit(1);
});
