import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture, packet, html } from './staging-worker-fixture.mjs';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { createSelectedReviewQa } from '../server/kernel/selected-review-qa.js';
let f;
afterEach(() => f?.cleanup());
async function check(files) {
  f = fixture();
  const bundle = createArtifactBundle(files);
  for (const file of files) {
    const parent = file.path.split('/').slice(0,-1).join('/');
    fs.mkdirSync(f.paths.within('sites','project-42', ...(parent ? [parent] : [])), { recursive: true });
    fs.writeFileSync(f.paths.within('sites','project-42',file.path), file.contents);
  }
  return createSelectedReviewQa({ paths:f.paths })({job:{id:'qa-test',packet:packet(),selected:{artifact_bundle:bundle}}});
}
it('rejects missing internal links, cross-page fragments and required CSS with actionable evidence', async () => {
  const result = await check([{path:'index.html',contents:html.replace('</head>','<link rel="stylesheet" href="missing.css"></head>').replace('</body>','<a href="missing-page.html">Missing</a><a href="about.html#absent">Anchor</a></body>')},{path:'about.html',contents:html}]);
  expect(result.passed).toBe(false);
  expect(result.problems).toContain('static_navigation_failed'); expect(result.problems).toContain('missing_local_resource');
  for (const e of result.evidence.filter(e=>e.path==='index.html')) {
    expect(e.navigation.some(n=>n.reason==='missing_internal_target'&&n.target==='missing-page.html')).toBe(true);
    expect(e.navigation.some(n=>n.reason==='missing_fragment')).toBe(true);
    expect(e.resources.some(r=>r.url?.endsWith('/missing.css')&&r.passed===false)).toBe(true);
  }
});
it('verifies valid nested navigation, root links, anchors, CSS and CSS dependencies without network', async () => {
  const result = await check([{path:'index.html',contents:html.replace('</head>','<link rel="stylesheet" href="styles.css"></head>').replace('</body>','<a href="nested/about.html#team">Team</a><a href="#home">Home</a><div id="home"></div></body>')},{path:'nested/about.html',contents:html.replace('</body>','<div id="team"></div><a href="/index.html#home">Home</a></body>')},{path:'styles.css',contents:'@import "extra.css"; body { color: #111; }'},{path:'extra.css',contents:'body { background:white; }'}]);
  expect(result.problems).toEqual([]); expect(result.passed).toBe(true);
  expect(result.evidence.every(e=>e.navigation.every(n=>n.passed))).toBe(true);
});
it('rejects missing same-page anchor and CSS import even when the page loads', async () => {
  const result = await check([{path:'index.html',contents:html.replace('</head>','<link rel="stylesheet" href="styles.css"></head>').replace('</body>','<a href="#absent">Missing anchor</a></body>')},{path:'styles.css',contents:'@import "missing-import.css";'}]);
  expect(result.passed).toBe(false);expect(result.problems).toContain('missing_local_resource');
  expect(result.evidence[0].navigation[0].reason).toBe('missing_fragment');
});
