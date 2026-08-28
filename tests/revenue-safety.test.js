// Revenue safety gates G4-0 and G4-1 (endgame items 21 and 22).
//
// These assert the gates' own building blocks behave correctly, so a gate cannot
// pass by accident. The gates themselves are run as scripts and their verdicts
// are recorded in docs/research/revenue-safety-gates-2026-08-22.md.
//
// Everything here is offline: no network egress, no production secrets, no
// writes to any production path. That constraint is the point of the gates, so
// the tests honour it too.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildV1Payload,
  buildV2Payload,
  signBody,
  gitHead,
  runChecks as runG40Checks,
  LEGACY_HANDLER_PATH,
  PHP_CLIENT_PATH,
  FIXTURE_DISPATCH_SECRET,
} from '../scripts/gate-g4-0-contract.mjs';

import {
  AUDIT_LOCATIONS,
  PRODUCTION_PROOF_JOBS_DIR,
  PRODUCTION_PROOF_OUTPUT_DIR,
  snapshotListing,
} from '../scripts/gate-g4-1-shadow-boundary.mjs';

describe('G4-0 fixtures mirror the real producer', () => {
  it('the real Drupal client and the legacy consumer both exist to be checked against', () => {
    expect(fs.existsSync(PHP_CLIENT_PATH), 'producer must exist or the gate proves nothing').toBe(true);
    expect(fs.existsSync(LEGACY_HANDLER_PATH), 'consumer must exist or the gate proves nothing').toBe(true);
  });

  it('builds a v2 payload carrying the fields the current producer sends', () => {
    const v2 = buildV2Payload();
    expect(v2.schema_version).toBe(2);
    for (const field of ['idempotency_key', 'campaign_id', 'callback_url', 'prospect', 'required_variant_count']) {
      expect(v2, `v2 payload must carry ${field}`).toHaveProperty(field);
    }
    expect(buildV1Payload().schema_version).toBe(1);
  });

  it('signs the exact raw body the way PHP does, and a tampered body will not verify', () => {
    const body = JSON.stringify(buildV2Payload());
    expect(body, 'PHP uses JSON_UNESCAPED_SLASHES, so slashes must stay raw').not.toContain('\\/');
    const sig = signBody(body, FIXTURE_DISPATCH_SECRET);
    const expected = `sha256=${crypto.createHmac('sha256', FIXTURE_DISPATCH_SECRET).update(body).digest('hex')}`;
    expect(sig).toBe(expected);
    const tampered = body.replace('"schema_version":2', '"schema_version":1');
    expect(signBody(tampered, FIXTURE_DISPATCH_SECRET)).not.toBe(sig);
  });

  it('gitHead returns a real sha, and fails loudly rather than silently for a non-repo', () => {
    expect(/^[0-9a-f]{40}$/.test(gitHead(process.cwd()))).toBe(true);
    // A silent null here would let the gate record an empty pin as though it
    // were a real one, so throwing is the correct behaviour.
    expect(() => gitHead(path.resolve('/'))).toThrow();
  });

  it('every G4-0 check passes, run in-process with no network', () => {
    const { results, pass, fail, sitesSha, siteStudioSha } = runG40Checks();
    const failed = results.filter((r) => r.ok === false);
    expect(failed, `failing checks: ${JSON.stringify(failed)}`).toEqual([]);
    expect(fail).toBe(0);
    expect(pass).toBeGreaterThanOrEqual(5);
    // The pins must be real shas, not empty strings: a gate that records an
    // empty pin proves nothing about which code it checked.
    for (const sha of [sitesSha, siteStudioSha]) {
      expect(/^[0-9a-f]{40}$/.test(String(sha))).toBe(true);
    }
  });
});

describe('G4-1 audit locations and snapshotting', () => {
  it('names the production locations it is meant to guard', () => {
    expect(AUDIT_LOCATIONS.length).toBeGreaterThanOrEqual(4);
    for (const loc of AUDIT_LOCATIONS) {
      expect(loc, 'each audit location needs a key so a skip can be attributed').toHaveProperty('key');
    }
  });

  it('snapshots a directory into a stable hash that changes when contents change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g41-snap-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.json'), '{"a":1}');
      const first = snapshotListing(dir);
      const second = snapshotListing(dir);
      expect(second.digest, 'an unchanged directory must hash identically, or the audit is noise').toBe(first.digest);
      fs.writeFileSync(path.join(dir, 'b.json'), '{"b":2}');
      const third = snapshotListing(dir);
      expect(third.digest, 'a changed directory must hash differently, or the audit is blind').not.toBe(first.digest);
      expect(third.fileCount).toBe(first.fileCount + 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an absent directory and an empty one snapshot identically, which is why the gate checks existence separately', () => {
    // snapshotListing alone cannot tell absent from empty: both yield zero files
    // and the same digest. That is exactly why the gate performs its own
    // existence check and emits SKIPPED-WITH-REASON, instead of treating a
    // missing production path as an observed zero-write pass. This test pins
    // that limitation so nobody later mistakes the snapshot for proof of
    // existence.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g41-empty-'));
    try {
      const absent = snapshotListing(path.join(os.tmpdir(), `definitely-absent-${Date.now()}`));
      const empty = snapshotListing(emptyDir);
      expect(absent.fileCount).toBe(0);
      expect(empty.fileCount).toBe(0);
      expect(absent.digest).toBe(empty.digest);
      expect(fs.existsSync(emptyDir)).toBe(true);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('knows the production proof paths it must never write to', () => {
    for (const p of [PRODUCTION_PROOF_JOBS_DIR, PRODUCTION_PROOF_OUTPUT_DIR]) {
      expect(p).toContain('.config/famtastic');
      expect(p.startsWith(os.tmpdir()), 'a production path must never resolve into tmp').toBe(false);
    }
  });
});
