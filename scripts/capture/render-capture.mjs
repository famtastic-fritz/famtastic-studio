/**
 * Artifact-proof render capture.
 *
 * Written after a calibration run produced TWO false defects on the best site
 * we have, both from the same cause: judging a page mid-load.
 *
 *   1. A chat widget's speech bubble was open in frame one and gone in frame
 *      two. Scored as an overlap defect. It was a timed animation.
 *   2. Five of twelve images reported zero naturalWidth. Scored as broken.
 *      They were lazy-loaded and resolved to zero broken after a full scroll.
 *
 * A naive screenshot critic would have FAILED our strongest page. So the
 * capture harness is a correctness requirement of the gate, not a convenience.
 *
 * Four defences, in the order they matter:
 *
 *   - SCROLL THE WHOLE PAGE FIRST, then return to top. This triggers lazy
 *     loading and IntersectionObserver reveals. Without it, "broken image" and
 *     "empty section" are measurement artifacts.
 *   - WAIT FOR IMAGE DECODE, not just network idle. networkidle2 fires while
 *     images are still decoding.
 *   - FREEZE ANIMATION via an injected stylesheet. This is Playwright's
 *     stylePath idea (research packet: "filtering out dynamic or volatile
 *     elements, hence improving the screenshot determinism"), applied here to
 *     Puppeteer. Transient overlays are hidden by selector, not guessed at.
 *   - CAPTURE TWICE AND COMPARE. If two captures a second apart differ in byte
 *     length beyond a small tolerance, the page has not settled and the capture
 *     is marked UNSETTLED rather than scored. An unsettled page is not a bad
 *     page; it is an unmeasured one.
 *
 * Same-environment rule, also from the packet: browser rendering varies with
 * host OS, version, settings, hardware, power source and headless mode, so a
 * baseline is only comparable to a capture made the same way. Every capture
 * records its environment alongside the bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
  video { visibility: hidden !important; }
`;

/** Selectors for transient chrome that is not part of the page's design. */
export const DEFAULT_VOLATILE = [
  '[class*="chat"][class*="bubble"]',
  '[class*="toast"]', '[class*="tooltip"]',
  '[role="tooltip"]', '[role="status"]',
  '[class*="cookie"]', '[class*="consent"]',
];

export async function captureRender(page, {
  url,
  outPath,
  width = 1440,
  height = 900,
  volatile = DEFAULT_VOLATILE,
  settleToleranceBytes = 2048,
} = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

  // 1. Full scroll — triggers lazy loading and reveal-on-scroll.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });

  // 2. Wait for decode, not just network -- BOUNDED. A lazy image inside a
  // collapsed <details> never loads no matter how long we wait, and an
  // unbounded Promise.all here hung the whole capture on the first page that
  // had one. The bound does not weaken the measurement: a genuinely in-flight
  // page still fails the two-shot settle comparison below.
  await page.evaluate(() => Promise.race([
    Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) =>
        new Promise((res) => { i.onload = i.onerror = res; })),
    ),
    new Promise((res) => setTimeout(res, 15000)),
  ]));

  // 3. Freeze animation and hide volatile chrome.
  await page.addStyleTag({ content: FREEZE_CSS });
  if (volatile.length) {
    await page.addStyleTag({ content: `${volatile.join(',')} { visibility: hidden !important; }` });
  }
  await new Promise((r) => setTimeout(r, 600));

  // 4. Capture twice; differing bytes means it has not settled.
  const a = await page.screenshot({ fullPage: true });
  await new Promise((r) => setTimeout(r, 1000));
  const b = await page.screenshot({ fullPage: true });
  const settled = Math.abs(a.length - b.length) <= settleToleranceBytes;

  // Measure only AFTER the page has been fully scrolled and decoded.
  const facts = await page.evaluate(() => ({
    images: document.images.length,
    broken: [...document.images].filter((i) => !i.naturalWidth).length,
    scrollHeight: document.body.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, b);
  }

  return {
    url,
    outPath: outPath || null,
    settled,
    settle_delta_bytes: Math.abs(a.length - b.length),
    sha256: crypto.createHash('sha256').update(b).digest('hex'),
    bytes: b.length,
    ...facts,
    environment: {
      platform: `${os.platform()} ${os.arch()}`,
      headless: true,
      viewport: `${width}x${height}`,
      captured_at: new Date().toISOString(),
    },
  };
}
