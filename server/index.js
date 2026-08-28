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
const BOOT_KERNELS = ['kernel/paths.js', 'kernel/events.js', 'kernel/journal.js', 'kernel/registry.js', 'kernel/app.js', 'kernel/modules.js'];

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

const paths = createPaths();
const events = createEvents({ paths });
const journal = createJournal({ paths });
const registry = createRegistry();
const app = createApp();
const modules = await loadModules();
for (const mod of modules) mod.register({ app, paths, events, journal, registry });
assertNoProofRoutes(app.routes);

const port = Number(process.env.PORT || paths.config.preview.port || 3400);
const host = process.env.BIND_LAN === '1' || paths.config.preview.bind_lan ? '0.0.0.0' : '127.0.0.1';
const server = http.createServer(app.handler);
events.attach(server);
server.listen(port, host, () => {
  console.log(`site-studio-next listening on http://${host}:${port} (modules: ${modules.map((m) => m.name).join(', ')}; P0-I1 preflight cleared ${preflight.checked} files)`);
});
