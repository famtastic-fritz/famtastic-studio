# Site Studio learning record

## 2026-09-14 - Source ownership must be enforced before the first write

Independent runtime is insufficient when the customer source remains inside an
agency repository. The prior post-build scaffold also bypassed direct builds
and overwrote authored documentation. Use the same preflight/package before all
creation paths, record foundation files in DNA, preserve authored source and
reject foreign/dirty/common-directory targets. A remote URL comes from Git, not
from a naming convention. See the repository reconciliation research record.

Sibling imports were locally functional but not portable. Discovery now reads
the pinned catalog from an explicitly configured independent checkout and
checks root, origin, revision and bytes. Availability of a library is not proof
of a full studio UI, installed application or production customer workflow.

## 2026-09-14 - Newsletter is a separate business-owned consent lane

Preserve explicit signup apart from booking, double-opt-in, read-only GET,
CSRF-protected confirmation/unsubscribe and business-owned storage/outbox.
An owner reader list does not imply campaign sending. Automatic transaction
retries must never wrap SMTP: the fixed post-acceptance deadlock check proves
one send, an uncertain outcome and no automatic resend.

The orchestrator verified source `b79aca2b` live through a controlled HTTPS
signup/confirmation/unsubscribe lifecycle and removed the fixture. This is a
candidate source pattern for future builds, not an imported or bundled Studio
feature. Keep readiness flags unchanged. Published local SEO files establish
source/deployment evidence, not search-account setup or rankings.

## 2026-09-14 - Application ownership must survive component discovery

Observation: The first Locs Owner Desk used the agency customer portal as its
runtime. The owner required a separate business application instead. Reusing a
presentation component was incorrectly allowed to determine the location of
authentication, booking records and notifications.

Guidance: Discover and reuse components at build time while preserving the
business's own backend descriptor, same-domain owner routes, identity authority,
database boundary and notification queue. An agency footer credit is not a
runtime dependency. Do not downgrade an application site into a static rebuild
or point it back to the agency portal when updating pages or assets. If Studio
cannot represent the functional contract, stop that operation explicitly.

Evidence: Designs source `ebb1215c`, `customer-apps/tighten-up-your-locs/`, and
`docs/architecture/LOCS_STANDALONE_APPLICATION_V1.md`. The orchestrator reports
core cutover live: database isolation, exact one-request import, 12 legacy write
guards, hosted controlled owner workflow, unchanged six-table rollback digests,
and fixture cleanup. Own same-origin booking, independent worker and nightly
backup are active; a backup was verified and corrected instructions accepted by
SMTP. Personal owner sign-in, inbox delivery and a restore drill remain separate
gates. Newsletter was pending at that core checkpoint; its later release is
recorded above. The capability record pins exact
source/package and receipt identifiers.
The Component Studio historical React hashes and Site Studio discovery-only
flags remain unchanged.

Post-evaluation: The discovery seam correctly preserves readiness metadata, but
the consumer guidance was too vague about business ownership. The updated
contract now names forbidden agency runtime dependencies. A future executable
application recipe needs an independence test in addition to visual parity and
catalog discovery tests.

## 2026-09-13 — Owner Desk recipe discovery and evidence boundaries

Observation: An earlier research review counted relative path segments incorrectly and called the Component Studio sibling import broken. Executing the existing import showed it was already correct. The new `/api/component-recipes` endpoint adds specification discovery, not a path repair.

Guidance: Resolve and execute imports before declaring a discovery failure. Test missing-library behavior separately from successful empty catalogs. Preserve implementation/readiness fields from the source package instead of normalizing them away. Recipe discovery does not prove rendering, customer authorization, booking transactions or deployment.

The captured Owner Desk implementation belongs to the FAMtastic Designs booking lane; reusable presentation source belongs to Component Studio. A future Studio build must bind the selected business's approved brand and backend adapter explicitly. Never transplant Tighten Up Your Locs identity or records into another business. Calendar and class enrollment are distinct domains sharing instructor time.

Evidence: `tests/component-recipe-discovery.test.js`, `docs/capabilities/OWNER-DESK-RECIPE-DISCOVERY.md`; consumer implementation lineage is recorded in Designs `docs/evidence/owner-desk-implementation/`.
