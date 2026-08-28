// Research Packet v1 (amendment A3, plan section 2.6). The pipeline's input
// contract: everything downstream (spec generation, compose, DNA) consumes only
// this packet, never raw research chat. Honest states only — a fact with no
// source_uri is not a fact, and validation rejects it outright.
//
// site_id is not part of the A3 field list itself, but every packet is stored
// under a site (A1: identity bound, no ambient state), so it travels alongside
// the packet as required storage metadata. Callers that only care about the A3
// contract can ignore it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// v2 adds two required fields to every fact: `design_use` (what this finding
// changes in the console or pipeline) and `mutable` (false = a hard constraint
// downstream may not reword or override). Both are lifted from the legacy
// website_build_brief.v2 research_context pattern, where every one of the 27
// findings carried them. A fact that cannot say what it is FOR is not
// actionable, which is the same class of failure as a claim with no source.
export const SCHEMA_VERSION = 2;
export const EXECUTION_STATUSES = ['ok', 'partial', 'adapter_failed', 'no_findings'];
export const VERIFICATION_STATES = ['verified', 'unverified', 'stale'];

export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isIsoDate(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}
function isSha256Hex(v) {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateFact(fact, index, errors) {
  const at = `facts[${index}]`;
  if (!isPlainObject(fact)) { errors.push(`${at}: must be an object`); return; }
  if (!isNonEmptyString(fact.claim)) errors.push(`${at}.claim: required non-empty string`);
  // The load-bearing rule (A3): a fact without a source_uri is rejected outright.
  if (!isNonEmptyString(fact.source_uri)) errors.push(`${at}.source_uri: required — a claim with no source is not a fact`);
  if (!isIsoDate(fact.retrieved_at)) errors.push(`${at}.retrieved_at: required ISO date string`);
  if (!isIsoDate(fact.checked_at)) errors.push(`${at}.checked_at: required ISO date string`);
  if (!VERIFICATION_STATES.includes(fact.verification_state)) errors.push(`${at}.verification_state: must be one of ${VERIFICATION_STATES.join(' | ')}`);
  // v2, from website_build_brief.v2: a finding must state what it is FOR.
  // Research that cannot name what it changes is trivia, not a design input.
  if (!isNonEmptyString(fact.design_use)) errors.push(`${at}.design_use: required — state what this finding changes in the console or pipeline`);
  // v2: false means downstream may not reword or override this. Required
  // explicitly rather than defaulted, so the decision is always deliberate.
  if (typeof fact.mutable !== 'boolean') errors.push(`${at}.mutable: required boolean — false marks a hard constraint downstream cannot override`);
}

function validateCustomerClaim(claim, index, errors) {
  const at = `customer_claims[${index}]`;
  if (!isPlainObject(claim)) { errors.push(`${at}: must be an object`); return; }
  if (!isNonEmptyString(claim.claim)) errors.push(`${at}.claim: required non-empty string`);
  // Customer claims are never promoted to facts without a source (A3). Enforced
  // by keeping the lists structurally separate; this check catches an adapter
  // that tried to smuggle a source_uri + verification_state onto a claim to make
  // it look like a fact.
  if (claim.verification_state !== undefined) errors.push(`${at}.verification_state: customer claims are never promoted to facts; remove this field or move the item to facts[]`);
}

function validateNotFound(entry, index, errors) {
  const at = `not_found[${index}]`;
  if (!isPlainObject(entry)) { errors.push(`${at}: must be an object`); return; }
  if (!isNonEmptyString(entry.claim) && !isNonEmptyString(entry.question)) errors.push(`${at}: requires a claim or question describing what was sought`);
  if (!isNonEmptyString(entry.reason)) errors.push(`${at}.reason: required — an honest note on why it is unresolved`);
}

/**
 * Validates a Research Packet v1 against amendment A3. Never throws; returns
 * { valid, errors }. When `paths` and `site_id` are supplied and the packet's
 * source_adapter is 'notebooklm-import', the stored import bytes are read and
 * re-hashed to confirm they match import_hash — a packet cannot claim an import
 * it cannot produce.
 */
export function validatePacket(packet, { paths, site_id } = {}) {
  const errors = [];
  if (!isPlainObject(packet)) return { valid: false, errors: ['packet must be an object'] };

  if (packet.schema_version !== SCHEMA_VERSION) errors.push(`schema_version: must equal ${SCHEMA_VERSION}`);
  if (!isNonEmptyString(packet.packet_id)) errors.push('packet_id: required non-empty string');
  if (!isNonEmptyString(packet.source_adapter)) errors.push('source_adapter: required non-empty string');
  if (!isNonEmptyString(packet.brief_ref)) errors.push('brief_ref: required non-empty string');
  if (!isIsoDate(packet.created)) errors.push('created: required ISO date string');
  if (!EXECUTION_STATUSES.includes(packet.execution_status)) errors.push(`execution_status: must be one of ${EXECUTION_STATUSES.join(' | ')}`);
  if (!isSha256Hex(packet.brief_hash)) errors.push('brief_hash: required sha256 hex string (of the immutable brief)');

  const isImport = packet.source_adapter === 'notebooklm-import';
  if (isImport) {
    if (!isNonEmptyString(packet.import_ref)) errors.push('import_ref: required when source_adapter is notebooklm-import');
    if (!isSha256Hex(packet.import_hash)) errors.push('import_hash: required sha256 hex string when source_adapter is notebooklm-import');
    if (isNonEmptyString(packet.import_ref) && isSha256Hex(packet.import_hash) && paths && site_id) {
      let file;
      try {
        file = paths.within('packets', site_id, packet.import_ref);
      } catch (error) {
        errors.push(`import_ref: ${error.message}`);
        file = null;
      }
      if (file) {
        if (!fs.existsSync(file)) {
          errors.push(`import_ref: stored raw import not found at ${packet.import_ref}`);
        } else {
          const bytes = fs.readFileSync(file);
          const actual = sha256Hex(bytes);
          if (actual !== packet.import_hash) errors.push('import_hash: does not match the bytes stored at import_ref');
        }
      }
    }
  } else {
    if (packet.import_ref != null || packet.import_hash != null) errors.push('import_ref/import_hash: must be absent (or null) unless source_adapter is notebooklm-import');
  }

  if (!Array.isArray(packet.facts)) errors.push('facts: required array');
  else packet.facts.forEach((f, i) => validateFact(f, i, errors));

  if (!Array.isArray(packet.customer_claims)) errors.push('customer_claims: required array');
  else packet.customer_claims.forEach((c, i) => validateCustomerClaim(c, i, errors));

  if (!Array.isArray(packet.not_found)) errors.push('not_found: required array');
  else packet.not_found.forEach((n, i) => validateNotFound(n, i, errors));

  if (!isPlainObject(packet.brand)) errors.push('brand: required object');
  if (!isPlainObject(packet.site_needs)) errors.push('site_needs: required object');
  if (!Array.isArray(packet.component_needs)) errors.push('component_needs: required array');
  if (!Array.isArray(packet.media_prompts)) errors.push('media_prompts: required array');
  if (!isPlainObject(packet.seo_targets)) errors.push('seo_targets: required object');
  if (!Array.isArray(packet.open_questions)) errors.push('open_questions: required array');
  if (typeof packet.confidence_notes !== 'string') errors.push('confidence_notes: required string (may be empty only if truly nothing to say, but adapters should always say something)');

  return { valid: errors.length === 0, errors };
}

function packetError(message, extra = {}) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'packet_invalid', ...extra });
}

