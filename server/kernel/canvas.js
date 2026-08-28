// Canvas click-to-edit kernel (Phase 2 contract section 1, BINDING).
//
// serve(): reads a page's raw bytes and stamps every editable text-leaf
// element with a server-generated, deterministic `data-fam-sel` (and
// `data-fam-path`) selector. The selector is a structural path from the
// document root (tag[nth-of-type] per ancestor), so it is reproducible by
// re-parsing the same bytes later -- nothing about it is stored, guessed in
// the browser, or dependent on the instrumented copy.
//
// applyEdit(): re-parses the CURRENT bytes on disk (never the instrumented
// copy, never client-trusted positions), locates the element the selector
// names, and refuses with 409 stale_selection unless its live text still
// matches before_text exactly. Only then does it build the new bytes and
// hand them to mutation.apply() so the edit is journaled before it is
// visible. applied_ms is measured server-side from the moment this function
// is entered to the moment the journal commit returns.
//
// Text content edits only (M2 scope): structural changes, image
// replacement, and multi-element commits are out of scope and are never
// attempted here.
import fs from 'node:fs';
import path from 'node:path';
import { createMutation } from './mutation.js';

function fail(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
// Elements whose content is not prose text an operator should click-edit:
// executable/opaque payloads (script/style/template) and form controls whose
// visible value is not their text content (textarea).
// 'head' and 'title' are skipped because head content is not clickable on the
// canvas: instrumenting it advertises an edit the operator can never perform.
// Editing page metadata belongs to the Spec and SEO surfaces, not the canvas.
const SKIP_ELEMENTS = new Set(['script', 'style', 'template', 'textarea', 'noscript', 'head', 'title']);

// Real marketing copy leans on these constantly (em/en dashes, curly quotes,
// ellipses). The original five-entry map only covered markup-syntax
// characters, which was invisible until a real site's text needed to round-
// trip: applyEdit() below compares this decode of the live bytes on disk
// against before_text the CLIENT sent (already decoded correctly by the
// browser's own DOM). A page containing "&mdash;" would decode to the
// literal six characters here while the client held a real em dash, so the
// comparison would never match -- every edit on a page with an em dash,
// curly quote, or ellipsis would 409 as falsely stale, forever, with no
// actual conflict. Exported so the importer (which parses the same raw
// bytes for the same reason) uses this exact map rather than a second one
// that could drift out of sync with it.
export const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0',
  bull: '\u2022', middot: '\u00b7', times: '\u00d7',
};

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref) => {
    if (ref[0] === '#') {
      const isHex = ref[1] === 'x' || ref[1] === 'X';
      const code = parseInt(isHex ? ref.slice(2) : ref.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ref in ENTITY_MAP ? ENTITY_MAP[ref] : whole;
  });
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Attribute values only strictly need `&` and the enclosing quote character
// escaped (HTML5 attribute-value syntax permits bare `<`/`>`); selectors use
// `>` as a path separator, so escaping it here would make every stamped
// selector diverge from the plain string parseLeaves() produces.
function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Hand-rolled tokenizer: no HTML parsing dependency is available in this
// tree (CONVENTIONS.md: zero build step, no framework), and text-leaf
// detection only needs tag boundaries, not a full DOM. Tolerates malformed
// markup (stray/mismatched close tags) by ignoring what it cannot match
// rather than throwing, since the input is a real site page, not a fixture.
function tokenize(html) {
  const tokens = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const gt = html.indexOf('>', lt);
      i = gt === -1 ? len : gt + 1;
      continue;
    }
    let j = lt + 1;
    let closing = false;
    if (html[j] === '/') { closing = true; j += 1; }
    const nameStart = j;
    while (j < len && /[a-zA-Z0-9-]/.test(html[j])) j += 1;
    const tag = html.slice(nameStart, j).toLowerCase();
    if (!tag) { i = lt + 1; continue; }
    let k = j;
    let quote = null;
    while (k < len) {
      const c = html[k];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      k += 1;
    }
    const gt = k;
    const selfClosing = html[gt - 1] === '/';
    if (closing) {
      tokens.push({ type: 'close', tag, start: lt, end: gt + 1 });
    } else if (selfClosing || VOID_ELEMENTS.has(tag)) {
      tokens.push({ type: 'void', tag, start: lt, end: gt + 1 });
    } else {
      tokens.push({ type: 'open', tag, start: lt, end: gt + 1, attrsEnd: gt });
    }
    i = gt + 1;
  }
  return tokens;
}

