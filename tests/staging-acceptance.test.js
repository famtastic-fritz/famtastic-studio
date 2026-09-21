import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createEvents } from '../server/kernel/events.js';
import { createExecutionStore, reconcileAcceptanceProjections } from '../server/kernel/durable-execution/index.js';
import { createJournal } from '../server/kernel/journal.js';
import { createPaths } from '../server/kernel/paths.js';
import { createRegistry } from '../server/kernel/registry.js';
import { loadModules } from '../server/kernel/modules.js';

let root;
let app;
let dbPath;
let events;
let journal;
const secret = 'hermetic-staging-secret';

function packet(overrides = {}) {
  const artifacts = [
    { role: 'selected_preview', path: 'proofs/7/a/index.html', sha256: 'a'.repeat(64), bytes: 1200 },
    { role: 'source_material', path: 'proofs/7/a/assets/hero.webp', sha256: 'b'.repeat(64), bytes: 2400 },
  ];
  const canonical = artifacts
    .map((artifact) => ({ bytes: artifact.bytes, path: artifact.path, role: artifact.role, sha256: artifact.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: 'staging-packet-test-1',
    idempotency_key: 'staging-packet-test-1',
    request_id: 'request-test-1',
    project_id: '42',
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: ['direction-a'],
    artifacts,
    artifact_manifest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    selected_artifacts: [{ direction_id: 'direction-a', source_artifact_path: artifacts[0].path, source_artifact_sha256: artifacts[0].sha256, source_artifact_bytes: artifacts[0].bytes }],
    ...overrides,
  };
}

function request(body, signature = true, suppliedChunks = null) {
  const raw = Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
      end(chunk) { this.writableEnded = true; if (chunk) chunks.push(chunk); resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()) }); },
    };
    const req = Readable.from(suppliedChunks || [raw]);
    req.method = 'POST';
    req.url = '/api/pipeline/staging/accept';
    req.headers = signature ? { 'x-famtastic-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` } : {};
    app.handler(req, res);
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-staging-'));
  process.env.STUDIO_DATA_ROOT = root;
  process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET = secret;
  process.env.FAMTASTIC_EXECUTION_MODE = 'mock';
  process.env.FAMTASTIC_EXECUTION_SCOPE = 'phase1-disposable';
  const paths = createPaths();
  const executionRoot = paths.ensure('execution');
  dbPath = path.join(executionRoot, 'studio.phase1-disposable.db');
  process.env.FAMTASTIC_AGENT_DB_PATH = dbPath;
  app = createApp();
  events = createEvents({ paths });
  journal = createJournal({ paths });
  const registry = createRegistry();
  for (const mod of await loadModules()) mod.register({ app, paths, events, journal, registry });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STUDIO_DATA_ROOT;
  delete process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET;
  delete process.env.FAMTASTIC_EXECUTION_MODE;
  delete process.env.FAMTASTIC_EXECUTION_SCOPE;
  delete process.env.FAMTASTIC_AGENT_DB_PATH;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('FAMtastic selected staging acceptance boundary', () => {
  it('accepts a signed packet without claiming deployment', async () => {
    const response = await request({ packet: packet() });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, status: 'accepted_waiting_callback' });
    expect(response.body.execution).toMatchObject({ state: 'accepted', dispatch_state: 'pending', duplicate: false });
    expect(response.body.execution).toMatchObject({ journal_projection: 'projected', event_projection: 'projected' });
    expect(response.body.receipt).not.toHaveProperty('staging_url');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM AgentTaskLog').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ExecutionJobs').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ExecutionOutbox').get().count).toBe(1);
    db.close();
    expect(journal.read('project-42')[0].evidence.idempotency_key).toBe('staging-packet-test-1');
    expect(events.replay('project-42')[0]).toMatchObject({
      idempotency_key: 'staging-accepted:staging-packet-test-1',
      payload: { task_id: response.body.execution.task_id, packet_id: 'staging-packet-test-1' },
    });
  });

  it('is idempotent for the same packet and key', async () => {
    const first = await request({ packet: packet() });
    const second = await request({ packet: packet() });
    expect(second.body.receipt.receipt_id).toBe(first.body.receipt.receipt_id);
    expect(second.body.execution.duplicate).toBe(true);
    const journalFile = path.join(root, '.studio', 'journal', 'project-42.jsonl');
    expect(fs.readFileSync(journalFile, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('rejects conflicting content under the same idempotency key', async () => {
    expect((await request({ packet: packet() })).status).toBe(202);
    const changed = packet({ packet_id: 'staging-packet-conflict' });
    const response = await request({ packet: changed });
    expect(response).toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } });
  });

  it('fails closed when durable mock admission is not explicitly enabled', async () => {
    delete process.env.FAMTASTIC_EXECUTION_MODE;
    const response = await request({ packet: packet() });
    expect(response).toMatchObject({ status: 503, body: { error: 'durable_execution_disabled' } });
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('returns non-202 and leaves no partial rows when the transaction aborts', async () => {
    const store = createExecutionStore({ dbPath, safeRoot: path.dirname(dbPath) });
    store.rawDatabaseForTests().exec(`CREATE TRIGGER abort_route_outbox
      BEFORE INSERT ON ExecutionOutbox BEGIN SELECT RAISE(ABORT, 'forced route failure'); END`);
    store.close();
    const response = await request({ packet: packet() });
    expect(response.status).not.toBe(202);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM AgentTaskLog').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ExecutionJobs').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ExecutionOutbox').get().count).toBe(0);
    db.close();
  });

  it('rejects tampered packet content and missing authentication', async () => {
    expect((await request({ packet: packet({ build_class: 'production' }) })).status).toBe(422);
    expect((await request({ packet: packet({ artifact_manifest_sha256: '0'.repeat(64) }) })).status).toBe(422);
    expect((await request({ packet: packet({ artifacts: [{ role: 'selected_preview', path: '..\\secret', sha256: 'a'.repeat(64), bytes: 1 }] }) })).status).toBe(422);
    expect((await request({ packet: packet() }, false)).status).toBe(401);
  });

  it('rejects oversized and structurally hostile input without opening the database', async () => {
    expect((await request({ packet: packet({ padding: 'x'.repeat(1024 * 1024) }) })).status).toBe(413);
    expect((await request({ packet: packet({ artifacts: [null] }) })).status).toBe(422);
  });

  it('verifies the HMAC over exact bytes when UTF-8 is split across chunks', async () => {
    const body = { packet: packet({
      packet_id: 'staging-packet-unicode',
      idempotency_key: 'staging-packet-unicode',
      request_id: 'request-unicode',
      project_id: '43',
      note: '💡',
    }) };
    const raw = Buffer.from(JSON.stringify(body));
    const marker = raw.indexOf(Buffer.from('💡'));
    expect(marker).toBeGreaterThan(0);
    const response = await request(body, true, [raw.subarray(0, marker + 1), raw.subarray(marker + 1)]);
    expect(response.status).toBe(202);
  });

  it('commits acceptance before projections and can reconcile a failed projection', async () => {
    const failure = vi.spyOn(journal, 'append').mockImplementationOnce(() => { throw new Error('projection unavailable'); });
    const response = await request({ packet: packet() });
    expect(response).toMatchObject({
      status: 202,
      body: { execution: { journal_projection: 'pending', event_projection: 'projected' } },
    });
    failure.mockRestore();

    const store = createExecutionStore({ dbPath, safeRoot: path.dirname(dbPath) });
    const before = store.rawDatabaseForTests().prepare('SELECT * FROM ExecutionOutbox').get();
    expect(before.journal_projected_at_ms).toBeNull();
    expect(before.journal_projection_error).toContain('projection unavailable');
    expect(reconcileAcceptanceProjections({ store, journal, events })).toEqual([
      { job_id: expect.any(String), journal: 'projected', event: 'projected' },
    ]);
    const after = store.rawDatabaseForTests().prepare('SELECT * FROM ExecutionOutbox').get();
    expect(after.journal_projected_at_ms).not.toBeNull();
    store.close();
    expect(journal.read('project-42')).toHaveLength(1);
  });
});
