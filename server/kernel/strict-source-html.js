// A deliberately restricted HTML parser with source offsets. No browser repair,
// implicit end tags or serialization: ambiguous source is outside this recipe.
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const forbidden = new Set('script form iframe object embed base textarea select option template noscript'.split(' '));
const allowed = new Set('html head body title meta link style header footer main nav section article aside div span p h1 h2 h3 h4 h5 h6 a ul ol li dl dt dd strong em b i small br hr img input label figure figcaption blockquote address time'.split(' '));
const blockTags = new Set('div section article header footer main nav p h1 h2 h3 h4 h5 h6 ul ol li'.split(' '));
const fail = code => { throw Object.assign(new Error(code), { code, permanent: true }); };
export function safeSourceUrl(value) {
  if (!value || /[\s&\\<>\u0000-\u001f]/.test(value) || value.startsWith('//')) return false;
  if (/^(?:https:|mailto:|tel:)/i.test(value)) {
    try { const url = new URL(value); return !url.username && !url.password; } catch { return false; }
  }
  return /^#[A-Za-z0-9_:-]+$/.test(value) || /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+(?:#[A-Za-z0-9_:-]+)?$/.test(value) && !value.includes('..');
}
function attributes(source, from, end) {
  const attrs = {}; let i = from;
  while (i < end) {
    while (/\s/.test(source[i] || '') && i < end) i++;
    if (i === end) break;
    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(source.slice(i, end));
    if (!nameMatch) fail('shell_attribute_malformed');
    const name = nameMatch[0].toLowerCase(); i += nameMatch[0].length;
    if (name in attrs || name.startsWith('on')) fail('shell_attribute_unsafe');
    while (i < end && /\s/.test(source[i])) i++;
    let value = '', valueStart = i, valueEnd = i;
    if (source[i] === '=') {
      i++; while (i < end && /\s/.test(source[i])) i++;
      const quote = source[i];
      if (quote !== '"' && quote !== "'") fail('shell_attribute_requires_quotes');
      valueStart = ++i;
      while (i < end && source[i] !== quote) i++;
      if (i >= end) fail('shell_attribute_malformed');
      valueEnd = i; value = source.slice(valueStart, valueEnd); i++;
    }
    attrs[name] = { value, start: valueStart, end: valueEnd };
    if (['href', 'src', 'action', 'poster', 'xlink:href', 'formaction'].includes(name) && !safeSourceUrl(value)) fail('shell_url_unsafe');
    if (['srcdoc', 'srcset', 'form', 'contenteditable', 'background', 'ping', 'dynsrc', 'lowsrc', 'manifest'].includes(name)) fail('shell_attribute_unsupported');
    if (name === 'style') checkCss(value);
  }
  return attrs;
}
function checkCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/[\\<>&]|@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) fail('shell_css_unsafe');
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!safeSourceUrl(match[2]) || /^[A-Za-z]+:/.test(match[2])) fail('shell_url_unsafe');
}
export function parseSourceHtml(source) {
  const root = { tag: '#document', children: [], start: 0, end: source.length }, stack = [root], nodes = [];
  const identities = new Map(); let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') { i++; continue; }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4); if (end < 0) fail('shell_comment_malformed'); i = end + 3; continue;
    }
    const doctype = /^<!doctype html\s*>/i.exec(source.slice(i));
    if (doctype) { if (nodes.length) fail('shell_doctype_malformed'); i += doctype[0].length; continue; }
    const start = i;
    const tagMatch = /^<(\/)?([A-Za-z][A-Za-z0-9-]*)\b/.exec(source.slice(i));
    if (!tagMatch) fail('shell_markup_malformed');
    const closing = Boolean(tagMatch[1]), tag = tagMatch[2].toLowerCase();
    i += tagMatch[0].length; const attrsStart = i;
    let quote = null;
    for (; i < source.length; i++) {
      if (quote) { if (source[i] === quote) quote = null; }
      else if (source[i] === '"' || source[i] === "'") quote = source[i];
      else if (source[i] === '>') break;
    }
    if (i === source.length) fail('shell_markup_malformed');
    const end = i + 1;
    if (closing) {
      if (source.slice(attrsStart, i).trim() || stack.length === 1 || stack.at(-1).tag !== tag) fail('shell_nesting_ambiguous');
      const node = stack.pop(); node.endTagStart = start; node.end = end;
      i = end; continue;
    }
    if (forbidden.has(tag)) fail('shell_active_content_unsupported');
    if (!allowed.has(tag)) fail('shell_element_unsupported');
    const selfClosing = source[i - 1] === '/';
    if (selfClosing && !voidTags.has(tag)) fail('shell_nesting_ambiguous');
    const attrs = attributes(source, attrsStart, selfClosing ? i - 1 : i);
    if (['meta', 'link', 'title', 'style'].includes(tag) && stack.at(-1).tag !== 'head') fail('shell_head_metadata_unsupported');
    if (['src', 'poster'].some(key => attrs[key] && /^[A-Za-z]+:/.test(attrs[key].value)) || tag === 'link' && /^[A-Za-z]+:/.test(attrs.href?.value || '')) fail('shell_external_resource_unsupported');
    if (tag === 'input' && (attrs.type?.value !== 'checkbox' || !stack.some(n => n.tag === 'header'))) fail('shell_component_control_unsupported');
    if (stack.some(n => n.tag === 'p') && blockTags.has(tag) || tag === 'a' && stack.some(n => n.tag === 'a')) fail('shell_nesting_ambiguous');
    if (/^h[1-6]$/.test(tag) && stack.some(n => /^h[1-6]$/.test(n.tag)) || tag === 'li' && !['ul', 'ol'].includes(stack.at(-1).tag) || ['dt', 'dd'].includes(tag) && stack.at(-1).tag !== 'dl') fail('shell_nesting_ambiguous');
    if (['input', 'button'].includes(tag) && stack.some(n => n.tag === 'main')) fail('shell_component_control_unsupported');
    const node = { tag, attrs, parent: stack.at(-1), children: [], start, startTagEnd: end, endTagStart: end, end };
    for (const key of ['id', 'data-field-id', 'data-section-id']) if (attrs[key]) {
      const value = attrs[key].value;
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) || identities.has(`${key}:${value}`)) fail('shell_identity_ambiguous');
      identities.set(`${key}:${value}`, node);
    }
    if (attrs['data-field-type'] && !['text', 'link', 'image', 'phone', 'email', 'address', 'testimonial'].includes(attrs['data-field-type'].value)) fail('shell_field_type_unsupported');
    node.parent.children.push(node); nodes.push(node);
    i = end;
    if (tag === 'style') {
      const match = /<\/style\s*>/ig; match.lastIndex = i;
      const close = match.exec(source); if (!close) fail('shell_nesting_ambiguous');
      checkCss(source.slice(i, close.index)); node.endTagStart = close.index; node.end = match.lastIndex; i = node.end;
    } else if (!voidTags.has(tag)) stack.push(node);
  }
  if (stack.length !== 1) fail('shell_nesting_ambiguous');
  for (const tag of ['html', 'head', 'body']) if (nodes.filter(n => n.tag === tag).length !== 1) fail('shell_document_ambiguous');
  const html = nodes.find(n => n.tag === 'html'), head = nodes.find(n => n.tag === 'head'), body = nodes.find(n => n.tag === 'body');
  if (root.children.length !== 1 || html.children.length !== 2 || html.parent !== root || head.parent !== html || body.parent !== html || head.start > body.start
    || source.slice(0, html.start).replace(/<!doctype html\s*>|<!--[\s\S]*?-->/ig, '').trim() || source.slice(html.end).trim()) fail('shell_document_ambiguous');
  return { root, nodes, byId: identities, source };
}
