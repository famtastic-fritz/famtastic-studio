// Browser-first verification (ENDGAME item 12, plan 2.1 'verify' stage).
//
// Real Chromium, via Playwright, navigates every composed page from disk and
// checks: the page loads, has exactly one h1, produced no console errors, no
// unresolved placeholder tokens are present in the rendered HTML, every
// internal link resolves to a page that was actually built, and every
// same-page fragment link (`#id`) resolves to an element with that id that
// actually exists on the page. Fragment links used to be skipped entirely --
// a whole class of link (every CTA in this build's default composer) went
// unchecked and a page with a dangling `#contact` link still verified green.
// A skipped fragment check is exactly the same failure shape as the deferred
// browser lane below: a check that never ran read as a pass.
//
// A skipped or deferred browser lane is a FAILURE, never a pass. The legacy
// runner returned status: deferred and it read green -- that is the exact
// failure mode this file refuses to repeat. If Chromium cannot be launched,
// verifySite() returns passed:false with that reason recorded in errors[]; it
// never silently reports success because the browser step didn't happen.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER_RE = /\{\{[^}]*\}\}|__[A-Z0-9_]+__|\[\[[^\]]*\]\]/;

// `#` alone (or empty) is a common no-op placeholder link, not a real
// fragment target -- left unchecked, same as an absolute-scheme link.
function isFragmentHref(href) {
  return typeof href === 'string' && href.startsWith('#') && href.length > 1;
}

function isInternalHref(href) {
  if (!href) return false;
  // Any absolute scheme (http(s), mailto:, tel:, javascript:, data:, //cdn, etc.)
  // is not an internal page link; only bare/relative paths are checked.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false;
  if (href.startsWith('#')) return false;
  return true;
}

function normalizeInternalPath(href) {
  const clean = href.split('#')[0].split('?')[0];
  return clean.startsWith('/') ? clean.slice(1) : clean;
}

/**
 * verifySite({ siteDir, pages, launchBrowser }) -> { passed, checks, errors }.
 * `pages` is the compose stage's page list ({ path, title, html }[]); `siteDir`
 * is where build actually wrote those files. `launchBrowser` is an injection
 * seam for tests only (defaults to a real headless Playwright Chromium).
 */
export async function verifySite({ siteDir, pages, launchBrowser } = {}) {
  const checks = [];
  const errors = [];

  if (!siteDir || !fs.existsSync(siteDir)) {
    return { passed: false, checks, errors: [`site directory does not exist: ${siteDir}`] };
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    return { passed: false, checks, errors: ['verify requires at least one built page'] };
  }

  const knownPaths = new Set(pages.map((p) => p.path));

  let browser;
  try {
    const launch = launchBrowser || (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ headless: true });
    });
    browser = await launch();
  } catch (error) {
    // Cannot launch the browser lane: this is the failure this file exists to
    // prevent from looking like a pass. Report it as a hard failure.
    return { passed: false, checks, errors: [`browser lane could not launch (this is a failure, not a skip): ${error.message}`] };
  }

  try {
    const context = await browser.newContext();
    for (const pageArtifact of pages) {
      const filePath = path.join(siteDir, pageArtifact.path);
      const check = { path: pageArtifact.path, loaded: false, h1_count: null, console_errors: [], placeholder_tokens: false, broken_links: [] };

      if (!fs.existsSync(filePath)) {
        check.error = 'built file missing on disk';
        checks.push(check);
        errors.push(`${pageArtifact.path}: built file missing on disk`);
        continue;
      }

      const tab = await context.newPage();
      const consoleErrors = [];
      tab.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      tab.on('pageerror', (err) => { consoleErrors.push(err.message); });

      try {
        await tab.goto(pathToFileURL(filePath).href, { waitUntil: 'load', timeout: 15000 });
        check.loaded = true;
      } catch (error) {
        check.loaded = false;
        errors.push(`${pageArtifact.path}: failed to load (${error.message})`);
      }

      if (check.loaded) {
        const h1Count = await tab.locator('h1').count();
        check.h1_count = h1Count;
        if (h1Count !== 1) errors.push(`${pageArtifact.path}: expected exactly one h1, found ${h1Count}`);

        const renderedHtml = await tab.evaluate(() => document.documentElement.outerHTML);
        check.placeholder_tokens = PLACEHOLDER_RE.test(renderedHtml);
        if (check.placeholder_tokens) errors.push(`${pageArtifact.path}: unresolved placeholder token found in rendered HTML`);

        const hrefs = await tab.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
        for (const href of hrefs) {
          if (isFragmentHref(href)) {
            const fragmentId = href.slice(1);
            // eslint-disable-next-line no-await-in-loop -- sequential per-link check, same pattern as the rest of this loop
            const targetExists = await tab.evaluate((id) => document.getElementById(id) !== null, fragmentId);
            if (!targetExists) {
              check.broken_links.push(href);
              errors.push(`${pageArtifact.path}: same-page fragment link does not resolve to any element with id="${fragmentId}": ${href}`);
            }
            continue;
          }
          if (!isInternalHref(href)) continue;
          const normalized = normalizeInternalPath(href);
          if (!normalized) continue;
          if (!knownPaths.has(normalized) && !fs.existsSync(path.join(siteDir, normalized))) {
            check.broken_links.push(href);
            errors.push(`${pageArtifact.path}: internal link does not resolve: ${href}`);
          }
        }
      }

      check.console_errors = consoleErrors;
      if (consoleErrors.length) errors.push(`${pageArtifact.path}: console error(s): ${consoleErrors.join(' | ')}`);

      checks.push(check);
      await tab.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }

  return { passed: errors.length === 0, checks, errors };
}
