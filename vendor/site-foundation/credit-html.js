// Small read-only HTML structural scanner. Scripts, styles, comments and inert
// templates are never interpreted as credit markup. Browser geometry is a
// separate release proof: this scanner deliberately does not invent CSS layout.
const decode = text => String(text).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
const voids = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
export function creditNodes(html) {
  const nodes = [], stack = [];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let token;
  while ((token = tokens.exec(html))) {
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index >= 0) { for (const node of stack.splice(index)) node.end = tokens.lastIndex; }
      continue;
    }
    const attrs = {};
    const raw = token[0].slice(token[1].length + 1, -1);
    for (const match of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
    const node = { tag, attrs, start: token.index, end: tokens.lastIndex, parent: stack.at(-1) || null };
    if (['script', 'style', 'template', 'noscript'].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'gi'); close.lastIndex = tokens.lastIndex;
      const end = close.exec(html); if (end) tokens.lastIndex = close.lastIndex;
      continue;
    }
    nodes.push(node);
    if (!voids.has(tag) && !token[0].endsWith('/>')) stack.push(node);
  }
  return nodes;
}
function ancestry(node) { const out = []; for (let p = node.parent; p; p = p.parent) out.push(p); return out; }
export function creditLink(href) {
  try {
    const url = new URL(href);
    if (url.origin !== 'https://famtasticdesigns.com' || url.pathname !== '/' || url.username || url.password || url.hash) return false;
    if (!url.search) return true;
    const keys = [...url.searchParams.keys()];
    return keys.length === 3 && new Set(keys).size === 3 && /^[a-z0-9][a-z0-9-]{0,62}$/.test(url.searchParams.get('utm_source') || '') && url.searchParams.get('utm_medium') === 'creator_credit' && url.searchParams.get('utm_campaign') === 'created_by_famtastic';
  } catch { return false; }
}
export function semanticCredits(html) {
  const nodes = creditNodes(html), rows = [];
  for (const img of nodes.filter(node => node.tag === 'img')) {
    const parents = ancestry(img);
    if (parents.some(node => ['header', 'nav'].includes(node.tag))) continue;
    const link = parents.find(node => node.tag === 'a');
    if (!link || !creditLink(link.attrs.href)) continue;
    const name = link.attrs['aria-label'] || img.attrs.alt || '';
    if (!/famtastic\s+designs/i.test(name)) continue;
    const row = parents.find(node => ['div', 'section', 'p', 'footer'].includes(node.tag)) || link;
    if ([img, link, row, ...ancestry(row)].some(node => 'hidden' in node.attrs || node.attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$))/i.test(node.attrs.style || ''))) continue;
    const after = html.slice(row.end).replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/[a-z][^>]*>/gi, '').trim();
    const declared = 'data-famtastic-creator-credit' in row.attrs || 'data-fd-creator-credit' in row.attrs || /created|built|designed/i.test(name) || parents.some(node => node.tag === 'footer');
    if (!after || declared) rows.push({ img, link, row, final: !after });
  }
  return rows;
}
