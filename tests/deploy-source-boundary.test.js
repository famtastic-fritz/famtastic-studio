import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDeploy } from '../server/kernel/deploy.js';
let root; let previous;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-boundary-')); previous = process.env.STUDIO_DATA_ROOT; process.env.STUDIO_DATA_ROOT = root; });
afterEach(() => { if (previous === undefined) delete process.env.STUDIO_DATA_ROOT; else process.env.STUDIO_DATA_ROOT = previous; fs.rmSync(root, { recursive: true }); });
function fixture() {
  const paths = createPaths(); const journal = createJournal({ paths }); const events = createEvents({ paths });
  const deploy = createDeploy({ paths, journal, events }); const dir = paths.within('sites', 'source-site');
  fs.mkdirSync(path.join(dir, '.famtastic'), { recursive: true }); fs.writeFileSync(path.join(dir, 'index.html'), '<h1>home</h1>');
  return { paths, deploy, dir };
}
describe('static deployment source boundary', () => {
  it('rejects unsafe source allowlists before any deployment target or receipt writes', () => {
    const { paths, deploy, dir } = fixture();
    fs.writeFileSync(path.join(dir, '.famtastic/site-manifest.json'), '{"format":"source_repository"}');
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/explicit public-file allowlist/);
    const file = path.join(dir, '.famtastic/public-files.json');
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, files: ['index.html', 'package.json'] }));
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/cannot be included/);
    expect(deploy.list('source-site').receipts).toEqual([]);
    expect(fs.existsSync(paths.within('famtasticinc', 'source-site'))).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, files: ['index.html'] }));
    const receipt = deploy.deploy({ site_id: 'source-site', initiator: 'operator' });
    expect(receipt.manifest.map(entry => entry.path)).toEqual(['index.html']);
  });
  it('refuses symlinked public files without copying their content', () => {
    const { deploy, dir } = fixture();
    fs.writeFileSync(path.join(root, 'private.css'), 'sensitive source');
    fs.symlinkSync(path.join(root, 'private.css'), path.join(dir, 'stolen.css'));
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/symlink/);
    expect(deploy.list('source-site').receipts).toEqual([]);
  });
});
