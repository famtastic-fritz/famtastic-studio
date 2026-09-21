import fs from 'node:fs';
import { digest, stagingError } from './staging-store.js';
// Private, operation-bound backup/restore for an exclusively claimed review
// target. Remote mutation needs the provider's target lock; read/write alone
// cannot promise atomic CAS against an unrelated cPanel operator.
export function createReviewBackup({ paths, journal, binding, readFile, writeFile, removeFile, listFiles }) {
  const bindingHash = digest(binding);
  const snapshotPath = operation => paths.within('staging', operation, 'remote-backup.json');
  function readSnapshot(operation) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath(operation)));
    if (snapshot.binding_sha256 !== bindingHash || snapshot.operation_id !== operation) throw stagingError('backup_binding_conflict');
    for (const file of snapshot.files) if (file.exists && digest(Buffer.from(file.base64, 'base64')) !== file.sha256) throw stagingError('backup_corrupt');
    return snapshot;
  }
  async function backup({ target, operation_id, manifest }) {
    if (digest(target) !== bindingHash) throw stagingError('backup_target_conflict');
    if (!fs.existsSync(snapshotPath(operation_id))) {
      const inventory = await listFiles();
      const declared = new Set(manifest.map(f => f.path));
      // Prevent stale prior public files from remaining reachable unnoticed.
      if (inventory.some(name => name !== '.htaccess' && !declared.has(name))) throw stagingError('stale_remote_inventory');
      const files = [];
      for (const item of manifest) {
        const bytes = await readFile(item.path);
        files.push({ path: item.path, exists: bytes !== null, sha256: bytes === null ? null : digest(bytes), base64: bytes === null ? null : bytes.toString('base64') });
      }
      const snapshot = { binding_sha256: bindingHash, operation_id, files };
      journal.append({ site_id: binding.site_id, initiator: operation_id, intent: 'review.backup', changes: manifest, result: { status: 'private_snapshot' }, evidence: { snapshot_sha256: digest(snapshot) } });
      const fd = fs.openSync(snapshotPath(operation_id), 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(snapshot)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const snapshot = readSnapshot(operation_id);
    return { ref: `${operation_id}/remote-backup.json`, verified: true, sha256: digest(snapshot) };
  }
  async function restore({ target, operation_id, backup: receipt, uploaded }) {
    if (digest(target) !== bindingHash) throw stagingError('restore_target_conflict');
    const snapshot = readSnapshot(operation_id);
    if (digest(snapshot) !== receipt.sha256) throw stagingError('backup_receipt_conflict');
    // Check the WHOLE change set before touching any file. Never overwrite a
    // third-party edit or remove an unreceipted file after a partial failure.
    for (const file of snapshot.files) {
      const bytes = await readFile(file.path), current = bytes === null ? null : digest(bytes);
      if (current !== file.sha256 && current !== uploaded[file.path]) throw stagingError('rollback_remote_changed');
    }
    for (const file of snapshot.files) {
      if (file.exists) await writeFile(file.path, Buffer.from(file.base64, 'base64'));
      else if (await readFile(file.path) !== null) await removeFile(file.path);
    }
    for (const file of snapshot.files) {
      const bytes = await readFile(file.path);
      if ((bytes === null ? null : digest(bytes)) !== file.sha256) throw stagingError('rollback_digest_mismatch');
    }
    return { verified: true, snapshot_sha256: digest(snapshot) };
  }
  return { backup, restore };
}
