import { describe, expect, it } from 'vitest';
import { sanitizeBrand } from '../server/kernel/research-prompts.js';
import { validateDesignContract } from '../server/kernel/design-contract.js';

const CONTRACT = {
  schema_version: 1,
  tokens: { bg: '#101010', fg: '#f7f7f2', accent: '#b8f135', muted: '#9aa090' },
  typography: { body: 'Inter, sans-serif', headings: 'Space Grotesk, Inter, sans-serif' },
  component_recipe: ['proof-shell', 'hero', 'cta'],
  layout: { max_width: '72rem', gutter: 'clamp(1rem, 4vw, 4rem)', grid: '12-column' },
  responsive: { mobile: 'stack', tablet: 'two-column', desktop: 'max-width' },
  asset_policy: { preserve: true, rights_safe_only: true, allow_new_assets: true, required_roles: ['hero'] },
  evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
};

describe('design contract', () => {
  it('survives research sanitization without accepting unbounded fields', () => {
    const brand = sanitizeBrand({ design_contract: { ...CONTRACT, secret_prompt: 'must not cross the boundary' } });
    expect(brand.design_contract).toMatchObject(CONTRACT);
    expect(brand.design_contract.secret_prompt).toBeUndefined();
  });

  it('fails closed when the evolution fields are missing', () => {
    const incomplete = { ...CONTRACT, evolution: { preserve_tokens: true } };
    expect(validateDesignContract(incomplete)).toEqual(expect.arrayContaining([
      'brand.design_contract.evolution.preserve_typography: must be true',
      'brand.design_contract.evolution.parity_required: must be true',
    ]));
  });

  it('accepts the complete contract used for future page additions', () => {
    expect(validateDesignContract(CONTRACT)).toEqual([]);
  });
});

