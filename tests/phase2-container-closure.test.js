import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../', import.meta.url));
const containerRoot = 'infra/gcp/phase2/containers';
const helper = 'server/kernel/cli-entry.js';
const roots = [];
const read = (file) => fs.readFileSync(path.join(repository, file), 'utf8');

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function safePath(value) {
  if (!/^[\w./-]+$/.test(value) || value.startsWith('/')
    || value.split('/').some((part) => part === '..')) throw new Error(`unsupported path: ${value}`);
  return value.replace(/^\.\//, '').replace(/\/$/, '');
}

function matches(file, pattern) {
  return pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern.replace(/\/$/, '');
}

function filesUnder(relative) {
  const entry = fs.lstatSync(path.join(repository, relative));
  if (entry.isFile()) return [relative];
  if (!entry.isDirectory()) throw new Error(`nonregular context source: ${relative}`);
  return fs.readdirSync(path.join(repository, relative)).sort()
    .flatMap((name) => filesUnder(`${relative}/${name}`));
}

function recipe(role) {
  const dockerfile = `${containerRoot}/${role}.Dockerfile`;
  const boundaries = read('infra/gcp/phase2/source-boundaries.yaml');
  const block = boundaries.match(new RegExp(`^  ${role}:\\n([\\s\\S]*?)(?=^  \\w+:|^rules:)`, 'm'))?.[1];
  const includes = block?.match(/^    include:\n((?:      - [^\n]+\n)+)/m)?.[1];
  if (!includes) throw new Error('unsupported source-boundaries include syntax');
  const include = includes.trim().split('\n').map((line) => line.trim().replace(/^- /, ''));
  for (const pattern of include) safePath(pattern.replace(/\/\*\*$/, ''));
  expect(block).toContain(`    dockerfile: ${dockerfile}\n`);
  expect(block).toContain(`    entrypoint: server/cloud/${role}-main.js\n`);
  return { role, docker: read(dockerfile), ignore: read(`${dockerfile}.dockerignore`), include };
}

// Model only the current literal COPY and deny-all/exact-allowlist grammar.
// Refuse unknown syntax instead of silently treating this as a Docker builder.
function copyContext({ role, docker, ignore, include }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-container-closure-'));
  roots.push(root);
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  const rules = ignore.trim().split('\n').filter((line) => line && !line.startsWith('#'));
  expect(rules.shift()).toBe('**');
  const allowed = rules.map((rule) => {
    if (!rule.startsWith('!')) throw new Error(`unsupported dockerignore rule: ${rule}`);
    safePath(rule.slice(1).replace(/\/\*\*$/, ''));
    return rule.slice(1);
  });
  const copied = [];
  for (const line of docker.split('\n').filter((line) => /^COPY\b/.test(line))) {
    const words = line.split(/\s+/);
    if (words.shift() !== 'COPY' || words.shift() !== '--chown=node:node' || words.length < 2) {
      throw new Error(`unsupported COPY: ${line}`);
    }
    const destination = words.pop();
    for (const source of words) {
      const relative = safePath(source);
      // Current Dockerfiles preserve every source path beneath WORKDIR /app.
      if (destination !== './' && safePath(destination) !== relative) throw new Error('unsupported COPY destination');
      if (destination === './' && relative.includes('/')) throw new Error('unsupported root COPY source');
      for (const file of filesUnder(relative)) {
        const segments = file.split('/');
        for (let depth = 1; depth <= segments.length; depth++) {
          const prefix = segments.slice(0, depth).join('/');
          if (!allowed.some((pattern) => matches(prefix, pattern))) throw new Error(`context excludes ${prefix}`);
        }
        if (!include.some((pattern) => matches(file, pattern))) throw new Error(`boundary excludes ${file}`);
        fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
        fs.copyFileSync(path.join(repository, file), path.join(app, file));
        copied.push(file);
      }
    }
  }
  expect(docker).toContain('WORKDIR /app\n');
  expect(docker).toContain('USER node\n');
  expect(docker).toContain(`CMD ["node", "server/cloud/${role}-main.js"]`);
  // Reuse byte-matched existing packages without an install or copying them.
  fs.symlinkSync(fs.realpathSync(path.join(repository, 'node_modules')), path.join(app, 'node_modules'), 'dir');
  const guard = path.join(root, 'deny-network.mjs');
  fs.writeFileSync(guard, `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
function deny() { attempts++; throw new Error('container_test_network_denied'); }
globalThis.fetch = deny;
for (const transport of [http, https]) { transport.request = deny; transport.get = deny; }
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
net.Server.prototype.listen = tls.connect = deny;
syncBuiltinESMExports();
process.on('exit', () => { if (attempts) process.exitCode = 97; });
`);
  const main = path.join(app, `server/cloud/${role}-main.js`);
  const importer = path.join(root, 'importer.mjs');
  fs.writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(main).href)});\nprocess.stdout.write('copied_import_completed\\n');\n`);
  return { root, app, main, importer, guard, copied };
}

function execute(context, entry = context.importer) {
  // Inherit the integration wrapper's OS network/credential/data restrictions.
  // The preload additionally denies loopback/listening and caught attempts.
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(context.guard).href, entry], {
    cwd: context.app, env: {}, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  return result;
}

function assertInert(context) {
  const result = execute(context);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('copied_import_completed\n');
  expect(result.stderr).toBe('');
}

function assertMissingHelper(context) {
  const result = execute(context);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
  expect(result.stderr).toContain(path.join(context.app, helper));
}

for (const role of ['control', 'worker']) {
  describe(`${role} actual copied container closure`, () => {
    it('copies exactly the declared inventory and imports the entrypoint inertly', () => {
      const config = recipe(role);
      const context = copyContext(config);
      const declared = config.include.flatMap((pattern) => filesUnder(pattern.replace(/\/\*\*$/, '')));
      expect(context.copied.sort()).toEqual(declared.sort());
      assertInert(context);
      expect(context.copied).toContain(helper);
      expect(fs.readFileSync(path.join(context.app, helper))).toEqual(fs.readFileSync(path.join(repository, helper)));
    }, 20000);

    it('executes the copied direct entry with an empty environment and fails closed', () => {
      const context = copyContext(recipe(role));
      const result = execute(context, context.main);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toEqual({
        level: 'error', event: `phase2_${role}_start_failed`, code: 'phase2_config_invalid',
      });
    }, 20000);

    it('reproduces the missing COPY defect in a real child process', () => {
      const config = recipe(role);
      expect(config.docker).toContain(`COPY --chown=node:node ${helper} ./`);
      config.docker = config.docker.split('\n').filter((line) => !line.startsWith(`COPY --chown=node:node ${helper} `)).join('\n');
      const context = copyContext(config);
      expect(fs.existsSync(path.join(context.app, helper))).toBe(false);
      assertMissingHelper(context);
    }, 20000);

    it('rejects a helper excluded from the Docker build context', () => {
      const config = recipe(role);
      config.ignore = config.ignore.replace(`!${helper}\n`, '');
      expect(() => copyContext(config)).toThrow(`context excludes ${helper}`);
    });

    it('rejects a copied helper omitted from the source boundary', () => {
      const config = recipe(role);
      config.include = config.include.filter((file) => file !== helper);
      expect(() => copyContext(config)).toThrow(`boundary excludes ${helper}`);
    });

    it.each([
      ['computed specifier', "['..', 'kernel', 'cli-entry.js'].join('/')"],
      ['computed file URL', "new URL(['..', 'kernel', 'cli-entry.js'].join('/'), import.meta.url)"],
    ])('loads and rejects missing dependencies through a %s, not an import regex', (_label, expression) => {
      const context = copyContext(recipe(role));
      const source = fs.readFileSync(context.main, 'utf8');
      const literal = "import { isDirectExecution } from '../kernel/cli-entry.js';";
      expect(source).toContain(literal);
      fs.writeFileSync(context.main, source.replace(literal, `const { isDirectExecution } = await import(${expression});`));
      assertInert(context);
      fs.unlinkSync(path.join(context.app, helper));
      assertMissingHelper(context);
    }, 35000);
  });
}

it.each([
  "fetch('https://network-denied.invalid')",
  "(await import('node:net')).connect(1, '127.0.0.1')",
  "(await import('node:http')).createServer().listen(0)",
])('makes even a caught network/listen attempt fail: %s', (attempt) => {
  const context = copyContext(recipe('control'));
  fs.writeFileSync(context.importer, `try { ${attempt}; } catch {}\n`);
  const result = execute(context);
  expect(result.status).toBe(97);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
});
