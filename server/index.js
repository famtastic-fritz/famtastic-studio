// Boot. P0-I1 ordering matters: ESM evaluates static imports before any statement
// in this file runs, so importing the kernels at the top would let a forbidden
// dependency execute BEFORE the preflight could reject it. Only node builtins and
// the preflight primitive are imported statically; everything else is imported
// dynamically, after clearance.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertInvariants, preflightModuleClosure, assertNoProofRoutes } from './kernel/invariants.js';

assertInvariants();

const bootDir = path.dirname(fileURLToPath(import.meta.url));
const treeRoot = path.resolve(bootDir, '..');
const modulesDir = path.join(bootDir, 'modules');
const moduleEntries = fs.existsSync(modulesDir)
  ? fs.readdirSync(modulesDir)
      .map((n) => path.join(modulesDir, n, 'index.js'))
      .filter((p) => fs.existsSync(p))
  : [];

// The kernels below are loaded through load(), whose specifiers are computed, so
// the closure scanner cannot follow them from this file. They are listed
// explicitly, and BOOT_KERNELS is the single source of truth for both the
// preflight and the dynamic loads, so the two can never drift apart.
const BOOT_KERNELS = ['kernel/paths.js', 'kernel/events.js', 'kernel/journal.js', 'kernel/registry.js', 'kernel/app.js', 'kernel/modules.js',
  'kernel/selected-staging-configuration.js', 'kernel/selected-staging-lifecycle.js'];

const preflight = preflightModuleClosure({
  entryFiles: [
    path.join(bootDir, 'index.js'),
    ...BOOT_KERNELS.map((rel) => path.join(bootDir, rel)),
    ...moduleEntries,
  ],
  treeRoot,
});

// Checking BOOT_KERNELS against itself would be circular: drop a kernel from the
// list and it simply stops being checked. Instead the loader is the gate. Every
// dynamic import goes through load(), and load() refuses any file the preflight
// did not actually clear, so an unchecked kernel cannot be executed at all.
const cleared = new Set(preflight.files);

// Cleared. Now it is safe to evaluate the rest of the tree.
const load = (rel) => {
  const abs = fs.realpathSync(path.join(bootDir, rel));
  if (!cleared.has(abs)) {
    throw new Error(`P0-I1: refusing to load ${rel}; it was not covered by the preflight`);
  }
  return import(pathToFileURL(abs).href);
};
const { createPaths } = await load('kernel/paths.js');
const { createEvents } = await load('kernel/events.js');
const { createJournal } = await load('kernel/journal.js');
const { createRegistry } = await load('kernel/registry.js');
const { createApp } = await load('kernel/app.js');
const { loadModules } = await load('kernel/modules.js');
const { configureSelectedStaging, selectedStagingDiagnostic } = await load('kernel/selected-staging-configuration.js');
const { createSelectedStagingLifecycle } = await load('kernel/selected-staging-lifecycle.js');

const paths = createPaths();
const events = createEvents({ paths });
const journal = createJournal({ paths });
const registry = createRegistry({ paths });
const app = createApp();
let lifecycle, server, websocket, deadline, shutdown;
const activeResponses = new Set();
let shutdownGraceMs = 30000;
const report = (error, phase) => console.error(JSON.stringify(selectedStagingDiagnostic(error, phase)));

function stop(exitCode = 0) {
  if (shutdown) return shutdown;
  lifecycle?.stop();
  for (const response of activeResponses) {
    response.shouldKeepAlive = false;
    if (!response.headersSent) response.setHeader('Connection', 'close');
  }
  deadline = setTimeout(() => {
    report(null, 'shutdown_timeout');
    // Do not close a live store or release an uncertain claim. Process death is
    // reconciled by the durable worker on restart, including interrupted builds.
    process.exit(1);
  }, shutdownGraceMs);
  shutdown = (async () => {
    // Drain requests before closing SQLite, including bodies still arriving.
    const drained = server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
    for (const client of websocket?.clients || []) client.terminate();
    websocket?.close();
    await drained;
    await lifecycle?.close();
    process.exitCode = exitCode;
  })().catch(error => { report(error, 'shutdown'); process.exitCode = 1; })
    .finally(() => { clearTimeout(deadline); });
  return shutdown;
}

try {
  const configured = configureSelectedStaging({ paths, treeRoot });
  shutdownGraceMs = configured.shutdownGraceMs;
  lifecycle = createSelectedStagingLifecycle(configured);
  const modules = await loadModules();
  for (const mod of modules) mod.register({ app, paths, events, journal, registry, stagingRuntime: lifecycle.runtime });
  assertNoProofRoutes(app.routes);
  const port = Number(process.env.PORT || paths.config.preview.port || 3400);
  const host = process.env.BIND_LAN === '1' || paths.config.preview.bind_lan ? '0.0.0.0' : '127.0.0.1';
  server = http.createServer((req, res) => {
    if (shutdown) {
      res.writeHead(503, { Connection: 'close', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_stopping' }));
      return;
    }
    activeResponses.add(res);
    res.once('close', () => activeResponses.delete(res));
    app.handler(req, res);
  });
  websocket = events.attach(server);
  server.on('error', error => { report(error, 'listen'); void stop(1); });
  process.on('SIGTERM', () => { void stop(); });
  process.on('SIGINT', () => { void stop(); });
  server.listen(port, host, () => {
    if (shutdown) return;
    console.log(`site-studio-next listening on http://${host}:${server.address().port} (modules: ${modules.map((m) => m.name).join(', ')}; P0-I1 preflight cleared ${preflight.checked} files; selected staging: ${configured.workerMode})`);
    lifecycle.start();
  });
} catch (error) {
  report(error, 'boot');
  await stop(1);
}
