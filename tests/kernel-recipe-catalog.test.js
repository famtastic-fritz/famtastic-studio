import { describe, it, expect } from 'vitest';
import { RECIPE_CATALOG, RECIPE_CATEGORIES, listRecipes, getRecipe } from '../server/kernel/recipe-catalog.js';
import { composeSite } from '../server/kernel/compose.js';

describe('Recipe Catalog & Version Registry', () => {
  it('exports all standard categories and version 1.0.0 recipes', () => {
    expect(RECIPE_CATEGORIES).toEqual(['static', 'drupal', 'wordpress', 'application']);
    expect(RECIPE_CATALOG.length).toBe(9);

    for (const r of RECIPE_CATALOG) {
      expect(r.version).toBe('1.0.0');
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(Array.isArray(r.tiers)).toBe(true);
    }
  });

  it('filters recipes by category', () => {
    const staticRecipes = listRecipes('static');
    expect(staticRecipes.length).toBe(4);

    const drupalRecipes = listRecipes('drupal');
    expect(drupalRecipes.length).toBe(2);
    expect(drupalRecipes.map((r) => r.id)).toEqual(['drupal-standard-v1', 'drupal-decoupled-tri-tier-v1']);

    const wpRecipes = listRecipes('wordpress');
    expect(wpRecipes.length).toBe(2);
    expect(wpRecipes.map((r) => r.id)).toEqual(['wordpress-standard-v1', 'wordpress-decoupled-tri-tier-v1']);
  });

  it('retrieves individual recipe by id', () => {
    const r = getRecipe('drupal-decoupled-tri-tier-v1');
    expect(r).not.toBeNull();
    expect(r.tiers).toEqual(['backend', 'portal', 'frontend']);
    expect(r.custom_theme).toBe(true);
  });

  it('describes the Event Cinema application boundary without claiming brochure rebuild support', () => {
    const r = getRecipe('event-cinema-v1');
    expect(r).not.toBeNull();
    expect(r.category).toBe('application');
    expect(r.capability_class).toBe('application');
    expect(r.source_reference).toBe('sites/site-mbsh-reunion-event-cinema');
    expect(r.tiers).toEqual(['public', 'backend', 'portal', 'admin', 'commerce']);
    expect(r.capabilities).toEqual(expect.arrayContaining(['attendee-portal', 'media-moderation', 'commerce-ticketing']));
    expect(r.acceptance).toEqual(expect.arrayContaining(['authz-boundaries', 'form-and-endpoint-behavior', 'launch-receipts']));
  });
});

describe('CMS & Decoupled Tri-Tier Composers', () => {
  const baseSpec = {
    brand: { name: 'FAMtastic Blueprints' },
    tokens: { accent: '#3b82f6' },
    pages: [{ id: 'home', path: 'index.html', title: 'Home' }],
  };

  it('composes standard Drupal with custom theme and docker-compose', () => {
    const composed = composeSite({
      spec: { ...baseSpec, archetype: 'drupal-standard-v1' },
    });

    expect(composed.output_stack).toBe('drupal-cms');
    expect(composed.provider).toBe('drupal-standard');

    const assetPaths = composed.assets.map((a) => a.path);
    expect(assetPaths).toContain('web/themes/custom/famtastic_drupal/famtastic_drupal.info.yml');
    expect(assetPaths).toContain('web/themes/custom/famtastic_drupal/famtastic_drupal.libraries.yml');
    expect(assetPaths).toContain('web/themes/custom/famtastic_drupal/templates/page.html.twig');
    expect(assetPaths).toContain('web/themes/custom/famtastic_drupal/css/theme.css');
    expect(assetPaths).toContain('composer.json');
    expect(assetPaths).toContain('docker-compose.yml');
  });

  it('composes decoupled Drupal tri-tier with React portal and frontend', () => {
    const composed = composeSite({
      spec: { ...baseSpec, archetype: 'drupal-decoupled-tri-tier-v1' },
    });

    expect(composed.output_stack).toBe('drupal-decoupled');
    expect(composed.provider).toBe('drupal-decoupled');

    const assetPaths = composed.assets.map((a) => a.path);
    expect(assetPaths).toContain('package.json');
    expect(assetPaths).toContain('client-portal/src/App.jsx');
    expect(assetPaths).toContain('frontend/src/App.jsx');
    expect(assetPaths).toContain('backend/composer.json');
    expect(assetPaths).toContain('backend/web/themes/custom/headless_admin/headless_admin.info.yml');

    const rootPkg = JSON.parse(composed.assets.find((a) => a.path === 'package.json').contents);
    expect(rootPkg.scripts['dev:all']).toBeTruthy();
    expect(rootPkg.scripts['dev:frontend']).toBeTruthy();
    expect(rootPkg.scripts['dev:portal']).toBeTruthy();
  });

  it('composes standard WordPress with custom PHP theme and template hierarchy', () => {
    const composed = composeSite({
      spec: { ...baseSpec, archetype: 'wordpress-standard-v1' },
    });

    expect(composed.output_stack).toBe('wordpress-cms');
    expect(composed.provider).toBe('wordpress-standard');

    const assetPaths = composed.assets.map((a) => a.path);
    expect(assetPaths).toContain('wp-content/themes/famtastic_wordpress/style.css');
    expect(assetPaths).toContain('wp-content/themes/famtastic_wordpress/index.php');
    expect(assetPaths).toContain('wp-content/themes/famtastic_wordpress/functions.php');
    expect(assetPaths).toContain('wp-content/themes/famtastic_wordpress/header.php');
    expect(assetPaths).toContain('wp-content/themes/famtastic_wordpress/footer.php');
    expect(assetPaths).toContain('docker-compose.yml');
  });

  it('composes decoupled WordPress tri-tier with React attendee portal and cinema frontend', () => {
    const composed = composeSite({
      spec: { ...baseSpec, archetype: 'wordpress-decoupled-tri-tier-v1' },
    });

    expect(composed.output_stack).toBe('wordpress-decoupled');
    expect(composed.provider).toBe('wordpress-decoupled');

    const assetPaths = composed.assets.map((a) => a.path);
    expect(assetPaths).toContain('package.json');
    expect(assetPaths).toContain('client-portal/src/App.jsx');
    expect(assetPaths).toContain('frontend/src/App.jsx');
    expect(assetPaths).toContain('backend/wp-content/themes/headless_api/style.css');
    expect(assetPaths).toContain('backend/docker-compose.yml');
  });
});
