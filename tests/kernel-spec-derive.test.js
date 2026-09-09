// spec-derive: the packet -> spec step, including the imagery bridge.
// Split out of kernel-research.test.js: these exercise spec-derive.js, not
// research.js, and the combined file crossed the no-monolith limit.
import { describe, it, expect } from 'vitest';

// The imagery bridge: research media prompts must survive into the spec as
// declared, countable slots. Before this they were validated in the packet and
// then dropped, so a site was built with no media slots and nothing said media
// was missing.
describe('imagery bridge: media prompts become declared spec slots', () => {
  it('carries every prompt through as an unfilled slot with the prompt attached', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = {
      packet_id: 'rp_1', source_adapter: 'shay-native', execution_status: 'partial',
      facts: [], open_questions: [], brand: {}, site_needs: { pages: ['home'] },
      media_prompts: [
        { role: 'hero', prompt: 'A warm daylight studio interior' },
        { role: 'gallery', prompt: 'Close-up of finished work' },
      ],
    };
    const spec = deriveSpecFromPacket({ packet, brief: { business: { name: 'X' } }, site_id: 'x' });
    expect(spec.media_slots).toHaveLength(2);
    expect(spec.media_slots[0]).toMatchObject({ id: 'hero', role: 'hero', state: 'unfilled', asset_ref: null });
    expect(spec.media_slots[0].prompt).toMatch(/warm daylight/);
    expect(spec.media_summary).toMatchObject({ declared: 2, filled: 0, unfilled: 2 });
  });

  it('accepts a bare string prompt and still produces a usable slot', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = {
      packet_id: 'rp_2', source_adapter: 'shay-native', execution_status: 'partial',
      facts: [], open_questions: [], brand: {}, site_needs: { pages: ['home'] },
      media_prompts: ['a storefront at golden hour'],
    };
    const spec = deriveSpecFromPacket({ packet, brief: {}, site_id: 'x' });
    expect(spec.media_slots).toHaveLength(1);
    expect(spec.media_slots[0].prompt).toBe('a storefront at golden hour');
    expect(spec.media_slots[0].id).toBe('media-1');
  });

  it('never collides slot ids when two prompts share a role', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = {
      packet_id: 'rp_3', source_adapter: 'shay-native', execution_status: 'partial',
      facts: [], open_questions: [], brand: {}, site_needs: { pages: ['home'] },
      media_prompts: [{ role: 'hero', prompt: 'a' }, { role: 'hero', prompt: 'b' }],
    };
    const spec = deriveSpecFromPacket({ packet, brief: {}, site_id: 'x' });
    const ids = spec.media_slots.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports an honest zero rather than omitting the summary when research declared no media', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = {
      packet_id: 'rp_4', source_adapter: 'shay-native', execution_status: 'no_findings',
      facts: [], open_questions: [], brand: {}, site_needs: { pages: ['home'] }, media_prompts: [],
    };
    const spec = deriveSpecFromPacket({ packet, brief: {}, site_id: 'x' });
    expect(spec.media_slots).toEqual([]);
    expect(spec.media_summary.declared).toBe(0);
    expect(spec.media_summary.note).toMatch(/declared no media slots/);
  });
});

describe('selected design contract reaches the renderer', () => {
  it('accepts the legacy palette array and explicit FAMtastic tokens', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const spec = deriveSpecFromPacket({
      packet: {
        packet_id: 'rp-design-contract', source_adapter: 'synthetic', execution_status: 'partial',
        facts: [], open_questions: [],
        brand: {
          name: 'Contract Studio',
          palette: ['#0a0a0a', '#7cfc00', '#eaeaea'],
          design_contract: {
            schema_version: 1,
            tokens: { bg: '#0a0a0a', fg: '#eaeaea', accent: '#7cfc00', muted: '#888888' },
            typography: { body: 'Inter, sans-serif', headings: 'Space Grotesk, Inter, sans-serif' },
            component_recipe: ['proof-shell', 'hero', 'cta'],
            layout: { max_width: '72rem', gutter: 'clamp(1rem, 4vw, 4rem)', grid: '12-column' },
            responsive: { mobile: 'stack', tablet: 'two-column', desktop: 'max-width' },
            asset_policy: { preserve: true, rights_safe_only: true },
            evolution: { preserve_tokens: true, preserve_typography: true, additions_must_use_recipe: true, parity_required: true },
          },
        },
        site_needs: { pages: ['home'] }, media_prompts: [],
      },
      brief: { business: { name: 'Contract Studio' } },
      site_id: 'contract-studio',
    });
    expect(spec.tokens).toMatchObject({ bg: '#0a0a0a', fg: '#eaeaea', accent: '#7cfc00' });
    expect(spec.tokens_provenance.source).toBe('design_contract');
    expect(spec.brand.design_contract.typography.headings).toMatch(/Space Grotesk/);
  });
});

