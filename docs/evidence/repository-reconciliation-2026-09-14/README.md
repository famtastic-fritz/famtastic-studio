# Repository standard proof, 2026-09-14

- `npm run lint`: passed.
- `npm test -- --maxWorkers=1`: 78 files, 930 tests passed.
- `node vendor/site-foundation/test.mjs`: 5 tests passed.
- `scripts/prove-library-discovery.mjs`: Components and Media rendered the actual
  pinned catalogs at 390, 768 and 1280 pixels with no page exceptions, horizontal
  overflow or clipped main content. Screenshots and browser-proof.json are here.
- A fresh generated customer clone executed its own vendored validator without
  neighboring FAMtastic code. Rebuild tests preserve authored design/backend
  source and staging robots. New palette drift requires an explicit revision.
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
