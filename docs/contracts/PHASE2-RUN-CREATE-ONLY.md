# Phase 2 create-only service request boundary

September 22, 2026. Source-only operator primitive; **not wired into apply**.
`apply-inert.sh` still refuses before any cloud call and has no accepted create
gate. No credentials, SDK client, transport, journal or cloud resource is created
by importing `infra/gcp/phase2/scripts/run-create-only.mjs`.

## Exact request, not create-or-update

`prepareRunCreate(input, role)` reuses `loadPhase2Config` and its exact runtime
environment allowlist. It validates both roles, five distinct project-bound
runtime/caller accounts, deterministic project-number audiences, role/service
identity, repository-bound immutable images, source SHA and operation ID. It
deep-freezes one explicit Cloud Run v2 POST-create descriptor and body digest.
Unrelated ambient environment, credentials and caller-made request bodies are not
copied. Current shell preflight now uses the same 1-49 character service-ID bound.
The official [create method](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/create)
is separate from update and returns an operation, not proof of readiness.

`submitRunCreateOnce(plan, {request, record})` accepts only a plan created by that
module instance. It consumes the plan before awaiting the injected durable intent
writer, then invokes the injected transport once with POST, redirects rejected,
zero retries and a 30-second deadline contract. The pre-POST event says
`submission_unresolved`: if the process crashes or the outcome cannot be stored,
this surviving intent cannot be mistaken for proof that nothing was submitted.
A 409 is a conflict, never adoption
or update. Exceptions, malformed/foreign operations and other HTTP statuses are
uncertain and require read-only reconciliation. Provider error bodies are not
echoed. Accepted operations receive only `accepted_not_verified`; ready, contained
and customer-effect authorization remain false. Receipt-write failure after POST
does not permit resubmission. No update, patch, delete, IAM grant or second request
is implemented in this primitive.

The injected adapters are trusted dependencies, not implemented services: transport
must actually enforce its redirect/retry/deadline contract; the intent writer must
durably retain exact hashes before returning. A memory callback proves neither.
The WeakMap prevents reuse/reentry of one handle only. A second prepared handle
can reach the recorder again, even in the same process. The durable journal must
reject a duplicate operation before returning; server name collisions protect
against overwrites but are not durable submission deduplication. Cross-process
recovery requires that journal too. Never generate another name or operation ID
to escape an uncertain outcome. Source SHA and image digest here are supplied
identifiers, not verified build provenance; real registry/build receipts remain
required before a reviewed adapter invokes this primitive.

## Corrected traffic and queue assumptions

The [Service schema](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
defaults absent/empty traffic to the latest ready revision. The descriptor therefore
states 100% latest explicitly, with internal ingress, IAM checks enabled and the
default service URI disabled. It retains min0/max1 instances, concurrency1 and
bounded resources. This is not proof of no execution or zero cost: deployment can
start a container for validation; application pause/provider controls and actual
IAM/network containment require independent verification. It deliberately does
not claim the old scaffolding's unproved zero-traffic postcondition.

Cloud Tasks [queue state](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues)
is output-only. Adding PAUSED to a create payload cannot prove atomic pause.
The replacement provisioner must withhold enqueue/invoke authority before queue
creation, classify interrupted creation and prove final pause, with ownership-
specific containment that never changes a collided foreign resource. No queue or
IAM operation is added in this slice. The old dead-code apply sequence is still
review scaffolding, not a valid deployment recipe.

## Required next integration and evidence

- Reviewed actual transport and private durable intent/operation journal;
  read-only uncertain-response reconciliation bound to service UID, exact create
  operation, body/image/source hashes, observed generation and current policy.
- Dedicated-project inherited IAM review, pre-bootstrap paused application state,
  ownership-specific partial-failure containment, no early invoke/enqueue grants.
- Reconcile old dry-run manifests/resource intent/zero-traffic assertions with the
  contained-create contract before replacing the apply hard gate. Never merely
  delete the guard and execute the old upsert commands.
- Authenticated project/Artifact Registry/ADC checks, cost boundary, real collision
  and interrupted-create evidence. Then a separately proven cloud canary and
  laptop-off journey; cloud must use Drupal's shared customer-job claims.

Executed results: [September 22 receipt](../evidence/PHASE2-RUN-CREATE-ONLY-2026-09-22.md).
Source tests use injected response/record doubles, never Google Cloud. They do not
establish actual API authorization, create collision behavior, network isolation,
durability, IAM, pause or deployment. See the separately recorded execution receipt.