describe('application implementation declarations survive the handoff', () => {
  it('carries a CMS/portal recipe and backend descriptor without pretending the proof proves behavior', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const spec = deriveSpecFromPacket({
      packet: {
        packet_id: 'rp-app-contract', source_adapter: 'synthetic', execution_status: 'partial',
        facts: [], open_questions: [], brand: {}, site_needs: { pages: ['home'] }, media_prompts: [],
      },
      brief: {
        business: { name: 'Shay Portal' },
        site_needs: { pages: ['home', 'services'] },
        capability_class: 'application',
        recipe: 'drupal-decoupled-tri-tier-v1',
        backend: {
          root: 'backend', runtime: 'drupal-jsonapi', schema_file: 'backend/schema.yml',
          deploy_target: 'staging', migrate_command: 'drush updb -y', authored_by: 'external',
          verify: [{ name: 'request persists', kind: 'behavioral' }],
        },
        functional_contract: { portal: ['login', 'request persistence'], data: ['availability'] },
      },
      site_id: 'shay-portal',
    });
    expect(spec).toMatchObject({
      capability_class: 'application',
      recipe: 'drupal-decoupled-tri-tier-v1',
      backend: { root: 'backend', runtime: 'drupal-jsonapi' },
      functional_contract: { portal: ['login', 'request persistence'] },
    });
  });
});

// REGRESSION: research returns sections_per_page as plain STRINGS. Those were
// passed through raw, so section.type was undefined, the hero was never a hero,
// and when imagery landed the hero image silently rendered nowhere while the
// generated files sat on disk. Nothing errored. Sections are now typed in the
// spec, because the spec is the contract.
describe('an instruction is never rendered as copy (OUTLINE_AS_COPY regression)', () => {
  it('leaves body null for every string-derived section, so compose cannot publish the outline', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections([
      'Hero: name, one-line clinical positioning, primary Book CTA',
      'Core treatment overview: facials, chemical peels, dermaplaning — four short cards linking into Services',
      'Policies preview: cancellation window, no-show, late arrival in one line each',
    ], { isHome: true });
    for (const section of out) {
      expect(section.body, `section ${section.id} must not carry copy it was never given`).toBeNull();
      expect(section.instruction, `section ${section.id} must retain its instruction`).toBeTruthy();
    }
  });

  it('renders nothing for a null body rather than impersonating copy', async () => {
    const { composeSite } = await import('../server/kernel/compose.js');
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const sections = normalizeSections(['Core treatment overview: facials, chemical peels, dermaplaning'], {});
    const spec = { business: { name: 'Probe' }, pages: [{ id: 'home', path: 'index.html', title: 'Probe', heading: 'Probe', sections }] };
    const out = composeSite({ spec });
    const html = (out.files || out.pages || []).map((f) => f.contents ?? f.html ?? '').join('');
    expect(html).not.toContain('facials, chemical peels, dermaplaning');
  });
});

