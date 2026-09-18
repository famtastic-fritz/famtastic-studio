// Durable selected jobs. SQLite serializes acceptance and project claims across
// processes. No lease takeover of a live worker, even during a long build.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { decodeSourceExport } from './source-export-wire.js';
import { createSelectedSourceResolver } from './selected-source-binding.js';
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
    CREATE TABLE IF NOT EXISTS claims (project TEXT PRIMARY KEY, token TEXT, pid INTEGER);
    CREATE TABLE IF NOT EXISTS source_mappings (project TEXT PRIMARY KEY, data TEXT);`);
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
      const job = { id: `ssj_${hash.slice(0, 32)}`, hash, packet, stage: packet.schema === 'famtastic.site-studio.planning-packet.v1' ? 'plan' : 'materialize', state: 'queued', attempts: {}, history: [], created_at: new Date().toISOString() };
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
  const sourceMappings = () => db.prepare('SELECT data FROM source_mappings').all().map(r => JSON.parse(r.data));
  const resolveSource = createSelectedSourceResolver({ paths, getMappings: sourceMappings });
  function recordSource(job, token) {
    return transaction(() => {
      if (!db.prepare('SELECT 1 FROM claims WHERE project=? AND token=?').get(job.packet.project_id, token) || job.qa?.passed !== true || job.build?.outcome !== 'success') throw stagingError('source_mapping_writer_unverified');
      const wire = job.source_export || job.build.source_export, record = decodeSourceExport(wire);
      if (!record.scope_complete || record.site_id !== job.build.site_id || record.repository.repository_path !== job.build.repository.repository_path) throw stagingError('source_mapping_writer_mismatch');
      const prior = sourceMappings().find(m => m.project_id === job.packet.project_id);
      if (prior && (prior.customer_id !== job.packet.continuation.customer.id || prior.request_id !== job.packet.request_id || prior.site_id !== record.site_id || prior.repository_path !== record.repository.repository_path)) throw stagingError('source_mapping_identity_changed');
      const content_records = { ...(prior?.content_records || {}) };
      const completed_steps = { ...(prior?.completed_steps || {}) };
      for (const t of job.selected?.transformations || []) if (t.content_record_id) content_records[t.path] = t.content_record_id;
      for (const t of job.selected?.transformations || []) if (t.content_record) completed_steps[t.path] = { content_record_id: t.content_record_id, fields_sha256: digest(t.content_record.fields), selected_sha256: t.selected_sha256, template_sha256: t.template_sha256, component_ids: t.component_ids,
        design_contract_sha256: job.packet.continuation.recipe.steps.find(s => s.path === t.path).design_contract_sha256 };
      const mapping = { project_id: job.packet.project_id, customer_id: job.packet.continuation.customer.id, request_id: job.packet.request_id,
        site_id: record.site_id, repository_path: record.repository.repository_path, run_id: record.run_id, source_export_sha256: wire.sha256,
        evidence_ref: `verified-staging-source:${job.id}`, content_records, completed_steps, source_export: wire,
        originating_system: prior?.originating_system || job.packet.continuation.initiating_system, handoff_initiator: job.packet.continuation.initiating_system };
      mapping.source_history = [...(prior?.source_history || [])];
      if (prior && prior.source_export_sha256 !== wire.sha256) mapping.source_history.push({ run_id: prior.run_id, source_export_sha256: prior.source_export_sha256 });
      db.prepare('INSERT OR REPLACE INTO source_mappings VALUES (?,?)').run(mapping.project_id, JSON.stringify(mapping));
      return mapping;
    });
  }
  async function readMappedArtifact(packet, file, options) {
    const resolved = await resolveSource(packet, options);
    const record = decodeSourceExport(resolved.source_export);
    const source = record.files.find(entry => entry.path === file.path);
    if (!source) throw stagingError('mapped_artifact_missing');
    return fs.readFileSync(paths.within('sites', resolved.site_id, source.path));
  }
  const resolveCompleted = packet => sourceMappings().some(m => m.project_id === packet.project_id) ? resolveSource(packet, { reconcile: true }) : null;
  return { accept, read, claim, checkpoint, recordSource, sourceMappings, resolveSource, readMappedArtifact, resolveCompleted,
    list: () => db.prepare('SELECT data FROM jobs ORDER BY rowid').all().map(r => JSON.parse(r.data)),
    release: (job, token) => db.prepare('DELETE FROM claims WHERE project=? AND token=?').run(job.packet.project_id, token),
    close: () => db.close() };
}
