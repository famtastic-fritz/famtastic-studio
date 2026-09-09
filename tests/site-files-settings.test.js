import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createApp } from '../server/kernel/app.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import sitesModule from '../server/modules/sites/index.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-site-files-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function createTestServer() {
  const paths = createPaths();
  const app = createApp({ paths });
  const journal = createJournal({ paths });
  const events = createEvents({ paths });

  sitesModule.register({ app, paths, journal, events });

  const server = http.createServer((req, res) => {
    app.handler(req, res);
  });
  return { server, paths };
}

describe('Site Files & Settings API', () => {
  it('lists grouped files, reads file content, and mutates file on disk', async () => {
    const { server, paths } = createTestServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const siteId = 'site-test-ide';
    const siteDir = paths.within('sites', siteId);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>Home</h1>', 'utf8');
    fs.writeFileSync(path.join(siteDir, 'about.html'), '<h1>About</h1>', 'utf8');
    fs.writeFileSync(path.join(siteDir, 'styles.css'), 'body { background: #000; }', 'utf8');
    fs.writeFileSync(path.join(siteDir, 'spec.json'), '{"business":{"name":"Test"}}', 'utf8');

    // 1. GET /api/sites/files
    const resFiles = await fetch(`http://127.0.0.1:${port}/api/sites/files?site_id=${siteId}`);
    expect(resFiles.status).toBe(200);
    const filesData = await resFiles.json();
    expect(filesData.pages.length).toBe(2);
    expect(filesData.styles.length).toBe(1);
    expect(filesData.configs.length).toBe(1);

    // 2. GET /api/sites/file
    const resRead = await fetch(`http://127.0.0.1:${port}/api/sites/file?site_id=${siteId}&file=index.html`);
    expect(resRead.status).toBe(200);
    const readData = await resRead.json();
    expect(readData.content).toBe('<h1>Home</h1>');

    // 3. POST /api/sites/file
    const resWrite = await fetch(`http://127.0.0.1:${port}/api/sites/file?site_id=${siteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'index.html', content: '<h1>Updated Home</h1>' }),
    });
    expect(resWrite.status).toBe(200);
    expect(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8')).toBe('<h1>Updated Home</h1>');

    // 4. GET /api/sites/settings
    const resSettings = await fetch(`http://127.0.0.1:${port}/api/sites/settings?site_id=${siteId}`);
    expect(resSettings.status).toBe(200);
    const settingsData = await resSettings.json();
    expect(settingsData.site_id).toBe(siteId);
    expect(settingsData.deployment_target).toBe('famtasticinc');

    // 5. POST /api/sites/settings
    const resUpdateSettings = await fetch(`http://127.0.0.1:${port}/api/sites/settings?site_id=${siteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_name: 'Super Movers',
        git_repo_url: 'https://github.com/my-org/super-movers.git',
        domain: 'supermovers.com',
      }),
    });
    expect(resUpdateSettings.status).toBe(200);

    const ctxFile = path.join(siteDir, '.site-context', 'site-context.json');
    expect(fs.existsSync(ctxFile)).toBe(true);
    const savedCtx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
    expect(savedCtx.git_repo_url).toBe('https://github.com/my-org/super-movers.git');
    expect(savedCtx.domain).toBe('supermovers.com');
    expect(savedCtx.deployment_target).toBe('famtasticinc');

    const resUnsupportedTarget = await fetch(`http://127.0.0.1:${port}/api/sites/settings?site_id=${siteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deployment_target: 'netlify' }),
    });
    expect(resUnsupportedTarget.status).toBe(422);
    expect((await resUnsupportedTarget.json()).error).toBe('deployment_target_not_supported');

    server.close();
  });
});
