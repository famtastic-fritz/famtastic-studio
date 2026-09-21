import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createExecutionStore } from '../../server/kernel/durable-execution/index.js';
import { createPaths } from '../../server/kernel/paths.js';

export function createClock(start = Date.parse('2026-09-19T12:00:00.000Z')) {
  let current = start;
  return {
    now: () => current,
    read: () => current,
    advance: (ms) => { current += ms; return current; },
    set: (ms) => { current = ms; return current; },
  };
}

export function createIdFactory() {
  let sequence = 0;
  return (kind) => {
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, '0');
    return kind === 'task'
      ? `00000000-0000-4000-8000-${suffix}`
      : `${kind}_${suffix}`;
  };
}

export function stagingPacket(number = 1, overrides = {}) {
  const artifacts = [
    { role: 'selected_preview', path: `proofs/${number}/index.html`, sha256: 'a'.repeat(64), bytes: 1200 },
    { role: 'source_material', path: `proofs/${number}/hero.webp`, sha256: 'b'.repeat(64), bytes: 2400 },
  ];
  const manifest = artifacts
    .map(({ bytes, path: artifactPath, role, sha256 }) => ({ bytes, path: artifactPath, role, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const base = {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: `packet-${number}`,
    idempotency_key: `packet-${number}`,
    request_id: `request-${number}`,
    project_id: String(number),
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: [`direction-${number}`],
    artifacts,
    artifact_manifest_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    selected_artifacts: [{
      direction_id: `direction-${number}`,
      source_artifact_path: artifacts[0].path,
      source_artifact_sha256: artifacts[0].sha256,
      source_artifact_bytes: artifacts[0].bytes,
    }],
    boundary: { deploy_authorized: false },
  };
  return { ...base, ...overrides };
}

export function createExecutionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-execution-'));
  const executionRoot = path.join(root, 'execution');
  fs.mkdirSync(executionRoot, { recursive: true });
  const dbPath = path.join(executionRoot, 'studio.phase1-disposable.db');
  const clock = createClock();
  const envKey = `DURABLE_TEST_ROOT_${crypto.randomUUID().replaceAll('-', '_')}`;
  process.env[envKey] = root;
  const paths = createPaths({
    schema_version: 1,
    data_root_env: envKey,
    data_root_default: root,
    source_root_default: null,
    roots: { execution: 'execution' },
    preview: { port: 3400, bind_lan: false },
    portfolio_roots: {},
  });
  const stores = [];
  const idFactory = createIdFactory();
  const openStore = () => {
    const store = createExecutionStore({ dbPath, safeRoot: executionRoot, clock: clock.now, idFactory });
    stores.push(store);
    return store;
  };
  return {
    root,
    executionRoot,
    dbPath,
    clock,
    paths,
    openStore,
    cleanup() {
      for (const store of stores.splice(0)) {
        try { store.close(); } catch { /* already closed */ }
      }
      delete process.env[envKey];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function seedSyntheticLegacy(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE legacy_jobs (id INTEGER PRIMARY KEY, status TEXT NOT NULL, payload_hash TEXT NOT NULL);
    CREATE TABLE schedules (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL, last_run TEXT NOT NULL);
    CREATE TABLE performance_records (id INTEGER PRIMARY KEY, metric TEXT NOT NULL, value REAL NOT NULL);
  `);
  const job = db.prepare('INSERT INTO legacy_jobs (id, status, payload_hash) VALUES (?, ?, ?)');
  for (let index = 1; index <= 448; index += 1) job.run(index, 'parked', crypto.createHash('sha256').update(`legacy-${index}`).digest('hex'));
  const schedule = db.prepare('INSERT INTO schedules (id, enabled, last_run) VALUES (?, 1, ?)');
  for (let index = 1; index <= 7; index += 1) schedule.run(index, `2026-08-0${index}T08:00:00.000Z`);
  const performance = db.prepare('INSERT INTO performance_records (id, metric, value) VALUES (?, ?, ?)');
  for (let index = 1; index <= 3; index += 1) performance.run(index, `metric-${index}`, index / 10);
  db.close();
}

export function tableHash(dbPath, table) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()
    .map((row) => Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))));
  db.close();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
