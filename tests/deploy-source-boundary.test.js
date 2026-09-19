import { appendCreatorCredit, creatorLogoAsset, CREATOR_LOGO_PATH } from '../vendor/site-foundation/index.js';
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
  fs.mkdirSync(path.join(dir, '.famtastic'), { recursive: true }); fs.writeFileSync(path.join(dir, 'index.html'), appendCreatorCredit('<html><body><h1>home</h1></body></html>'));
  fs.mkdirSync(path.dirname(path.join(dir, CREATOR_LOGO_PATH)), { recursive: true }); fs.writeFileSync(path.join(dir, CREATOR_LOGO_PATH), creatorLogoAsset().contents);
  return { paths, deploy, dir };
}
describe('static deployment source boundary', () => {
  it('accepts existing explicit array manifests through the same publication gates', () => {
    const { deploy, dir } = fixture();
    fs.writeFileSync(path.join(dir, '.famtastic/site-manifest.json'), '{"format":"source_repository"}');
    const file = path.join(dir, '.famtastic/public-files.json');
    fs.writeFileSync(path.join(dir, '.htaccess'), 'Options -Indexes\n');
    fs.writeFileSync(file, JSON.stringify(['index.html', '.htaccess', CREATOR_LOGO_PATH]));
    expect(deploy.plan({ site_id: 'source-site' }).files.map(entry => entry.path)).toEqual(['index.html', '.htaccess', CREATOR_LOGO_PATH]);
    const receipt = deploy.deploy({ site_id: 'source-site', initiator: 'operator' });
    expect(fs.readFileSync(path.join(receipt.target, '.htaccess'), 'utf8')).toBe('Options -Indexes\n');
    fs.writeFileSync(file, JSON.stringify(['index.html', 'docs/private.html']));
    expect(() => deploy.plan({ site_id: 'source-site' })).toThrow(/cannot be included/);
    fs.writeFileSync(file, JSON.stringify(['index.html', { path: 'other.html' }]));
    expect(() => deploy.plan({ site_id: 'source-site' })).toThrow(/cannot be included/);
    fs.writeFileSync(file, JSON.stringify({ files: ['index.html', CREATOR_LOGO_PATH] }));
    expect(() => deploy.plan({ site_id: 'source-site' })).toThrow(/explicit public-file array or version 1/);
    expect(deploy.list('source-site').receipts).toHaveLength(1);
  });
  it('rejects unsafe source allowlists before any deployment target or receipt writes', () => {
    const { paths, deploy, dir } = fixture();
    fs.writeFileSync(path.join(dir, '.famtastic/site-manifest.json'), '{"format":"source_repository"}');
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/explicit public-file allowlist/);
    const file = path.join(dir, '.famtastic/public-files.json');
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, files: ['index.html', 'package.json'] }));
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/cannot be included/);
    expect(deploy.list('source-site').receipts).toEqual([]);
    expect(fs.existsSync(paths.within('famtasticinc', 'source-site'))).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, files: ['index.html', CREATOR_LOGO_PATH] }));
    const receipt = deploy.deploy({ site_id: 'source-site', initiator: 'operator' });
    expect(receipt.manifest.map(entry => entry.path)).toEqual(['index.html', CREATOR_LOGO_PATH]);
  });
  it('refuses symlinked public files without copying their content', () => {
    const { deploy, dir } = fixture();
    fs.writeFileSync(path.join(root, 'private.css'), 'sensitive source');
    fs.symlinkSync(path.join(root, 'private.css'), path.join(dir, 'stolen.css'));
    expect(() => deploy.deploy({ site_id: 'source-site', initiator: 'operator' })).toThrow(/symlink/);
    expect(deploy.list('source-site').receipts).toEqual([]);
  });
});
