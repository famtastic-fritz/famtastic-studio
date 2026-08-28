const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3400';
const SHOTS = path.join(__dirname, '..', 'docs', 'env', 'critique-screens');
fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  { id: 'work', path: '/', rail: true },
  { id: 'sites', path: '/sites', rail: false },
  { id: 'site-view', path: '/site?site_id=site-drop-the-beat', rail: true },
  { id: 'applications', path: '/applications', rail: false },
  { id: 'proofs', path: '/proofs', rail: false },
  { id: 'deployments', path: '/deployments', rail: true },
  { id: 'media', path: '/media', rail: false },
  { id: 'components', path: '/components', rail: false },
  { id: 'builds', path: '/builds', rail: true },
  { id: 'automations', path: '/automations', rail: false },
  { id: 'settings', path: '/settings', rail: false },
];

const SHOT_BOTH_THEME = new Set(['work', 'sites', 'site-view']);

// contrast helpers
function parseColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function relLum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(c1, c2) {
  const l1 = relLum(c1), l2 = relLum(c2);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}
// composite fg (possibly alpha) over bg
function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

async function extractContrast(page) {
  return await page.evaluate(() => {
    function parseColor(str) {
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map(s => parseFloat(s.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    function getBgColor(el) {
      let node = el;
      while (node) {
        const cs = getComputedStyle(node);
        const bg = parseColor(cs.backgroundColor);
        if (bg && bg.a > 0.01) return bg;
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }
    const results = [];
    const all = document.querySelectorAll('body *');
    const seen = new Set();
    for (const el of all) {
      if (el.children.length > 0 && el.textContent.trim() === '') continue;
      const text = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const fg = parseColor(cs.color);
      if (!fg) continue;
      const bg = getBgColor(el);
      const fontSize = parseFloat(cs.fontSize);
      const fontWeight = parseInt(cs.fontWeight) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const key = el.tagName + '|' + (el.className || '') + '|' + el.textContent.trim().slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        text: el.textContent.trim().slice(0, 40),
        color: cs.color,
        bg: cs.backgroundColor,
        effectiveBg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        fontSize,
        fontWeight,
        isLarge,
      });
    }
    return results;
  });
}

async function computeContrastFindings(page) {
  const raw = await extractContrast(page);
  const findings = [];
  for (const r of raw) {
    const fg = parseColor(r.color);
    let bg = parseColor(r.bg);
    if (!bg || bg.a < 0.01) bg = parseColor(r.effectiveBg);
    if (!fg || !bg) continue;
    const effFg = fg.a < 1 ? composite(fg, bg) : fg;
    const ratio = contrastRatio(effFg, bg);
    const min = r.isLarge ? 3.0 : 4.5;
    if (ratio < min) {
      findings.push({ ...r, ratio: ratio.toFixed(2), min });
    }
  }
  return findings;
}

async function structuralAudit(page) {
  return await page.evaluate(() => {
    const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim());
    const headingEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const headings = headingEls.map(h => ({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0, 60) }));
    let skipped = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        skipped.push(`${headings[i - 1].text} (h${headings[i - 1].level}) -> ${headings[i].text} (h${headings[i].level})`);
      }
    }
    const landmarks = {
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      header: document.querySelectorAll('header').length,
    };
    const skipLink = Array.from(document.querySelectorAll('a[href^="#"]')).find(a => /skip/i.test(a.textContent) || /skip/i.test(a.className));
    // images
    const imgs = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt'),
      hasAlt: img.hasAttribute('alt'),
      ariaHidden: img.getAttribute('aria-hidden'),
    }));
    // icon-only buttons/links: no visible text, check aria-label/title
    const interactive = Array.from(document.querySelectorAll('button, a[href], [role="button"], input, select, textarea'));
    const unnamed = [];
    for (const el of interactive) {
      const text = el.textContent.trim();
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledby = el.getAttribute('aria-labelledby');
      const title = el.getAttribute('title');
      const alt = el.tagName === 'INPUT' ? el.getAttribute('alt') : null;
      const type = el.tagName === 'INPUT' ? el.getAttribute('type') : null;
      const hasVisibleLabel = text.length > 0;
      const hasAccessibleName = hasVisibleLabel || ariaLabel || ariaLabelledby || title || alt;
      if (!hasAccessibleName) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          unnamed.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), type, outerHTML: el.outerHTML.slice(0, 150) });
        }
      }
    }
    // form controls without labels
    const formControls = Array.from(document.querySelectorAll('input, select, textarea')).map(el => {
      const id = el.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledby = el.getAttribute('aria-labelledby');
      const placeholder = el.getAttribute('placeholder');
      const type = el.getAttribute('type') || el.tagName.toLowerCase();
      return {
        type,
        hasLabel: !!(label || ariaLabel || ariaLabelledby),
        placeholderOnly: !!(placeholder && !(label || ariaLabel || ariaLabelledby)),
        cls: (el.className || '').toString().slice(0, 60),
      };
    });
    // aria-live regions
    const liveRegions = Array.from(document.querySelectorAll('[aria-live]')).map(el => ({
      ariaLive: el.getAttribute('aria-live'),
      cls: (el.className || '').toString().slice(0, 60),
      text: el.textContent.trim().slice(0, 60),
    }));
    // tablist / tabs
    const tablists = Array.from(document.querySelectorAll('[role="tablist"]')).map(tl => ({
      tabs: Array.from(tl.querySelectorAll('[role="tab"]')).map(t => ({
        text: t.textContent.trim(),
        selected: t.getAttribute('aria-selected'),
        controls: t.getAttribute('aria-controls'),
        tabindex: t.getAttribute('tabindex'),
      })),
    }));
    const tabpanels = document.querySelectorAll('[role="tabpanel"]').length;
    return { h1Count: h1s.length, h1s, headings, skipped, landmarks, skipLinkPresent: !!skipLink, imgs, unnamed, formControls, liveRegions, tablists, tabpanels };
  });
}

async function keyboardAudit(page) {
  // Tab through first N focusable elements, check outline/box-shadow presence on focus
  const results = [];
  await page.keyboard.press('Tab');
  for (let i = 0; i < 15; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 40),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        boxShadow: cs.boxShadow,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    results.push(info);
    await page.keyboard.press('Tab');
  }
  return results;
}

async function run() {
  const browser = await chromium.launch();
  const report = {};

  for (const p of PAGES) {
    report[p.id] = { dark: {}, light: {} };
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + p.path, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(400);
        const structural = theme === 'dark' ? await structuralAudit(page) : null;
        const contrast = await computeContrastFindings(page);
        let keyboard = null;
        if (theme === 'dark') keyboard = await keyboardAudit(page);
        report[p.id][theme] = { structural, contrast, keyboard };

        if (SHOT_BOTH_THEME.has(p.id) || theme === 'dark') {
          await page.screenshot({ path: path.join(SHOTS, `${p.id}-${theme}.png`), fullPage: true });
        }
      } catch (e) {
        report[p.id][theme] = { error: e.message };
      }
      await ctx.close();
    }
    console.log('done', p.id);
  }

  fs.writeFileSync(path.join(__dirname, '_audit-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('WROTE REPORT');
}

run().catch(e => { console.error(e); process.exit(1); });
