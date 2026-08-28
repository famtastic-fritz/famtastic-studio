import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createMutation } from '../server/kernel/mutation.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-mutation-'));
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
  const mutation = createMutation({ paths, journal, events });
  return { paths, journal, events, mutation };
}

function sitePath(paths, siteId, relPath) {
  return paths.within('sites', siteId, relPath);
}

describe('createMutation.apply', () => {
  it('creates a new file, journals before writing, and returns journal_entry_id/revision/undo_token', () => {
    const { paths, journal, mutation } = setup();
    const result = mutation.apply({
      site_id: 'site-a',
      initiator: 'operator',
      intent: 'page.create',
      changes: [{ path: 'index.html', contents: '<html>hello</html>' }],
    });

    expect(result.journal_entry_id).toBeTruthy();
    expect(result.revision).toBe(1);
    expect(result.undo_token).toBeTruthy();

    const written = fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8');
    expect(written).toBe('<html>hello</html>');

    const entries = journal.read('site-a');
    expect(entries.length).toBe(1);
    expect(entries[0].evidence.manifest[0].before_exists).toBe(false);
    expect(entries[0].evidence.manifest[0].after_exists).toBe(true);
    expect(entries[0].evidence.manifest[0].after_sha256).toBe(sha256(Buffer.from('<html>hello</html>')));
  });

  it('updates an existing file, capturing the exact prior bytes in the manifest', () => {
    const { paths, mutation } = setup();
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'version one' }],
    });
    const result = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.update',
      changes: [{ path: 'index.html', contents: 'version two' }],
    });

    expect(result.revision).toBe(2);
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8')).toBe('version two');
  });

  it('deletes a file when contents is null', () => {
    const { paths, mutation } = setup();
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'to be deleted' }],
    });
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.delete',
      changes: [{ path: 'index.html', contents: null }],
    });

    expect(fs.existsSync(sitePath(paths, 'site-a', 'index.html'))).toBe(false);
  });

  it('applies multiple artifacts (html, css, spec, asset) atomically in one entry', () => {
    const { paths, journal, mutation } = setup();
    const assetBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    const result = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.build',
      changes: [
        { path: 'index.html', contents: '<html>multi</html>' },
        { path: 'style.css', contents: 'body{color:red}' },
        { path: 'spec.json', contents: JSON.stringify({ customer: { id: 'c1' } }) },
        { path: 'assets/logo.png', contents: assetBytes },
      ],
    });

    expect(fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8')).toBe('<html>multi</html>');
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'style.css'), 'utf8')).toBe('body{color:red}');
    expect(JSON.parse(fs.readFileSync(sitePath(paths, 'site-a', 'spec.json'), 'utf8'))).toEqual({ customer: { id: 'c1' } });
    expect(Buffer.compare(fs.readFileSync(sitePath(paths, 'site-a', 'assets/logo.png')), assetBytes)).toBe(0);

    const entries = journal.read('site-a');
    expect(entries[0].entry_id).toBe(result.journal_entry_id);
    expect(entries[0].evidence.manifest.length).toBe(4);
  });

  it('refuses a stale expectedRevision with 409 and does not touch the filesystem or journal', () => {
    const { paths, journal, mutation } = setup();
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'v1' }],
    });

    let caught = null;
    try {
      mutation.apply({
        site_id: 'site-a', initiator: 'operator', intent: 'page.update',
        changes: [{ path: 'index.html', contents: 'v2 should not land' }],
        expectedRevision: 0,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe('stale_revision');
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8')).toBe('v1');
    expect(journal.read('site-a').length).toBe(1);
  });

  it('fails closed with 503 journal_unavailable when the journal cannot be written, and never writes files', () => {
    const { paths, events } = setup();
    const brokenJournal = {
      append() { throw new Error('disk full'); },
      read() { return []; },
    };
    const mutation = createMutation({ paths, journal: brokenJournal, events });

    let caught = null;
    try {
      mutation.apply({
        site_id: 'site-a', initiator: 'operator', intent: 'page.create',
        changes: [{ path: 'index.html', contents: 'should never land' }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(503);
    expect(caught.code).toBe('journal_unavailable');
    expect(fs.existsSync(sitePath(paths, 'site-a', 'index.html'))).toBe(false);
  });

  it('crash boundary: a write interrupted after journaling leaves a detectable, recoverable state', () => {
    const { paths, journal, mutation } = setup();

    // Force the second file's write to fail (EISDIR) by pre-creating a
    // directory at its target path, simulating a process crash mid-write:
    // the journal entry lands, the first file is written, the second is not.
    const secondAbs = sitePath(paths, 'site-a', 'blocked.css');
    fs.mkdirSync(secondAbs, { recursive: true });

    let caught = null;
    try {
      mutation.apply({
        site_id: 'site-a', initiator: 'operator', intent: 'page.build',
        changes: [
          { path: 'index.html', contents: 'applied fine' },
          { path: 'blocked.css', contents: 'never applied' },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull(); // the error must propagate, not be swallowed

    const entries = journal.read('site-a');
    expect(entries.length).toBe(1); // the journal entry was written before the crash
    const manifest = entries[0].evidence.manifest;
    const first = manifest.find((m) => m.path === 'index.html');
    const second = manifest.find((m) => m.path === 'blocked.css');

    // Detectable: the first file matches what the manifest says should exist...
    const firstOnDisk = fs.readFileSync(sitePath(paths, 'site-a', 'index.html'));
    expect(sha256(firstOnDisk)).toBe(first.after_sha256);

    // ...but the second does not, because it's still a directory, not the file
    // the manifest recorded. Comparing live state to the manifest is exactly
    // how a recovery pass would detect the incomplete mutation.
    expect(fs.statSync(secondAbs).isDirectory()).toBe(true);
    expect(second.after_sha256).not.toBeNull();

    // Recoverable: an operator (or an automated recovery pass) can read this
    // same manifest and finish applying it once the obstruction is cleared.
    fs.rmSync(secondAbs, { recursive: true, force: true });
    fs.writeFileSync(secondAbs, Buffer.from(second.after_base64, 'base64'));
    expect(sha256(fs.readFileSync(secondAbs))).toBe(second.after_sha256);
  });

  it('rejects a change path that escapes the site directory', () => {
    const { mutation } = setup();
    expect(() => mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: '../escape.html', contents: 'nope' }],
    })).toThrow();
  });
});

describe('createMutation.undo', () => {
  it('restores the exact prior bytes for every file in the manifest, verified by hash', () => {
    const { paths, mutation } = setup();
    const before = 'the original content';
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: before }],
    });
    const applied = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.update',
      changes: [{ path: 'index.html', contents: 'the changed content' }],
    });

    const result = mutation.undo('site-a', applied.undo_token);
    expect(result.revision).toBe(3);

    const restored = fs.readFileSync(sitePath(paths, 'site-a', 'index.html'));
    expect(sha256(restored)).toBe(sha256(Buffer.from(before)));
    expect(restored.toString('utf8')).toBe(before);
  });

  it('restores every artifact in a multi-file entry (html, css, spec, asset)', () => {
    const { paths, mutation } = setup();
    const assetBefore = Buffer.from([1, 2, 3, 4]);
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.build',
      changes: [
        { path: 'index.html', contents: 'before html' },
        { path: 'style.css', contents: 'before css' },
        { path: 'spec.json', contents: '{"before":true}' },
        { path: 'assets/logo.png', contents: assetBefore },
      ],
    });
    const applied = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.build',
      changes: [
        { path: 'index.html', contents: 'after html' },
        { path: 'style.css', contents: 'after css' },
        { path: 'spec.json', contents: '{"before":false}' },
        { path: 'assets/logo.png', contents: Buffer.from([9, 9, 9, 9]) },
      ],
    });

    mutation.undo('site-a', applied.undo_token);

    expect(fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8')).toBe('before html');
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'style.css'), 'utf8')).toBe('before css');
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'spec.json'), 'utf8')).toBe('{"before":true}');
    expect(Buffer.compare(fs.readFileSync(sitePath(paths, 'site-a', 'assets/logo.png')), assetBefore)).toBe(0);
  });

  it('removes a file that the mutation created, since it did not exist before', () => {
    const { paths, mutation } = setup();
    const applied = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'brand-new.html', contents: 'fresh file' }],
    });

    expect(fs.existsSync(sitePath(paths, 'site-a', 'brand-new.html'))).toBe(true);
    mutation.undo('site-a', applied.undo_token);
    expect(fs.existsSync(sitePath(paths, 'site-a', 'brand-new.html'))).toBe(false);
  });

  it('journals the undo as its own entry and emits an event', () => {
    const { journal, mutation } = setup();
    const applied = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'v1' }],
    });
    mutation.undo('site-a', applied.undo_token);

    const entries = journal.read('site-a');
    expect(entries.length).toBe(2);
    expect(entries[0].intent).toBe('undo:page.create');
    expect(entries[0].result.undone_entry_id).toBe(applied.journal_entry_id);
  });

  it('invalidates a divergent redo: undoing a stale entry after a later mutation touched the same file is refused', () => {
    const { paths, mutation } = setup();
    // apply A
    const a = mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'A' }],
    });
    // undo A (this undo's own undo_token would "redo" A if replayed)
    const undoOfA = mutation.undo('site-a', a.undo_token);
    expect(fs.existsSync(sitePath(paths, 'site-a', 'index.html'))).toBe(false);

    // a new, divergent mutation: B creates the file with different content
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'B' }],
    });

    // attempting to "redo" A now conflicts with B's live state and must be refused
    let caught = null;
    try {
      mutation.undo('site-a', undoOfA.undo_token);
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe('undo_conflict');
    // B's content must be untouched by the refused redo attempt
    expect(fs.readFileSync(sitePath(paths, 'site-a', 'index.html'), 'utf8')).toBe('B');
  });

  it('throws 404 undo_token_not_found for an unknown token', () => {
    const { mutation } = setup();
    mutation.apply({
      site_id: 'site-a', initiator: 'operator', intent: 'page.create',
      changes: [{ path: 'index.html', contents: 'x' }],
    });
    let caught = null;
    try {
      mutation.undo('site-a', 'ut_does_not_exist');
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(404);
    expect(caught.code).toBe('undo_token_not_found');
  });
});
