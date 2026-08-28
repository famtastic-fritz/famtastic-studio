import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const outDir = '/Users/famtastic-fritz/.gemini/antigravity-ide/brain/daaa58f1-a00d-49ca-baa2-872ddfe550d3';
const PORT = '34056';

const server = spawn('node', ['server/index.js'], {
  cwd: '/Users/famtastic-fritz/Development/FAMtastic/site-studio-next',
  env: { ...process.env, PORT },
  stdio: 'inherit',
});

await new Promise((r) => setTimeout(r, 1200));

try {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto(`http://localhost:${PORT}/builds`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'cms-recipes-builder-dark.png'), fullPage: true });

  await browser.close();
  console.log('Successfully captured CMS recipes screenshot!');
} finally {
  server.kill();
}
