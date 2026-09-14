# Site Studio Next change log

## 2026-09-14 - Preserve independent business applications

Documented the Locs owner correction: shared components do not imply an agency
portal, identity, database, booking API or notification queue dependency. Future
application-site updates must preserve the independent backend and same-domain
owner entry, not regenerate a static substitute or the retired portal route.

Recorded independent consumer source `ebb1215c`, migration guard source
`4cec4bd3` and public source `3dfaed65`. The orchestrator reports core cutover
live, exact one-request import, 12 legacy guards, hosted controlled owner
workflow checks, unchanged rollback digests, independent workers and a verified
backup. Corrected instruction emails were accepted by SMTP. Personal owner
sign-in, inbox delivery, a restore drill and the additional newsletter release
are not claimed complete. Exact package and receipt identifiers are in the
capability record.
Discovery remains read-only and non-executable; no readiness flags or runtime
code were promoted by this documentation change.

Validation: 11 focused discovery/inventory tests passed; whitespace checks pass.

## 2026-09-13 — Read-only candidate recipe discovery

Added `GET /api/component-recipes` to discover specifications from sibling
Component Studio while preserving readiness flags and explicitly reporting an
unavailable library. Existing component inventory remains intact. Four focused
discovery tests and seven inventory tests pass locally. No executable owner UI
import, scheduling runtime or production deployment is claimed.

See [capability and learning](capabilities/OWNER-DESK-RECIPE-DISCOVERY.md).