function nextIndex(counts, tag) {
  const n = (counts.get(tag) || 0) + 1;
  counts.set(tag, n);
  return n;
}

// Parses `html` into the flat list of editable text-leaf elements: elements
// whose entire content, between their own open and close tags, is text with
// no nested element children. Each leaf's `selector` is a deterministic path
// of `tag[nth-of-type-within-parent]` segments from the document root, so
// running this same function again over the same bytes always yields the
// same selector for the same element.
export function parseLeaves(html) {
  const tokens = tokenize(html);
  const rootCounts = new Map();
  const stack = [];
  const leaves = [];

  for (const tok of tokens) {
    if (tok.type === 'open') {
      const parent = stack[stack.length - 1];
      const counts = parent ? parent.childCounts : rootCounts;
      const nth = nextIndex(counts, tok.tag);
      const path = parent ? [...parent.path, `${tok.tag}[${nth}]`] : [`${tok.tag}[${nth}]`];
      if (parent) parent.hasElementChild = true;
      stack.push({
        tag: tok.tag,
        childCounts: new Map(),
        hasElementChild: false,
        textStart: tok.end,
        path,
        skip: SKIP_ELEMENTS.has(tok.tag) || Boolean(parent && parent.skip),
        attrsEnd: tok.attrsEnd,
      });
    } else if (tok.type === 'void') {
      const parent = stack[stack.length - 1];
      const counts = parent ? parent.childCounts : rootCounts;
      nextIndex(counts, tok.tag);
      if (parent) parent.hasElementChild = true;
    } else if (tok.type === 'close') {
      let idx = -1;
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s].tag === tok.tag) { idx = s; break; }
      }
      if (idx === -1) continue; // stray close tag with no matching open: ignore
      while (stack.length - 1 > idx) stack.pop(); // tolerate unclosed descendants
      const frame = stack.pop();
      if (!frame.hasElementChild && !frame.skip) {
        const raw = html.slice(frame.textStart, tok.start);
        if (raw.trim().length > 0) {
          leaves.push({
            tag: frame.tag,
            selector: frame.path.join('>'),
            attrsEnd: frame.attrsEnd,
            textStart: frame.textStart,
            textEnd: tok.start,
          });
        }
      }
    }
  }
  return leaves;
}

function findLeaf(html, selector) {
  return parseLeaves(html).find((leaf) => leaf.selector === selector) || null;
}

// Trims a text span without discarding the surrounding whitespace bytes, so
// an edit can replace only the meaningful inner text and leave original
// indentation/formatting around it untouched.
function trimSpan(text) {
  const leading = text.match(/^\s*/)[0].length;
  const trailing = text.match(/\s*$/)[0].length;
  return { leading, trailing, inner: text.slice(leading, text.length - trailing) };
}

