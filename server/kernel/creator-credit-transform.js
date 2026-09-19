import crypto from 'node:crypto';
import { appendCreatorCredit, creatorLogoAsset, CREATOR_LOGO_PATH, requireCreatorCreditFiles } from '../../vendor/site-foundation/index.js';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Explicit global owner mandate authorizes this presentation-only derivative.
// Original selected bundle, approval hashes and financial state are untouched.
export function deriveCreatorCreditArtifact(composed, { public_base_path = '/', originalError } = {}) {
  const changes = [];
  function author(html, page) {
    const next = appendCreatorCredit(html, { page });
    if (next !== html) changes.push({ path: page, before_sha256: digest(html), after_sha256: digest(next) });
    return next;
  }
  const pages = composed.pages.map(page => ({ ...page, html: author(page.html, page.path) }));
  let assets = composed.assets.map(asset => /\.html?$/i.test(asset.path) ? { ...asset, contents: author(String(asset.contents), asset.path) } : asset);
  if (!changes.length) throw originalError; // Existing invalid/missing asset needs an explicit repair.
  const logo = creatorLogoAsset();
  const existing = assets.find(asset => asset.path === CREATOR_LOGO_PATH);
  if (existing && !Buffer.from(existing.contents).equals(logo.contents)) throw new Error('creator_credit_asset_conflict: preserve existing bytes for explicit repair');
  if (!existing) assets = [...assets, logo];
  assets = assets.map(asset => {
    if (asset.path !== '.famtastic/public-files.json') return asset;
    const config = JSON.parse(asset.contents), list = Array.isArray(config) ? config : config.files;
    const files = [...new Set([...list, CREATOR_LOGO_PATH])];
    return { ...asset, contents: JSON.stringify(Array.isArray(config) ? files : { ...config, files }, null, 2) + '\n' };
  });
  const before = [...composed.pages.map(p => ({ path: p.path, sha256: digest(p.html) })), ...composed.assets.map(a => ({ path: a.path, sha256: digest(a.contents) }))];
  const after = [...pages.map(p => ({ path: p.path, sha256: digest(p.html) })), ...assets.map(a => ({ path: a.path, sha256: digest(a.contents) }))];
  requireCreatorCreditFiles([...pages.map(p => ({ path: p.path, contents: p.html })), ...assets], { public_base_path });
  const receipt = { schema_version: 1, kind: 'owner_authorized_creator_credit_derivative', authorization: 'Fritz Medine universal creator-credit mandate 2026-09-18', transformation: 'append missing final credit row and bundle exact PNG; no page regeneration', original_files: before, derived_files: after, changed_pages: changes,
    original_inventory_sha256: digest(JSON.stringify(before)), derived_inventory_sha256: digest(JSON.stringify(after)),
    original_approval_unchanged: true, customer_acceptance_changed: false, financial_auth_customer_state_changed: false, publication_authorized: false };
  if (assets.some(a => a.path === '.famtastic/creator-credit-transform.json')) throw new Error('creator_credit_transform_receipt_conflict');
  assets.push({ path: '.famtastic/creator-credit-transform.json', contents: JSON.stringify(receipt, null, 2) + '\n' });
  return { ...composed, pages, assets, creator_credit_transform: receipt };
}
