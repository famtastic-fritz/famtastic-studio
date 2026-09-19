import { describe, it, expect } from 'vitest';
import { composeSite } from '../server/kernel/compose.js';
import { creditComposition } from '../server/kernel/creator-credit.js';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { creatorLogoAsset, requireCreatorCreditFiles } from '../vendor/site-foundation/index.js';

const spec = { brand: { name: 'Fixture' }, pages: [{ id: 'home', path: 'index.html', title: 'Fixture', sections: [] }] };
describe('creator credit across authorship and immutable transfer', () => {
  it('credits every authored page, including 404, once and allowlists exact PNG', () => {
    const result = composeSite({ spec });
    const files = [...result.pages.map(p => ({ path: p.path, contents: p.html })), ...result.assets];
    requireCreatorCreditFiles(files);
    expect(creditComposition(result)).toEqual(result);
    expect(JSON.parse(result.assets.find(a => a.path === '.famtastic/public-files.json').contents).files).toContain(creatorLogoAsset().path);
    expect(result.pages[0].html).toContain('<p>Fixture</p>');
  });
  it('preserves credited bytes and derives an uncredited old selection without modifying its original', () => {
    const authored = composeSite({ spec });
    const files = [...authored.pages.map(p => ({ path: p.path, contents: p.html })), ...authored.assets.filter(a => a.path === creatorLogoAsset().path).map(a => ({ path: a.path, bytes: a.contents }))];
    const bundle = createArtifactBundle(files);
    const before = JSON.stringify(bundle);
    const result = composeSite({ spec: { ...spec, artifact_bundle: bundle }, composer: 'artifact' });
    expect(result.pages[0].html).toBe(authored.pages[0].html);
    expect(result.assets[0].contents).toEqual(creatorLogoAsset().contents);
    expect(JSON.stringify(bundle)).toBe(before);
    const old = createArtifactBundle([{ path: 'index.html', contents: '<html><body>Historical</body></html>' }]);
    const original = JSON.stringify(old);
    const derived = composeSite({ spec: { ...spec, artifact_bundle: old }, composer: 'artifact' });
    expect(JSON.stringify(old)).toBe(original);
    expect(derived.pages[0].html).toContain('Historical');
    expect(derived.creator_credit_transform.changed_pages).toHaveLength(1);
    expect(derived.creator_credit_transform.original_approval_unchanged).toBe(true);
    expect(derived.creator_credit_transform.financial_auth_customer_state_changed).toBe(false);
    expect(derived.creator_credit_transform.original_inventory_sha256).not.toBe(derived.creator_credit_transform.derived_inventory_sha256);
  });
  it('refuses an unknown runtime rather than crediting only its preview', () => {
    expect(() => creditComposition({ pages: [], assets: [], output_stack: 'unknown-cms' })).toThrow(/runtime_adapter_required/);
  });
  it('does not overwrite conflicting PNG bytes or pretend a missing referenced asset exists', () => {
    const uncredited = createArtifactBundle([
      { path: 'index.html', contents: '<html><body><h1>Old selected page</h1></body></html>' },
      { path: creatorLogoAsset().path, contents: 'existing conflicting customer bytes' },
    ]);
    const original = JSON.stringify(uncredited);
    expect(() => composeSite({ spec: { ...spec, artifact_bundle: uncredited }, composer: 'artifact' })).toThrow(/asset_conflict/);
    expect(JSON.stringify(uncredited)).toBe(original);
    const compliant = composeSite({ spec });
    const missing = createArtifactBundle(compliant.pages.map(p => ({ path: p.path, contents: p.html })));
    expect(() => composeSite({ spec: { ...spec, artifact_bundle: missing }, composer: 'artifact' })).toThrow(/exact approved PNG must be bundled/);
  });
  it('credits CMS template sources and each React app without changing customer state', () => {
    for (const recipe of ['drupal-standard-v1', 'wordpress-standard-v1', 'drupal-decoupled-tri-tier-v1', 'wordpress-decoupled-tri-tier-v1']) {
      const result = composeSite({ spec: { ...spec, recipe } });
      const templates = result.assets.filter(a => /page.html.twig$|footer.php$|CreatorCredit.jsx$/.test(a.path));
      expect(templates.length).toBe(recipe.includes('decoupled') ? 2 : 1);
      for (const template of templates) expect(template.contents).toContain('Created by FAMtastic Designs');
      for (const app of result.assets.filter(a => a.path.endsWith('/App.jsx'))) expect(app.contents).toContain('<CreatorCredit />');
      const again = creditComposition(result);
      expect(again.assets.map(a => a.path)).toEqual(result.assets.map(a => a.path));
      for (const template of templates) expect(again.assets.find(a => a.path === template.path).contents).toBe(template.contents);
    }
  });
});
