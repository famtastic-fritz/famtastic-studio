// Renders one site entry file to a card thumbnail. Viewport shot, not full
// page: a card shows the hero, the way console-v2's minis do.
import puppeteer from '/Users/famtastic-fritz/Development/FAMtastic/site-studio/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
const [,, url, out] = process.argv;
const b = await puppeteer.launch({ headless: 'new' });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400)); // fonts/lazy heroes
  await p.screenshot({ path: out });
  console.log('ok');
} finally { await b.close(); }
