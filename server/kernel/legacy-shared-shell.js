import { parseSourceHtml } from './strict-source-html.js';
import { digest } from './staging-store.js';
const fail = code => { throw Object.assign(new Error(code), { code, permanent: true }); };
const text = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (node, key) => node.attrs[key]?.value;
const slice = (doc, node) => doc.source.slice(node.start, node.end);
function one(nodes, predicate, code) {
  const found = nodes.filter(predicate); if (found.length !== 1) fail(code); return found[0];
}
function edits(source, changes) {
  const sorted = [...changes].sort((a, b) => b.start - a.start);
  let boundary = source.length, output = source;
  for (const change of sorted) {
    if (change.end > boundary || change.start > change.end) fail('shell_edit_overlap');
    output = output.slice(0, change.start) + change.value + output.slice(change.end); boundary = change.start;
  }
  return output;
}
export function assembleLegacySharedShell({ selectedBytes, templateBytes, contentBytes, permissionBytes, step, sharedStyleBytes = null }) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.html$/.test(step.path) || step.path.includes('..')) fail('shell_output_path_unsupported');
  const decode = bytes => { const value = bytes.toString('utf8'); if (!Buffer.from(value).equals(bytes)) fail('shell_utf8_required'); return value; };
  const selectedHash = digest(selectedBytes), templateHash = digest(templateBytes), contentHash = digest(contentBytes);
  let content, permission;
  try { content = JSON.parse(decode(contentBytes)); permission = JSON.parse(decode(permissionBytes)); } catch { fail('shell_authority_record_invalid'); }
  if (content.schema !== 'famtastic.authored-page-content.v1' || !content.record_id || !Number.isSafeInteger(content.revision) || content.revision < 1
    || content.output_path !== step.path || content.selected_sha256 !== selectedHash || !content.fields || typeof content.fields !== 'object' || Array.isArray(content.fields)
    || Object.values(content.fields).some(value => typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) fail('shell_content_authority_missing');
  if (permission.schema !== 'famtastic.page-transformation-permission.v1' || permission.status !== 'approved' || permission.action !== 'text_substitution'
    || !permission.authority_ref || permission.content_record_id !== content.record_id || permission.content_revision !== content.revision
    || permission.content_sha256 !== contentHash || permission.selected_sha256 !== selectedHash || permission.template_sha256 !== templateHash
    || permission.output_path !== step.path || permission.reuse_shared_shell !== true
    || !Array.isArray(permission.component_ids) || !Array.isArray(permission.fields)
    || JSON.stringify(permission.component_ids) !== JSON.stringify(step.component_ids)
    || JSON.stringify([...(permission.fields || [])].sort()) !== JSON.stringify(Object.keys(content.fields).sort())) fail('shell_transformation_permission_stale');
  const selected = parseSourceHtml(decode(selectedBytes)), template = parseSourceHtml(decode(templateBytes));
  const selectedBody = one(selected.nodes, n => n.tag === 'body', 'shell_body_ambiguous');
  const main = one(selected.nodes, n => n.tag === 'main' && n.parent === selectedBody, 'shell_main_ambiguous');
  if (selected.nodes.filter(n => n.tag === 'main').length !== 1 || selectedBody.children.some(n => !['header', 'main', 'footer'].includes(n.tag))) fail('shell_body_unsupported');
  const bindings = {};
  for (const tag of ['header', 'footer']) {
    const a = one(selected.nodes, n => n.tag === tag && attr(n, 'data-template') === tag, 'shell_chrome_ambiguous');
    const b = one(template.nodes, n => n.tag === tag && attr(n, 'data-template') === tag, 'shell_chrome_ambiguous');
    if (a.parent !== selectedBody || b.parent.tag !== 'body' || slice(selected, a) !== slice(template, b)) fail('shell_chrome_mismatch');
    bindings[tag] = digest(slice(selected, a));
  }
  const shared = one(template.nodes, n => n.tag === 'style' && attr(n, 'data-template') === 'shared', 'shell_shared_style_missing');
  const templateCss = template.source.slice(shared.startTagEnd, shared.endTagStart);
  const inline = selected.nodes.filter(n => n.tag === 'style' && attr(n, 'data-template') === 'shared');
  if (inline.length === 1) {
    if (selected.source.slice(inline[0].startTagEnd, inline[0].endTagStart) !== templateCss) fail('shell_shared_style_mismatch');
  } else if (!inline.length && sharedStyleBytes && step.shared_style_public_path) {
    one(selected.nodes, n => n.tag === 'link' && attr(n, 'rel') === 'stylesheet' && attr(n, 'href') === step.shared_style_public_path, 'shell_shared_style_missing');
    if (decode(sharedStyleBytes).trim() !== templateCss.trim()) fail('shell_shared_style_mismatch');
  } else fail('shell_shared_style_missing');
  bindings.shared_style = digest(templateCss);
  const head = one(selected.nodes, n => n.tag === 'head', 'shell_head_ambiguous');
  const title = one(head.children, n => n.tag === 'title', 'shell_title_ambiguous');
  if (title.children.length || head.children.some(n => !['title', 'meta', 'style', 'link'].includes(n.tag))) fail('shell_head_metadata_unsupported');
  const targets = new Map([['head/title', { start: title.startTagEnd, end: title.endTagStart, node: title }]]);
  for (const node of head.children) {
    if (node.tag === 'meta') {
      const name = attr(node, 'name');
      if (attr(node, 'charset') && attr(node, 'charset').toLowerCase() !== 'utf-8') fail('shell_head_metadata_unsupported');
      if (attr(node, 'http-equiv') || attr(node, 'property') || !attr(node, 'charset') && !['viewport', 'description', 'robots', 'theme-color'].includes(name)) fail('shell_head_metadata_unsupported');
      if (name === 'description') {
        if (targets.has('head/description') || !node.attrs.content) fail('shell_head_metadata_unsupported');
        targets.set('head/description', { start: node.attrs.content.start, end: node.attrs.content.end, node });
      }
    }
    if (node.tag === 'link' && !['stylesheet', 'icon'].includes(attr(node, 'rel'))) fail('shell_head_metadata_unsupported');
  }
  const components = step.component_ids.map(id => one(main.children, n => attr(n, 'data-section-id') === id, 'shell_component_missing'));
  for (const component of components) {
    for (const node of selected.nodes.filter(n => n.start >= component.start && n.end <= component.end)) {
      if (attr(node, 'data-field-type') === 'text') {
        const id = attr(node, 'data-field-id');
        if (!id || node.children.length || node.endTagStart <= node.startTagEnd) fail('shell_text_field_ambiguous');
        targets.set(`${attr(component, 'data-section-id')}/${id}`, { start: node.startTagEnd, end: node.endTagStart, node });
      }
    }
  }
  if (JSON.stringify([...targets.keys()].sort()) !== JSON.stringify(Object.keys(content.fields).sort())) fail('shell_content_fields_incomplete');
  const changes = [...targets].map(([field, target]) => ({ ...target, field, value: text(content.fields[field]) }));
  const mainBody = components.map(component => edits(slice(selected, component), changes.filter(c => c.start >= component.start && c.end <= component.end).map(c => ({ ...c, start: c.start - component.start, end: c.end - component.start })))).join('\n');
  const headChanges = changes.filter(c => c.start >= head.start && c.end <= head.end);
  const output = Buffer.from(edits(selected.source, [...headChanges, { start: main.startTagEnd, end: main.endTagStart, value: `\n${mainBody}\n` }]));
  parseSourceHtml(output.toString('utf8'));
  return { bytes: output, lineage: { stage: 'assemble_selected_shell', recipe: 'legacy-shared-shell-v1', path: step.path,
    selected_sha256: selectedHash, template_sha256: templateHash, content_sha256: contentHash, permission_sha256: digest(permissionBytes),
    content_record_id: content.record_id, content_revision: content.revision, authority_ref: permission.authority_ref,
    component_ids: step.component_ids, shared_bindings: bindings,
    head_changes: headChanges.map(c => c.field), field_changes: changes.map(c => ({ field: c.field, source_start: c.start, source_end: c.end, output_text_sha256: digest(c.value) })),
    output_sha256: digest(output), content_record: content, permission_record: permission,
    template_content_base64: templateBytes.toString('base64'), selected_content_base64: selectedBytes.toString('base64'), generation_provider_calls: 0 } };
}
