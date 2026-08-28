// Event spine (A5). Validated envelope, locked per-site sequence, durable append
// before broadcast, per-connection site binding with cursor replay and resync.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { bindIdentity } from './identity.js';

const SCHEMA_VERSION = 1;
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) { time = ULID_CHARS[t % 32] + time; t = Math.floor(t / 32); }
  const rand = crypto.randomBytes(16);
  let body = '';
  for (let i = 0; i < 16; i += 1) body += ULID_CHARS[rand[i] % 32];
  return time + body;
}

function validateEnvelope(e) {
  const errs = [];
  if (e.schema_version !== SCHEMA_VERSION) errs.push('schema_version');
  if (typeof e.type !== 'string' || !e.type.trim()) errs.push('type');
  if (typeof e.site_id !== 'string' || !e.site_id.trim()) errs.push('site_id');
  if (!Number.isInteger(e.seq) || e.seq < 1) errs.push('seq');
  if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) errs.push('ts');
  if (typeof e.event_id !== 'string' || e.event_id.length !== 26) errs.push('event_id');
  if (e.payload === null || typeof e.payload !== 'object') errs.push('payload');
  if (errs.length) throw new Error(`invalid event envelope: ${errs.join(', ')}`);
  return e;
}

export function createEvents({ paths }) {
  const clients = new Set();

  const fileFor = (siteId) => paths.within('events', `${siteId}.jsonl`);
  const lockFor = (siteId) => paths.within('events', `${siteId}.seq.lock`);

  // Cross-process safe: O_EXCL lock plus a re-read of the tail under the lock, so
  // two instances sharing an events root cannot allocate the same sequence.
  function withSeqLock(siteId, fn) {
    paths.ensure('events');
    const lock = lockFor(siteId);
    const deadline = Date.now() + 5000;
    let fd;
    for (;;) {
      try { fd = fs.openSync(lock, 'wx'); break; } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.unlinkSync(lock); continue; }
        } catch { /* lock vanished, retry */ }
        if (Date.now() > deadline) throw Object.assign(new Error('event sequence lock timeout'), { statusCode: 503, code: 'events_locked' });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try { return fn(); } finally { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch { /* already gone */ } }
  }

  // Reads the last well-formed line. A torn tail is skipped for reading.
  function lastSeq(siteId) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try { const e = JSON.parse(lines[i]); if (Number.isInteger(e.seq)) return e.seq; } catch { /* torn, keep walking back */ }
    }
    return 0;
  }

  // Before appending, remove any unparseable trailing fragment and preserve it
  // beside the log. Appending onto a torn line would make the NEW event
  // unreplayable too, and the sequence derived from it could be reused.
  function quarantineTornTail(siteId) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw) return;
    const lines = raw.split('\n');
    const trailing = raw.endsWith('\n') ? '' : lines.pop();
    if (!trailing) return;
    let valid = false;
    try { JSON.parse(trailing); valid = true; } catch { valid = false; }
    const kept = lines.filter((l) => l !== '').join('\n');
    const body = kept ? `${kept}\n` : '';
    if (valid) {
      // Well-formed but missing its newline: just terminate it.
      fs.writeFileSync(file, `${body}${trailing}\n`);
      return;
    }
    fs.appendFileSync(`${file}.quarantine`, `${new Date().toISOString()} ${trailing}\n`);
    fs.writeFileSync(file, body);
  }

  function emit({ type, site_id, run_id = null, payload = {}, causation_id = null, idempotency_key = null }) {
    if (!site_id) throw new Error('event site_id is required (no ambient site)');
    return withSeqLock(site_id, () => {
      quarantineTornTail(site_id);
      // An idempotency_key was stored but never enforced, so a retried emit got a
      // second sequence number and consumers saw the same event twice. Dedupe
      // inside the lock, and return the original rather than a new event, so a
      // caller retrying after an ambiguous failure is safe.
      if (idempotency_key) {
        const existing = replay(site_id, 0).find((e) => e.idempotency_key === idempotency_key);
        if (existing) return existing;
      }
      const event = validateEnvelope({
        event_id: ulid(), schema_version: SCHEMA_VERSION, type, site_id, run_id,
        seq: lastSeq(site_id) + 1, ts: new Date().toISOString(),
        causation_id, idempotency_key, payload,
      });
      const file = fileFor(site_id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Durable before broadcast: an event a client saw must survive power loss.
      const fd = fs.openSync(file, 'a');
      try { fs.writeSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      broadcast(event);
      return event;
    });
  }

  function replay(siteId, afterSeq = 0) {
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return [];
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.seq > afterSeq) out.push(e); } catch { /* skip torn line */ }
    }
    return out;
  }

  // A client only ever receives events for the site it subscribed to.
  function broadcast(event) {
    const frame = JSON.stringify(event);
    for (const c of clients) {
      if (c.socket.readyState !== 1) continue;
      if (c.site_id !== event.site_id) continue;
      c.socket.send(frame);
    }
  }

  function attach(server) {
    const wss = new WebSocketServer({ server, path: '/events' });
    wss.on('connection', (socket, req) => {
      const url = new URL(req.url, 'http://localhost');
      let identity;
      try {
        // Same contract as HTTP ingress: validation, conflict detection, frozen.
        identity = bindIdentity({ query: url.searchParams, headers: req.headers || {} }, { requireSite: true });
      } catch (error) {
        socket.send(JSON.stringify({ error: error.code || 'identity_required', message: error.message }));
        socket.close(error.code === 'identity_conflict' ? 4409 : 4400, error.code || 'identity_required');
        return;
      }
      const siteId = identity.site_id;
      const client = { socket, site_id: siteId, identity };
      clients.add(client);
      socket.on('close', () => clients.delete(client));

      const cursor = Number(url.searchParams.get('after_seq') || 0);
      const available = lastSeq(siteId);
      if (cursor > available) {
        socket.send(JSON.stringify({ type: 'resync_required', site_id: siteId, reason: 'cursor ahead of retained history', available }));
      } else {
        for (const e of replay(siteId, cursor)) socket.send(JSON.stringify(e));
      }
    });
    return wss;
  }

  return { emit, replay, attach, clients, lastSeq, SCHEMA_VERSION };
}
