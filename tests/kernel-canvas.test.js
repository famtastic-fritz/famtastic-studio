import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createCanvas, parseLeaves } from '../server/kernel/canvas.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-canvas-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup() {
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const canvas = createCanvas({ paths, journal, events });
  const mutation = createMutation({ paths, journal, events });
  return { paths, journal, events, canvas, mutation };
}

function writePage(paths, siteId, relPath, html) {
  const abs = paths.within('sites', siteId, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, html);
  return abs;
}

const PAGE = '<!doctype html><html><head><title>Test</title></head><body><h1>Hello world</h1><p>Some body text.</p></body></html>';

describe('parseLeaves', () => {
  it('stamps a deterministic selector for the same element across parses', () => {
    const first = parseLeaves(PAGE);
    const second = parseLeaves(PAGE);
    expect(first.map((l) => l.selector)).toEqual(second.map((l) => l.selector));
    expect(first.find((l) => l.tag === 'h1').selector).toBe('html[1]>body[1]>h1[1]');
    expect(first.find((l) => l.tag === 'p').selector).toBe('html[1]>body[1]>p[1]');
  });

  it('does not treat elements with nested element children as leaves', () => {
    const html = '<html><body><div><span>a</span><span>b</span></div></body></html>';
    const leaves = parseLeaves(html);
    expect(leaves.some((l) => l.tag === 'div')).toBe(false);
    expect(leaves.filter((l) => l.tag === 'span').length).toBe(2);
  });
});

describe('canvas.serve', () => {
  it('instruments every text leaf with data-fam-sel and data-fam-path', () => {
    const { paths, canvas } = setup();
    writePage(paths, 'site-a', 'index.html', PAGE);
    const html = canvas.serve('site-a', 'index.html');
    expect(html).toContain('data-fam-sel="html[1]>body[1]>h1[1]"');
    expect(html).toContain('data-fam-path="index.html"');
    expect(html).toContain('/kit/canvas-edit.js');
  });

  it('rejects a traversal page_path without touching the filesystem', () => {
    const { paths, canvas } = setup();
    writePage(paths, 'site-a', 'index.html', PAGE);
    expect(() => canvas.serve('site-a', '../../etc/passwd')).toThrowError(
      expect.objectContaining({ statusCode: 400, code: 'invalid_page_path' }),
    );
  });
});