function findLocalAsset(paths, siteId, pagePath, refPath) {
  if (!paths || !refPath || typeof refPath !== 'string') return null;
  const clean = refPath.split(/[?#]/)[0].trim();
  if (!clean || clean.startsWith('http:') || clean.startsWith('https:') || clean.startsWith('//') || clean.startsWith('data:') || clean.startsWith('#')) {
    return null;
  }
  let siteAbs;
  let pageAbs;
  try {
    const { rootName, dir } = paths.resolveSite(siteId);
    siteAbs = dir;
    pageAbs = paths.within(rootName, siteId, pagePath);
  } catch {
    return null;
  }
  const pageDir = path.dirname(pageAbs);

  const candidates = [
    path.resolve(pageDir, clean),
    path.resolve(siteAbs, clean.replace(/^\//, '')),
    path.resolve(siteAbs, 'frontend', clean.replace(/^\//, '')),
    path.resolve(siteAbs, 'dist', clean.replace(/^\//, '')),
    path.resolve(siteAbs, 'public', clean.replace(/^\//, '')),
  ];

  for (const cand of candidates) {
    if (cand.startsWith(siteAbs) && fs.existsSync(cand)) {
      try {
        if (!fs.statSync(cand).isDirectory()) {
          return { abs: cand, relToSite: path.relative(siteAbs, cand) };
        }
      } catch {}
    }
  }
  return null;
}

function inlineStylesheets(html, siteId, pagePath, paths) {
  if (!paths) return html;
  return html.replace(/<link\b([^>]*)\/?>/gi, (match, attrsStr) => {
    const isStylesheet = /\brel\s*=\s*["']?stylesheet["']?/i.test(attrsStr);
    if (!isStylesheet) return match;
    const hrefMatch = attrsStr.match(/\bhref\s*=\s*["']([^"']+)["']/i) || attrsStr.match(/\bhref\s*=\s*([^\s>]+)/i);
    if (!hrefMatch) return match;
    const rawHref = hrefMatch[1];
    const asset = findLocalAsset(paths, siteId, pagePath, rawHref);
    if (!asset) return match;

    try {
      let css = fs.readFileSync(asset.abs, 'utf8');
      const cssDir = path.dirname(asset.abs);
      const { dir: siteAbs } = paths.resolveSite(siteId);
      css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (urlMatch, quote, urlRef) => {
        const trimmed = urlRef.split(/[?#]/)[0].trim();
        if (!trimmed || trimmed.startsWith('http:') || trimmed.startsWith('https:') || trimmed.startsWith('//') || trimmed.startsWith('data:') || trimmed.startsWith('#')) {
          return urlMatch;
        }
        const cand = path.resolve(cssDir, trimmed);
        if (cand.startsWith(siteAbs) && fs.existsSync(cand)) {
          try {
            if (!fs.statSync(cand).isDirectory()) {
              const rel = path.relative(siteAbs, cand);
              return `url('/api/sites/asset?site_id=${encodeURIComponent(siteId)}&path=${encodeURIComponent(rel)}')`;
            }
          } catch {}
        }
        return urlMatch;
      });
      return `<style data-fam-href="${escapeAttr(rawHref)}">\n${css}\n</style>`;
    } catch {
      return match;
    }
  });
}

function rewriteAssetUrls(html, siteId, pagePath, paths) {
  if (!paths) return html;
  return html.replace(/\b(src|poster|data-src)\s*=\s*(["'])([^"']+)\2/gi, (match, attrName, quote, refUrl) => {
    const trimmed = refUrl.split(/[?#]/)[0].trim();
    if (!trimmed || trimmed.startsWith('http:') || trimmed.startsWith('https:') || trimmed.startsWith('//') || trimmed.startsWith('data:') || trimmed.startsWith('#') || trimmed.startsWith('/api/')) {
      return match;
    }
    const asset = findLocalAsset(paths, siteId, pagePath, trimmed);
    if (asset) {
      return `${attrName}=${quote}/api/sites/asset?site_id=${encodeURIComponent(siteId)}&path=${encodeURIComponent(asset.relToSite)}${quote}`;
    }
    return match;
  });
}

function instrumentHtml(html, siteId, pagePath, paths) {
  const leaves = parseLeaves(html);
  const sorted = [...leaves].sort((a, b) => b.attrsEnd - a.attrsEnd);
  let out = html;
  for (const leaf of sorted) {
    const insertion = ` data-fam-sel="${escapeAttr(leaf.selector)}" data-fam-path="${escapeAttr(pagePath)}"`;
    out = out.slice(0, leaf.attrsEnd) + insertion + out.slice(leaf.attrsEnd);
  }
  if (paths) {
    out = inlineStylesheets(out, siteId, pagePath, paths);
    out = rewriteAssetUrls(out, siteId, pagePath, paths);
  }
  // The injected client script needs site_id/page_path to call the edit API;
  // it reads them from this meta tag rather than a query string on its own
  // src, since the script is a static shared file, not per-page.
  const meta = `\n<meta name="fam-site-id" content="${escapeAttr(siteId)}">\n<meta name="fam-page-path" content="${escapeAttr(pagePath)}">\n<script src="/kit/canvas-edit.js"></script>\n`;
  const bodyClose = out.lastIndexOf('</body>');
  return bodyClose === -1 ? out + meta : out.slice(0, bodyClose) + meta + out.slice(bodyClose);
}

function resolvePagePath(paths, siteId, pagePath) {
  if (typeof pagePath !== 'string' || !pagePath.trim()) {
    throw fail(400, 'page_path_required', 'page_path is required');
  }
  // THE SEAM. A real portfolio site's pages live under its own root, not the
  // studio one; resolveSite() finds it via the portfolio scan (or throws a
  // real 404, since serving a page is a read, not a creation).
  const { rootName } = paths.resolveSite(siteId);
  try {
    return paths.within(rootName, siteId, pagePath);
  } catch {
    throw fail(400, 'invalid_page_path', `page path escapes the site directory: ${pagePath}`);
  }
}

export function createCanvas({ paths, journal, events }) {
  const mutation = createMutation({ paths, journal, events });

  function serve(siteId, pagePath) {
    const abs = resolvePagePath(paths, siteId, pagePath);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      throw fail(404, 'page_not_found', `page not found: ${pagePath}`);
    }
    const html = fs.readFileSync(abs, 'utf8');
    return instrumentHtml(html, siteId, pagePath, paths);
  }

  function applyEdit({ site_id, page_path, selector, before_text, after_text, expectedRevision, initiator = 'canvas' } = {}) {
    const startedAt = process.hrtime.bigint();
    if (!site_id) throw fail(400, 'identity_required', 'applyEdit requires site_id');
    if (typeof selector !== 'string' || !selector.trim()) {
      throw fail(400, 'selector_required', 'applyEdit requires a selector');
    }
    if (typeof before_text !== 'string') throw fail(400, 'before_text_required', 'applyEdit requires before_text');
    if (typeof after_text !== 'string') throw fail(400, 'after_text_required', 'applyEdit requires after_text');

    const abs = resolvePagePath(paths, site_id, page_path);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      throw fail(404, 'page_not_found', `page not found: ${page_path}`);
    }
    const html = fs.readFileSync(abs, 'utf8');
    const leaf = findLeaf(html, selector);
    if (!leaf) {
      throw fail(409, 'stale_selection', `selector no longer resolves to an element: ${selector}`);
    }

    const raw = html.slice(leaf.textStart, leaf.textEnd);
    const { leading, trailing, inner } = trimSpan(raw);
    const liveText = decodeEntities(inner);
    if (liveText !== before_text) {
      throw fail(409, 'stale_selection', 'the element text on disk no longer matches before_text', {
        selector,
        live_text: liveText,
      });
    }

    const newInner = escapeText(after_text);
    const newRaw = raw.slice(0, leading) + newInner + raw.slice(raw.length - trailing);
    const newHtml = html.slice(0, leaf.textStart) + newRaw + html.slice(leaf.textEnd);

    const result = mutation.apply({
      site_id,
      initiator,
      intent: 'canvas.edit',
      changes: [{ path: page_path, contents: newHtml }],
      expectedRevision,
    });

    const applied_ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { ...result, applied_ms };
  }

  return { serve, applyEdit };
}
