# Repository standard proof, 2026-09-14

- `npm run lint`: passed.
- `npm test -- --maxWorkers=1`: final static-output follow-on, 79 files, 932 tests passed.
- `node vendor/site-foundation/test.mjs`: 5 tests passed.
- `scripts/prove-library-discovery.mjs`: Components and Media rendered the actual
  pinned catalogs at 390, 768 and 1280 pixels with no page exceptions, horizontal
  overflow or clipped main content. Screenshots and browser-proof.json are here.
- A fresh generated customer clone executed its own vendored validator without
  neighboring FAMtastic code, plus `npm ci`, `npm test` and `npm run build` with
  an unchanged lockfile. The build emits real allowlisted `dist/` files; malformed
  HTML or an unsafe public allowlist fails without replacing the prior artifact.
  Private agent/docs/spec/blueprint/package JSON files are absent from the output
  and return 404 from the generated localhost preview. Static deployment tests
  reject missing/unsafe allowlists and symlinks before target/receipt writes.
  Rebuild tests preserve authored design/backend/PHP/.htaccess source and staging
  robots. New palette drift requires an explicit revision.
- Git tests exercised nested/foreign repositories, customer/agency common-dir
  distinction, dirty snapshots, duplicate identity and an approved local bare
  remote push with exact remote-ref readback.

Library pins: Component 7745a9feb281e8ac32d2198cdb42a87f46d727e4;
Media 8d6371f2a7614898eb4b78dc601b142103150d00. Six and four records respectively.
The six site-foundation implementation/test files match the Component Studio
capture byte-for-byte; the wrapper documentation is library-owned.

The first parallel final test run hit host ENOSPC on one temporary DNA write;
929 tests passed, one failed from disk capacity. After capacity recovered, the
complete low-concurrency suite passed. No fixture failure was relabeled success.

Review caught inherited mobile shell clipping that document overflow checks
missed. The two library views now use a narrow-screen horizontal navigation row;
proof asserts actual panel width and main height as well as document overflow.
The original authored design.md remains intact with an additive reconciliation
section.

These are local source/browser proofs. They do not establish customer production
deployment, runtime service cutover or generic production readiness for backend
library packages. The ecosystem release ledger owns those separate receipts.
