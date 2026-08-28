// CMS & Decoupled Tri-Tier Composer (v1.0.0)
// Generates complete folder structures, custom themes, and multi-tier workspaces for:
// - Standard Drupal (Monolith + Custom Theme)
// - Decoupled Drupal Tri-Tier (Headless Drupal + React Portal + React Frontend)
// - Standard WordPress (Monolith + Custom Theme)
// - Decoupled WordPress Tri-Tier (Headless WordPress + React Portal + React Frontend)

import { tokensToCss, DEFAULT_TOKENS } from './tokens.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * 1. Standard Drupal Composer (v1.0.0)
 */
export function composeDrupalStandard({ spec, bName, slug, tokens }) {
  const css = tokensToCss({ ...DEFAULT_TOKENS, ...(tokens || {}) });

  const themeInfoYml = `name: '${bName} Theme'
type: theme
description: 'Custom theme for ${bName} generated with FAMtastic Site Studio.'
core_version_requirement: ^10 || ^11
base theme: false

libraries:
  - famtastic_drupal/global-styling

regions:
  header: 'Header'
  primary_menu: 'Primary Menu'
  highlighted: 'Highlighted'
  content: 'Content'
  sidebar_first: 'Sidebar First'
  footer: 'Footer'
`;

  const themeLibrariesYml = `global-styling:
  version: 1.0.0
  css:
    theme:
      css/theme.css: {}
  js:
    js/main.js: {}
`;

  const themeTwig = `{# Page Template for ${bName} #}
<div class="layout-container">
  <header class="site-header">
    <div class="header-inner">
      <div class="site-branding">
        <a href="{{ front_page }}" title="{{ 'Home'|t }}" rel="home" class="site-logo">
          <strong>{{ site_name }}</strong>
        </a>
      </div>
      {{ page.primary_menu }}
    </div>
  </header>

  {{ page.highlighted }}

  <main id="main-content" class="main-content" role="main">
    <div class="content-container">
      {{ page.content }}
    </div>
    {% if page.sidebar_first %}
      <aside class="sidebar" role="complementary">
        {{ page.sidebar_first }}
      </aside>
    {% endif %}
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      {{ page.footer }}
      <p>&copy; {{ "now"|date("Y") }} {{ site_name }}. All rights reserved.</p>
    </div>
  </footer>
</div>
`;

  const composerJson = JSON.stringify({
    name: `famtastic/site-${slug}`,
    description: `${bName} — Drupal CMS powered website`,
    type: 'project',
    license: 'GPL-2.0-or-later',
    require: {
      'php': '>=8.2',
      'composer/installers': '^2.0',
      'drupal/core-composer-scaffold': '^10.2 || ^11.0',
      'drupal/core-recommended': '^10.2 || ^11.0',
      'drush/drush': '^12.0 || ^13.0',
    },
    scripts: {
      'drupal-scaffold': 'Drupal\\Composer\\ScaffoldPlugin::scaffold',
    },
    extra: {
      'drupal-scaffold': {
        'locations': {
          'web-root': 'web/',
        },
      },
      'installer-paths': {
        'web/core': ['type:drupal-core'],
        'web/modules/contrib/{$name}': ['type:drupal-module'],
        'web/profiles/contrib/{$name}': ['type:drupal-profile'],
        'web/themes/contrib/{$name}': ['type:drupal-theme'],
        'web/themes/custom/{$name}': ['type:drupal-custom-theme'],
      },
    },
  }, null, 2) + '\n';

  const dockerCompose = `version: '3.8'

services:
  drupal:
    image: drupal:10-apache
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./web:/var/www/html/web
      - ./vendor:/var/www/html/vendor
    environment:
      - DRUPAL_DATABASE_HOST=db
      - DRUPAL_DATABASE_NAME=drupal
      - DRUPAL_DATABASE_USERNAME=drupal
      - DRUPAL_DATABASE_PASSWORD=drupal_secret
    depends_on:
      - db

  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      - MYSQL_DATABASE=drupal
      - MYSQL_USER=drupal
      - MYSQL_PASSWORD=drupal_secret
      - MYSQL_ROOT_PASSWORD=root_secret
    volumes:
      - db-data:/var/lib/mysql

volumes:
  db-data:
`;

  return {
    pages: [{
      path: 'index.html',
      title: `${bName} — Drupal CMS`,
      html: `<!doctype html><html><head><title>${escapeHtml(bName)} (Drupal)</title><link rel="stylesheet" href="web/themes/custom/famtastic_drupal/css/theme.css"></head><body><main style="max-width:960px;margin:4rem auto;text-align:center"><h1>${escapeHtml(bName)}</h1><p>Standard Drupal CMS installation with custom theme <code>famtastic_drupal</code>.</p><p><a href="web/themes/custom/famtastic_drupal/css/theme.css">View Custom Theme Stylesheet</a></p></main></body></html>`,
    }],
    assets: [
      { path: 'styles.css', contents: css },
      { path: 'web/themes/custom/famtastic_drupal/css/theme.css', contents: css },
      { path: 'web/themes/custom/famtastic_drupal/famtastic_drupal.info.yml', contents: themeInfoYml },
      { path: 'web/themes/custom/famtastic_drupal/famtastic_drupal.libraries.yml', contents: themeLibrariesYml },
      { path: 'web/themes/custom/famtastic_drupal/templates/page.html.twig', contents: themeTwig },
      { path: 'composer.json', contents: composerJson },
      { path: 'docker-compose.yml', contents: dockerCompose },
      { path: 'README.md', contents: `# ${bName} — Standard Drupal CMS\n\nCustom theme: \`web/themes/custom/famtastic_drupal\`\nRun \`docker-compose up -d\` to start local environment.\n` },
      { path: 'robots.txt', contents: 'User-agent: *\nDisallow: /core/\nDisallow: /update.php\n' },
    ],
  };
}

