// Durable selected jobs. SQLite serializes acceptance and project claims across
// processes. No lease takeover of a live worker, even during a long build.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const stagingError = (code, statusCode = 422) => Object.assign(new Error(code), { code, statusCode });
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
export function createStagingStore({ paths, journal }) {
  paths.ensure('staging');
  const file = paths.within('staging', 'jobs.sqlite');
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, idem TEXT UNIQUE, packet_id TEXT UNIQUE,
      project TEXT, request TEXT, account TEXT, revision INTEGER, hash TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS claims (project TEXT PRIMARY KEY, token TEXT, pid INTEGER);`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function read(id) { const row = db.prepare('SELECT data FROM jobs WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  function save(job) {
    journal.append({ site_id: `project-${job.packet.project_id}`, initiator: 'selected-staging', intent: 'staging.checkpoint',
      changes: [{ job_id: job.id, stage: job.stage, state: job.state }], result: { status: job.state }, evidence: { packet_sha256: job.hash } });
    db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
    return job;
  }
  function accept(packet) {
    return transaction(() => {
      const hash = digest(packet);
      const prior = db.prepare('SELECT * FROM jobs WHERE idem=? OR packet_id=?').get(packet.idempotency_key, packet.packet_id);
      if (prior) { if (prior.hash !== hash) throw stagingError('idempotency_conflict', 409); return JSON.parse(prior.data); }
      const account = packet.continuation?.customer?.id || null;
      const revision = packet.continuation?.selection_revision || 0;
      const older = db.prepare('SELECT * FROM jobs WHERE project=? OR request=? ORDER BY revision DESC').all(packet.project_id, packet.request_id);
      for (const row of older) {
        if (row.project !== packet.project_id || row.request !== packet.request_id || row.account !== account) throw stagingError('identity_conflict', 409);
        if (revision <= row.revision) throw stagingError('stale_selection_revision', 409);
      }
      const held = db.prepare('SELECT * FROM claims WHERE project=?').get(packet.project_id);
      if (held && alive(held.pid)) throw stagingError('project_busy', 409);
      if (held) db.prepare('DELETE FROM claims WHERE project=?').run(packet.project_id);
      const job = { id: `ssj_${hash.slice(0, 32)}`, hash, packet, stage: 'materialize', state: 'queued', attempts: {}, history: [], created_at: new Date().toISOString() };
      journal.append({ site_id: `project-${packet.project_id}`, initiator: 'famtastic-drupal', intent: 'accept_selected_staging_packet', changes: [{ job_id: job.id }], result: { status: 'durably_queued' }, evidence: { packet_sha256: hash } });
      db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, packet.idempotency_key, packet.packet_id, packet.project_id, packet.request_id, account, revision, hash, JSON.stringify(job));
      return job;
    });
  }
  function claim(id) {
    return transaction(() => {
      const job = read(id);
      if (!job) throw stagingError('job_not_found', 404);
      const project = job.packet.project_id;
      const held = db.prepare('SELECT * FROM claims WHERE project=?').get(project);
      if (held && alive(held.pid)) throw stagingError('project_busy', 409);
      const token = crypto.randomUUID();
      db.prepare('INSERT OR REPLACE INTO claims VALUES (?,?,?)').run(project, token, process.pid);
      const latest = db.prepare('SELECT id FROM jobs WHERE project=? ORDER BY revision DESC LIMIT 1').get(project);
      if (latest.id !== id) { job.state = 'superseded'; save(job); }
      return { job, token };
    });
  }
  function checkpoint(job, token) {
    return transaction(() => {
      if (!db.prepare('SELECT 1 FROM claims WHERE project=? AND token=?').get(job.packet.project_id, token)) throw stagingError('claim_lost', 409);
      return save(job);
    });
  }
  return { accept, read, claim, checkpoint,
    list: () => db.prepare('SELECT data FROM jobs ORDER BY rowid').all().map(r => JSON.parse(r.data)),
    release: (job, token) => db.prepare('DELETE FROM claims WHERE project=? AND token=?').run(job.packet.project_id, token),
    close: () => db.close() };
}
