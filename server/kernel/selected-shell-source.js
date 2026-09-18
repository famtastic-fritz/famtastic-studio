import { parseSourceHtml } from './strict-source-html.js';
import { digest } from './staging-store.js';

// This derives a shell reference from selected bytes, not an upstream template.
// The byte reference is the full unchanged selected document; assembly reads
// only its marked shell and explicitly chosen components using source offsets.
export function deriveSelectedShell(bytes) {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source).equals(bytes)) throw new Error('shell_utf8_required');
  const doc = parseSourceHtml(source);
  const unique = (tag, marker) => {
    const found = doc.nodes.filter(n => n.tag === tag && (!marker || n.attrs['data-template']?.value === marker));
    if (found.length !== 1) throw new Error('selected_shell_boundary_ambiguous');
    return found[0];
  };
  const header = unique('header', 'header'), footer = unique('footer', 'footer'), main = unique('main'), style = unique('style', 'shared');
  if ([header, footer, main].some(n => n.parent.tag !== 'body') || style.parent.tag !== 'head') throw new Error('selected_shell_boundary_ambiguous');
  return { schema: 'famtastic.selected-shell-derivation.v1', selected_sha256: digest(bytes), template_sha256: digest(bytes), original_template_received: false,
    shared: Object.fromEntries([['header', header], ['footer', footer], ['style', style]].map(([key, n]) => [key, { start: n.start, end: n.end, sha256: digest(source.slice(n.start, n.end)) }])),
    components: main.children.filter(n => n.attrs['data-section-id']).map(n => ({ id: n.attrs['data-section-id'].value, type: n.attrs['data-section-type']?.value || null,
      fields: doc.nodes.filter(f => f.start >= n.start && f.end <= n.end && f.attrs['data-field-type']?.value === 'text').map(f => ({ id: f.attrs['data-field-id']?.value, start: f.startTagEnd, end: f.endTagStart })) })) };
}
