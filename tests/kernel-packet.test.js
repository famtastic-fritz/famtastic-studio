// Research Packet v1 contract (amendment A3): validation, persistence, and
// cross-site isolation of stored packets.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import {
  SCHEMA_VERSION,
  sha256Hex,
  validatePacket,
  createPacket,
  writePacket,
  readPacket,
  listPackets,
  storeRawImport,
} from '../server/kernel/packet.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-packet-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function basePacket(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    packet_id: 'rp_test001',
    source_adapter: 'shay-native',
    brief_ref: 'brief:acme:abc123',
    created: now,
    execution_status: 'no_findings',
    brief_hash: sha256Hex('{"business":"Acme"}'),
    import_ref: null,
    import_hash: null,
    facts: [],
    customer_claims: [],
    not_found: [],
    brand: {},
    site_needs: { pages: [], sections_per_page: {}, offers: [], ctas: [] },
    component_needs: [],
    media_prompts: [],
    seo_targets: { keywords: [], meta_direction: '' },
    open_questions: [],
    confidence_notes: 'no provider connected',
    ...overrides,
  };
}

describe('validatePacket', () => {
  it('accepts a valid, structurally honest no_findings packet', () => {
    const { valid, errors } = validatePacket(basePacket());
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('accepts a valid packet carrying real facts', () => {
    const packet = basePacket({
      execution_status: 'partial',
      facts: [{
        claim: 'Founded in 1998',
        source_uri: 'https://example.com/about',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        design_use: 'fixture — exercises the v2 fact contract',
        mutable: true,
      }],
    });
    expect(validatePacket(packet).valid).toBe(true);
  });

  // ── v2: design_use + mutable ──────────────────────────────────────────
  // A finding that cannot say what it changes is trivia, not a design input —
  // the same class of failure as a claim with no source.

  it('rejects a fact with no design_use: a finding that cannot say what it changes is not a fact', () => {
    const packet = basePacket({
      facts: [{
        claim: 'Operators abandon a build screen after roughly 8 seconds of no feedback',
        source_uri: 'https://example.com/study',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        mutable: false,
      }],
    });
    const { valid, errors } = validatePacket(packet);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('design_use'))).toBe(true);
  });

  it('rejects a fact with an empty-string design_use', () => {
    const packet = basePacket({
      facts: [{
        claim: 'x',
        source_uri: 'https://example.com/x',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        design_use: '   ',
        mutable: true,
      }],
    });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('rejects a fact whose mutable is missing — the constraint decision must be deliberate, never defaulted', () => {
    const packet = basePacket({
      facts: [{
        claim: 'x',
        source_uri: 'https://example.com/x',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        design_use: 'sets the build-progress timeout',
      }],
    });
    const { valid, errors } = validatePacket(packet);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('mutable'))).toBe(true);
  });

  it('rejects a non-boolean mutable (a truthy string is not a constraint decision)', () => {
    const packet = basePacket({
      facts: [{
        claim: 'x',
        source_uri: 'https://example.com/x',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        design_use: 'sets the build-progress timeout',
        mutable: 'false',
      }],
    });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('accepts a fact carrying design_use and mutable:false as a hard constraint', () => {
    const packet = basePacket({
      execution_status: 'ok',
      facts: [{
        claim: 'Operators abandon a build screen after roughly 8 seconds of no feedback',
        source_uri: 'https://example.com/study',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'verified',
        design_use: 'Sets the maximum silent interval on the console build view before a progress signal must appear.',
        mutable: false,
      }],
    });
    expect(validatePacket(packet).valid).toBe(true);
  });

  it('rejects a fact with no source_uri', () => {
    const packet = basePacket({
      facts: [{
        claim: 'Their hours are 9 to 5',
        retrieved_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        verification_state: 'unverified',
        design_use: 'fixture — exercises the v2 fact contract',
        mutable: true,
      }],
    });
    const { valid, errors } = validatePacket(packet);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('source_uri'))).toBe(true);
  });

  it('rejects a fact with an empty-string source_uri', () => {
    const packet = basePacket({
      facts: [{ claim: 'x', source_uri: '   ', retrieved_at: new Date().toISOString(), checked_at: new Date().toISOString(), verification_state: 'unverified' }],
    });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('rejects an unknown execution_status', () => {
    const { valid, errors } = validatePacket(basePacket({ execution_status: 'fabricated' }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('execution_status'))).toBe(true);
  });

  it('rejects a missing schema_version', () => {
    const packet = basePacket();
    delete packet.schema_version;
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('rejects a missing brief_hash', () => {
    const packet = basePacket({ brief_hash: undefined });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('never promotes a customer claim to a fact: rejects a customer claim carrying verification_state', () => {
    const packet = basePacket({ customer_claims: [{ claim: 'We are the best locksmith in town', verification_state: 'verified' }] });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('requires import_ref and import_hash when source_adapter is notebooklm-import', () => {
    const packet = basePacket({ source_adapter: 'notebooklm-import', import_ref: null, import_hash: null });
    const { valid, errors } = validatePacket(packet);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('import_ref'))).toBe(true);
    expect(errors.some((e) => e.includes('import_hash'))).toBe(true);
  });

  it('rejects import_ref/import_hash present on a non-import adapter', () => {
    const packet = basePacket({ import_ref: 'imports/x.raw', import_hash: sha256Hex('x') });
    expect(validatePacket(packet).valid).toBe(false);
  });

  it('rejects a notebooklm packet whose import bytes do not match import_hash', () => {
    const paths = createPaths();
    const site_id = 'site-hash-mismatch';
    const stored = storeRawImport({ paths, site_id, packet_id: 'rp_import1', bytes: 'original notebooklm text' });
    const packet = basePacket({
      source_adapter: 'notebooklm-import',
      import_ref: stored.import_ref,
      import_hash: sha256Hex('a completely different payload'), // deliberately wrong
    });
    const { valid, errors } = validatePacket(packet, { paths, site_id });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('import_hash'))).toBe(true);
  });

  it('accepts a notebooklm packet whose import bytes DO match import_hash', () => {
    const paths = createPaths();
    const site_id = 'site-hash-match';
    const stored = storeRawImport({ paths, site_id, packet_id: 'rp_import2', bytes: 'original notebooklm text' });
    const packet = basePacket({
      source_adapter: 'notebooklm-import',
      execution_status: 'no_findings',
      import_ref: stored.import_ref,
      import_hash: stored.import_hash,
    });
    expect(validatePacket(packet, { paths, site_id }).valid).toBe(true);
  });

  it('rejects a notebooklm packet whose import_ref points at a file that does not exist', () => {
    const paths = createPaths();
    const site_id = 'site-missing-import';
    const packet = basePacket({
      source_adapter: 'notebooklm-import',
      import_ref: 'imports/does-not-exist.raw',
      import_hash: sha256Hex('whatever'),
    });
    const { valid, errors } = validatePacket(packet, { paths, site_id });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('not found'))).toBe(true);
  });
});

describe('createPacket', () => {
  it('builds and validates a well-formed packet from adapter fields', () => {
    const packet = createPacket({
      source_adapter: 'shay-native',
      brief_ref: 'brief:acme:xyz',
      execution_status: 'no_findings',
      brief_hash: sha256Hex('{}'),
      confidence_notes: 'no provider connected',
    });
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.packet_id).toMatch(/^rp_/);
    expect(packet.facts).toEqual([]);
  });

  it('throws packet_invalid when the assembled packet fails validation', () => {
    expect(() => createPacket({ source_adapter: 'shay-native' })).toThrow(/invalid research packet/);
  });
});

describe('write / read / list persistence', () => {
  it('round-trips a packet through write and read', () => {
    const paths = createPaths();
    const site_id = 'site-roundtrip';
    const packet = { ...basePacket({ packet_id: 'rp_roundtrip' }), site_id };
    writePacket({ paths, packet });
    const back = readPacket({ paths, site_id, packet_id: 'rp_roundtrip' });
    expect(back).toMatchObject({ packet_id: 'rp_roundtrip', source_adapter: 'shay-native' });
  });

  it('read returns null for a packet that does not exist', () => {
    const paths = createPaths();
    expect(readPacket({ paths, site_id: 'site-empty', packet_id: 'rp_nope' })).toBeNull();
  });

  it('refuses to persist an invalid packet', () => {
    const paths = createPaths();
    const packet = { ...basePacket({ execution_status: 'nonsense' }), site_id: 'site-invalid' };
    expect(() => writePacket({ paths, packet })).toThrow(/refusing to persist/);
  });

  it('list returns packets newest first', () => {
    const paths = createPaths();
    const site_id = 'site-list';
    writePacket({ paths, packet: { ...basePacket({ packet_id: 'rp_a', created: '2026-01-01T00:00:00.000Z' }), site_id } });
    writePacket({ paths, packet: { ...basePacket({ packet_id: 'rp_b', created: '2026-06-01T00:00:00.000Z' }), site_id } });
    const list = listPackets({ paths, site_id });
    expect(list.map((p) => p.packet_id)).toEqual(['rp_b', 'rp_a']);
  });

  it('isolates packets across sites: listing one site never returns another site\'s packets', () => {
    const paths = createPaths();
    writePacket({ paths, packet: { ...basePacket({ packet_id: 'rp_alpha' }), site_id: 'site-alpha' } });
    writePacket({ paths, packet: { ...basePacket({ packet_id: 'rp_beta' }), site_id: 'site-beta' } });

    const alphaList = listPackets({ paths, site_id: 'site-alpha' });
    const betaList = listPackets({ paths, site_id: 'site-beta' });
    expect(alphaList.map((p) => p.packet_id)).toEqual(['rp_alpha']);
    expect(betaList.map((p) => p.packet_id)).toEqual(['rp_beta']);

    // Reading site-alpha's packet through site-beta's identity must fail closed
    // (paths.within rejects traversal outside the bound site's directory).
    expect(readPacket({ paths, site_id: 'site-beta', packet_id: 'rp_alpha' })).toBeNull();
  });

  it('writePacket requires site_id (no ambient site)', () => {
    const paths = createPaths();
    const packet = basePacket();
    expect(() => writePacket({ paths, packet })).toThrow(/site_id/);
  });
});
