// FAMtasticInc deploy adapter (ADR-0003, amendment A7). deploy() copies a
// site's PUBLISHABLE output (never operational files such as spec.json) to a
// new, receipted path under the famtasticinc root; goLive() switches the
// site's explicit active-release pointer and records what DNS evidence it
// had, without ever touching DNS. Receipts are immutable once persisted and
// carry a per-file sha256 plus an overall manifest hash for rollback (A7).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createMutation } from './mutation.js';
import { createSpec } from './spec.js';

const PROVIDER = 'famtasticinc';

// Operational files describe the site to Site Studio, not to a visitor, and
// are never part of the publishable artifact; dot-directories are excluded too.

import { fail, sha256, newId, walkAllFiles, isPublishable, computeManifestHash, stripContent } from './deploy-helpers.js';

export function createDeploy({ paths, journal, events }) {
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });

  function journalOrRefuse(entryInput, onFailure) {
    try {
      return journal.append(entryInput);
    } catch (error) {
      if (onFailure) { try { onFailure(); } catch { /* best effort cleanup */ } }
      throw fail(503, 'journal_unavailable', `deploy refused: journal unavailable (${error.message})`);
    }
  }

  function receiptFile(siteId, receiptId) {
    return paths.within('deploys', siteId, `${receiptId}.json`);
  }

  function targetDirFor(siteId, receiptId) {
    return paths.within('famtasticinc', siteId, receiptId);
  }

  function activePointerFile(siteId) {
    return paths.within('deploys', siteId, 'active.json');
  }

  // Atomic pointer switch: write a sibling temp file, then rename over it.
  function writeActivePointer(siteId, pointer) {
    const dir = paths.within('deploys', siteId);
    fs.mkdirSync(dir, { recursive: true });
    const file = activePointerFile(siteId);
    const tmp = `${file}.tmp-${newId('p')}`;
    fs.writeFileSync(tmp, JSON.stringify(pointer, null, 2));
    fs.renameSync(tmp, file);
    return pointer;
  }

  function readActivePointer(siteId) {
    const file = activePointerFile(siteId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // Switches the pointer, then reads it back to confirm it actually landed.
  function switchActivePointer(siteId, pointer, failCode) {
    writeActivePointer(siteId, pointer);
    const check = readActivePointer(siteId);
    if (!check || check.receipt_id !== pointer.receipt_id) {
      throw fail(500, failCode, `active pointer did not switch to ${pointer.receipt_id}`);
    }
    return check;
  }

  // Isolation falls out of the directory layout: a receipt_id belonging to
  // another site is simply not present under this site_id.
  function readFull(siteId, receiptId) {
    const file = receiptFile(siteId, receiptId);
    if (!fs.existsSync(file)) {
      throw fail(404, 'deploy_receipt_not_found', `no deploy receipt ${receiptId} for site ${siteId}`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function removeReceipt(siteId, receiptId) {
    const file = receiptFile(siteId, receiptId);
    if (fs.existsSync(file)) { fs.chmodSync(file, 0o644); fs.rmSync(file, { force: true }); }
  }

  function persistReceipt(siteId, receiptId, fullReceipt) {
    const dir = paths.within('deploys', siteId);
    fs.mkdirSync(dir, { recursive: true });
    const file = receiptFile(siteId, receiptId);
    fs.writeFileSync(file, JSON.stringify(fullReceipt, null, 2));
    // Best-effort immutability; never fatal -- some filesystems ignore chmod.
    try { fs.chmodSync(file, 0o444); } catch { /* not enforceable here */ }
  }

  function list(siteId) {
    if (!siteId) throw fail(400, 'identity_required', 'deploy.list requires site_id');
    const dir = paths.within('deploys', siteId);
    if (!fs.existsSync(dir)) return { site_id: siteId, receipts: [], status: 'empty' };
    const receipts = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => stripContent(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return { site_id: siteId, receipts, status: receipts.length ? 'available' : 'empty' };
  }

  // No site_id: scans every site's receipt directory (kernel/admin lookup).
  function read(receiptId, { site_id } = {}) {
    if (site_id) return stripContent(readFull(site_id, receiptId));
    const root = paths.root('deploys');
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(root, entry.name, `${receiptId}.json`);
        if (fs.existsSync(file)) return stripContent(JSON.parse(fs.readFileSync(file, 'utf8')));
      }
    }
    throw fail(404, 'deploy_receipt_not_found', `no deploy receipt ${receiptId}`);
  }

  function latestReceipt(siteId) {
    return list(siteId).receipts[0] || null;
  }

  function currentSourceRevision(siteId) {
    const [latest] = journal.read(siteId, { limit: 1 });
    return latest && typeof latest.result?.revision === 'number' ? latest.result.revision : 0;
  }

  // Only the PUBLISHABLE set (isPublishable) -- what a deploy actually ships.
  function buildManifest(siteDir) {
    return walkAllFiles(siteDir)
      .filter(isPublishable)
      .map((relPath) => {
        const buf = fs.readFileSync(path.join(siteDir, relPath));
        return { path: relPath, sha256: sha256(buf), bytes: buf.length, content_base64: buf.toString('base64') };
      });
  }

  function writeFilesToTarget(targetDir, manifest) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const item of manifest) {
      const abs = path.join(targetDir, item.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(item.content_base64, 'base64'));
    }
  }

  // Writes `manifest` and removes anything else, so targetDir matches exactly.
  function restoreTarget(targetDir, manifest) {
    const wanted = new Set(manifest.map((m) => m.path));
    writeFilesToTarget(targetDir, manifest);
    for (const relPath of walkAllFiles(targetDir)) {
      if (!wanted.has(relPath)) fs.rmSync(path.join(targetDir, relPath), { force: true });
    }
  }

  function updateSpecDeployTarget(siteId, target, initiator) {
    const current = spec.read(siteId);
    if (!current.spec || !current.valid) return; // no valid spec yet; deploy still succeeds, honestly
    const nextSpec = { ...current.spec, deploy: { ...(current.spec.deploy || {}), target } };
    spec.write(siteId, nextSpec, { initiator, expectedRevision: current.revision });
  }

  // Confirmation without dispatch: same manifest/hash/target as deploy(), no writes.
  function plan({ site_id } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'plan requires site_id');
    const siteDir = paths.within('sites', site_id);
    const manifest = buildManifest(siteDir);
    if (manifest.length === 0) {
      return { site_id, would_deploy: false, reason: 'no built output to deploy', file_count: 0 };
    }
    const prior = latestReceipt(site_id);
    return {
      site_id,
      would_deploy: true,
      provider: 'famtasticinc',
      file_count: manifest.length,
      total_bytes: manifest.reduce((n, f) => n + f.bytes, 0),
      manifest_hash: computeManifestHash(manifest),
      files: manifest.map(({ path: p, sha256: h, bytes }) => ({ path: p, sha256: h, bytes })),
      prior_target: prior ? prior.target : null,
      prior_receipt_id: prior ? prior.receipt_id : null,
      dispatched: false,
    };
  }

  // Copies `manifest` into a fresh temp dir beside `target`, recomputes the
  // hash of what actually landed on disk, and compares it to `expectedHash`.
  // Proof the copy completed before anything durable claims it did.
  function copyToTempAndVerify(target, manifest, expectedHash) {
    const tmpTarget = `${target}.tmp-${newId('t')}`;
    try {
      writeFilesToTarget(tmpTarget, manifest);
      const landedHash = computeManifestHash(buildManifest(tmpTarget));
      if (landedHash !== expectedHash) {
        throw fail(500, 'manifest_hash_mismatch', 'published bytes did not match the source manifest hash',
          { expected_hash: expectedHash, actual_hash: landedHash });
      }
      return tmpTarget;
    } catch (error) {
      try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  function deploy({ site_id, initiator } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'deploy requires site_id');
    if (!initiator) throw fail(400, 'initiator_required', 'deploy requires an initiator');

    const siteDir = paths.within('sites', site_id);
    if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
      throw fail(404, 'site_not_found', `site not found: ${site_id}`);
    }
    const manifest = buildManifest(siteDir);
    if (manifest.length === 0) {
      throw fail(422, 'empty_site', `refusing to deploy an empty site: ${site_id}`);
    }

    const manifest_hash = computeManifestHash(manifest);
    const prior = latestReceipt(site_id);
    const receipt_id = newId('dep');
    const target = targetDirFor(site_id, receipt_id);
    const source_revision = currentSourceRevision(site_id);

    // Copy to temp, prove the copy completed by hash. A failed or partial
    // copy never reaches the journal or a receipt as a success.
    let tmpTarget;
    try {
      tmpTarget = copyToTempAndVerify(target, manifest, manifest_hash);
    } catch (error) {
      journalOrRefuse({
        site_id,
        initiator,
        intent: 'deploy',
        changes: manifest.map((m) => ({ path: m.path })),
        result: { status: 'deploy_failed', reason: error.code || 'copy_failed', revision: source_revision },
        evidence: { error: error.message },
        rollback_ref: null,
      });
      events?.emit?.({ type: 'deploy.failed', site_id, payload: { reason: error.code || 'copy_failed', message: error.message } });
      throw fail(error.statusCode || 500, error.code || 'deploy_copy_failed', `deploy failed: ${error.message}`);
    }

    const receipt = {
      receipt_id,
      site_id,
      provider: PROVIDER,
      target,
      prior_target: prior ? prior.target : null,
      prior_receipt_id: prior ? prior.receipt_id : null,
      manifest: manifest.map(({ path: p, sha256: h, bytes }) => ({ path: p, sha256: h, bytes })),
      manifest_hash,
      timestamp: new Date().toISOString(),
      initiator,
      source_revision,
    };

    // Nothing may claim `deployed` until the bytes are actually in place. The
    // pre-publish entry records an ATTEMPT; a failure after this point must not
    // leave durable evidence of a deploy that never landed.
    const entry = journalOrRefuse({
      site_id,
      initiator,
      intent: 'deploy',
      changes: manifest.map((m) => ({ path: m.path })),
      result: { status: 'publishing', receipt_id, target, revision: source_revision },
      evidence: { receipt },
      rollback_ref: receipt_id,
    }, () => { try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* best effort */ } });

    // Publish, then prove the published path is what we verified, and only then
    // persist the receipt and record success. A rename or receipt-write failure
    // journals the failure and leaves no receipt behind.
    let successEntry = null;
    try {
      fs.renameSync(tmpTarget, target); // atomic publish of the proven temp copy
      const published = computeManifestHash(buildManifest(target));
      if (published !== manifest_hash) {
        throw Object.assign(new Error('published bytes do not match the verified manifest'), { code: 'publish_hash_mismatch' });
      }
      persistReceipt(site_id, receipt_id, { ...receipt, manifest });
      successEntry = journal.append({
        site_id,
        initiator,
        intent: 'deploy',
        changes: manifest.map((m) => ({ path: m.path })),
        result: { status: 'deployed', receipt_id, target, revision: source_revision },
        evidence: { receipt, attempt_entry_id: entry.entry_id },
        rollback_ref: receipt_id,
      });
    } catch (error) {
      try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* best effort */ }
      try { removeReceipt(site_id, receipt_id); } catch { /* nothing persisted */ }
      journal.append({
        site_id,
        initiator,
        intent: 'deploy',
        changes: [],
        result: { status: 'deploy_failed', receipt_id, target, reason: error.message },
        evidence: { stage: 'publish', attempted_entry_id: entry.entry_id },
        rollback_ref: null,
      });
      throw Object.assign(new Error(`deploy failed during publish: ${error.message}`), { statusCode: 500, code: error.code || 'publish_failed' });
    }


    updateSpecDeployTarget(site_id, target, initiator); // skipped honestly if no valid spec yet

    events?.emit?.({
      type: 'deploy.completed',
      site_id,
      payload: { receipt_id, target, journal_entry_id: successEntry?.entry_id ?? entry.entry_id, revision: source_revision },
    });

    return stripContent(receipt);
  }

  // Recomputes the manifest hash of what is actually on disk at a receipt's
  // target and compares it to the hash recorded at deploy time (A7 oracle).
  function verify(siteId, receiptId) {
    const full = readFull(siteId, receiptId);
    const targetDir = paths.within('famtasticinc', siteId, full.receipt_id);
    const expected = new Map(full.manifest.map((m) => [m.path, m.sha256]));
    const mismatches = [];
    const actualManifest = [];

    if (fs.existsSync(targetDir)) {
      for (const relPath of walkAllFiles(targetDir)) {
        const digest = sha256(fs.readFileSync(path.join(targetDir, relPath)));
        actualManifest.push({ path: relPath, sha256: digest });
        if (!expected.has(relPath)) mismatches.push({ path: relPath, reason: 'unexpected_file' });
        else if (expected.get(relPath) !== digest) mismatches.push({ path: relPath, reason: 'content_mismatch' });
      }
    } else {
      mismatches.push({ path: null, reason: 'target_missing' });
    }
    const actualPaths = new Set(actualManifest.map((m) => m.path));
    for (const relPath of expected.keys()) {
      if (!actualPaths.has(relPath)) mismatches.push({ path: relPath, reason: 'missing_file' });
    }

    const actual_hash = computeManifestHash(actualManifest);
    const ok = mismatches.length === 0 && actual_hash === full.manifest_hash;
    return { ok, expected_hash: full.manifest_hash, actual_hash, mismatches, checked_at: new Date().toISOString(), target: targetDir, receipt_id: receiptId };
  }

  function rollback({ site_id, receipt_id, initiator } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'rollback requires site_id');
    if (!receipt_id) throw fail(400, 'receipt_id_required', 'rollback requires receipt_id');
    if (!initiator) throw fail(400, 'initiator_required', 'rollback requires an initiator');

    const target = readFull(site_id, receipt_id); // 404s on cross-site or unknown receipt_id
    if (!target.prior_receipt_id) {
      throw fail(422, 'no_prior_deploy', `receipt ${receipt_id} has no prior deploy to roll back to`);
    }
    const prior = readFull(site_id, target.prior_receipt_id);

    const priorTargetDir = paths.within('famtasticinc', site_id, prior.receipt_id);
    restoreTarget(priorTargetDir, prior.manifest);

    // Verify AFTER restoring, against bytes read back from disk, not the
    // in-memory manifest, and fail loudly on a restore that did not land.
    const verification = verify(site_id, prior.receipt_id);
    if (!verification.ok) {
      throw fail(500, 'rollback_verification_failed', `rollback of ${receipt_id} did not restore ${prior.receipt_id} exactly`, { verification });
    }

    // Restoring bytes is not the same claim as switching which release is
    // active; switch the pointer too and verify it landed.
    const pointerCheck = switchActivePointer(site_id, {
      receipt_id: prior.receipt_id, target: priorTargetDir, dns_evidence: 'rollback: no new dns check performed',
      environment: null, verified_at: null, updated_at: new Date().toISOString(), initiator, rolled_back_from: receipt_id,
    }, 'rollback_pointer_verification_failed');

    const entry = journalOrRefuse({
      site_id,
      initiator,
      intent: 'deploy.rollback',
      changes: prior.manifest.map((m) => ({ path: m.path })),
      result: { status: 'rolled_back', restored_receipt_id: prior.receipt_id, from_receipt_id: receipt_id },
      evidence: { verification, active_pointer: pointerCheck },
      rollback_ref: null,
    });

    events?.emit?.({
      type: 'deploy.rolled_back',
      site_id,
      payload: { restored_receipt_id: prior.receipt_id, from_receipt_id: receipt_id, journal_entry_id: entry.entry_id },
    });

    return {
      site_id, from_receipt_id: receipt_id, restored_receipt_id: prior.receipt_id, restored_target: priorTargetDir,
      verification, active_pointer: pointerCheck, journal_entry_id: entry.entry_id,
    };
  }

  // ADR-0003: Site Studio must not mutate DNS and this machine cannot reach
  // production, so go-live cannot resolve a real domain here. dns_evidence
  // supplied -> release marked production-verified; absent -> recorded
  // honestly as 'absent', environment/verified_at left unset (never
  // fabricated) so kernel/site.js's isLive() only reports live with evidence.
  function goLive({ site_id, receipt_id, dns_evidence, initiator } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'go-live requires site_id');
    if (!receipt_id) throw fail(400, 'receipt_id_required', 'go-live requires receipt_id');
    if (!initiator) throw fail(400, 'initiator_required', 'go-live requires an initiator');

    const matched = readFull(site_id, receipt_id); // 404s on cross-site or unknown receipt_id

    // Honest probe: recompute the deployed artifact's manifest hash against
    // bytes on disk right now. NOT a DNS check -- go-live never queries DNS.
    const verification = verify(site_id, matched.receipt_id);
    if (!verification.ok) {
      throw fail(409, 'go_live_verification_failed', `go-live refused: ${matched.target} does not match its recorded manifest hash`, { verification });
    }

    const current = spec.read(site_id);
    if (!current.spec || !current.valid) {
      throw fail(422, 'spec_required', 'go-live requires an existing valid spec.json (deploy first)');
    }

    const hasEvidence = Boolean(dns_evidence);
    const checked_at = new Date().toISOString();
    const dns_evidence_out = hasEvidence ? dns_evidence : 'absent';
    const environment = hasEvidence ? 'production' : null;
    const verified_at = hasEvidence ? checked_at : null;

    const receiptForSpec = {
      receipt_id: matched.receipt_id,
      provider: matched.provider,
      target: matched.target,
      manifest_hash: matched.manifest_hash,
      dns_evidence: dns_evidence_out,
      environment,
      verified_at,
      // Never fabricated: absent when no dns_evidence was supplied, since this
      // environment must not contact production DNS (ADR-0003).
      ...(hasEvidence ? {} : { dns_evidence_reason: 'no dns_evidence supplied; go-live cannot verify the live domain from this environment' }),
      verification_evidence: {
        checked: 'recomputed artifact manifest hash against files on disk at target',
        checked_at,
        manifest_hash_expected: verification.expected_hash,
        manifest_hash_actual: verification.actual_hash,
      },
    };

    const nextSpec = {
      ...current.spec,
      deploy: {
        ...(current.spec.deploy || {}),
        target: current.spec.deploy?.target || matched.target,
        canonical_target: matched.target,
        receipt: receiptForSpec,
      },
    };
    spec.write(site_id, nextSpec, { initiator, expectedRevision: current.revision });

    const pointerCheck = switchActivePointer(site_id, {
      receipt_id: matched.receipt_id, target: matched.target, dns_evidence: dns_evidence_out,
      environment, verified_at, updated_at: checked_at, initiator,
    }, 'go_live_pointer_verification_failed');

    const entry = journalOrRefuse({
      site_id,
      initiator,
      intent: 'deploy.go_live',
      changes: [{ path: 'spec.json' }],
      result: {
        status: hasEvidence ? 'live' : 'active_no_dns_evidence',
        canonical_target: matched.target,
        receipt_id: matched.receipt_id,
        dns_evidence: hasEvidence ? 'provided' : 'absent',
      },
      evidence: { verification, dns_evidence: dns_evidence_out, active_pointer: pointerCheck },
      rollback_ref: null,
    });

    events?.emit?.({
      type: 'deploy.went_live',
      site_id,
      payload: { canonical_target: matched.target, receipt_id: matched.receipt_id, journal_entry_id: entry.entry_id, dns_evidence: hasEvidence },
    });

    return { site_id, canonical_target: matched.target, receipt_id: matched.receipt_id, dns_evidence: dns_evidence_out, environment, verified_at, verification, active_pointer: pointerCheck };
  }

  return { plan, deploy, goLive, rollback, list, read, verify, readActivePointer, PROVIDER };
}
