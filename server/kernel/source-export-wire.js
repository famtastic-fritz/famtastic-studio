import { digest } from './staging-store.js';

// v2 hashes exact UTF-8 JSON bytes, never a consumer's reserialization.
export const sourceExportDigest = payload => digest('famtastic.finalized-source-wire.v2\n' + payload);
export function encodeSourceExport(record) {
  const payload_json = JSON.stringify(record);
  return { schema: 'famtastic.finalized-source-wire.v2', payload_json, sha256: sourceExportDigest(payload_json) };
}
export function decodeSourceExport(wire) {
  if (wire?.schema !== 'famtastic.finalized-source-wire.v2' || typeof wire.payload_json !== 'string'
    || Object.keys(wire).sort().join(',') !== 'payload_json,schema,sha256'
    || sourceExportDigest(wire.payload_json) !== wire.sha256) throw new Error('source_export_digest_mismatch');
  const record = JSON.parse(wire.payload_json);
  if (record?.schema !== 'famtastic.finalized-source.v1' || Object.hasOwn(record, 'sha256')) throw new Error('source_export_payload_invalid');
  return { ...record, sha256: wire.sha256 };
}
