import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createEvents } from '../server/kernel/events.js';
import { createJournal } from '../server/kernel/journal.js';
import { createPaths } from '../server/kernel/paths.js';
import { createRegistry } from '../server/kernel/registry.js';
import { loadModules } from '../server/kernel/modules.js';

let root;
let app;
const secret = 'hermetic-staging-secret';

function packet(overrides = {}) {
  return {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: 'staging-packet-test-1',
    idempotency_key: 'staging-packet-test-1',
    request_id: 'request-test-1',
    project_id: '42',
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: ['direction-a'],
    artifacts: [{ direction_id: 'direction-a', variant_id: 7, source_path: 'proofs/7/a/index.html' }],
    ...overrides,
  };
}

function request(body, signature = true) {
  const raw = JSON.stringify(body);
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
      end(chunk) { this.writableEnded = true; if (chunk) chunks.push(chunk); resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()) }); },
    };
    const req = Readable.from([raw]);
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
  const paths = createPaths();
  app = createApp();
  const events = createEvents({ paths });
  const journal = createJournal({ paths });
  const registry = createRegistry();
  for (const mod of await loadModules()) mod.register({ app, paths, events, journal, registry });
});

afterEach(() => {
  delete process.env.STUDIO_DATA_ROOT;
  delete process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('FAMtastic selected staging acceptance boundary', () => {
  it('accepts a signed packet without claiming deployment', async () => {
    const response = await request({ packet: packet() });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, status: 'accepted_waiting_callback' });
    expect(response.body.receipt).not.toHaveProperty('staging_url');
  });

  it('is idempotent for the same packet and key', async () => {
    const first = await request({ packet: packet() });
    const second = await request({ packet: packet() });
    expect(second.body.receipt.receipt_id).toBe(first.body.receipt.receipt_id);
  });

  it('rejects tampered packet content and missing authentication', async () => {
    expect((await request({ packet: packet({ build_class: 'production' }) })).status).toBe(422);
    expect((await request({ packet: packet() }, false)).status).toBe(401);
  });
});
