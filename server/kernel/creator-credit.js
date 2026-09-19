import { appendCreatorCredit, creatorLogoAsset, CREATOR_LOGO_PATH, requireCreatorCreditFiles } from '../../vendor/site-foundation/index.js';
import { creditCmsTemplates } from './creator-credit-cms.js';
import { deriveCreatorCreditArtifact } from './creator-credit-transform.js';

// One finalization pass, after composition and before DNA hashing. No second
// build, external call, alternate builder identity or tier branch.
export function creditComposition(composed, { immutable = false, public_base_path = '/' } = {}) {
  const files = [
    ...composed.pages.map(page => ({ path: page.path, contents: page.html })),
    ...composed.assets,
  ];
  if (immutable) {
    try { requireCreatorCreditFiles(files, { public_base_path }); return composed; }
    catch (originalError) {
      return deriveCreatorCreditArtifact(composed, { public_base_path, originalError });
    }
  }
  if (!['html-css', undefined].includes(composed.output_stack)) {
    composed = creditCmsTemplates(composed);
  }
  const pages = composed.pages.map(page => ({ ...page, html: appendCreatorCredit(page.html, { page: page.path }) }));
  const assets = composed.assets.filter(asset => asset.path !== CREATOR_LOGO_PATH).map(asset => {
    if (/\.html?$/i.test(asset.path)) return { ...asset, contents: appendCreatorCredit(String(asset.contents), { page: asset.path }) };
    if (asset.path === '.famtastic/public-files.json') {
      const config = JSON.parse(asset.contents);
      const listed = Array.isArray(config) ? config : config.files;
      const files = [...new Set([...listed, CREATOR_LOGO_PATH])];
      return { ...asset, contents: JSON.stringify(Array.isArray(config) ? files : { ...config, files }, null, 2) + '\n' };
    }
    return asset;
  });
  assets.push(creatorLogoAsset());
  requireCreatorCreditFiles([...pages.map(page => ({ path: page.path, contents: page.html })), ...assets]);
  return { ...composed, pages, assets };
}
