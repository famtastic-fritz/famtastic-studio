# Phase 2 cloud shadow evidence receipt

Copy this template for each plan, apply, verification, stop, or rollback. Keep
secret values, tokens, customer content, and raw task bodies out of the receipt.

## Identity

- Receipt ID:
- UTC start and end:
- Operator:
- Reviewer:
- Action: `offline-plan | online-plan | apply-inert | verify | stop | rollback`
- Git branch and SHA:
- Dirty worktree classification:
- gcloud version:
- Active gcloud account:
- Project ID and number:
- Region:
- Artifact Registry repository resource name, location, and format:
- Pilot run ID:

## Inputs

- Control source SHA and build context:
- Control image digest:
- Control returned registry, project, repository, package, and digest:
- Control provenance attestation reference:
- Control SBOM reference:
- Worker source SHA and build context:
- Worker image digest:
- Worker returned registry, project, repository, package, and digest:
- Worker provenance attestation reference:
- Worker SBOM reference:
- Named Firestore database ID:
- Source bucket:
- Artifact bucket:
- Queue:
- Per-job cost cap in micros:
- Total pilot cost cap in micros:
- Vertex model, pricebook, and location:
- Control audience:
- Worker audience:
- Intake caller service account:
- Scheduler caller service account:
- Task caller service account:
- Scheduler expected state: `ABSENT`
- Budget resource and alert recipients:
- Apply or stop gate used:
- Persistent pause gate source: `stop.sh fixed value | standalone reviewed command`

## Precondition evidence

| Check | Expected | Observed | Evidence reference |
| --- | --- | --- | --- |
| Firestore database | named, exists | | |
| Artifact Registry repository | exact project, region, name, Docker format | | |
| Control image describe | exact registry, project, repository, package, digest | | |
| Worker image describe | exact registry, project, repository, package, digest | | |
| Target Cloud Run services | both absent | | |
| Configured service URLs | exact deterministic project-number form, no slash | | |
| Queue and Scheduler names | both absent | | |
| Bucket names | both globally absent | | |
| Five service-account IDs | all absent | | |
| Application Default Credentials | reviewed operator, named database access | | |
| Customer data | none | | |
| Global pause | on | | |
| Dispatch | off | | |
| Worker | off | | |
| Provider | off | | |
| Effect firewall | customer effects denied | | |
| Accepted job cap | 20 | | |
| Budget alerts | configured | | |
| Pilot state bootstrap | matching empty pilot or absent | | |

## Commands and results

Record exact commands with secret values redacted, exit codes, timestamps, and
immutable output references. Do not write `passed` for a command that did not
run.

| UTC | Command or check | Exit | Result | Evidence reference |
| --- | --- | ---: | --- | --- |
| | | | | |

## Postcondition evidence

| Check | Required result | Observed | Evidence reference |
| --- | --- | --- | --- |
| Control ingress | internal | | |
| Worker ingress | internal | | |
| Public principals | none | | |
| Runtime service accounts | distinct | | |
| Intake caller | service account, control invoker | | |
| Scheduler caller | service account, control invoker | | |
| Task caller | service account, worker invoker | | |
| Control task identity authority | actAs only on task caller | | |
| New revision traffic | 0 percent | | |
| Control status URL | exact configured deterministic audience | | |
| Worker status URL | exact configured deterministic audience | | |
| Queue state | PAUSED | | |
| Queue initial-state boundary | no create-then-pause exposure | | |
| Queue rate | 0.1/s | | |
| Queue concurrency | 1 | | |
| Queue attempts | max 3 | | |
| Scheduler | ABSENT | | |
| Withheld Scheduler contract | POST JSON `{}` to `/internal/reconcile`, exact no-slash audience | | |
| Source bucket uniform access | enabled | | |
| Source bucket public access prevention | enforced | | |
| Artifact bucket uniform access | enabled | | |
| Artifact bucket public access prevention | enforced | | |
| Runtime storage delete authority | none | | |
| Control queue task read | get plus full view | | |
| Worker Vertex role | aiplatform user | | |
| Secrets created | none | | |
| Global pause | on | | |
| Dispatch | off | | |
| Worker | off | | |
| Provider | off | | |
| Pilot budget ledger | zero at inert bootstrap | | |
| Effect firewall | customer effects denied | | |
| Accepted job cap | 20 | | |
| Per-job cost cap | at most 250000 micros | | |
| Total pilot cost cap | at most 5000000 micros | | |
| Provider pin | Gemini model, pricebook, global location | | |

## Zero customer effects

- Accepted synthetic jobs:
- Dispatched tasks:
- Worker attempts:
- Vertex Gemini shadow calls:
- Vertex requests in flight when containment began:
- Unresolved model-call outcomes or cost reservations:
- Vertex observations awaiting review:
- Measured Vertex cost:
- Customer callbacks:
- Customer messages:
- Publishes or deployments:
- Customer repository writes:
- Payments or billing mutations:
- Active leases after stop:
- Unexpected external network observations:

Vertex shadow calls and their measured cost may be nonzero only in a separately
activated pilot receipt. Every customer-effect row must be zero. Attach logs or
queries that establish the denominator. An empty screenshot is not sufficient
evidence.

## Drift, failures, and decision

- Existing resources changed:
- Unexpected IAM bindings:
- Failed or skipped checks:
- Partial mutations:
- Residual resources:
- Unresolved risks:
- Stop or rollback actions:
- Persistent pause CLI exit and failure classification:
- Persistent pause receipt project, database, pilot, and duplicate flag:
- Persistent pause transaction and resulting control record:
- Final status: `PASS | FAIL | INCOMPLETE`
- Reviewer decision and UTC timestamp:
