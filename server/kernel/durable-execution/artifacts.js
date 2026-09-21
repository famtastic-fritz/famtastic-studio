import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from './store.js';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function ensureRealDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw failure(409, 'artifact_directory_invalid', 'Artifact directories must be real directories, not links');
  }
}

function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw failure(400, 'artifact_identity_invalid', `${label} is not a safe artifact identifier`);
  }
  return value;
}

export function createMockArtifactStore({ paths }) {
  function write({ jobId, logicalKey = 'mock-result', version = 1, output }) {
    safeSegment(jobId, 'jobId');
    safeSegment(logicalKey, 'logicalKey');
    if (!Number.isInteger(version) || version < 1 || version > 100) {
      throw failure(400, 'artifact_version_invalid', 'Artifact version is invalid');
    }
    paths.ensure('execution');
    const jobDirectory = paths.within('execution', jobId);
    ensureRealDirectory(jobDirectory);
    const directory = paths.within('execution', jobId, 'artifacts');
    ensureRealDirectory(directory);
    const filename = `${logicalKey}-v${version}.json`;
    const target = paths.within('execution', jobId, 'artifacts', filename);
    const bytes = Buffer.from(`${canonicalJson(output)}\n`, 'utf8');
    const sha256 = digest(bytes);

    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) {
        throw failure(409, 'artifact_symlink_denied', 'Existing artifact path is a symbolic link');
      }
      const existing = fs.readFileSync(target);
      if (digest(existing) !== sha256 || existing.length !== bytes.length) {
        throw failure(409, 'artifact_identity_conflict', 'Existing artifact bytes do not match the deterministic result');
      }
    } else {
      const temporary = paths.within('execution', jobId, 'artifacts', `.${filename}.${crypto.randomUUID()}.tmp`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.linkSync(temporary, target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = fs.readFileSync(target);
        if (digest(existing) !== sha256 || existing.length !== bytes.length) {
          throw failure(409, 'artifact_identity_conflict', 'A competing artifact write produced different bytes');
        }
      } finally {
        try { fs.unlinkSync(temporary); } catch { /* already removed */ }
      }
      fsyncDirectory(directory);
      fsyncDirectory(paths.within('execution', jobId));
      fsyncDirectory(paths.root('execution'));
    }

    return {
      logical_key: logicalKey,
      version,
      artifact_ref: `execution-artifact:${jobId}/${filename}`,
      sha256,
      bytes: bytes.length,
    };
  }

  return { write };
}
