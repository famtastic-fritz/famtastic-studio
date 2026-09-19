import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { semanticCredits, creditNodes } from './credit-html.js';

export const CREATOR_CREDIT_VERSION = '1.0.0';
export const CREATOR_LOGO_PATH = 'assets/brand/famtastic-designs-logo-v1.png';
export const CREATOR_LOGO_SHA256 = 'ebb0477344132d32e449ba19e2b622921585aa71af0decdbcf8abfbe033fa950';
const marker = 'data-famtastic-creator-credit="1"';
const fail = message => Object.assign(new Error(`creator_credit_required: ${message}`), { code: 'creator_credit_required' });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// This record is an audit reference, not an approval UI. Callers must obtain it
// from explicit owner instructions, never model output, customer input or tier.
export function ownerCreditException(record, siteId) {
  if (record == null) return false;
  if (record.approved_by !== 'Fritz Medine' || record.scope !== siteId || !siteId ||
      typeof record.approval_ref !== 'string' || !record.approval_ref.trim() ||
      typeof record.reason !== 'string' || !record.reason.trim()) throw fail('invalid explicit owner exception record');
  return true;
}

function pagePath(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+\.html?$/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw fail('unsafe HTML page path');
  return value;
}

export function creatorCreditRow({ page = 'index.html' } = {}) {
  const src = path.posix.relative(path.posix.dirname(pagePath(page)), CREATOR_LOGO_PATH);
  // Attribution is deliberately omitted by default. No scripts or cookies.
  return `<div ${marker} style="display:flex;justify-content:center;align-items:center;width:100%;box-sizing:border-box;padding:12px 16px;clear:both"><a href="https://famtasticdesigns.com/" aria-label="Created by FAMtastic Designs" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:8px 12px;box-sizing:border-box;background:#111111;border-radius:6px"><img src="${src}" alt="FAMtastic Designs" width="2172" height="724" style="display:block;width:clamp(160px,40vw,220px);max-width:100%;height:auto;object-fit:contain;filter:none;opacity:1;mix-blend-mode:normal"></a></div>`;
}

export function creatorLogoAsset() {
  const contents = fs.readFileSync(new URL('./famtastic-designs-logo-v1.png', import.meta.url));
  if (hash(contents) !== CREATOR_LOGO_SHA256) throw fail('approved logo bytes changed');
  return { path: CREATOR_LOGO_PATH, contents };
}

export function requireCreatorCreditHtml(html, options = {}) {
  if (ownerCreditException(options.owner_exception, options.site_id)) return;
  const rows = semanticCredits(String(html));
  if (rows.length !== 1 || !rows[0].final) throw fail(`${options.page || 'index.html'} needs exactly one accessible final creator row; preserve the old artifact and author a new version if absent or invalid`);
  const row = rows[0];
  const minimum = /min-height\s*:\s*([\d.]+)px/i.exec(row.link.attrs.style || '');
  if (minimum && Number(minimum[1]) < 44) throw fail('link target must be at least 44px');
  return row;
}

export function appendCreatorCredit(html, options = {}) {
  if (ownerCreditException(options.owner_exception, options.site_id)) return html;
  if (semanticCredits(String(html)).length || creditNodes(String(html)).some(node => 'data-famtastic-creator-credit' in node.attrs || 'data-fd-creator-credit' in node.attrs)) { requireCreatorCreditHtml(html, options); return html; }
  if ((String(html).match(/<\/body>/gi) || []).length !== 1) throw fail('one closing body is required');
  const result = html.replace(/<\/body>/i, `${creatorCreditRow(options)}\n</body>`);
  requireCreatorCreditHtml(result, options);
  return result;
}

// Pure validation: callers resolve an explicit publication allowlist first.
// Immutable transfer/export paths must reject missing credit, never patch it.
export function requireCreatorCreditFiles(files, options = {}) {
  if (ownerCreditException(options.owner_exception, options.site_id)) return;
  const pages = files.filter(f => /\.html?$/i.test(f.path));
  if (!pages.length) throw fail('no public HTML pages supplied');
  for (const page of pages) {
    const row = requireCreatorCreditHtml(String(page.contents), { ...options, page: page.path });
    let src;
    try {
      const base = options.public_base_path || '/';
      if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('invalid base');
      const url = new URL(row.img.attrs.src, 'https://artifact.invalid' + base + page.path);
      if (url.origin !== 'https://artifact.invalid' || !url.pathname.startsWith(base) || url.search || url.hash) throw new Error('not bundled');
      src = decodeURIComponent(url.pathname.slice(base.length));
    } catch { throw fail(`${page.path}: credit PNG must resolve within the explicit artifact public_base_path`); }
    const logo = files.find(f => f.path === src);
    if (!logo || hash(logo.contents) !== CREATOR_LOGO_SHA256) throw fail(`${page.path}: exact approved PNG must be bundled at ${src}`);
  }
}
