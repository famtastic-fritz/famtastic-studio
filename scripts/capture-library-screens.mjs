import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const outDir = '/Users/famtastic-fritz/.gemini/antigravity-ide/brain/daaa58f1-a00d-49ca-baa2-872ddfe550d3';
const PORT = '34055';

const server = spawn('node', ['server/index.js'], {
  cwd: '/Users/famtastic-fritz/Development/FAMtastic/site-studio-next',
  env: { ...process.env, PORT },
  stdio: 'inherit',
});

await new Promise((r) => setTimeout(r, 1200));

try {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Components page with Component Studio Archetype Library
  await page.goto(`http://localhost:${PORT}/components`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'components-studio-library.png'), fullPage: true });

  // 2. Media page with Media Studio Presets
  await page.goto(`http://localhost:${PORT}/media`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'media-studio-library.png'), fullPage: true });

  await browser.close();
  console.log('Successfully captured library screenshots!');
} finally {
  server.kill();
}
