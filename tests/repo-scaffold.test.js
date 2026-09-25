import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepoScaffold, requireCommunicationsContract } from '../server/kernel/repo-scaffold.js';

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
    expect(scaffold.files.map((file) => file.path)).toEqual(expect.arrayContaining(['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md', 'FAMTASTIC-CONTEXT.md', 'SITE-STATE.md', 'design.md', '.famtastic/site-manifest.json', '.famtastic/communications.json', 'docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md']));
    expect(scaffold.manifest.repository).toEqual({ mode: 'existing', url: 'git@github.com:example/site.git', branch: 'staging', state: 'local_only' });
    expect(scaffold.files.find((file) => file.path === 'design.md').contents).toContain('schema_version');
    const communications = JSON.parse(scaffold.files.find((file) => file.path === '.famtastic/communications.json').contents);
    expect(communications.sender).toMatchObject({ brand: 'FAMtastic Designs', signing_name: 'Shay', signature_text: '— Shay\nFAMtastic Designs' });
    expect(communications.template_registry.templates).toEqual(expect.arrayContaining([
      { id: 'customer_proof_ready', version: 4 },
      { id: 'customer_message_reply', version: 2 },
      { id: 'standard', version: 2 },
    ]));
    expect(scaffold.files.find((file) => file.path === 'AGENTS.md').contents).toContain('.famtastic/communications.json');
    expect(scaffold.files.find((file) => file.path === 'CODEX.md').contents).toContain('FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md');
  });

  it('fails closed when a generated repository loses a required central template version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'famtastic-communication-contract-'));
    try {
      const scaffold = createRepoScaffold({ site_id: 'communication-fixture', business_name: 'Communication Fixture', description: 'Contract fixture.', design_contract: contract });
      for (const file of scaffold.files) {
        const absolutePath = path.join(root, file.path);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, file.contents);
      }
      expect(() => requireCommunicationsContract(root)).not.toThrow();

      const contractPath = path.join(root, '.famtastic', 'communications.json');
      const communications = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      communications.template_registry.templates = communications.template_registry.templates.filter((template) => template.id !== 'customer_proof_ready');
      fs.writeFileSync(contractPath, JSON.stringify(communications, null, 2));
      expect(() => requireCommunicationsContract(root)).toThrow(/centralized delivery/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed without a versioned design contract', () => {
    expect(() => createRepoScaffold({ site_id: 'site', business_name: 'Site' })).toThrow(/design_contract/);
  });
});
