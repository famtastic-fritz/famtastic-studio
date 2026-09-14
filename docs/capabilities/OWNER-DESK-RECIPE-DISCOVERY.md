# Owner Desk recipe discovery — 2026-09-13

Local implementation: `GET /api/component-recipes`, global read-only scope.
The existing component inventory/catalog endpoint remains present. The recipe
endpoint loads the sibling Component Studio API and returns original recipe
readiness fields plus `discovery_only: true` and
`executable_import_proven: false`. Missing/invalid library exports return
`status: unavailable` with an explicit reason and an empty recipe list.

Verification: four discovery tests and seven existing inventory tests pass.
No site, tenant, provider, calendar or published artifact is mutated. This is
specification discovery, not the owner application runtime or a deployment.

Learning: the earlier directory-count suspicion was disproved by actual import;
the original component catalog path was correct and was not changed.
