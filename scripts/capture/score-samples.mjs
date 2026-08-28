/**
 * Calibration scoring pass.
 *
 * For each built sample: capture through the settled harness at 1440 and 390,
 * run the blocking WebAIM Six, and emit the evidence each isolated dimension
 * judge needs. Judging happens per dimension, never one judge across all three
 * (Anthropic: grade each dimension with an isolated judge rather than using one
 * to grade all dimensions).
 *
 * This script does NOT assign the aesthetic scores. It produces the record a
 * judge scores against, plus the deterministic facts, so a score can always be
 * traced to the capture it was made from.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from '/Users/famtastic-fritz/Development/FAMtastic/site-studio/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { captureRender } from './render-capture.mjs';
import { runWebaimSix } from './webaim-six.mjs';

const RUNS = '/Users/famtastic-fritz/Development/FAMtastic/docs/research/calibration/runs/sites';
const OUT = '/Users/famtastic-fritz/Development/FAMtastic/docs/research/calibration/samples';

const sites = fs.existsSync(RUNS)
  ? fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'index.html')))
  : [];

if (!sites.length) { console.log('no built samples yet'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new' });
const record = [];

for (const site of sites) {
  const url = `file://${path.join(RUNS, site, 'index.html')}`;
  const entry = { site, url, captures: {}, webaim: null, structure: null };

  for (const [label, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
    const page = await browser.newPage();
    const cap = await captureRender(page, { url, outPath: path.join(OUT, `${site}-${label}.png`), width: w, height: h });
    entry.captures[label] = {
      settled: cap.settled, images: cap.images, broken: cap.broken,
      horizontalOverflow: cap.horizontalOverflow, scrollHeight: cap.scrollHeight,
      sha256: cap.sha256.slice(0, 16), file: `${site}-${label}.png`,
    };
    if (label === '1440') {
      entry.webaim = await runWebaimSix(page);
      // Facts an isolated judge needs, measured from the settled DOM.
      entry.structure = await page.evaluate(() => ({
        h1_count: document.querySelectorAll('h1').length,
        headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ': ' + (h.textContent || '').trim().slice(0, 48)).slice(0, 14),
        images_rendered: [...document.images].filter((i) => i.naturalWidth > 0).length,
        emoji_as_icon: (document.body.innerText.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length,
        distinct_bg_colors: new Set([...document.querySelectorAll('section,div,header,footer')].map((e) => getComputedStyle(e).backgroundColor).filter((c) => c && c !== 'rgba(0, 0, 0, 0)')).size,
        word_count: (document.body.innerText.match(/\S+/g) || []).length,
        links: document.querySelectorAll('a[href]').length,
      }));
    }
    await page.close();
  }
  record.push(entry);
  const w = entry.webaim;
  console.log(`${site.padEnd(20)} webaim=${w.pass ? 'PASS' : `BLOCK(${w.total})`} imgs=${entry.structure.images_rendered} emoji=${entry.structure.emoji_as_icon} words=${entry.structure.word_count} settled=${entry.captures['1440'].settled}/${entry.captures['390'].settled}`);
}

await browser.close();
fs.writeFileSync(path.join(OUT, '_samples.json'), JSON.stringify(record, null, 2));
console.log(`\n${record.length} samples captured to ${OUT}`);
