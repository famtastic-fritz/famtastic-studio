/**
 * Capture every console page that exists today, at 1440 and 390.
 *
 * Points at the operator's REAL data root by default, not a temp fixture: the
 * question is "where does the studio itself stand", and a page rendered against
 * an empty temp root would show honest-empty states everywhere and answer a
 * different question. Pass --temp for a fixture run.
 *
 * Uses the settled capture harness, so nothing is judged mid-load.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import puppeteer from '/Users/famtastic-fritz/Development/FAMtastic/site-studio/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { captureRender } from './render-capture.mjs';

const root = path.resolve(process.argv[1], '../../..');
const OUT = path.join(root, 'docs/env/console-shots');
const pages = JSON.parse(fs.readFileSync(path.join(root, 'config/pages.json'), 'utf8')).pages;
const dataRoot = process.argv.includes('--temp')
  ? fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'console-shots-'))
  : path.join(process.env.HOME, 'Development/famtastic-wt-phase-0/.studio-next-data');

const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

const port = await freePort();
console.log(`[shots] server on ${port}, data root ${dataRoot}`);
const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root, env: { ...process.env, PORT: String(port), STUDIO_DATA_ROOT: dataRoot }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
child.stderr.on('data', (d) => { serverErr += d.toString(); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server did not listen in 20s. stderr:\n${serverErr}`)), 20000);
  child.stdout.on('data', (d) => { if (/listening/i.test(d.toString())) { clearTimeout(t); res(); } });
  child.on('exit', (c) => { clearTimeout(t); rej(new Error(`server exited ${c}: ${serverErr}`)); });
});

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const record = [];

for (const pg of pages) {
  const url = `http://127.0.0.1:${port}${pg.path}`;
  const entry = { id: pg.id, title: pg.title, group: pg.group, path: pg.path, captures: {} };
  for (const [label, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    try {
      const cap = await captureRender(page, { url, outPath: path.join(OUT, `${pg.id}-${label}.png`), width: w, height: h });
      entry.captures[label] = { settled: cap.settled, scrollHeight: cap.scrollHeight, horizontalOverflow: cap.horizontalOverflow, file: `${pg.id}-${label}.png` };
    } catch (e) {
      entry.captures[label] = { error: e.message };
    }
    if (errors.length) entry.page_errors = errors;
    await page.close();
  }
  const c = entry.captures['1440'] || {};
  console.log(`${pg.id.padEnd(14)} ${String(pg.group).padEnd(8)} settled=${c.settled} h=${c.scrollHeight} overflow390=${entry.captures['390']?.horizontalOverflow}${entry.page_errors ? ' ERRORS' : ''}`);
  record.push(entry);
}

await browser.close();
child.kill();
fs.writeFileSync(path.join(OUT, '_shots.json'), JSON.stringify(record, null, 2));
console.log(`\n${record.length} pages captured to ${OUT}`);
