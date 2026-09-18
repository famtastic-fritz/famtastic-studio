# Source wire v2 and inherited markers

The parent's independent review of b878623 / 2ae0d1ea passed 169 tests in 27 files, but identified two valid-source failures: normal immutable phone/email/address/testimonial metadata was rejected, and PHP decode/re-encode changed empty objects and numeric formatting before hashing.

## Wire contract

The finalized-source export is now exactly three envelope fields: `schema: famtastic.finalized-source-wire.v2`, `payload_json` (a JSON string containing the complete `famtastic.finalized-source.v1` record), and `sha256`. Hash input is UTF-8 bytes of `famtastic.finalized-source-wire.v2`, one LF byte, then the exact payload string. No Unicode normalization, key sorting or numeric rewriting occurs. The prefix separates this identity from old exports, so new exports do not overwrite old format files under the same digest.

Consumers verify the bytes before parsing. PHP stores the original envelope unchanged; its associative decoded view is used only for business-field reads, never to recreate the authoritative export. Node reconstructs original object/array/value semantics from the retained payload. There is no duplicate semantic payload to prefer accidentally. Unknown envelope fields and old v1 flat records are rejected. Existing v1 records need a fresh verified finalizer export and updated mapping, not silent migration.

Reordering envelope fields is harmless. Reordering payload keys, whitespace, alternate numeric spellings or changing an empty object into an array changes the byte identity. Such changes fail with the old hash; a new valid digest must also match the installation-owned authority mapping. Original payload bytes remain exactly retrievable through PHP storage.

Planning has the related reserialization trap: the PHP producer now records `intent_payload_json`, its byte hash and strategy; Next verifies the bytes and intent view, then echoes the verified hash. Agency callback comparison uses that retained payload. Scope snapshots similarly carry `snapshot_json` and a byte hash; authority binds that hash instead of another language's serialization. Same-language revision fingerprints and inherited DNA hash labels remain producer-owned, not cross-language recomputation contracts. Current intake/DNA extraction already uses PHP associative views; lossless capture of upstream raw JSON belongs to the normal source writer in the connection plan. These changes do not retroactively restore data an earlier producer already discarded.

## Inherited fields

Phone, email, address and testimonial are allowed immutable marker kinds alongside link/image. Only explicitly authorized typed text leaves are substitution targets. Tests copy the entire marked footer exactly and reject attempts to edit protected footer fields or protected main-component fields. Unknown/html field kinds and active markup remain rejected.

## Verification and remaining work

The bounded sweep passed 77 tests in 9 files in 16.91s. After adding the v2 domain prefix and alternate numeric-spelling coverage, the focused source/marker/planning sweep passed 32 tests in 4 files in 7.35s. Tests exercise actual Next export through actual PHP source registration and normal selection for empty objects/arrays, small/large numbers, Unicode, reordered envelopes/payloads and tampering; PHP planning fixtures include small/large numbers and Unicode. PHP 42 contract assertions plus 3 normal-selection cases and lint pass. No Drupal runtime, credentials, provider call, production/legacy write or hosting activation occurred.

See `docs/plans/NORMAL-SELECTED-WRITERS-2026-09-17.md` for the remaining normal producer connection plan. General automatic building remains open. Drive mirror is outside the explicit two-worktree scope.
