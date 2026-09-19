import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { transform } from 'esbuild';
import { composeSite } from '../server/kernel/compose.js';
import { CREATOR_LOGO_PATH, CREATOR_LOGO_SHA256 } from '../vendor/site-foundation/index.js';

const spec = { brand: { name: 'Creator credit fixture' }, pages: [{ id: 'home', path: 'index.html', title: 'Creator credit fixture', sections: [] }] };
const composed = composeSite({ spec });
const files = new Map([...composed.pages.map(p => [p.path, p.html]), ...composed.assets.map(a => [a.path, a.contents])]);
const server = http.createServer((req, res) => {
  const key = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.has(key)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : key.endsWith('.css') ? 'text/css' : key.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(files.get(key));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const receipt = [];
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    const result = await page.locator('[data-famtastic-creator-credit]').evaluate(row => {
      const link = row.querySelector('a'), img = row.querySelector('img');
      const rect = img.getBoundingClientRect(), target = link.getBoundingClientRect();
      return { rows: document.querySelectorAll('[data-famtastic-creator-credit]').length, href: link.href,
        name: link.getAttribute('aria-label'), naturalWidth: img.naturalWidth, width: rect.width,
        targetHeight: target.height, targetWidth: target.width,
        centered: Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2) < 1,
        final: row === document.body.lastElementChild, footerPreserved: document.querySelector('footer').textContent.includes('Creator credit fixture'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    assert.equal(result.rows, 1); assert.equal(result.href, 'https://famtasticdesigns.com/');
    assert.equal(result.naturalWidth, 2172); assert.ok(result.name);
    assert.ok(result.width >= 160 && result.width <= 220);
    assert.ok(result.targetHeight >= 44 && result.targetWidth >= 44);
    assert.ok(result.centered && result.final && result.footerPreserved && !result.overflow);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-famtastic-creator-credit] a').evaluate(link => link === document.activeElement), true);
    receipt.push({ viewport: width, ...result });
  }
  const bytes = Buffer.from(await (await fetch(`${origin}/${CREATOR_LOGO_PATH}`)).arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), CREATOR_LOGO_SHA256);
  for (const recipe of ['drupal-decoupled-tri-tier-v1', 'wordpress-decoupled-tri-tier-v1']) {
    for (const asset of composeSite({ spec: { ...spec, recipe } }).assets.filter(a => a.path.endsWith('.jsx'))) {
      await transform(asset.contents, { loader: 'jsx' });
    }
  }
  console.log(JSON.stringify({ passed: true, sha256: CREATOR_LOGO_SHA256, browser: receipt, jsx_syntax: 'passed', production: false }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
