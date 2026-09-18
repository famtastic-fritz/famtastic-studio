import fs from 'node:fs';
import { checkStaticNavigation, checkStaticResources } from './selected-static-navigation.js';
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
      const local = paths.within('sites', job.build?.site_id || `project-${job.packet.project_id}`, file.path);
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
        const origin = 'https://selected-review.invalid';
        const resourceChecks = [];
        let baselineMode = false;
        const mime = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2' };
        const manifest = new Map(files.map(f => [f.path, f]));
        // Every browser request is intercepted. Only current allowlisted bytes
        // are served, so missing CSS/imports/fonts/scripts cannot pass silently.
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          const relative = decodeURIComponent(url.pathname.slice(1));
          const name = !relative || relative.endsWith('/') ? `${relative}index.html` : relative;
          const allowed = url.origin === origin && manifest.has(name);
          if (!allowed) {
            problems.push(url.origin === origin ? 'missing_local_resource' : 'undeclared_external_dependency');
            resourceChecks.push({ url: url.href, type: request.resourceType(), passed: false, reason: url.origin === origin ? 'not_in_artifact_manifest' : 'external_request_blocked' });
            return route.fulfill({ status: 404, body: '' });
          }
          const artifact = manifest.get(name);
          const contents = baselineMode ? Buffer.from(artifact.content_base64, 'base64') : fs.readFileSync(paths.within('sites', job.build?.site_id || `project-${job.packet.project_id}`, name));
          resourceChecks.push({ path: name, type: request.resourceType(), passed: true, sha256: digest(contents) });
          return route.fulfill({ status: 200, contentType: mime[name.split('.').at(-1)] || 'application/octet-stream', body: contents });
        });
        for (const file of files.filter(f => f.path.endsWith('.html'))) {
          const page = await context.newPage();
          page.on('pageerror', () => problems.push('script_error'));
          baselineMode = false;
          await page.goto(`${origin}/${file.path}`);
          const navigation = await checkStaticNavigation({ page, context, origin, files: manifest });
          const declaredResources = await checkStaticResources({ page, origin, files: manifest });
          if (declaredResources.some(check => check.passed === false)) problems.push('declared_resource_failed');
          if (navigation.some(check => check.passed === false)) problems.push('static_navigation_failed');
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
          baselineMode = true;
          await page.goto(`${origin}/${file.path}`);
          const baseline = await page.screenshot({ fullPage: true, animations: 'disabled' });
          if (digest(actual) !== digest(baseline)) problems.push('visual_parity');
          const authored_fields = await page.evaluate(() => {
            const text = selector => { const nodes = document.querySelectorAll(selector); return nodes.length === 1 ? nodes[0].textContent : null; };
            const descriptions = document.querySelectorAll('meta[name="description"]');
            return { title: text('title'), description: descriptions.length === 1 ? descriptions[0].content : null,
              heading: text('main h1[data-field-type="text"]'), body: text('main p[data-field-type="text"]') };
          });
          evidence.push({ path: file.path, width, checks, authored_fields, navigation, declared_resources: declaredResources, resources: [...resourceChecks], output_screenshot_sha256: digest(actual), baseline_screenshot_sha256: digest(baseline) });
          await page.close();
        }
        await context.close();
      }
    } finally { await browser.close(); }
    const manifestPaths = new Set(files.map(f => f.path));
    if (c.required_pages.some(p => !manifestPaths.has(p))) problems.push('scope_incomplete');
    if (c.files.some(f => f.rights?.status !== 'approved' || !f.rights?.evidence_ref)) problems.push('asset_rights');
    return { passed: problems.length === 0, checks: ['functional', 'responsive', 'accessibility', 'asset_rights', 'visual_parity'],
      source_binding: { site_id: job.build?.site_id || `project-${job.packet.project_id}`, run_id: job.build?.run_id || null,
        manifest_sha256: digest(files.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.from(f.content_base64, 'base64').length })).sort((a, b) => a.path.localeCompare(b.path))) },
      verifier: 'selected-static-browser-v2', evidence, problems, limitations: ['Accessibility checks are structural, not a complete WCAG audit', 'Functional scope is static navigation; no application recipe is inferred'] };
  };
}
