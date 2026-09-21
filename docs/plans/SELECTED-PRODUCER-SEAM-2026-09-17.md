# Minimal selected producer seam increment

Architecture direction: Next owns selected-site continuation and completed-source
export. Designs owns customer identity, scope, rights, review targets and exact
acceptance. Legacy remains read-only. This plan supersedes the source-placement
decision request in the earlier producer trace. All work is local source/tests;
no provider calls, production allocations or activation are included.

## 1. Produce selection intent from existing agency records

Add a dependency-free selection snapshot adapter called by the existing
`CustomerPortalService::createSelectedProofStaging` seam. Its inputs are the
actual request row (`intake_data`), selected variant, byte-verified artifacts,
request-owned asset records and project state. Its output is a versioned
selected-source intent, not an assertion that the website is complete.

Derive request/customer/project/campaign/variant IDs, selected direction, exact
source hashes, approval event/time and immutable revision from current records.
Preserve the original Design DNA and hash without demanding that legacy fonts
and fingerprints be rewritten as a fabricated canonical design contract.
Use the actual intake fields `page_count`, `page_list`, `required_features`,
`integrations`, `booking_details`, `ecommerce_details`, `custom_needs`, content
and brand answers as requested scope. A recommendation is not agreed scope;
ambiguous page mapping or interactive requirements become explicit plan issues.

Request asset authority already exists in `famtastic_request_asset`:
`ownership_confirmed`, `subject_permission_confirmed`, `ai_use_consent`,
`ai_transformation_consent`, `likeness_consent_version` and timestamp. Reuse
these only when an output asset is provably bound to that exact input record.
Do not translate general AI consent or `media_fulfillment.status` into blanket
rights approval. Assets lacking a binding remain individually unresolved.

No operator-authored continuation blob is required. Missing authority is a
structured issue with its field, source and resolving owner, attached to the
existing durable selected intent. Existing canonical packets remain compatible.

## 2. Accept intent and plan remaining work in Next

Version the staging continuation contract to distinguish inherited source
evidence from completed-site evidence. For inherited source, preserve its bytes
and original provenance reference directly. A source-import provenance record
may say research was inherited/unknown; it must not pretend research ran or
manufacture a `research_packet_ref` for an absent research result.

The planner compares requested scope to recorded completed output. Concept-only
source always yields remaining work and never `package_existing`. A successful
Next source export can establish materialized files, but completion additionally
requires scope coverage and relevant QA. Rights and hosting issues stay visible
and separately block the appropriate stage rather than blocking source intake.

First implement the intent adapter/planner and retain the current executable
packet lane. Do not silently relax the old executor's design/rights validation;
new inherited-source semantics need an explicit version and dedicated tests.

## 3. Export evidence where Next really finishes source work

Add an exporter to `createPipeline.run` after successful verify and the record
stage (where `assertManifestComplete` and `dna.finishRun` already run). Export
actual composed public file bytes/hashes, run identity, spec snapshot, original
packet/provenance references, source/repository binding and verification results.
Record rights only if supplied by a bound authority record. Scope coverage must
be separately computed; ordinary pipeline success alone is insufficient.

Persist this export beside the existing run records, then return its digest/ref
in the build result. The staging worker consumes the result and binds it into
its receipt. This uses the real source finalization seam; it does not introduce
a reverse proof-generation callback or import the legacy handler.

## 4. Separate the missing executor from transport

The existing `selected-html-slots-v1` executor can add absent pages only when a
hash-bound selected template and authored text-slot values already exist. It
cannot turn arbitrary proof HTML and freeform intake into those inputs. The
normal pipeline's generation path can write copy/layout/media, but it is not a
selected-preserving continuation executor and must not run as a fallback.

The minimal missing executor is a deterministic selected-template extraction
and page-assembly stage: identify reusable selected shell/component boundaries,
bind exact customer-authored content to explicit slots, preserve all completed
pages, and fail on ambiguous structure or missing content. Its output feeds the
existing slot executor with recorded transformations and parity QA. Scope this
increment to explicit structural markers/recipes; arbitrary concept HTML and
application behavior remain an implementation gap. No provider calls are needed
for this bounded executor. Do not claim it handles the general auto-build goal.

## 5. Test the real seams and report limits

- Feed the actual pipeline output into the source exporter, then the agency
  adapter/selection serializer, Next worker and actual receipt service. Reuse
  the current synthetic tenant/HTTP adapters, not a hand-seeded continuation.
- Use the pre-existing legacy variant shape for a negative/remaining-work test:
  it preserves selection and bytes and never claims full-site completion.
- Test real request-asset authority binding, ambiguous scope, unbound rights,
  stale source/export hashes and absent target binding independently.
- Prove no research/copy/image/layout provider calls for imported completed work
  and deterministic supported continuation. Retain current regression checks.

Hosting remains Designs authority. The current agency has no per-project
protected Inc target registry; a local registry/adapter can record and validate
an explicitly supplied binding without allocating a server path. Its missing
production binding is a real operational choice, not a reason to hand-author
source metadata. No business choice is needed to begin steps 1–3. A specific
customer's unclear pages/content, unavailable rights or unassigned review target
may require a narrow decision only when encountered; do not invent it in tests.

Implementation order: intent adapter/planner and negative normal-producer proof;
real Next exporter and supported positive export-to-receipt proof; then bounded
marked-template executor. Report each capability separately and retain the
general auto-build requirement as open until it has its own evidence.
