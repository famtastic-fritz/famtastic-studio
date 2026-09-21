import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDirectExecution } from '../server/kernel/cli-entry.js';
import { assertDurableExecutionReport } from './helpers/durable-execution-proof.js';
import { assertPhase2ShadowProofReport } from './helpers/phase2-proof-assertions.js';
import { assertPhase2HttpCheckpointProofReport } from './helpers/phase2-proof-http.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const failures = [
  ['scripts/bootstrap-durable-execution-phase2.mjs', 'phase2_bootstrap_failed', 'phase2_bootstrap_gate_denied'],
  ['scripts/pause-durable-execution-phase2.mjs', 'phase2_persistent_pause_failed', 'phase2_pause_gate_denied'],
  ['server/cloud/control-main.js', 'phase2_control_start_failed', 'phase2_config_invalid'],
  ['server/cloud/worker-main.js', 'phase2_worker_start_failed', 'phase2_config_invalid'],
];
const proofs = ['scripts/prove-durable-execution.mjs', 'scripts/prove-durable-execution-phase2.mjs'];
const entries = [...failures.map(([file]) => file), ...proofs];
let root;
let networkGuard;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-phase-cli-'));
  // Preserve relative module and package resolution with --preserve-symlinks-main.
  fs.symlinkSync(repository, path.join(root, 'studio-link'), 'dir');
  networkGuard = path.join(root, 'deny-network.mjs');
  fs.writeFileSync(networkGuard, `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
function deny() { attempts++; throw new Error('cli_test_network_denied'); }
globalThis.fetch = deny;
for (const transport of [http, https]) { transport.request = deny; transport.get = deny; }
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
net.Server.prototype.listen = tls.connect = deny;
syncBuiltinESMExports();
process.on('exit', () => { if (attempts) process.exitCode = 97; });
`);
});
afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

function execute(args) {
  // Inherit the verification wrapper's OS denial of network/authoritative data.
  // Nested sandbox-exec is refused on macOS. This preload additionally rejects
  // loopback and makes even a caught network attempt fail the child process.
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(networkGuard).href, ...args], {
    cwd: root, env: {}, encoding: 'utf8', timeout: 20000, maxBuffer: 256 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  return result;
}

for (const flags of [[], ['--preserve-symlinks-main']]) {
  describe(flags.length ? 'preserved symlink main' : 'canonicalized symlink main', () => {
    it.each(failures)('%s executes its exact fail-closed gate with no configuration', (file, event, code) => {
      const result = execute([...flags, path.join('studio-link', file)]);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toBe('');
      const error = JSON.parse(result.stderr);
      expect(error).toEqual(file.startsWith('server/')
        ? { level: 'error', event, code }
        : { ok: false, event, code });
    }, 25000);

    it.each(proofs)('%s prints a nonempty independently checked proof receipt', (file) => {
      const result = execute([...flags, path.join('studio-link', file)]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).not.toBe('');
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe('passed');
      if (file === proofs[0]) {
        assertDurableExecutionReport(report);
        expect(() => assertDurableExecutionReport({ ...report, jobs: 0 })).toThrow();
      } else {
        assertPhase2ShadowProofReport(report);
        assertPhase2HttpCheckpointProofReport(report.in_process_http_checkpoint);
        expect(() => assertPhase2ShadowProofReport({ ...report, jobs: 0 })).toThrow();
      }
    }, 25000);

    it.each(entries)('%s stays inert when imported by a different file entry', (file) => {
      const importer = path.join(root, 'importer.mjs');
      const target = pathToFileURL(path.join(root, 'studio-link', file)).href;
      fs.writeFileSync(importer, `await import(${JSON.stringify(target)});\nprocess.stdout.write('import_completed\\n');\n`);
      const result = execute([...flags, importer]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('import_completed\n');
      // node:sqlite can warn merely on import; no CLI failure receipt is allowed.
      expect(result.stderr).not.toMatch(/"event"|"status"|"code"/);
    }, 25000);
  });
}

it('compares canonical files without accepting missing, invalid or different entries', () => {
  const moduleUrl = new URL('../server/kernel/cli-entry.js', import.meta.url);
  const same = path.join(root, 'studio-link/server/kernel/cli-entry.js');
  expect(isDirectExecution(moduleUrl, same)).toBe(true);
  expect(isDirectExecution(moduleUrl, '')).toBe(false);
  expect(isDirectExecution(moduleUrl, path.join(root, 'absent.mjs'))).toBe(false);
  expect(isDirectExecution(moduleUrl, path.join(repository, entries[0]))).toBe(false);
  expect(isDirectExecution('not a URL', same)).toBe(false);
});