/**
 * 2. Decoupled Drupal Tri-Tier Composer (v1.0.0 - FAMtastic Designs architecture)
 */
export function composeDrupalDecoupled({ spec, bName, slug, tokens }) {
  const css = tokensToCss({ ...DEFAULT_TOKENS, ...(tokens || {}) });

  const rootPackageJson = JSON.stringify({
    name: `site-${slug}-monorepo`,
    version: '1.0.0',
    private: true,
    description: `${bName} — Decoupled Tri-Tier Site (Drupal + React Portal + React Frontend)`,
    scripts: {
      'dev:all': 'npx concurrently "npm run dev:frontend" "npm run dev:portal"',
      'dev:frontend': 'cd frontend && npm run dev',
      'dev:portal': 'cd client-portal && npm run dev',
      'dev:backend': 'cd backend && docker-compose up',
      'build': 'cd frontend && npm run build && cd ../client-portal && npm run build',
    },
  }, null, 2) + '\n';

  const portalAppJsx = `import React, { useState } from 'react';

export default function ClientPortal() {
  const [activeTab, setActiveTab] = useState('orders');

  return (
    <div className="portal-container" style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e5e5', paddingBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>${escapeHtml(bName)} Client Portal</h2>
          <small style={{ color: '#666' }}>Connected to Drupal Headless JSON:API</small>
        </div>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setActiveTab('orders')} style={{ padding: '6px 12px', background: activeTab === 'orders' ? '#e11d48' : '#f5f5f5', color: activeTab === 'orders' ? '#fff' : '#111', border: 'none', borderRadius: 4 }}>My Orders</button>
          <button onClick={() => setActiveTab('submit')} style={{ padding: '6px 12px', background: activeTab === 'submit' ? '#e11d48' : '#f5f5f5', color: activeTab === 'submit' ? '#fff' : '#111', border: 'none', borderRadius: 4 }}>Submit Brief</button>
          <button onClick={() => setActiveTab('account')} style={{ padding: '6px 12px', background: activeTab === 'account' ? '#e11d48' : '#f5f5f5', color: activeTab === 'account' ? '#fff' : '#111', border: 'none', borderRadius: 4 }}>Account</button>
        </nav>
      </header>

      <main style={{ marginTop: '2rem' }}>
        {activeTab === 'orders' && (
          <section>
            <h3>Active Project Deliverables</h3>
            <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: '1.5rem' }}>
              <p><strong>Order #1042</strong> — Brand Identity & Landing Page System</p>
              <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: 4, fontSize: '0.85rem' }}>In Review</span>
            </div>
          </section>
        )}
        {activeTab === 'submit' && (
          <section>
            <h3>Submit New Project Brief</h3>
            <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 600 }}>
              <input type="text" placeholder="Project Name" style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6 }} />
              <textarea placeholder="Describe your vision and requirements..." rows={5} style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6 }} />
              <button type="button" style={{ background: '#e11d48', color: '#fff', padding: '12px', border: 'none', borderRadius: 6, fontWeight: 600 }}>Dispatch to Drupal API</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
`;

  const frontendAppJsx = `import React from 'react';

export default function PublicFrontend() {
  return (
    <div style={{ fontFamily: 'sans-serif', color: '#111' }}>
      <header style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
        <h3 style={{ margin: 0 }}>${escapeHtml(bName)}</h3>
        <a href="/portal" style={{ background: '#e11d48', color: '#fff', padding: '8px 16px', borderRadius: 6, textDecoration: 'none' }}>Client Portal &rarr;</a>
      </header>
      <main style={{ maxWidth: 960, margin: '4rem auto', textAlign: 'center', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>${escapeHtml(bName)}</h1>
        <p style={{ fontSize: '1.25rem', color: '#646464', marginBottom: '2rem' }}>High-velocity digital experiences powered by Decoupled Drupal & React.</p>
        <a href="#contact" style={{ display: 'inline-block', background: '#e11d48', color: '#fff', padding: '12px 24px', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>Get Started</a>
      </main>
    </div>
  );
}
`;

  return {
    pages: [{
      path: 'index.html',
      title: `${bName} — Decoupled Drupal Tri-Tier`,
      html: `<!doctype html><html><head><title>${escapeHtml(bName)}</title><link rel="stylesheet" href="styles.css"></head><body><main style="max-width:960px;margin:4rem auto;text-align:center"><h1>${escapeHtml(bName)}</h1><p><strong>Decoupled Tri-Tier Architecture</strong>: Headless Drupal Backend + React Client Portal + React Frontend.</p><p><a href="frontend/src/App.jsx">Frontend Source</a> &bull; <a href="client-portal/src/App.jsx">Portal Source</a> &bull; <a href="backend/composer.json">Backend Drupal Config</a></p></main></body></html>`,
    }],
    assets: [
      { path: 'styles.css', contents: css },
      { path: 'package.json', contents: rootPackageJson },
      { path: 'client-portal/src/App.jsx', contents: portalAppJsx },
      { path: 'frontend/src/App.jsx', contents: frontendAppJsx },
      { path: 'backend/web/themes/custom/headless_admin/headless_admin.info.yml', contents: `name: 'Headless Admin'\ntype: theme\ncore_version_requirement: ^10 || ^11\n` },
      { path: 'backend/composer.json', contents: JSON.stringify({ name: `famtastic/backend-${slug}`, require: { 'drupal/core-recommended': '^10.2 || ^11.0', 'drupal/jsonapi_extras': '^3.0' } }, null, 2) + '\n' },
      { path: 'README.md', contents: `# ${bName} — Decoupled Tri-Tier Architecture\n\n- \`backend/\`: Headless Drupal JSON:API backend\n- \`client-portal/\`: React Client Portal\n- \`frontend/\`: React Public Marketing Frontend\n\nRun \`npm run dev:all\` to start both React applications.\n` },
      { path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n' },
    ],
  };
}

/**
 * 3. Standard WordPress Composer (v1.0.0)
 */
export function composeWordPressStandard({ spec, bName, slug, tokens }) {
  const css = tokensToCss({ ...DEFAULT_TOKENS, ...(tokens || {}) });

  const styleCss = `/*
Theme Name: ${bName} Custom Theme
Theme URI: https://famtastic.dev
Author: FAMtastic Site Studio
Author URI: https://famtastic.dev
Description: Custom WordPress theme for ${bName} generated with design tokens.
Version: 1.0.0
License: GNU General Public License v2 or later
*/

${css}
`;

  const indexPhp = `<?php
get_header();
?>
<main id="primary" class="site-main" style="max-width: var(--container, 960px); margin: 3rem auto; padding: 0 1.5rem;">
  <?php
  if ( have_posts() ) :
    while ( have_posts() ) : the_post();
      ?>
      <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
        <header class="entry-header">
          <h1 class="entry-title"><?php the_title(); ?></h1>
        </header>
        <div class="entry-content" style="line-height: 1.6; margin-top: 1rem;">
          <?php the_content(); ?>
        </div>
      </article>
      <?php
    endwhile;
  else :
    echo '<p>No content found.</p>';
  endif;
  ?>
</main>
<?php
get_footer();
`;

  const functionsPhp = `<?php
function famtastic_theme_setup() {
  add_theme_support( 'title-tag' );
  add_theme_support( 'post-thumbnails' );
  add_theme_support( 'html5', array( 'search-form', 'comment-form', 'gallery', 'caption' ) );
}
add_action( 'after_setup_theme', 'famtastic_theme_setup' );

function famtastic_enqueue_scripts() {
  wp_enqueue_style( 'famtastic-style', get_stylesheet_uri(), array(), '1.0.0' );
}
add_action( 'wp_enqueue_scripts', 'famtastic_enqueue_scripts' );
`;

  const headerPhp = `<!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo( 'charset' ); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<header class="site-header" style="border-bottom: 1px solid var(--border, #e5e5e5); padding: 1.5rem 0;">
  <div style="max-width: var(--container, 960px); margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 0 1.5rem;">
    <a href="<?php echo esc_url( home_url( '/' ) ); ?>" style="font-weight: 700; font-size: 1.25rem; text-decoration: none; color: var(--fg, #111);"><?php bloginfo( 'name' ); ?></a>
    <nav class="main-navigation">
      <?php
      wp_nav_menu( array(
        'theme_location' => 'menu-1',
        'menu_id'        => 'primary-menu',
        'fallback_cb'    => false,
      ) );
      ?>
    </nav>
  </div>
</header>
`;

  const footerPhp = `<footer class="site-footer" style="border-top: 1px solid var(--border, #e5e5e5); padding: 2rem 0; margin-top: 4rem; text-align: center; font-size: 0.9rem; color: var(--muted, #646464);">
  <div style="max-width: var(--container, 960px); margin: 0 auto;">
    <p>&copy; <?php echo date('Y'); ?> <?php bloginfo('name'); ?>. All rights reserved.</p>
  </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
`;

  const dockerCompose = `version: '3.8'

services:
  wordpress:
    image: wordpress:latest
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress_secret
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - ./wp-content:/var/www/html/wp-content
    depends_on:
      - db

  db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress_secret
      MYSQL_ROOT_PASSWORD: root_secret
    volumes:
      - db-data:/var/lib/mysql

volumes:
  db-data:
`;

  return {
    pages: [{
      path: 'index.html',
      title: `${bName} — WordPress CMS`,
      html: `<!doctype html><html><head><title>${escapeHtml(bName)} (WordPress)</title><link rel="stylesheet" href="wp-content/themes/famtastic_wordpress/style.css"></head><body><main style="max-width:960px;margin:4rem auto;text-align:center"><h1>${escapeHtml(bName)}</h1><p>Standard WordPress CMS with custom theme <code>famtastic_wordpress</code>.</p><p><a href="wp-content/themes/famtastic_wordpress/style.css">View Custom Theme Stylesheet</a></p></main></body></html>`,
    }],
    assets: [
      { path: 'styles.css', contents: css },
      { path: 'wp-content/themes/famtastic_wordpress/style.css', contents: styleCss },
      { path: 'wp-content/themes/famtastic_wordpress/index.php', contents: indexPhp },
      { path: 'wp-content/themes/famtastic_wordpress/functions.php', contents: functionsPhp },
      { path: 'wp-content/themes/famtastic_wordpress/header.php', contents: headerPhp },
      { path: 'wp-content/themes/famtastic_wordpress/footer.php', contents: footerPhp },
      { path: 'docker-compose.yml', contents: dockerCompose },
      { path: 'README.md', contents: `# ${bName} — WordPress CMS\n\nCustom theme: \`wp-content/themes/famtastic_wordpress\`\nRun \`docker-compose up -d\` to start local WordPress & MySQL.\n` },
      { path: 'robots.txt', contents: 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n' },
    ],
  };
}

/**
 * 4. Decoupled WordPress Tri-Tier Composer (v1.0.0 - MBSH architecture)
 */
export function composeWordPressDecoupled({ spec, bName, slug, tokens }) {
  const css = tokensToCss({ ...DEFAULT_TOKENS, ...(tokens || {}) });

  const rootPackageJson = JSON.stringify({
    name: `site-${slug}-tri-tier`,
    version: '1.0.0',
    private: true,
    description: `${bName} — Decoupled WordPress Tri-Tier Architecture (MBSH Pattern)`,
    scripts: {
      'dev:all': 'npx concurrently "npm run dev:frontend" "npm run dev:portal"',
      'dev:frontend': 'cd frontend && npm run dev',
      'dev:portal': 'cd client-portal && npm run dev',
      'dev:backend': 'cd backend && docker-compose up',
    },
  }, null, 2) + '\n';

  const portalAppJsx = `import React, { useState } from 'react';

export default function AttendeePortal() {
  const [rsvpStatus, setRsvpStatus] = useState(null);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: '2rem' }}>
      <h2>${escapeHtml(bName)} Attendee & Client Portal</h2>
      <p style={{ color: '#666' }}>Connected to Headless WordPress REST API & Database.</p>
      
      <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', padding: '1.5rem', borderRadius: 8, margin: '1.5rem 0' }}>
        <h3>RSVP & Event Registration</h3>
        <p>Confirm your attendance for the upcoming experience.</p>
        <button onClick={() => setRsvpStatus('confirmed')} style={{ background: '#e11d48', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 600 }}>Confirm RSVP</button>
        {rsvpStatus && <p style={{ color: '#059669', fontWeight: 600, marginTop: 10 }}>&check; RSVP Recorded to WordPress!</p>}
      </div>
    </div>
  );
}
`;

  const frontendAppJsx = `import React from 'react';

export default function EventFrontend() {
  return (
    <div style={{ fontFamily: 'sans-serif', color: '#111' }}>
      <header style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
        <h3 style={{ margin: 0 }}>${escapeHtml(bName)}</h3>
        <a href="/portal" style={{ background: '#e11d48', color: '#fff', padding: '8px 16px', borderRadius: 6, textDecoration: 'none' }}>Attendee Portal &rarr;</a>
      </header>
      <main style={{ maxWidth: 960, margin: '4rem auto', textAlign: 'center', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '3.2rem', marginBottom: '1rem', letterSpacing: '-0.02em' }}>${escapeHtml(bName)}</h1>
        <p style={{ fontSize: '1.25rem', color: '#646464', marginBottom: '2rem' }}>Cinematic Event & Digital Experience powered by Decoupled WordPress.</p>
        <a href="/portal" style={{ display: 'inline-block', background: '#e11d48', color: '#fff', padding: '12px 24px', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>Enter Portal</a>
      </main>
    </div>
  );
}
`;

  return {
    pages: [{
      path: 'index.html',
      title: `${bName} — Decoupled WordPress Tri-Tier`,
      html: `<!doctype html><html><head><title>${escapeHtml(bName)}</title><link rel="stylesheet" href="styles.css"></head><body><main style="max-width:960px;margin:4rem auto;text-align:center"><h1>${escapeHtml(bName)}</h1><p><strong>Decoupled Tri-Tier Architecture</strong>: Headless WordPress Backend + React Attendee Portal + React Frontend.</p><p><a href="frontend/src/App.jsx">Frontend Source</a> &bull; <a href="client-portal/src/App.jsx">Portal Source</a> &bull; <a href="backend/wp-content/themes/headless_api/style.css">Headless WordPress Theme</a></p></main></body></html>`,
    }],
    assets: [
      { path: 'styles.css', contents: css },
      { path: 'package.json', contents: rootPackageJson },
      { path: 'client-portal/src/App.jsx', contents: portalAppJsx },
      { path: 'frontend/src/App.jsx', contents: frontendAppJsx },
      { path: 'backend/wp-content/themes/headless_api/style.css', contents: `/*\nTheme Name: Headless API\nAuthor: FAMtastic\nVersion: 1.0.0\n*/\n` },
      { path: 'backend/docker-compose.yml', contents: `version: '3.8'\nservices:\n  wordpress:\n    image: wordpress:latest\n    ports:\n      - "8080:80"\n` },
      { path: 'README.md', contents: `# ${bName} — Decoupled WordPress Tri-Tier Architecture\n\n- \`backend/\`: Headless WordPress API\n- \`client-portal/\`: React Attendee Portal\n- \`frontend/\`: React Marketing Frontend\n\nRun \`npm run dev:all\` to start local workspaces.\n` },
      { path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n' },
    ],
  };
}
