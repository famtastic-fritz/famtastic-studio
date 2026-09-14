# Site Studio learning record

## 2026-09-13 — Owner Desk recipe discovery and evidence boundaries

Observation: An earlier research review counted relative path segments incorrectly and called the Component Studio sibling import broken. Executing the existing import showed it was already correct. The new `/api/component-recipes` endpoint adds specification discovery, not a path repair.

Guidance: Resolve and execute imports before declaring a discovery failure. Test missing-library behavior separately from successful empty catalogs. Preserve implementation/readiness fields from the source package instead of normalizing them away. Recipe discovery does not prove rendering, customer authorization, booking transactions or deployment.

The captured Owner Desk implementation belongs to the FAMtastic Designs booking lane; reusable presentation source belongs to Component Studio. A future Studio build must bind the selected business's approved brand and backend adapter explicitly. Never transplant Tighten Up Your Locs identity or records into another business. Calendar and class enrollment are distinct domains sharing instructor time.

Evidence: `tests/component-recipe-discovery.test.js`, `docs/capabilities/OWNER-DESK-RECIPE-DISCOVERY.md`; consumer implementation lineage is recorded in Designs `docs/evidence/owner-desk-implementation/`.
