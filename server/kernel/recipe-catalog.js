// Recipe Catalog & Version Registry (v1.0.0)
// Central source of truth for Site Studio Next recipe blueprints:
// - Static Web Archetypes (Minimal, Standard Business, Lead Gen, Creator Portfolio)
// - Drupal CMS & Decoupled Tri-Tier Stacks (Monolith + Custom Theme vs Decoupled Backend/Portal/Frontend)
// - WordPress CMS & Decoupled Tri-Tier Stacks (Monolith + Custom Theme vs Decoupled Backend/Portal/Frontend)

export const RECIPE_CATEGORIES = ['static', 'drupal', 'wordpress'];

export const RECIPE_CATALOG = [
  // 1. Static Web Recipes
  {
    id: 'minimal-hello-world',
    name: 'Minimal Canvas',
    version: '1.0.0',
    category: 'static',
    archetype: 'minimal-static',
    tiers: ['frontend'],
    custom_theme: false,
    description: 'Clean single-page blank canvas with design tokens, ready for bespoke crafting.',
    pages: ['index.html'],
  },
  {
    id: 'standard-business',
    name: 'Standard Business Brochure',
    version: '1.0.0',
    category: 'static',
    archetype: 'business-brochure',
    tiers: ['frontend'],
    custom_theme: false,
    description: '3-page brochure site with Home, About Us, and Contact forms.',
    pages: ['index.html', 'about.html', 'contact.html'],
  },
  {
    id: 'lead-gen-landing',
    name: 'Lead Generation Landing',
    version: '1.0.0',
    category: 'static',
    archetype: 'lead-gen',
    tiers: ['frontend'],
    custom_theme: false,
    description: 'High-converting single-page landing with hero headline, social proof, and CTA inquiry form.',
    pages: ['index.html'],
  },
  {
    id: 'creator-portfolio',
    name: 'Creator & Agency Portfolio',
    version: '1.0.0',
    category: 'static',
    archetype: 'portfolio',
    tiers: ['frontend'],
    custom_theme: false,
    description: 'Multi-page creative showcase with Home, Selected Work gallery, and Project Inquiry.',
    pages: ['index.html', 'work.html', 'contact.html'],
  },

  // 2. Drupal CMS Recipes
  {
    id: 'drupal-standard-v1',
    name: 'Standard Drupal CMS',
    version: '1.0.0',
    category: 'drupal',
    archetype: 'drupal-monolith',
    tiers: ['monolith'],
    custom_theme: true,
    theme_name: 'famtastic_drupal',
    description: 'Full Drupal 10/11 installation with custom theme, Twig templates, Drush config, and Docker Compose.',
    pages: ['web/index.php', 'web/themes/custom/famtastic_drupal/famtastic_drupal.info.yml'],
  },
  {
    id: 'drupal-decoupled-tri-tier-v1',
    name: 'Decoupled Drupal Tri-Tier',
    version: '1.0.0',
    category: 'drupal',
    archetype: 'drupal-decoupled',
    tiers: ['backend', 'portal', 'frontend'],
    custom_theme: true,
    theme_name: 'famtastic_headless_admin',
    description: 'Tri-tier architecture (FAMtastic Designs pattern): Headless Drupal JSON:API backend + React Client Portal + React Marketing Frontend.',
    pages: ['backend/composer.json', 'client-portal/src/App.jsx', 'frontend/src/App.jsx'],
  },

  // 3. WordPress CMS Recipes
  {
    id: 'wordpress-standard-v1',
    name: 'Standard WordPress CMS',
    version: '1.0.0',
    category: 'wordpress',
    archetype: 'wordpress-monolith',
    tiers: ['monolith'],
    custom_theme: true,
    theme_name: 'famtastic_wordpress',
    description: 'Full WordPress installation with custom PHP theme, template hierarchy, wp-config, and Docker Compose.',
    pages: ['wp-content/themes/famtastic_wordpress/style.css', 'wp-content/themes/famtastic_wordpress/index.php'],
  },
  {
    id: 'wordpress-decoupled-tri-tier-v1',
    name: 'Decoupled WordPress Tri-Tier',
    version: '1.0.0',
    category: 'wordpress',
    archetype: 'wordpress-decoupled',
    tiers: ['backend', 'portal', 'frontend'],
    custom_theme: true,
    theme_name: 'famtastic_headless_starter',
    description: 'Tri-tier architecture (MBSH pattern): Headless WordPress REST/GraphQL backend + React Attendee Portal + React Public Cinema Frontend.',
    pages: ['backend/docker-compose.yml', 'client-portal/src/App.jsx', 'frontend/src/App.jsx'],
  },
];

export function listRecipes(category = null) {
  if (!category) return [...RECIPE_CATALOG];
  return RECIPE_CATALOG.filter((r) => r.category === category);
}

export function getRecipe(id) {
  return RECIPE_CATALOG.find((r) => r.id === id) || null;
}
