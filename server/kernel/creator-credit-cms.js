import { creatorCreditRow, creatorLogoAsset } from '../../vendor/site-foundation/index.js';

// These adapters change newly authored template source, never installed CMS
// records or approved artifacts. Runtime installation remains a separate gate.
export function creditCmsTemplates(composed) {
  const assets = [...composed.assets];
  const logo = creatorLogoAsset();
  function add(asset) {
    const existing = assets.find(item => item.path === asset.path);
    if (!existing) assets.push(asset);
    else if (!Buffer.from(existing.contents).equals(Buffer.from(asset.contents))) throw new Error(`creator_credit_asset_conflict: ${asset.path}`);
  }
  function edit(file, transform) {
    const index = assets.findIndex(asset => asset.path === file);
    if (index < 0) throw new Error(`creator_credit_runtime_template_missing: ${file}`);
    assets[index] = { ...assets[index], contents: transform(assets[index].contents) };
  }
  if (composed.output_stack === 'drupal-cms') {
    const theme = 'web/themes/custom/famtastic_drupal';
    const row = creatorCreditRow().replace('src="assets/brand/famtastic-designs-logo-v1.png"', 'src="{{ base_path ~ directory }}/famtastic-designs-logo-v1.png"');
    edit(`${theme}/templates/page.html.twig`, source => source.includes(row) ? source : source.trimEnd() + '\n' + row + '\n');
    add({ path: `${theme}/famtastic-designs-logo-v1.png`, contents: logo.contents });
  } else if (composed.output_stack === 'wordpress-cms') {
    const theme = 'wp-content/themes/famtastic_wordpress';
    const row = creatorCreditRow().replace('src="assets/brand/famtastic-designs-logo-v1.png"', 'src="<?php echo esc_url( get_template_directory_uri() ); ?>/famtastic-designs-logo-v1.png"');
    edit(`${theme}/footer.php`, source => source.includes(row) ? source : source.replace('</body>', row + '\n</body>'));
    add({ path: `${theme}/famtastic-designs-logo-v1.png`, contents: logo.contents });
  } else if (['drupal-decoupled', 'wordpress-decoupled'].includes(composed.output_stack)) {
    const jsx = creatorCreditRow().replace(/style="([^"]+)"/g, (_, css) => {
      const styles = Object.fromEntries(css.split(';').filter(Boolean).map(rule => {
        const [key, value] = rule.split(':');
        return [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value];
      }));
      return `style={${JSON.stringify(styles)}}`;
    }).replace('src="assets/brand/famtastic-designs-logo-v1.png"', 'src={creatorLogo}').replace('></a></div>', ' /></a></div>');
    for (const app of ['frontend', 'client-portal']) {
      edit(`${app}/src/App.jsx`, source => source.includes('<CreatorCredit />') ? source : `import CreatorCredit from './CreatorCredit.jsx';\n` + source.replace(/(\s*<\/div>\s*\);\s*}\s*)$/, '\n      <CreatorCredit />$1'));
      add({ path: `${app}/src/CreatorCredit.jsx`, contents: `import React from 'react';\nimport creatorLogo from './famtastic-designs-logo-v1.png';\nexport default function CreatorCredit() { return (${jsx}); }\n` });
      add({ path: `${app}/src/famtastic-designs-logo-v1.png`, contents: logo.contents });
    }
  } else throw new Error('creator_credit_runtime_adapter_required');
  return { ...composed, assets };
}