describe('canvas.applyEdit', () => {
  it('journals the edit before the new bytes are visible, and returns the contract shape', () => {
    const { paths, journal, canvas } = setup();
    const abs = writePage(paths, 'site-a', 'index.html', PAGE);

    const result = canvas.applyEdit({
      site_id: 'site-a',
      page_path: 'index.html',
      selector: 'html[1]>body[1]>h1[1]',
      before_text: 'Hello world',
      after_text: 'Hello universe',
    });

    expect(result.revision).toBe(1);
    expect(typeof result.journal_entry_id).toBe('string');
    expect(typeof result.undo_token).toBe('string');
    expect(typeof result.applied_ms).toBe('number');
    expect(result.applied_ms).toBeGreaterThanOrEqual(0);

    const entries = journal.read('site-a');
    expect(entries.length).toBe(1);
    expect(entries[0].intent).toBe('canvas.edit');
    // The manifest recorded in the journal already carries the after bytes
    // that were then written -- the edit was visible (journaled) before or
    // exactly as the write landed, never after an unrecorded write.
    const manifest = entries[0].evidence.manifest[0];
    expect(Buffer.from(manifest.after_base64, 'base64').toString('utf8')).toContain('Hello universe');

    const onDisk = fs.readFileSync(abs, 'utf8');
    expect(onDisk).toContain('<h1>Hello universe</h1>');
    expect(onDisk).not.toContain('data-fam-sel');
  });

  it('refuses a stale selection with 409 instead of a blind overwrite', () => {
    const { paths, canvas } = setup();
    const abs = writePage(paths, 'site-a', 'index.html', PAGE);

    expect(() =>
      canvas.applyEdit({
        site_id: 'site-a',
        page_path: 'index.html',
        selector: 'html[1]>body[1]>h1[1]',
        before_text: 'This is not what is on disk',
        after_text: 'Attempted overwrite',
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 409, code: 'stale_selection' }));

    // The file must be completely untouched by the refused edit.
    expect(fs.readFileSync(abs, 'utf8')).toBe(PAGE);
  });

  it('refuses a selector that no longer resolves to any element', () => {
    const { paths, canvas } = setup();
    writePage(paths, 'site-a', 'index.html', PAGE);

    expect(() =>
      canvas.applyEdit({
        site_id: 'site-a',
        page_path: 'index.html',
        selector: 'html[1]>body[1]>h2[1]',
        before_text: 'Hello world',
        after_text: 'Hello universe',
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 409, code: 'stale_selection' }));
  });

  it('rejects a traversal page_path on apply, never reaching the filesystem outside the site', () => {
    const { paths, canvas } = setup();
    writePage(paths, 'site-a', 'index.html', PAGE);

    expect(() =>
      canvas.applyEdit({
        site_id: 'site-a',
        page_path: '../../../etc/passwd',
        selector: 'html[1]>body[1]>h1[1]',
        before_text: 'Hello world',
        after_text: 'pwned',
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, code: 'invalid_page_path' }));
  });

  it('undo restores the exact prior bytes after a canvas edit', () => {
    const { paths, canvas, mutation } = setup();
    const abs = writePage(paths, 'site-a', 'index.html', PAGE);
    const before = fs.readFileSync(abs);

    const result = canvas.applyEdit({
      site_id: 'site-a',
      page_path: 'index.html',
      selector: 'html[1]>body[1]>h1[1]',
      before_text: 'Hello world',
      after_text: 'Hello universe',
    });

    expect(fs.readFileSync(abs, 'utf8')).not.toEqual(before.toString('utf8'));

    mutation.undo('site-a', result.undo_token);

    const restored = fs.readFileSync(abs);
    expect(restored.equals(before)).toBe(true);
  });

  // REGRESSION: the entity map originally covered only markup-syntax
  // characters (amp/lt/gt/quot/apos/nbsp). A real page's "&mdash;" decoded to
  // the six literal characters here while a browser-based client's
  // before_text already held a real em dash, so the comparison never
  // matched: every edit on real marketing copy containing an em dash, curly
  // quote, or ellipsis would 409 as falsely stale, forever, with no actual
  // conflict. This is exactly the shape of page the acceptance walkthrough
  // edits.
  it('does not falsely reject an edit on a page whose text uses named HTML entities', () => {
    const { paths, canvas } = setup();
    const withEntities = '<!doctype html><html><head><title>T</title></head><body><h1>Quiet luxury &mdash; for your skin</h1></body></html>';
    writePage(paths, 'site-a', 'index.html', withEntities);

    // What a real browser's DOM would hand a client as before_text: the
    // entity already decoded to a real em dash, not the literal source text.
    const result = canvas.applyEdit({
      site_id: 'site-a',
      page_path: 'index.html',
      selector: 'html[1]>body[1]>h1[1]',
      before_text: 'Quiet luxury — for your skin',
      after_text: 'Quiet luxury — for glowing skin',
    });
    expect(result.revision).toBe(1);
  });

  it('inlines local stylesheets and rewrites local asset URLs into canvas HTML', () => {
    const { paths, canvas } = setup();
    const cssPath = paths.within('sites', 'site-a', 'css', 'main.css');
    fs.mkdirSync(path.dirname(cssPath), { recursive: true });
    fs.writeFileSync(cssPath, 'body { background: #000; color: #fff; background-image: url("../images/bg.jpg"); }');

    const htmlWithCss = '<!doctype html><html><head><title>Styled</title><link rel="stylesheet" href="css/main.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter"></head><body><h1>Styled Heading</h1><img src="images/logo.png" alt="Logo"></body></html>';
    writePage(paths, 'site-a', 'index.html', htmlWithCss);

    const served = canvas.serve('site-a', 'index.html');
    expect(served).toContain('<style data-fam-href="css/main.css">');
    expect(served).toContain('background: #000');
    expect(served).toContain('color: #fff');
    expect(served).toContain('https://fonts.googleapis.com/css?family=Inter');
    expect(served).toContain('data-fam-sel="html[1]>body[1]>h1[1]"');
  });
});