describe('spec sections are always typed', () => {
  it('types a string hero section as a hero and keeps its text as an INSTRUCTION, never as body copy', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Hero: name, positioning, city, Book CTA'], { isHome: true });
    expect(out[0]).toMatchObject({ id: 'hero', type: 'hero' });
    // The half after the colon tells a writer what to write. It is not the
    // writing. This assertion previously expected it as `body`, which is how
    // five consecutive builds published their own outline to customers.
    expect(out[0].instruction).toBe('name, positioning, city, Book CTA');
    expect(out[0].body).toBeNull();
    // A hero carries no heading; the page's own h1 is the headline.
    expect(out[0].heading).toBeUndefined();
  });

  it('extracts a heading from a labelled string section', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Services overview: facials, peels, hair removal'], {});
    expect(out[0]).toMatchObject({ type: 'text', heading: 'Services overview', id: 'services-overview' });
    expect(out[0].instruction).toBe('facials, peels, hair removal');
    expect(out[0].body).toBeNull();
  });

  it('never puts the literal word CTA on the page as a heading', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['CTA: Book your first visit'], {});
    expect(out[0].type).toBe('cta');
    expect(out[0].heading).toBe('Get started');
    expect(out[0].items).toEqual(['Book your first visit']);
  });

  // A home page without a hero is a template failure, not a legitimate shape.
  it('promotes the first section to hero on the home page when nothing typed itself', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Welcome blurb about the studio', 'Services'], { isHome: true });
    expect(out[0].type).toBe('hero');
    expect(out[1].type).toBe('text');
  });

  // REGRESSION: promotion used to write `body` directly from the previous
  // section's heading. The outline label landed in body, and because the copy
  // stage only fills a NULL body it skipped the section, so the echo guard never
  // saw it. A real build published "Opening statement" as its hero.
  it('promotion carries the instruction and leaves body null, so the copy stage still runs', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Opening statement', 'Services'], { isHome: true });
    expect(out[0].type).toBe('hero');
    expect(out[0].body).toBeNull();
    expect(out[0].instruction).toBe('Opening statement');
  });

  it('no section anywhere leaves derivation with a pre-filled body', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Opening statement', 'Hero: welcome', 'Services: what we do'], { isHome: true });
    for (const sec of out) expect(sec.body).toBeNull();
  });

  it('does NOT invent a hero on an interior page', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Some body copy'], { isHome: false });
    expect(out[0].type).toBe('text');
  });

  // Cues match only the leading label; a body that mentions booking is not a CTA.
  it('does not mislabel a section that merely mentions booking in its body', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections(['Policies: cancellations, no-shows, and how to book again'], {});
    expect(out[0].type).toBe('text');
  });

  it('keeps an already-typed object section and repairs an unknown type', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    const out = normalizeSections([
      { id: 'x', type: 'list', heading: 'Offers', items: ['a'] },
      { id: 'y', type: 'carousel', body: 'unsupported' },
    ], {});
    expect(out[0]).toMatchObject({ id: 'x', type: 'list' });
    expect(out[1].type).toBe('text');
  });

  it('produces typed sections end to end from a research-shaped packet', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = {
      packet_id: 'rp_typed', source_adapter: 'shay-native', execution_status: 'partial',
      facts: [], open_questions: [], brand: {}, media_prompts: [],
      site_needs: { pages: ['home'], sections_per_page: { home: ['Hero: warm welcome', 'Services: what we do'] } },
    };
    const spec = deriveSpecFromPacket({ packet, brief: { business: { name: 'X' } }, site_id: 'x' });
    for (const sec of spec.pages[0].sections) expect(typeof sec).toBe('object');
    expect(spec.pages[0].sections[0].type).toBe('hero');
  });
});

