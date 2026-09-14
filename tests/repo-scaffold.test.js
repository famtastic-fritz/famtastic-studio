import { describe, expect, it } from 'vitest';
import { createRepoScaffold } from '../server/kernel/repo-scaffold.js';

const contract = {
  schema_version: 1,
  tokens: { bg: '#000', fg: '#fff', accent: '#0f0', muted: '#888' },
  typography: { body: 'Inter', headings: 'Inter' },
  component_recipe: ['proof-shell', 'hero', 'cta'],
  layout: { max_width: '72rem', gutter: '1rem', grid: '12-column' },
  responsive: { mobile: 'stack', tablet: 'two-column', desktop: 'max-width' },
  asset_policy: { preserve: true, rights_safe_only: true },
  evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
};

describe('per-site repository scaffold', () => {
  it('creates the shared defaults without running git or a remote transport', () => {
    const scaffold = createRepoScaffold({ site_id: 'shay-tighten-up-your-locs', business_name: 'Tighten Up Your Locs', description: 'A private fixture.', design_contract: contract, repository: { mode: 'existing', url: 'git@github.com:example/site.git', branch: 'staging' } });
    expect(scaffold.files.map((file) => file.path)).toEqual(expect.arrayContaining(['AGENTS.md', 'CLAUDE.md', 'design.md', '.famtastic/site-manifest.json']));
    expect(scaffold.manifest.repository).toEqual({ mode: 'existing', url: 'git@github.com:example/site.git', branch: 'staging', state: 'local_only' });
    expect(scaffold.files.find((file) => file.path === 'design.md').contents).toContain('schema_version');
  });

  it('fails closed without a versioned design contract', () => {
    expect(() => createRepoScaffold({ site_id: 'site', business_name: 'Site' })).toThrow(/design_contract/);
  });
});
