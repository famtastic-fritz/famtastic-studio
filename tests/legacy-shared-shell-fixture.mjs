import { packet } from './staging-worker-fixture.mjs';
import { digest } from '../server/kernel/staging-store.js';
export const css = 'body{margin:0;font-family:Arial}main{max-width:64rem;margin:auto;padding:1rem}img{max-width:100%}';
const header = '<header data-template="header"><nav aria-label="Main"><a href="index.html">Home</a> <a href="about.html">About</a></nav></header>';
export const footer = '<footer data-template="footer"><p>Synthetic owned fixture</p><a data-field-id="footer-phone" data-field-type="phone" href="tel:+15555550100">555-555-0100</a><a data-field-id="footer-email" data-field-type="email" href="mailto:hello@example.invalid">hello@example.invalid</a><address data-field-id="footer-address" data-field-type="address">Synthetic address</address><blockquote data-field-id="footer-testimonial" data-field-type="testimonial">Synthetic authored quotation</blockquote></footer>';
const start = '<!doctype html><html lang="en">';
export function shellFixture(options = {}) {
  const outputPath = options.outputPath || 'about.html';
  let template = `${start}<head><title>Shared template only</title><style data-template="shared">${css}</style></head><body>${header}${footer}</body></html>`;
  let selected = `${start}<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Original home description"><title>Original home</title><style data-template="shared">${css}</style><style>.intro{padding:1rem}</style></head><body>${header}<main id="main"><section class="intro" data-section-id="intro" data-section-type="intro"><h1 data-field-id="heading" data-field-type="text">Original heading</h1><p data-field-id="body" data-field-type="text">Original authored home paragraph.</p></section></main>${footer}</body></html>`;
  if (options.externalCss) selected = selected.replace(`<style data-template="shared">${css}</style>`, '<link rel="stylesheet" href="assets/styles.css">');
  selected = options.selected?.(selected) ?? selected; template = options.template?.(template) ?? template;
  const content = { schema: 'famtastic.authored-page-content.v1', record_id: 'owned-content:about', revision: 1, output_path: outputPath, selected_sha256: digest(selected),
    fields: { 'head/title': 'About the synthetic business', 'head/description': 'Customer-authored about description', 'intro/heading': 'About this business', 'intro/body': 'Customer authored <story> & care.' } };
  options.content?.(content);
  const permission = { schema: 'famtastic.page-transformation-permission.v1', status: 'approved', action: 'text_substitution', authority_ref: 'synthetic-owner-permission-record',
    content_record_id: content.record_id, content_revision: content.revision, content_sha256: digest(JSON.stringify(content)), selected_sha256: digest(selected), template_sha256: digest(template),
    output_path: outputPath, reuse_shared_shell: true, component_ids: ['intro'], fields: Object.keys(content.fields) };
  options.permission?.(permission); options.staleContent?.(content);
  const p = packet(), a = p.artifacts[0]; a.sha256 = digest(selected); a.bytes = Buffer.byteLength(selected);
  p.selected_artifacts[0].source_artifact_sha256 = a.sha256; p.selected_artifacts[0].source_artifact_bytes = a.bytes;
  p.continuation.current_selected_sha256 = a.sha256; p.continuation.operation = 'continue_build'; p.continuation.required_pages = ['index.html', outputPath];
  p.continuation.requested_changes = [{ id: 'about-page', description: 'Assemble the recorded authored about page' }];
  const source = new Map([['proof/index.html', Buffer.from(selected)], ['proof/_template.html', Buffer.from(template)], ['records/content.json', Buffer.from(JSON.stringify(content))], ['records/permission.json', Buffer.from(JSON.stringify(permission))]]);
  const step = { stage: 'assemble_selected_shell', path: outputPath, selected_source_path: 'proof/index.html', component_ids: ['intro'],
    design_contract_sha256: digest(p.continuation.brand.design_contract), rights: { status: 'approved', evidence_ref: 'synthetic-owned-shell-source' }, resolves_change_ids: ['about-page'] };
  for (const [kind, sourcePath] of [['template', 'proof/_template.html'], ['content', 'records/content.json'], ['permission', 'records/permission.json']]) {
    const bytes = source.get(sourcePath);
    p.artifacts.push({ role: 'source_material', path: sourcePath, bytes: bytes.length, sha256: digest(bytes) });
    step[`${kind}_source_path`] = sourcePath; step[`${kind}_sha256`] = digest(bytes); step[`${kind}_url`] = `https://assets.example.invalid/${sourcePath}`;
  }
  if (options.externalCss) {
    source.set('proof/styles.css', Buffer.from(css));
    p.artifacts.push({ role: 'source_material', path: 'proof/styles.css', bytes: Buffer.byteLength(css), sha256: digest(css) });
    p.continuation.files.push({ path: 'assets/styles.css', source_path: 'proof/styles.css', url: 'https://assets.example.invalid/proof/styles.css', rights: { status: 'approved', evidence_ref: 'synthetic-shared-css' } });
    Object.assign(step, { shared_style_source_path: 'proof/styles.css', shared_style_sha256: digest(css), shared_style_public_path: 'assets/styles.css' });
  }
  p.artifact_manifest_sha256 = digest(p.artifacts.map(a => ({ bytes: a.bytes, path: a.path, role: a.role, sha256: a.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  p.continuation.recipe = { id: 'legacy-shared-shell-v1', steps: [step] };
  return { p, source, selected, template, content, permission, step,
    renderer: { selectedBytes: Buffer.from(selected), templateBytes: Buffer.from(template), contentBytes: source.get('records/content.json'), permissionBytes: source.get('records/permission.json'), step, sharedStyleBytes: options.externalCss ? Buffer.from(css) : null } };
}
