import fs from 'node:fs';
import path from 'node:path';

const compDir = '/Users/famtastic-fritz/Development/FAMtastic/component-studio';
fs.mkdirSync(path.join(compDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(compDir, 'tests'), { recursive: true });

// 1. package.json
const pkg = {
  name: 'component-studio',
  version: '1.0.0',
  description: 'FAMtastic Component Studio — Modern UI component library, archetypes, and semantic HTML/CSS snippet engine',
  type: 'module',
  main: 'src/index.js',
  exports: {
    '.': './src/index.js',
    './catalog': './src/catalog.js',
  },
  scripts: {
    test: 'node --test tests/*.test.js',
  },
  keywords: ['famtastic', 'component-studio', 'ui-components', 'archetypes', 'design-system'],
  author: 'FAMtastic',
  license: 'MIT',
};
fs.writeFileSync(path.join(compDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// 2. .gitignore
const gitignore = 'node_modules/\n.DS_Store\n*.log\ndist/\ntmp/\n';
fs.writeFileSync(path.join(compDir, '.gitignore'), gitignore, 'utf8');

// 3. src/catalog.js
const catalogCode = `// Production Component Archetypes Catalog
export const COMPONENT_CATEGORIES = [
  'hero',
  'features',
  'conversion',
  'content',
  'navigation',
];

export const COMPONENTS_CATALOG = [
  {
    id: 'hero-split',
    name: 'Split Visual Hero',
    category: 'hero',
    description: 'High-impact 2-column hero with headline, subcopy, CTA button, and featured visual.',
    template: (data) => \`
<section class="comp-hero-split" style="display:grid;grid-template-columns:1.2fr 1fr;gap:3rem;align-items:center;padding:var(--gap-secondary, 4rem) 0">
  <div>
    <h1 style="font-size:2.5rem;line-height:1.15;margin-bottom:1rem;color:var(--fg, #111)">\${data.title || 'Transform Your Digital Presence'}</h1>
    <p style="font-size:1.15rem;color:var(--muted, #646464);margin-bottom:1.75rem">\${data.body || 'Custom-engineered solutions tailored for performance and scale.'}</p>
    <a href="\${data.cta_href || '#contact'}" class="cta" style="display:inline-block;padding:0.75rem 1.5rem;background:var(--accent, #e11d48);color:#fff;border-radius:6px;text-decoration:none;font-weight:600">\${data.cta_label || 'Get Started'}</a>
  </div>
  <div style="background:color-mix(in srgb, var(--accent, #e11d48) 8%, var(--bg, #fff));border-radius:12px;padding:2rem;text-align:center;border:1px solid var(--muted, #e5e5e5)">
    \${data.media_html || '<div style="height:240px;display:flex;align-items:center;justify-content:center;color:var(--muted)">Featured Visual</div>'}
  </div>
</section>
\`,
  },
  {
    id: 'hero-centered',
    name: 'Centered Statement Hero',
    category: 'hero',
    description: 'Focused single-column hero with bold statement typography and dual action triggers.',
    template: (data) => \`
<section class="comp-hero-centered" style="text-align:center;max-width:800px;margin:0 auto;padding:var(--gap-primary, 5rem) 1rem">
  <h1 style="font-size:3rem;line-height:1.1;margin-bottom:1.25rem;letter-spacing:-0.02em">\${data.title || 'Simplicity Meets Performance'}</h1>
  <p style="font-size:1.25rem;color:var(--muted, #646464);margin-bottom:2rem">\${data.body || 'Engineered from first principles with zero bloat and maximum velocity.'}</p>
  <div style="display:flex;gap:1rem;justify-content:center">
    <a href="\${data.cta_href || '#contact'}" class="cta" style="padding:0.8rem 1.75rem;background:var(--accent, #e11d48);color:#fff;border-radius:6px;text-decoration:none;font-weight:600">\${data.cta_label || 'Book a Consultation'}</a>
    <a href="\${data.secondary_href || '#about'}" style="padding:0.8rem 1.75rem;border:1px solid var(--muted, #ccc);color:var(--fg, #111);border-radius:6px;text-decoration:none;font-weight:500">\${data.secondary_label || 'Learn More'}</a>
  </div>
</section>
\`,
  },
  {
    id: 'features-3col-cards',
    name: '3-Column Service Cards',
    category: 'features',
    description: 'Clean responsive 3-column card grid highlighting core features or services.',
    template: (data) => {
      const items = data.items || [
        { title: 'Rapid Execution', body: 'Delivering end-to-end capabilities with unprecedented speed.' },
        { title: 'Verified Quality', body: 'Every deliverable audited with automated browser-first gates.' },
        { title: 'Complete Ownership', body: 'Full source control and independent deployment freedom.' },
      ];
      const cardsHtml = items.map((item) => \`
        <div class="card" style="border:1px solid var(--muted, #e5e5e5);border-radius:10px;padding:1.5rem;background:var(--bg, #fff)">
          <h3 style="font-size:1.25rem;margin-bottom:0.5rem;color:var(--accent, #e11d48)">\${item.title}</h3>
          <p style="font-size:0.95rem;color:var(--muted, #646464);margin:0">\${item.body}</p>
        </div>
      \`).join('');
      return \`
<section class="comp-features-cards" style="padding:var(--gap-secondary, 3.5rem) 0">
  <div style="text-align:center;margin-bottom:2.5rem">
    <h2 style="font-size:2rem;margin-bottom:0.5rem">\${data.heading || 'Core Capabilities'}</h2>
    <p style="color:var(--muted, #646464)">\${data.subheading || 'Engineered for real-world reliability.'}</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:1.5rem">
    \${cardsHtml}
  </div>
</section>
\`;
    },
  },
  {
    id: 'conversion-cta-band',
    name: 'Full-Width CTA Band',
    category: 'conversion',
    description: 'Eye-catching tinted horizontal band with direct call-to-action trigger.',
    template: (data) => \`
<section class="comp-cta-band" style="width:100cqw;max-width:100vw;margin-left:calc(50% - 50cqw);padding:var(--gap-secondary, 3.5rem) 2rem;background:color-mix(in srgb, var(--accent, #e11d48) 10%, var(--bg, #fff));text-align:center">
  <div style="max-width:var(--container, 960px);margin:0 auto">
    <h2 style="font-size:2.25rem;margin-bottom:0.75rem">\${data.heading || 'Ready to Elevate Your Brand?'}</h2>
    <p style="font-size:1.15rem;color:var(--muted, #646464);margin-bottom:1.75rem">\${data.body || 'Connect with our team today and receive a personalized proposal.'}</p>
    <a href="\${data.cta_href || '#contact'}" class="cta" style="padding:0.85rem 2rem;background:var(--accent, #e11d48);color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:1.05rem">\${data.cta_label || 'Get in Touch'}</a>
  </div>
</section>
\`,
  },
  {
    id: 'content-faq-accordion',
    name: 'Interactive FAQ Accordion',
    category: 'content',
    description: 'Semantic details/summary FAQ list with styled accordion disclosures.',
    template: (data) => {
      const faqs = data.faqs || [
        { q: 'How long does a typical build take?', a: 'Most builds are generated, grounded, and verified within minutes.' },
        { q: 'Can I customize the design tokens and layout?', a: 'Yes, full control over palettes, typography, and sections is available in Canvas Editor.' },
        { q: 'Where are the files stored?', a: 'Sites are initialized as independent Git repositories directly on your machine.' },
      ];
      const faqsHtml = faqs.map((f) => \`
        <details style="border-bottom:1px solid var(--muted, #e5e5e5);padding:1rem 0">
          <summary style="font-weight:600;font-size:1.1rem;cursor:pointer;color:var(--fg, #111)">\${f.q}</summary>
          <p style="margin-top:0.75rem;color:var(--muted, #646464);line-height:1.6">\${f.a}</p>
        </details>
      \`).join('');
      return \`
<section class="comp-faq" style="max-width:760px;margin:0 auto;padding:var(--gap-secondary, 3.5rem) 0">
  <h2 style="font-size:2rem;text-align:center;margin-bottom:2rem">\${data.heading || 'Frequently Asked Questions'}</h2>
  <div style="display:flex;flex-direction:column">
    \${faqsHtml}
  </div>
</section>
\`;
    },
  },
  {
    id: 'navigation-footer',
    name: 'Multi-Column Site Footer',
    category: 'navigation',
    description: 'Semantic footer with brand summary, quick links, and dynamic copyright year.',
    template: (data) => \`
<footer class="comp-footer" style="padding:3rem 1.25rem 2rem;border-top:1px solid var(--muted, #e5e5e5);color:var(--muted, #646464);font-size:0.9rem">
  <div style="max-width:var(--container, 960px);margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1.5rem">
    <div>
      <b style="color:var(--fg, #111);font-size:1.1rem">\${data.brand_name || 'Brand'}</b>
      <div style="margin-top:4px">\${data.tagline || 'Engineered with Site Studio'}</div>
    </div>
    <div style="text-align:right">
      <div>&copy; <span class="current-year">\${new Date().getFullYear()}</span> \${data.brand_name || 'Brand'}. All rights reserved.</div>
    </div>
  </div>
</footer>
\`,
  },
];
`;
fs.writeFileSync(path.join(compDir, 'src', 'catalog.js'), catalogCode, 'utf8');

// 4. src/index.js
const indexCode = `import { COMPONENTS_CATALOG, COMPONENT_CATEGORIES } from './catalog.js';

export { COMPONENTS_CATALOG, COMPONENT_CATEGORIES };

export function listComponents(category = null) {
  if (!category) return [...COMPONENTS_CATALOG];
  return COMPONENTS_CATALOG.filter((c) => c.category === category);
}

export function getComponent(id) {
  return COMPONENTS_CATALOG.find((c) => c.id === id) || null;
}

export function renderComponent(id, data = {}, tokens = {}) {
  const comp = getComponent(id);
  if (!comp) throw new Error(\`Component not found: \${id}\`);
  return comp.template(data, tokens);
}

export function createComponentStudio(options = {}) {
  return {
    listComponents,
    getComponent,
    renderComponent,
    categories: COMPONENT_CATEGORIES,
  };
}
`;
fs.writeFileSync(path.join(compDir, 'src', 'index.js'), indexCode, 'utf8');

// 5. tests/component-studio.test.js
const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';
import { listComponents, getComponent, renderComponent, COMPONENTS_CATALOG, COMPONENT_CATEGORIES } from '../src/index.js';

test('Component Studio exports catalog and categories', () => {
  assert.ok(COMPONENTS_CATALOG.length >= 6);
  assert.ok(COMPONENT_CATEGORIES.includes('hero'));
  assert.ok(COMPONENT_CATEGORIES.includes('features'));
  assert.ok(COMPONENT_CATEGORIES.includes('conversion'));
});

test('listComponents filters by category', () => {
  const heroes = listComponents('hero');
  assert.ok(heroes.length >= 2);
  assert.ok(heroes.every((h) => h.category === 'hero'));
});

test('getComponent returns component by id', () => {
  const comp = getComponent('hero-split');
  assert.ok(comp);
  assert.equal(comp.name, 'Split Visual Hero');
});

test('renderComponent produces valid semantic HTML markup', () => {
  const html = renderComponent('hero-split', { title: 'Test Hero Headline' });
  assert.ok(html.includes('Test Hero Headline'));
  assert.ok(html.includes('<h1'));
  assert.ok(html.includes('comp-hero-split'));
});
`;
fs.writeFileSync(path.join(compDir, 'tests', 'component-studio.test.js'), testCode, 'utf8');

// 6. README.md
const readmeCode = `# FAMtastic Component Studio Library

Modular UI component archetypes, semantic HTML/CSS snippet engine, and design-token renderer for Site Studio and autonomous web building.

## Features
- **Component Archetypes**: Split hero, Centered hero, 3-Column service cards, Full-width CTA bands, FAQ accordions, Multi-column footers
- **Design Token Compatible**: Seamlessly binds to \`--bg\`, \`--fg\`, \`--accent\`, \`--muted\` CSS properties
- **Zero Framework Dependency**: Pure semantic HTML5 and vanilla CSS
- **Site Studio Integration**: Powering the \`/components\` console and autonomous composer pipeline

## Usage
\`\`\`javascript
import { listComponents, renderComponent } from 'component-studio';

const heroes = listComponents('hero');
const markup = renderComponent('hero-split', {
  title: 'Grow Your Business Fast',
  body: 'Expert engineering tailored for your team.',
  cta_label: 'Get Free Audit',
});
console.log(markup);
\`\`\`

## Testing
\`\`\`bash
npm test
\`\`\`
`;
fs.writeFileSync(path.join(compDir, 'README.md'), readmeCode, 'utf8');

console.log('Successfully structured component-studio!');
