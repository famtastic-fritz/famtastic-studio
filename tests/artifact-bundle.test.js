import { describe, expect, it } from 'vitest';
import { createArtifactBundle, materializeArtifactBundle, validateArtifactBundle } from '../server/kernel/artifact-bundle.js';

describe('approved proof artifact bundle', () => {
  it('round-trips HTML, CSS, JavaScript, and binary bytes', () => {
    const bundle = createArtifactBundle([
      { path: 'index.html', contents: '<h1>Proof</h1>' },
      { path: 'styles.css', contents: 'body{background:#000}' },
      { path: 'js/main.js', contents: 'window.proof=true' },
      { path: 'images/hero.bin', bytes: Buffer.from([0, 1, 2, 255]) },
    ]);
    expect(validateArtifactBundle(bundle)).toEqual([]);
    const files = materializeArtifactBundle(bundle);
    expect(files.find((file) => file.path === 'index.html').html).toBe('<h1>Proof</h1>');
    expect(files.find((file) => file.path === 'styles.css').contents.toString()).toBe('body{background:#000}');
    expect([...files.find((file) => file.path === 'images/hero.bin').contents]).toEqual([0, 1, 2, 255]);
  });

  it('refuses tampered bytes and traversal paths', () => {
    const bundle = createArtifactBundle([{ path: 'index.html', contents: '<h1>Proof</h1>' }]);
    const tampered = { ...bundle, files: [{ ...bundle.files[0], content_base64: Buffer.from('<h1>Changed</h1>').toString('base64') }] };
    expect(validateArtifactBundle(tampered).some((error) => /digest/i.test(error))).toBe(true);
    expect(validateArtifactBundle({ ...bundle, files: [{ ...bundle.files[0], path: '../index.html' }] })).toContain('files[0].path is not a safe relative path');
  });
});
