// Validate declared navigation using the same intercepted origin as rendering.
// External links are recorded as outside this static contract, never fetched.
export async function checkStaticNavigation({ page, context, origin, files }) {
  const refs = await page.locator('a[href],area[href]').evaluateAll(nodes => nodes.map(n => ({ href: n.getAttribute('href'), resolved: n.href })));
  const results = [];
  for (const ref of refs) {
    let url;
    try { url = new URL(ref.resolved); } catch { results.push({ ...ref, passed: false, reason: 'invalid_link' }); continue; }
    if (['mailto:', 'tel:', 'https:', 'http:'].includes(url.protocol) && url.origin !== origin) {
      results.push({ ...ref, status: 'external_not_checked' }); continue;
    }
    if (url.origin !== origin) { results.push({ ...ref, passed: false, reason: 'unsupported_link_scheme' }); continue; }
    const path = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    const target = path.endsWith('/') ? `${path}index.html` : path;
    if (!files.has(target)) { results.push({ ...ref, target, passed: false, reason: 'missing_internal_target' }); continue; }
    if (url.hash && /\.html$/.test(target)) {
      const probe = await context.newPage();
      try {
        await probe.goto(url.href);
        const fragment = decodeURIComponent(url.hash.slice(1));
        const found = await probe.evaluate(id => !!document.getElementById(id) || [...document.getElementsByName(id)].some(n => n.tagName === 'A'), fragment);
        results.push({ ...ref, target, passed: found, reason: found ? 'anchor_verified' : 'missing_fragment' });
      } finally { await probe.close(); }
    } else results.push({ ...ref, target, passed: true, reason: 'manifest_target_verified' });
  }
  return results;
}

export async function checkStaticResources({ page, origin, files }) {
  const urls = await page.evaluate(() => {
    const refs = [];
    for (const node of document.querySelectorAll('script[src],img[src],source[src],video[src],audio[src],track[src],iframe[src],embed[src],object[data],link[href]')) {
      if (node.tagName === 'LINK' && !/(stylesheet|preload|modulepreload|icon)/.test(node.rel)) continue;
      const raw = node.getAttribute(node.tagName === 'OBJECT' ? 'data' : node.tagName === 'LINK' ? 'href' : 'src');
      refs.push({ element: node.tagName.toLowerCase(), raw, url: new URL(raw, document.baseURI).href });
    }
    return refs;
  });
  return urls.map(ref => {
    const url = new URL(ref.url);
    if (url.protocol === 'data:') return { ...ref, passed: true, reason: 'inline_resource' };
    if (url.origin !== origin) return { ...ref, passed: false, reason: 'external_resource_not_allowed' };
    let target;
    try { target = decodeURIComponent(url.pathname.slice(1)); } catch { return { ...ref, passed: false, reason: 'invalid_resource_path' }; }
    target = !target || target.endsWith('/') ? `${target}index.html` : target;
    return { ...ref, target, passed: files.has(target), reason: files.has(target) ? 'manifest_resource_verified' : 'missing_declared_resource' };
  });
}