/**
 * Assembles a Research Packet v1 from adapter output, filling structural
 * defaults, then validates it. Throws (statusCode 400, code packet_invalid) if
 * the assembled packet is invalid — an adapter's honest 'no_findings' output is
 * still a STRUCTURALLY valid packet, so this should only ever throw on a real
 * adapter bug, never on the mere absence of findings.
 */
export function createPacket(fields = {}, { paths, site_id } = {}) {
  const packet = {
    schema_version: SCHEMA_VERSION,
    packet_id: fields.packet_id || `rp_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`,
    source_adapter: fields.source_adapter,
    brief_ref: fields.brief_ref,
    created: fields.created || new Date().toISOString(),
    execution_status: fields.execution_status,
    brief_hash: fields.brief_hash,
    import_ref: fields.import_ref ?? null,
    import_hash: fields.import_hash ?? null,
    facts: fields.facts || [],
    customer_claims: fields.customer_claims || [],
    not_found: fields.not_found || [],
    brand: fields.brand || {},
    site_needs: fields.site_needs || { pages: [], sections_per_page: {}, offers: [], ctas: [] },
    component_needs: fields.component_needs || [],
    media_prompts: fields.media_prompts || [],
    seo_targets: fields.seo_targets || { keywords: [], meta_direction: '' },
    open_questions: fields.open_questions || [],
    confidence_notes: fields.confidence_notes || '',
    // Sub-stage timing, when the adapter measured it. Optional and additive:
    // an adapter that does not measure omits it rather than reporting a zero
    // that would read as instant.
    timings: fields.timings || null,
  };
  if (packet.source_adapter !== 'notebooklm-import' && fields.import_ref === undefined) packet.import_ref = null;

  const { valid, errors } = validatePacket(packet, { paths, site_id });
  if (!valid) throw packetError(`invalid research packet: ${errors.join('; ')}`, { errors });
  return packet;
}

function siteDir(paths, site_id) {
  if (!site_id) throw Object.assign(new Error('packets require site_id (no ambient site)'), { statusCode: 400, code: 'identity_required' });
  return paths.within('packets', site_id);
}

/** Writes an immutable raw import (notebooklm-import) before the packet that references it is built. */
export function storeRawImport({ paths, site_id, packet_id, bytes }) {
  const dir = siteDir(paths, site_id);
  fs.mkdirSync(path.join(dir, 'imports'), { recursive: true });
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8');
  const import_ref = path.posix.join('imports', `${packet_id}.raw`);
  const file = paths.within('packets', site_id, import_ref);
  fs.writeFileSync(file, buf);
  return { import_ref, import_hash: sha256Hex(buf) };
}

/** Persists a packet under its site. Validates (including import-hash re-check) before writing. */
export function writePacket({ paths, packet }) {
  if (!packet || !isNonEmptyString(packet.site_id)) throw Object.assign(new Error('writePacket requires packet.site_id (no ambient site)'), { statusCode: 400, code: 'identity_required' });
  const { valid, errors } = validatePacket(packet, { paths, site_id: packet.site_id });
  if (!valid) throw packetError(`refusing to persist invalid research packet: ${errors.join('; ')}`, { errors });
  const dir = siteDir(paths, packet.site_id);
  fs.mkdirSync(dir, { recursive: true });
  const file = paths.within('packets', packet.site_id, `${packet.packet_id}.json`);
  fs.writeFileSync(file, JSON.stringify(packet, null, 2));
  return packet;
}

export function readPacket({ paths, site_id, packet_id }) {
  const file = paths.within('packets', site_id, `${packet_id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listPackets({ paths, site_id }) {
  const dir = siteDir(paths, site_id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => (a.created < b.created ? 1 : -1));
}
