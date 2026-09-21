import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { packet } from './staging-worker-fixture.mjs';
import { digest } from '../server/kernel/staging-store.js';
import { stagingPacketErrors } from '../server/kernel/staging-contract.js';
const harness = process.env.SELECTED_STAGING_AGENCY_HARNESS;
it.skipIf(!harness)('matches actual PHP byte ordering across mixed case and punctuation without renaming files', () => {
  const p = packet();
  for (const path of ['proof/Logo.png', 'proof/icon-2.png', 'proof/icon_1.png', 'proof/A.logo.png', 'proof/z/Logo.png']) {
    p.artifacts.push({ path, role: 'source_material', bytes: path.length, sha256: digest(path) });
  }
  const phpDigest = artifacts => execFileSync('php', [harness, '--manifest-digest'], { input: JSON.stringify(artifacts), encoding: 'utf8' }).trim();
  p.artifact_manifest_sha256 = phpDigest(p.artifacts);
  expect(stagingPacketErrors(p)).toEqual([]);
  p.artifacts.reverse();
  expect(phpDigest(p.artifacts)).toBe(p.artifact_manifest_sha256);
  expect(stagingPacketErrors(p)).toEqual([]);
  p.artifacts[0].sha256 = digest('changed');
  expect(stagingPacketErrors(p)).toContain('packet.artifact_manifest_sha256');
});
