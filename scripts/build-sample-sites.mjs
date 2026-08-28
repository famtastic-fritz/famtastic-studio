import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createPaths } from '../server/kernel/paths.js';
import { composeSite } from '../server/kernel/compose.js';

const paths = createPaths();
const sitesDir = '/Users/famtastic-fritz/Development/FAMtastic/sites';

const SAMPLES = [
  {
    site_id: 'site-drupal-standard-sample',
    brand: { name: 'Apex Logistics Drupal' },
    recipe: 'drupal-standard-v1',
    description: 'Standard Drupal 10/11 CMS with custom theme famtastic_drupal',
  },
  {
    site_id: 'site-drupal-decoupled-sample',
    brand: { name: 'Apex Studio Decoupled Drupal' },
    recipe: 'drupal-decoupled-tri-tier-v1',
    description: 'Tri-Tier Architecture: Headless Drupal + React Client Portal + React Frontend',
  },
  {
    site_id: 'site-wordpress-standard-sample',
    brand: { name: 'Beacon Creative WordPress' },
    recipe: 'wordpress-standard-v1',
    description: 'Standard WordPress CMS with custom theme famtastic_wordpress',
  },
  {
    site_id: 'site-wordpress-decoupled-sample',
    brand: { name: 'Beacon Events Decoupled WP' },
    recipe: 'wordpress-decoupled-tri-tier-v1',
    description: 'Tri-Tier Architecture: Headless WordPress + React Attendee Portal + React Frontend',
  },
];

console.log('Building 4 sample CMS & Decoupled sites...');

for (const sample of SAMPLES) {
  const targetDir = path.join(sitesDir, sample.site_id);
  fs.mkdirSync(targetDir, { recursive: true });

  const spec = {
    site_id: sample.site_id,
    brand: sample.brand,
    archetype: sample.recipe,
    recipe: sample.recipe,
    tokens: {
      accent: sample.recipe.includes('drupal') ? '#0284c7' : '#0d9488',
      bg: '#ffffff',
      fg: '#111827',
      muted: '#6b7280',
    },
    pages: [{ id: 'home', path: 'index.html', title: `${sample.brand.name} — Home` }],
  };

  const composed = composeSite({ spec });

  // 1. Write spec.json
  fs.writeFileSync(path.join(targetDir, 'spec.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');

  // 2. Write pages
  for (const page of composed.pages) {
    const pagePath = path.join(targetDir, page.path);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, page.html, 'utf8');
  }

  // 3. Write assets
  for (const asset of composed.assets) {
    const assetPath = path.join(targetDir, asset.path);
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, asset.contents, 'utf8');
  }

  // 4. Initialize Git repository
  try {
    execSync(`git init -b main && git config user.name "FAMtastic Operator" && git config user.email "operator@famtastic.dev" && git add -A && git commit -m "feat: initial build of ${sample.brand.name} (${sample.recipe})"`, {
      cwd: targetDir,
      stdio: 'pipe',
    });
  } catch (err) {
    console.error(`Git init failed for ${sample.site_id}:`, err.message);
  }

  console.log(`✓ Built ${sample.site_id} (${sample.recipe}) -> ${targetDir}`);
}

console.log('All 4 sample sites built and initialized successfully!');
