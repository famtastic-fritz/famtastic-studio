import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { digest } from './staging-store.js';
// Static selected-artifact QA. No application behavior or independent human
// design judgment is inferred. Unknown interactive forms fail scope validation.
export function createSelectedReviewQa({ paths, launchBrowser }) {
  return async ({ job }) => {
    const problems = [], evidence = [];
    const c = job.packet.continuation;
    const files = job.selected.artifact_bundle.files;
    const baselineDir = paths.within('staging', job.id, 'baseline');
    fs.mkdirSync(baselineDir, { recursive: true, mode: 0o700 });
    for (const file of files) {
      const local = paths.within('sites', `project-${job.packet.project_id}`, file.path);
      if (!fs.existsSync(local) || digest(fs.readFileSync(local)) !== file.sha256) problems.push('artifact_parity');
      const baseline = paths.within('staging', job.id, 'baseline', file.path);
      const parent = file.path.split('/').slice(0, -1).join('/');
      if (parent) fs.mkdirSync(paths.within('staging', job.id, 'baseline', parent), { recursive: true, mode: 0o700 });
      fs.writeFileSync(baseline, Buffer.from(file.content_base64, 'base64'), { mode: 0o600 });
    }
    const browser = await (launchBrowser || (async () => (await import('playwright')).chromium.launch({ headless: true })))();
    try {
      for (const width of [390, 768, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        // Hermetic review: undeclared network assets are a failed check.
        await context.route(/^https?:/, route => { problems.push('undeclared_external_dependency'); return route.abort(); });
        for (const file of files.filter(f => f.path.endsWith('.html'))) {
          const page = await context.newPage();
          page.on('pageerror', () => problems.push('script_error'));
          const local = paths.within('sites', `project-${job.packet.project_id}`, file.path);
          await page.goto(pathToFileURL(local).href);
          const checks = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            lang: !!document.documentElement.lang, title: !!document.title,
            h1: document.querySelectorAll('h1').length === 1,
            images: [...document.images].every(i => i.complete && i.naturalWidth > 0 && i.hasAttribute('alt')),
            controls: [...document.querySelectorAll('button,input,select,textarea')].every(e => e.getAttribute('aria-label') || e.labels?.length || e.textContent.trim()),
            unsupportedForms: !!document.querySelector('form'),
          }));
          if (checks.overflow || !checks.lang || !checks.title || !checks.h1 || !checks.images || !checks.controls || checks.unsupportedForms) problems.push('static_browser_qa');
          const actual = await page.screenshot({ fullPage: true, animations: 'disabled' });
          await page.goto(pathToFileURL(paths.within('staging', job.id, 'baseline', file.path)).href);
          const baseline = await page.screenshot({ fullPage: true, animations: 'disabled' });
          if (digest(actual) !== digest(baseline)) problems.push('visual_parity');
          evidence.push({ path: file.path, width, checks, output_screenshot_sha256: digest(actual), baseline_screenshot_sha256: digest(baseline) });
          await page.close();
        }
        await context.close();
      }
    } finally { await browser.close(); }
    const manifestPaths = new Set(files.map(f => f.path));
    if (c.required_pages.some(p => !manifestPaths.has(p))) problems.push('scope_incomplete');
    if (c.files.some(f => f.rights?.status !== 'approved' || !f.rights?.evidence_ref)) problems.push('asset_rights');
    return { passed: problems.length === 0, checks: ['functional', 'responsive', 'accessibility', 'asset_rights', 'visual_parity'],
      verifier: 'selected-static-browser-v1', evidence, problems, limitations: ['Accessibility checks are structural, not a complete WCAG audit', 'Functional scope is static navigation; no application recipe is inferred'] };
  };
}