// Ruling 4 (2026-08-25): nothing may claim a reach Studio does not have. MBSH is
// deployed and live and Studio could not rebuild it, because the spec vocabulary
// has no field for a database, endpoint, session, job or upload.
describe('capability_class and the carried backend', () => {
  it('derivation always produces a brochure, because it cannot produce anything else', async () => {
    const { deriveSpecFromPacket, classifyCapability } = await import('../server/kernel/spec-derive.js');
    const packet = { packet_id: 'rp_c', source_adapter: 'shay-native', execution_status: 'partial', facts: [], open_questions: [], brand: {}, media_prompts: [], site_needs: { pages: ['home'] } };
    const spec = deriveSpecFromPacket({ packet, brief: { business: { name: 'X' } }, site_id: 'x' });
    expect(spec.capability_class).toBe('brochure');
    expect(classifyCapability(spec)).toBe('brochure');
  });

  it('classifies a spec carrying a backend as an application', async () => {
    const { classifyCapability } = await import('../server/kernel/spec-derive.js');
    expect(classifyCapability({ backend: { root: 'backend' } })).toBe('application');
  });

  it('a declared class beats inference', async () => {
    const { classifyCapability } = await import('../server/kernel/spec-derive.js');
    expect(classifyCapability({ capability_class: 'application' })).toBe('application');
  });

  // Option B is explicitly opaque. Claiming to understand a carried backend
  // would be the same overclaim as a research-derived spec with zero facts.
  it('never claims Studio understands a backend it only carries', async () => {
    const { attachBackend } = await import('../server/kernel/spec-derive.js');
    const s = attachBackend({ pages: [] }, { root: 'backend', runtime: 'php' });
    expect(s.backend.studio_understands_contents).toBe(false);
    expect(s.backend.authored_by).toBe('external');
    expect(s.capability_class).toBe('application');
  });

  // For an application a rendered page proves nothing: a form can post into a
  // void and every DOM assertion still passes.
  it('marks a backend with no behavioral checks as none_declared rather than accepting it silently', async () => {
    const { attachBackend } = await import('../server/kernel/spec-derive.js');
    const s = attachBackend({ pages: [] }, { root: 'backend' });
    expect(s.backend.verification).toBe('none_declared');
    expect(s.backend.note).toMatch(/rendered page is not proof/);
  });

  it('records declared behavioral checks', async () => {
    const { attachBackend } = await import('../server/kernel/spec-derive.js');
    const s = attachBackend({ pages: [] }, { root: 'backend', verify: [{ name: 'a vote records', kind: 'http_post' }] });
    expect(s.backend.verification).toBe('behavioral_declared');
    expect(s.backend.verify).toHaveLength(1);
  });

  it('refuses a backend that does not name the directory Studio would deploy', async () => {
    const { attachBackend } = await import('../server/kernel/spec-derive.js');
    // Assert the code, not the prose: the code is the contract.
    try {
      attachBackend({ pages: [] }, { runtime: 'php' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('backend_root_required');
    }
  });
});

// Ruled 2026-08-25 after the FOURTH instance of one pattern: a fix that
// preserved the defect in the one path that skipped its own discipline. Any path
// writing `body` bypasses the copy stage's echo guard, so no path may write it.
describe('derivation never writes body (the invariant, enforced)', () => {
  it('fails loudly when a section arrives with a pre-written body', async () => {
    const { assertNoPreWrittenBody } = await import('../server/kernel/spec-derive.js');
    try {
      assertNoPreWrittenBody([{ id: 'home', sections: [{ id: 'hero', body: 'written directly' }] }]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('body_written_outside_copy_stage');
      expect(e.message).toMatch(/home\/hero/);
    }
  });

  it('passes when every body is null', async () => {
    const { assertNoPreWrittenBody } = await import('../server/kernel/spec-derive.js');
    expect(() => assertNoPreWrittenBody([{ id: 'home', sections: [{ id: 'hero', body: null }] }])).not.toThrow();
  });

  // The fallback path shipped placeholders like "More about X is coming soon."
  // A placeholder reaching a customer page is the same failure as an outline
  // reaching one: text never written for a reader.
  it('leaves body null even on the no-research fallback path', async () => {
    const { deriveSpecFromPacket } = await import('../server/kernel/spec-derive.js');
    const packet = { packet_id: 'rp_d', source_adapter: 'shay-native', execution_status: 'no_findings', facts: [], open_questions: [], brand: {}, media_prompts: [], site_needs: { pages: ['home', 'about', 'services'] } };
    const spec = deriveSpecFromPacket({ packet, brief: { business: { name: 'Acme', description: 'A bakery.' } }, site_id: 'acme' });
    for (const page of spec.pages) {
      for (const sec of page.sections) {
        expect(sec.body ?? null).toBeNull();
        if (sec.type !== 'list' && sec.type !== 'cta') expect(typeof sec.instruction).toBe('string');
      }
    }
  });

  // Structural: a future direct write should fail review, not ship. Source-level
  // assertion because the runtime invariant only catches paths a test happens to
  // exercise.
  it('no module outside copy.js assigns a non-null body to a section', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('server/kernel/spec-derive.js', 'utf8');
    const writes = [...src.matchAll(/\bbody:\s*([^,\n}]+)/g)]
      .map((m) => m[1].trim())
      // `body: null` is the required shape. splitLabel returns a {heading, body}
      // pair used to PARSE an instruction; it never reaches a section.
      .filter((v) => v !== 'null' && v !== 'text.trim()' && v !== 'm[2].trim()');
    expect(writes).toEqual([]);
  });
});

// EIGHTH instance: the body was routed through the copy stage and the heading
// was left echoing the note. A real build published "Final CTA band" and
// "Credential and license strip" as <h2> on a customer page. Found by LOOKING at
// the render — every metric passed: WebAIM PASS, 100% prose, 9 images.
describe('a layout label is never a heading', () => {
  it('refuses pure layout vocabulary as a heading and folds it into the instruction', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    for (const label of ['Final CTA band', 'Credential and license strip', 'Proof strip', 'Turnaround promise band']) {
      const [sec] = normalizeSections([`${label}: some direction`], {});
      expect(sec.heading, `${label} must not survive as a heading`).toBeUndefined();
      // The writer still needs to know what the section is for.
      expect(sec.instruction).toContain(label);
    }
  });

  // A detector that flags good headings trains you to ignore it. These are
  // ordinary English and must survive.
  it('keeps legitimate headings that merely sound editorial', async () => {
    const { normalizeSections } = await import('../server/kernel/spec-derive.js');
    for (const good of ['Core services at a glance', 'Policy summary in brief', 'Who this is for', 'Location and finding Studio 6']) {
      const [sec] = normalizeSections([`${good}: some direction`], {});
      expect(sec.heading, `${good} is a real heading`).toBe(good);
    }
  });

  it('exposes the check so a gate can use it', async () => {
    const { isLayoutLabel } = await import('../server/kernel/spec-derive.js');
    expect(isLayoutLabel('Final CTA band')).toBe(true);
    expect(isLayoutLabel('Core services at a glance')).toBe(false);
    expect(isLayoutLabel(null)).toBe(false);
  });
});
