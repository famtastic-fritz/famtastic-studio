import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-library-proof-'));
const outputRoot = process.env.STUDIO_LIBRARY_PROOF_OUTPUT || base;
fs.mkdirSync(outputRoot, { recursive: true });
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', STUDIO_DATA_ROOT: path.join(base, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
  server.stdout.on('data', data => { output += data; const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output); if (match && match[1] !== '0') { clearTimeout(timer); resolve(match[0]); } });
  server.stderr.on('data', data => { output += data; });
  server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${output}`)); });
}).catch(error => { server.kill('SIGTERM'); throw error; });
const browser = await chromium.launch({ headless: true });
try {
  const evidence = [];
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const [route, title] of [['components', 'Component Studio library'], ['media', 'Media Studio library']]) {
      await page.goto(`${url}/${route}`);
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await panel.getByRole('link', { name: 'Open private library repository' }).waitFor();
      const copy = await panel.innerText();
      if (!copy.includes('full studio platform remains planned')) throw new Error('Missing readiness distinction');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await panel.scrollIntoViewIfNeeded();
      const mainBounds = await page.locator('main').boundingBox();
      if (!mainBounds || mainBounds.height < 300) throw new Error(`Main content is clipped at ${width}px`);
      const panelBounds = await panel.boundingBox();
      if (overflow || panelBounds.x < 0 || panelBounds.x + panelBounds.width > width + 1 || panelBounds.width < Math.min(300, width - 32)) throw new Error(`Library is clipped at ${width}px`);
      const screenshot = path.join(outputRoot, `${route}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      evidence.push({ route, width, library_visible: true, overflow, errors: [...errors], screenshot });
    }
    await page.close();
  }
  if (evidence.some(item => item.errors.length)) throw new Error('Browser exception recorded');
  const proof = { status: 'passed', node: process.version, evidence };
  fs.writeFileSync(path.join(outputRoot, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
} finally { await browser.close(); server.kill('SIGTERM'); }
