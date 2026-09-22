import crypto from 'node:crypto';
import { phase2Failure } from './errors.js';

function normalized(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw phase2Failure(400, 'phase2_canonical_value_invalid', 'Canonical values require finite numbers');
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw phase2Failure(400, 'phase2_canonical_value_invalid', 'Canonical values must be JSON-compatible');
  }
  if (seen.has(value)) {
    throw phase2Failure(400, 'phase2_canonical_cycle', 'Canonical values cannot contain cycles');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalized(entry, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw phase2Failure(400, 'phase2_canonical_value_invalid', 'Canonical objects must be plain objects');
    }
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw phase2Failure(400, 'phase2_canonical_value_invalid', `Canonical field ${key} cannot be undefined`);
      }
      result[key] = normalized(value[key], seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(normalized(value, new WeakSet()));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function canonicalDigest(value) {
  return sha256Hex(canonicalJson(value));
}
