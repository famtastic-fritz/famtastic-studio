// The seam between FAMtastic Designs and Site Studio (ADR-0007). These tests
// pin the two properties that make it a boundary rather than a suggestion:
// it is refused whole when malformed, and deploy authorization travels with
// the packet instead of being inferred.
import { describe, it, expect } from 'vitest';
import {
  validateSelectedBuildPacket,
  createSelectedBuildPacket,
  acceptSelectedBuildPacket,
  SELECTED_BUILD_PACKET_SCHEMA_VERSION,
} from '../server/kernel/selected-build-packet.js';

function validPacket(overrides = {}) {
  return {
    schema_version: SELECTED_BUILD_PACKET_SCHEMA_VERSION,
    packet_id: 'sbp_test_1',
    created: '2026-08-23T19:00:00.000Z',
    customer: { id: 'cust-1', name: 'The Beehive Studio', email: 'owner@example.com' },
    chosen_direction: { id: 'direction-a', name: 'Warm Editorial' },
    spec: { pages: [] },
    brand: { palette: ['#161B2E'] },
    asset_refs: [{ ref: 'media/hero-a.jpg' }],
    research_packet_ref: { packet_id: 'rp_1', brief_hash: 'abc123', source_adapter: 'shay-native' },
    origin: 'legit',
    boundary: { external_mutation_allowed: false, deploy_authorized: true },
    ...overrides,
  };
}

describe('selected build packet: validation', () => {
  it('accepts a well-formed packet', () => {
    const r = validateSelectedBuildPacket(validPacket());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('collects every error in one pass rather than failing on the first', () => {
    const r = validateSelectedBuildPacket({});
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(5);
  });

  it('refuses a packet whose schema_version does not match', () => {
    const r = validateSelectedBuildPacket(validPacket({ schema_version: 99 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/schema_version/);
  });

  it('requires full customer identity -- A1 binding needs a real subject', () => {
    const r = validateSelectedBuildPacket(validPacket({ customer: { id: 'c1', name: 'x' } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/customer\.email/);
  });

  it('refuses an asset ref that inlines bytes -- references only cross the seam', () => {
    const r = validateSelectedBuildPacket(validPacket({ asset_refs: [{ ref: 'x', bytes: 'AAAA' }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/never inline its bytes/);
  });

  it('allows an empty asset list -- a site with no assets is honest, not invalid', () => {
    expect(validateSelectedBuildPacket(validPacket({ asset_refs: [] })).ok).toBe(true);
  });

  it('requires provenance back to the research packet', () => {
    const r = validateSelectedBuildPacket(validPacket({ research_packet_ref: { packet_id: 'rp_1' } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/brief_hash/);
  });

  it("refuses origin 'unknown' -- the producer of a build packet knows what it built", () => {
    const r = validateSelectedBuildPacket(validPacket({ origin: 'unknown' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/origin/);
  });

  // The distinction that matters most: absent is not the same as denied.
  it('treats an absent boundary permission as malformed, never as a denial', () => {
    const r = validateSelectedBuildPacket(validPacket({ boundary: { external_mutation_allowed: false } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/deploy_authorized.*explicit boolean, never absent/);
  });
});

describe('selected build packet: creation and acceptance', () => {
  it('stamps schema_version and derives a packet_id from content when absent', () => {
    const p = createSelectedBuildPacket({ customer: { id: 'c1' } });
    expect(p.schema_version).toBe(SELECTED_BUILD_PACKET_SCHEMA_VERSION);
    expect(p.packet_id).toMatch(/^sbp_[0-9a-f]{24}$/);
  });

  it('derives the same id for identical content and a different id for different content', () => {
    const a = createSelectedBuildPacket({ customer: { id: 'c1' } });
    const b = createSelectedBuildPacket({ customer: { id: 'c1' } });
    const c = createSelectedBuildPacket({ customer: { id: 'c2' } });
    expect(a.packet_id).toBe(b.packet_id);
    expect(a.packet_id).not.toBe(c.packet_id);
  });

  it('refuses an invalid packet whole -- no partial acceptance', () => {
    const r = acceptSelectedBuildPacket({ schema_version: 1 });
    expect(r.accepted).toBe(false);
    expect(r.packet).toBeNull();
    expect(r.may_deploy).toBe(false);
  });

  it('carries deploy authorization with the packet rather than inferring it', () => {
    const yes = acceptSelectedBuildPacket(validPacket({ boundary: { external_mutation_allowed: false, deploy_authorized: true } }));
    expect(yes.accepted).toBe(true);
    expect(yes.may_deploy).toBe(true);

    // Build allowed, deploy denied. Studio must honor this rather than reading
    // its own environment to decide.
    const no = acceptSelectedBuildPacket(validPacket({ boundary: { external_mutation_allowed: false, deploy_authorized: false } }));
    expect(no.accepted).toBe(true);
    expect(no.may_deploy).toBe(false);
  });
});
