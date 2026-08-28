// The one path for every byte a site mutation changes (plan 2.8, PHASE-1 contract).
//
// apply(): capture the exact prior bytes of every affected file (amendment A14:
// exactness is the whole before/after file manifest and content hashes, not just
// visible HTML), journal that manifest BEFORE any file becomes visible, write the
// files, then emit an event. Journal unavailable fails the whole mutation closed.
//
// undo(): looks up the journal entry that produced a given undo_token and
// restores the exact prior bytes of every file in its manifest, journalling the
// undo as its own entry (whose own undo_token can "redo" by the same mechanism).
// A divergent mutation after an undo invalidates that redo path: undo() only
// proceeds when the live bytes still match what the entry being undone actually
// produced, so a later, unrelated change refuses a stale redo instead of
// silently clobbering it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function fail(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readFileState(absPath) {
  if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
    return { exists: false, sha256: null, base64: null };
  }
  const buffer = fs.readFileSync(absPath);
  return { exists: true, sha256: sha256(buffer), base64: buffer.toString('base64') };
}

function newToken(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createMutation({ paths, journal, events }) {
  // THE SEAM. `within('sites', ...)` only ever resolved studio-generated build
  // output, so a mutation against an operator's real site (no directory under
  // that root) always 404'd before this line ran. resolveSite() decides which
  // root -- studio or the specific portfolio root -- actually holds this
  // site's files; within() still does the actual containment check either
  // way, unchanged.
  function resolveSitePath(siteId, relPath) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
      throw fail(400, 'invalid_change_path', 'each change requires a non-empty path');
    }
    if (path.isAbsolute(relPath) || relPath.split(/[/\\]/).includes('..')) {
      throw fail(400, 'invalid_change_path', `change path must be relative to the site directory and may not escape it: ${relPath}`);
    }
    // createIfMissing: true. A mutation on a site with no directory yet is how
    // the build pipeline writes a new studio site's first bytes, and that must
    // keep working exactly as before -- the seam only ADDS the portfolio
    // branch for ids the scan actually finds, it never narrows what used to
    // resolve.
    const { rootName } = paths.resolveSite(siteId, { createIfMissing: true });
    try {
      return paths.within(rootName, siteId, relPath);
    } catch {
      throw fail(400, 'invalid_change_path', `change path escapes the site directory: ${relPath}`);
    }
  }

  // Latest revision known for a site: the revision recorded on the most
  // recent journal entry, or 0 when the site has no mutation history yet.
  function currentRevision(siteId) {
    const [latest] = journal.read(siteId, { limit: 1 });
    return latest && typeof latest.result?.revision === 'number' ? latest.result.revision : 0;
  }

  function buildManifest(siteId, changes) {
    return changes.map((change) => {
      const abs = resolveSitePath(siteId, change.path);
      const before = readFileState(abs);
      const isDelete = change.contents === null;
      let after;
      if (isDelete) {
        after = { exists: false, sha256: null, base64: null };
      } else {
        const buf = Buffer.isBuffer(change.contents) ? change.contents : Buffer.from(String(change.contents ?? ''), 'utf8');
        after = { exists: true, sha256: sha256(buf), base64: buf.toString('base64') };
      }
      return {
        path: change.path,
        before_exists: before.exists,
        before_sha256: before.sha256,
        before_base64: before.base64,
        after_exists: after.exists,
        after_sha256: after.sha256,
        after_base64: after.base64,
      };
    });
  }

  function writeManifest(siteId, manifest) {
    for (const item of manifest) {
      const abs = resolveSitePath(siteId, item.path);
      if (item.after_exists) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(item.after_base64, 'base64'));
      } else if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
      }
    }
  }

  function journalOrRefuse(entryInput) {
    try {
      return journal.append(entryInput);
    } catch (error) {
      throw fail(503, 'journal_unavailable', `mutation refused: journal unavailable (${error.message})`);
    }
  }

  function apply({ site_id, initiator, intent, changes, expectedRevision } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'mutation.apply requires site_id');
    if (!initiator) throw fail(400, 'initiator_required', 'mutation.apply requires an initiator');
    if (!intent) throw fail(400, 'intent_required', 'mutation.apply requires an intent');
    if (!Array.isArray(changes) || changes.length === 0) {
      throw fail(400, 'no_changes', 'mutation.apply requires at least one change');
    }

    const current = currentRevision(site_id);
    if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== current) {
      throw fail(409, 'stale_revision', `stale revision: expected ${expectedRevision}, current ${current}`, {
        expectedRevision,
        currentRevision: current,
      });
    }

    // Step 1 (before anything is visible): capture the complete before/after
    // manifest. "After" is fully known already, since callers hand over the
    // literal content, so this manifest alone is enough to detect and recover
    // from a crash between journaling and finishing the writes.
    const manifest = buildManifest(site_id, changes);
    const nextRevision = current + 1;
    const undo_token = newToken('ut');

    const entry = journalOrRefuse({
      site_id,
      initiator,
      intent,
      changes: changes.map((c) => ({ path: c.path })),
      result: { status: 'applied', revision: nextRevision },
      evidence: { manifest },
      rollback_ref: undo_token,
    });

    // Step 2: write every file. Not wrapped in a try/catch that swallows the
    // error -- a failure here must propagate so the mutation is not reported
    // as successful. The journal entry above already records exactly what was
    // intended, so the resulting state is detectable (diff live bytes against
    // the manifest) and recoverable (undo/redo or a manual repair pass).
    writeManifest(site_id, manifest);

    // Step 3: only after every byte lands do we tell the world.
    events?.emit?.({
      type: 'mutation.applied',
      site_id,
      payload: { journal_entry_id: entry.entry_id, revision: nextRevision, intent, paths: changes.map((c) => c.path) },
    });

    return { journal_entry_id: entry.entry_id, revision: nextRevision, undo_token };
  }

  function findEntryByToken(siteId, undoToken) {
    const all = journal.read(siteId, { limit: Number.MAX_SAFE_INTEGER });
    return all.find((e) => e.rollback_ref === undoToken) || null;
  }

  function undo(siteId, undoToken) {
    if (!siteId) throw fail(400, 'identity_required', 'mutation.undo requires site_id');
    if (!undoToken) throw fail(400, 'undo_token_required', 'mutation.undo requires an undo_token');

    const target = findEntryByToken(siteId, undoToken);
    if (!target) throw fail(404, 'undo_token_not_found', `no journal entry for undo_token ${undoToken}`);

    const manifest = target.evidence?.manifest;
    if (!Array.isArray(manifest) || manifest.length === 0) {
      throw fail(422, 'undo_manifest_missing', `journal entry ${target.entry_id} has no restorable manifest`);
    }

    // Refuse a divergent undo/redo: only proceed while live bytes still match
    // what this entry actually produced. Once a later mutation touches the
    // same file(s), this path is stale and must not silently clobber it.
    for (const item of manifest) {
      const abs = resolveSitePath(siteId, item.path);
      const live = readFileState(abs);
      const matches = item.after_exists
        ? live.exists && live.sha256 === item.after_sha256
        : !live.exists;
      if (!matches) {
        throw fail(409, 'undo_conflict', `cannot undo ${target.entry_id}: ${item.path} has changed since this mutation`, {
          entry_id: target.entry_id,
          path: item.path,
        });
      }
    }

    // Restore every prior byte, exactly, and remove anything the mutation created.
    for (const item of manifest) {
      const abs = resolveSitePath(siteId, item.path);
      if (item.before_exists) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(item.before_base64, 'base64'));
      } else if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
      }
    }

    const current = currentRevision(siteId);
    const nextRevision = current + 1;
    const redoToken = newToken('ut');

    // The undo's own manifest runs the entry backwards: what was "after" for
    // the undone entry is now the "before" state of this action, and vice
    // versa. Calling undo() again with redoToken replays this same guarded
    // restore in the opposite direction -- a redo, using the identical
    // machinery and the identical divergence guard.
    const undoManifest = manifest.map((item) => ({
      path: item.path,
      before_exists: item.after_exists,
      before_sha256: item.after_sha256,
      before_base64: item.after_base64,
      after_exists: item.before_exists,
      after_sha256: item.before_sha256,
      after_base64: item.before_base64,
    }));

    const entry = journalOrRefuse({
      site_id: siteId,
      initiator: 'kernel:undo',
      intent: `undo:${target.intent}`,
      changes: manifest.map((m) => ({ path: m.path })),
      result: { status: 'undone', revision: nextRevision, undone_entry_id: target.entry_id },
      evidence: { manifest: undoManifest },
      rollback_ref: redoToken,
    });

    events?.emit?.({
      type: 'mutation.undone',
      site_id: siteId,
      payload: { journal_entry_id: entry.entry_id, revision: nextRevision, undone_entry_id: target.entry_id },
    });

    return { journal_entry_id: entry.entry_id, revision: nextRevision, undo_token: redoToken };
  }

  return { apply, undo };
}
