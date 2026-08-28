// The WebAIM-six checks (config/quality-gates.json's `webaim_six` gate) --
// the first thing anywhere in this codebase that actually computes it.
// Each check gets a real pass case and a real fail case; a regex-based
// checker over raw HTML is exactly the kind of thing that quietly passes
// broken markup if it isn't tested against the fail case, not just the pass.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { runWebaimSix, createQualityGate } from '../server/kernel/quality-gate.js';

function checkFor(result, id) {
  return result.checks.find((c) => c.id === id);
}

describe('runWebaimSix: missing_alt_text', () => {
  it('passes a page where every image has real alt text', () => {
    const r = runWebaimSix('<html lang="en"><body><img src="a.jpg" alt="A storefront"></body></html>');
    expect(checkFor(r, 'missing_alt_text').pass).toBe(true);
  });
  it('fails and names the offending src for a missing or empty alt', () => {
    const r = runWebaimSix('<html lang="en"><body><img src="a.jpg"><img src="b.jpg" alt=""></body></html>');
    const c = checkFor(r, 'missing_alt_text');
    expect(c.pass).toBe(false);
    expect(c.count).toBe(2);
    expect(c.offenders).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('runWebaimSix: missing_document_language', () => {
  it('passes when <html lang> is present and non-empty', () => {
    const r = runWebaimSix('<html lang="en"><body>x</body></html>');
    expect(checkFor(r, 'missing_document_language').pass).toBe(true);
  });
  it('fails when lang is absent', () => {
    const r = runWebaimSix('<html><body>x</body></html>');
    expect(checkFor(r, 'missing_document_language').pass).toBe(false);
  });
  it('fails when lang is present but empty', () => {
    const r = runWebaimSix('<html lang=""><body>x</body></html>');
    expect(checkFor(r, 'missing_document_language').pass).toBe(false);
  });
});

describe('runWebaimSix: empty_links', () => {
  it('passes a link with real text', () => {
    const r = runWebaimSix('<html lang="en"><body><a href="/book">Book a table</a></body></html>');
    expect(checkFor(r, 'empty_links').pass).toBe(true);
  });
  it('passes an image-only link when the image has real alt text', () => {
    const r = runWebaimSix('<html lang="en"><body><a href="/"><img src="logo.png" alt="Home"></a></body></html>');
    expect(checkFor(r, 'empty_links').pass).toBe(true);
  });
  it('passes an empty-text link that carries an aria-label', () => {
    const r = runWebaimSix('<html lang="en"><body><a href="/" aria-label="Home"></a></body></html>');
    expect(checkFor(r, 'empty_links').pass).toBe(true);
  });
  it('fails a link with no text, no aria-label, and no alt image', () => {
    const r = runWebaimSix('<html lang="en"><body><a href="/mystery"></a></body></html>');
    const c = checkFor(r, 'empty_links');
    expect(c.pass).toBe(false);
    expect(c.offenders).toEqual(['/mystery']);
  });
});

describe('runWebaimSix: empty_buttons', () => {
  it('passes a button with text', () => {
    const r = runWebaimSix('<html lang="en"><body><button>Submit</button></body></html>');
    expect(checkFor(r, 'empty_buttons').pass).toBe(true);
  });
  it('passes an icon button with aria-label', () => {
    const r = runWebaimSix('<html lang="en"><body><button aria-label="Close"><svg></svg></button></body></html>');
    expect(checkFor(r, 'empty_buttons').pass).toBe(true);
  });
  it('fails a button with no text and no aria-label', () => {
    const r = runWebaimSix('<html lang="en"><body><button><svg></svg></button></body></html>');
    expect(checkFor(r, 'empty_buttons').pass).toBe(false);
  });
  it('fails an <input type="submit"> with no value and no aria-label', () => {
    const r = runWebaimSix('<html lang="en"><body><input type="submit"></body></html>');
    expect(checkFor(r, 'empty_buttons').pass).toBe(false);
  });
  it('passes an <input type="submit" value="Send">', () => {
    const r = runWebaimSix('<html lang="en"><body><input type="submit" value="Send"></body></html>');
    expect(checkFor(r, 'empty_buttons').pass).toBe(true);
  });
});

describe('runWebaimSix: missing_form_labels', () => {
  it('passes an input with a for= label', () => {
    const r = runWebaimSix('<html lang="en"><body><label for="email">Email</label><input id="email" type="email"></body></html>');
    expect(checkFor(r, 'missing_form_labels').pass).toBe(true);
  });
  it('passes an input wrapped in a label', () => {
    const r = runWebaimSix('<html lang="en"><body><label>Email <input type="email"></label></body></html>');
    expect(checkFor(r, 'missing_form_labels').pass).toBe(true);
  });
  it('passes an input with aria-label', () => {
    const r = runWebaimSix('<html lang="en"><body><input type="text" aria-label="Search"></body></html>');
    expect(checkFor(r, 'missing_form_labels').pass).toBe(true);
  });
  it('fails a bare input with no label of any kind', () => {
    const r = runWebaimSix('<html lang="en"><body><input id="mystery" type="text"></body></html>');
    const c = checkFor(r, 'missing_form_labels');
    expect(c.pass).toBe(false);
    expect(c.offenders).toEqual(['<input id="mystery">']);
  });
  it('never flags a hidden or submit input as needing a label', () => {
    const r = runWebaimSix('<html lang="en"><body><input type="hidden" name="csrf"><input type="submit" value="Go"></body></html>');
    expect(checkFor(r, 'missing_form_labels').pass).toBe(true);
  });

  // REGRESSION, found running against MBSH's real RSVP page before shipping
  // this file: a honeypot input (aria-hidden="true", tabindex="-1", the
  // standard anti-bot pattern) is deliberately kept from assistive tech --
  // that is correct, not a defect, and must never be flagged.
  it('never flags an aria-hidden honeypot field as needing a label', () => {
    const r = runWebaimSix('<html lang="en"><body><input type="text" name="website" tabindex="-1" aria-hidden="true"></body></html>');
    expect(checkFor(r, 'missing_form_labels').pass).toBe(true);
  });
  it('checks a textarea and a select the same way as an input', () => {
    const r = runWebaimSix('<html lang="en"><body><textarea id="msg"></textarea><select id="choice"><option>a</option></select></body></html>');
    const c = checkFor(r, 'missing_form_labels');
    expect(c.pass).toBe(false);
    expect(c.count).toBe(2);
  });
});

describe('runWebaimSix: low_contrast_text is a proxy over tokens_provenance, reported honestly', () => {
  it('is not computed, and does not fail the page, when no tokens were attempted', () => {
    const r = runWebaimSix('<html lang="en"><body>x</body></html>', { tokensProvenance: null });
    const c = checkFor(r, 'low_contrast_text');
    expect(c.pass).toBeNull();
    expect(r.pass).toBe(true); // nothing else failed; a null check must not drag the verdict down
  });
  it('fails when the site\'s own dominant colours were rejected for contrast at import', () => {
    const r = runWebaimSix('<html lang="en"><body>x</body></html>', { tokensProvenance: { source: 'rejected_low_contrast' } });
    expect(checkFor(r, 'low_contrast_text').pass).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.blocking_failures).toContain('low_contrast_text');
  });
  it('passes when tokens were successfully detected (they already cleared 4.5:1 to be detected at all)', () => {
    const r = runWebaimSix('<html lang="en"><body>x</body></html>', { tokensProvenance: { source: 'detected_from_css' } });
    expect(checkFor(r, 'low_contrast_text').pass).toBe(true);
  });
});

describe('runWebaimSix: overall verdict', () => {
  it('passes a genuinely clean real-shaped page across all six checks', () => {
    const html = `<!doctype html><html lang="en"><body>
      <h1>Welcome</h1>
      <img src="hero.jpg" alt="A welcoming storefront">
      <label for="email">Email</label><input id="email" type="email">
      <a href="/book">Book a table</a>
      <button>Submit</button>
    </body></html>`;
    const r = runWebaimSix(html, { tokensProvenance: { source: 'detected_from_css' } });
    expect(r.pass).toBe(true);
    expect(r.blocking_failures).toEqual([]);
  });

  it('fails and names every real defect on a genuinely broken page, not just the first one', () => {
    const html = `<html><body>
      <img src="a.jpg">
      <input id="mystery" type="text">
      <a href="/x"></a>
      <button></button>
    </body></html>`;
    const r = runWebaimSix(html, { tokensProvenance: { source: 'rejected_low_contrast' } });
    expect(r.pass).toBe(false);
    expect(r.blocking_failures.sort()).toEqual(
      ['empty_buttons', 'empty_links', 'low_contrast_text', 'missing_alt_text', 'missing_document_language', 'missing_form_labels'].sort(),
    );
  });
});

describe('createQualityGate: evaluate()', () => {
  it('returns NOT_FOUND status for non-existent site', () => {
    const paths = {
      resolveSite: () => ({ dir: '/nonexistent', origin: 'site', readOnly: false }),
      siteDir: () => '/nonexistent',
      root: () => '/nonexistent',
    };
    const gate = createQualityGate({ paths });
    const result = gate.evaluate('nonexistent-site');
    expect(result.status).toBe('NOT_FOUND');
    expect(result.verdict).toBe('UNKNOWN');
  });

  // REGRESSION: an earlier version of evaluate() read
  // spec.tokens_provenance.confidence (a field that never exists in the real
  // schema -- tokens_provenance only ever carries {source, sample_count}) and
  // fell through to a hardcoded 85, presented as "Token adherence · 85% --
  // computed styles mapped cleanly to brand tokens." aesthetic_critic did the
  // same with a 3-value lookup table (8.4/6.2/3.5) labeled "vlm rubric" with
  // no model call anywhere. Found live against a real imported site before
  // shipping; fixed to report status: 'not_computed' instead of a number
  // that was never actually measured.
  describe('token_adherence and aesthetic_critic report honestly, never a fabricated score', () => {
    let tmpRoot;
    let baseConfig;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-eval-'));
      baseConfig = loadPathsConfig();
      process.env[baseConfig.data_root_env] = tmpRoot;
    });

    afterEach(() => {
      delete process.env[baseConfig.data_root_env];
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function writeSite(paths, siteId, spec) {
      const dir = path.join(paths.ensure('sites'), siteId);
      fs.mkdirSync(dir, { recursive: true });
      // <section> present so the real (crude but genuine) Geometry check
      // passes too -- otherwise these fixtures would land on REPAIR from a
      // real, correct warn, not from anything token_adherence/aesthetic_critic
      // related, and this describe block's assertions are specifically about
      // the latter two never being the thing that blocks a clean page.
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="en"><body><section><h1>Real headline</h1><img src="a.jpg" alt="A real photo"></section></body></html>');
      fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
    }

    it('reports not_computed with no numeric score when tokens were detected', () => {
      const paths = createPaths();
      writeSite(paths, 'site-with-tokens', { tokens: { bg: '#fff', fg: '#111' }, tokens_provenance: { source: 'detected_from_css', sample_count: 5 } });
      const result = createQualityGate({ paths }).evaluate('site-with-tokens');
      const tokenLane = result.lanes.find((l) => l.id === 'token_adherence');
      expect(tokenLane.status).toBe('not_computed');
      expect(tokenLane.name).not.toMatch(/%/); // no fabricated percentage in the label
      const criticLane = result.lanes.find((l) => l.id === 'aesthetic_critic');
      expect(criticLane.status).toBe('not_computed');
      expect(criticLane.name).not.toMatch(/\d/); // no fabricated decimal score
    });

    it('reports not_computed the same way when tokens_provenance.confidence is absent (the real, always-true case)', () => {
      const paths = createPaths();
      // tokens_provenance never carries a confidence field in the real
      // schema (server/kernel/importer-tokens.js) -- this is every real
      // imported site's actual shape, not a contrived edge case.
      writeSite(paths, 'site-real-shape', { tokens: { bg: '#fff', fg: '#111' }, tokens_provenance: { source: 'detected_from_css', sample_count: 3 } });
      const result = createQualityGate({ paths }).evaluate('site-real-shape');
      expect(result.lanes.find((l) => l.id === 'token_adherence').status).toBe('not_computed');
    });

    it('never contributes a not_computed lane to the fail or warn count, or the repair queue', () => {
      const paths = createPaths();
      writeSite(paths, 'site-clean', { tokens: { bg: '#fff', fg: '#111' }, tokens_provenance: { source: 'detected_from_css', sample_count: 3 } });
      const result = createQualityGate({ paths }).evaluate('site-clean');
      // The fixture page passes every genuinely-computed lane (real h1,
      // real alt text, lang set, no outline-leak text) -- verdict must be
      // decided by those, not blocked by a lane that was never measured.
      expect(result.verdict).toBe('PASS');
      expect(result.repair_queue.some((r) => r.code === 'TOKEN-01')).toBe(false);
    });

    it('token_audit reports computed: false rather than an invented percentage breakdown', () => {
      const paths = createPaths();
      writeSite(paths, 'site-audit', { tokens: { bg: '#fff', fg: '#111' }, tokens_provenance: { source: 'detected_from_css', sample_count: 3 } });
      const result = createQualityGate({ paths }).evaluate('site-audit');
      expect(result.token_audit.computed).toBe(false);
      expect(result.token_audit.on_brand).toBeUndefined();
    });

    it('the PASS summary never claims all six lanes cleared, since two are not computed', () => {
      const paths = createPaths();
      writeSite(paths, 'site-summary', { tokens: { bg: '#fff', fg: '#111' }, tokens_provenance: { source: 'detected_from_css', sample_count: 3 } });
      const result = createQualityGate({ paths }).evaluate('site-summary');
      expect(result.summary).not.toMatch(/all six/i);
    });
  });
});

