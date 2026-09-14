# Owner Desk recipe discovery — 2026-09-13

Current 2026-09-14 override: fixed sibling imports described below are historical.
Discovery now uses pinned, declarative catalog JSON from independently configured
repositories. See SITE-REPOSITORY-STANDARD.md. The historical Designs source
paths below record lineage, not the canonical location for future customer apps.

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

## 2026-09-14 - Independent business application correction

The owner rejected the earlier Tighten Up Your Locs booking runtime inside the
FAMtastic Designs customer portal. That implementation is historical context,
not the default runtime for future business sites. The replacement source is
`customer-apps/tighten-up-your-locs/` in the Designs repository at
`ebb1215cfcd8ce5bdcdfedc96e17a5ce9f518d0d`, governed by
`docs/architecture/LOCS_STANDALONE_APPLICATION_V1.md` and its own `design.md`.

The declared application boundary is a same-domain `/admin/login`, independent
owner authentication, a dedicated database/user, booking tables, audit and
notification outbox. The release orchestrator reports the core cutover live:
application source `ebb1215c`, following initial installation `3b4caea0`, has 15
dedicated tables and a runtime CRUD user restricted to that database. One legacy
request was imported with field-by-field equality and zero replayed alerts;
12 exact-site write guards from source `4cec4bd3` prevent late legacy changes.

Hosted HTTP checks passed controlled owner login, CSRF enforcement, requests,
appointments, conflict, stale version rejection and logout. Fixture account/data
were removed. All six booking-table digests were unchanged by rollback-only
MySQL checks. Public source `3dfaed65f59ef11fe8dd04dfa39d48c682299f8e` produced
deployed package SHA-256
`2a21e89933677be844aec14122e2701a22787b2938ba09b29eca4a524290ff13`.
Same-origin booking endpoints were verified on apex and www. Own booking/mail
are enabled, the old worker was removed by exact marker, and independent minute
worker/nightly backup are active. A backup was created and verified; a restore
drill is not claimed.

Corrected instructions were accepted by SMTP: Shay
`1x66Bq-00000002qz6-0JVQ`; Fritz, copied to Shay,
`1x66C9-00000002r8l-3oE6`. Acceptance is not inbox delivery or readership. Shay
must still choose her own password and complete her personal sign-in. Newsletter
was pending at this core checkpoint; its later evidence is recorded below.
These are orchestrator-reported consumer deployment facts, not proof that
Site Studio can execute or regenerate this application recipe.

The discovery contract remains `discovery_only: true` and
`executable_import_proven: false`. Preserve the source recipe's
`runtime_implemented: false`, `backend_bundled: false`,
`production_proven: false` and `site_studio_import_proven: false`. The captured
React component retains its original hashes; the independent Laravel consumer
is separate source, not an unrecorded replacement of that component.

### Required continuation boundary

- Treat the selected business as `capability_class: "application"`; carry its
  backend descriptor and functional contract alongside the approved public
  artifact and design contract.
- Reuse components, acceptance contracts and approved assets at build time.
  Never infer agency authentication, sessions, databases, API endpoints or
  notification queues from a shared component or source repository.
- Preserve the independent backend, storage, routes and business records during
  public page additions or media/content updates. A static renderer must not
  overwrite the application, replace it with decorative controls, or recreate
  the old agency `/portal?section=booking` entry.
- If a loader cannot represent or safely carry the application boundary,
  report it as unavailable for that operation. Discovery and visual parity
  alone must not authorize an application rebuild or deployment.
- Before promotion, prove same-origin owner login, request persistence,
  reservation conflicts, replay, reschedule rollback, notification recovery,
  backup/restore and operation without the agency application available.

Scope of this change: documentation and Component Studio recipe metadata only.
No Site Studio route, loader, deployment provider, account or running service was
changed. Core release evidence is recorded above; documentation repository
commit and push results are reported separately from the consumer deployment.

Validation on 2026-09-14: four recipe-discovery tests and seven component
inventory tests pass against the updated sibling metadata. The source recipe
retains negative runtime readiness, and the discovery endpoint retains
`discovery_only: true` and `executable_import_proven: false`. No browser,
deployment or live consumer-import proof is implied by these 11 local tests.

## 2026-09-14 - Business-owned newsletter source pattern

The orchestrator reports Locs source
`b79aca2b76e64a14368a0d04a83b6fafea650262` live with 18 independent tables.
Controlled HTTPS signup/duplicate suppression, SMTP acceptance
(`1x66OA-00000002wiy-1814`), read-only GET, CSRF confirmation, single-use token,
unsubscribe and 401 private-API denial passed; the fixture was fully removed.
`/admin/newsletter` is an owner-only reader count/list, not a campaign sender.

For future application builds, preserve separate newsletter consent,
double-opt-in, business-owned storage/outbox, unsubscribe and one-attempt SMTP
transactions with explicit uncertainty. Never auto-enroll appointment clients
or move the list into agency storage. This is candidate source-pattern awareness,
not bundled component code or executable Studio import; all strict recipe and
discovery flags remain unchanged.

Public title/meta, canonical/Open Graph, schema, robots and sitemap were
published; no Google Business Profile, Search Console or ranking outcome is
claimed. Reported release checks: 63 PHP tests/383 assertions, 36 public tests
and 11 admin tests. Later hover/child-HTTPS gateway source `576b190a` was still
deploying at this checkpoint; it is not needed to substantiate the newsletter
release above.
