# Phase 2 Google Cloud shadow baseline

This package describes an inert cloud shadow. It does not make the current
Phase 1 SQLite database a cloud authority, and it does not authorize customer
work. The repository contains isolated Phase 2 control, worker, Firestore,
Cloud Tasks, GCS, OIDC, and Vertex Gemini runtime modules. Source tests are not
cloud deployment evidence, so this package still stops before traffic or
activation.

The baseline is intentionally unable to execute work:

- both Cloud Run services are internal and IAM authenticated;
- control and worker use different runtime service accounts;
- only immutable image digests are accepted;
- new revisions receive no traffic;
- the Cloud Tasks queue finishes baseline creation in `PAUSED` state with 0.1
  dispatches per second and concurrency 1;
- no Scheduler job is created;
- persistent application controls are global pause on, dispatch off, worker
  off, and provider off;
- the application hard cap is 20 accepted jobs;
- the named Firestore database must already exist and is never created here;
- distinct source and artifact buckets use uniform access and enforced public
  access prevention;
- no secret is created in the baseline.

## Files

| File | Purpose |
| --- | --- |
| `resource-intent.yaml` | Reviewable desired state and safety invariants |
| `source-boundaries.yaml` | Separate image contexts and excluded source |
| `containers/*` | Narrow role-specific Dockerfiles and build-context filters |
| `manifests/*.service.yaml` | Declarative Cloud Run dry-run specifications |
| `scripts/validate.sh` | Offline shell, YAML, public-access, and prose checks |
| `scripts/plan.sh` | Local plan, plus optional read-only cloud and dry-run checks |
| `scripts/apply-inert.sh` | Review scaffolding, hard-disabled before cloud calls until Run creation is create-only |
| `scripts/stop.sh` | Explicitly gated first-response containment |
| `../../../scripts/pause-durable-execution-phase2.mjs` | Exact-gated, pause-only persistent control transaction |
| `EVIDENCE-RECEIPT.md` | Deployment or no-deployment evidence record |

## Source and container boundary

Do not build either image from the repository root as an unfiltered context.
The role-specific Dockerfile ignore files admit only package metadata, the
matching HTTP entrypoint and server, the shared HTTP boundary, and the isolated
Phase 2 execution modules.

The control image may admit jobs and create Cloud Tasks. It must not execute a
job. The worker image may call the fixed Vertex Gemini adapter only to create a
bounded shadow observation. That observation is evidence for operator review,
never a customer build or authorization for an effect. The effect firewall
denies callbacks, outbound messages, publishing, deployment, customer repository
writes, and payments. Never include customer source, Studio data, environment
files, service-account keys, or credentials in either image.

The runtime configuration is exact and fail closed:

```text
FAMTASTIC_EXECUTION_MODE=cloud-shadow
FAMTASTIC_EXECUTION_SCOPE=phase2-pilot
FAMTASTIC_PHASE2_RUNTIME=1
FAMTASTIC_PHASE2_MAX_JOBS=20
FAMTASTIC_PHASE2_PILOT_RUN_ID=<pilot-run-id>
FAMTASTIC_PHASE2_MAX_JOB_COST_MICROS=250000
FAMTASTIC_PHASE2_MAX_TOTAL_COST_MICROS=5000000
FAMTASTIC_PHASE2_MODEL=gemini-3.1-flash-lite
FAMTASTIC_PHASE2_PRICEBOOK_VERSION=vertex-gemini-2026-09-21
FAMTASTIC_PHASE2_VERTEX_LOCATION=global
GOOGLE_CLOUD_PROJECT=<project>
FAMTASTIC_PHASE2_REGION=<region>
FAMTASTIC_PHASE2_QUEUE=<queue>
FAMTASTIC_PHASE2_WORKER_URL=https://<worker-service>-<project-number>.<region>.run.app/internal/tasks/execute
FAMTASTIC_PHASE2_WORKER_AUDIENCE=https://<worker-service>-<project-number>.<region>.run.app
FAMTASTIC_PHASE2_CONTROL_AUDIENCE=https://<control-service>-<project-number>.<region>.run.app
FAMTASTIC_PHASE2_INTAKE_SERVICE_ACCOUNT=<intake>@<project>.iam.gserviceaccount.com
FAMTASTIC_PHASE2_SCHEDULER_SERVICE_ACCOUNT=<scheduler>@<project>.iam.gserviceaccount.com
FAMTASTIC_PHASE2_TASK_INVOKER_SERVICE_ACCOUNT=<task-invoker>@<project>.iam.gserviceaccount.com
FAMTASTIC_PHASE2_FIRESTORE_DATABASE=<named-database>
FAMTASTIC_PHASE2_SOURCE_BUCKET=<private-source-bucket>
FAMTASTIC_PHASE2_ARTIFACT_BUCKET=<private-artifact-bucket>
```

`FAMTASTIC_PHASE2_RUNTIME=1` makes the isolated runtime constructible. It does
not enable execution. Firestore bootstrap persists `global_pause=true`,
`dispatch_enabled=false`, `worker_enabled=false`, and
`provider_enabled=false`. Enabling Vertex requires a separate persistent control
change after the other gates pass.

The provider client identity is fixed in code, not selected by environment:
`@google/genai`, Vertex mode, stable API version `v1`, model
`gemini-3.1-flash-lite`, and thinking level `MINIMAL` with thought summaries
excluded. Reported thinking tokens are still billed as output and count with
candidate tokens against the 4096-token bound. A real GCP canary remains
unproven and is required before provider activation.

## Prepare configuration

Use a dedicated Google Cloud project. Copy `env.example` to a file outside the
repository, replace every example, then load it:

```bash
set -a
. /absolute/private/path/phase2.env
set +a
```

The two image variables must use
`$PHASE2_REGION-docker.pkg.dev/$PHASE2_PROJECT_ID/$PHASE2_ARTIFACT_REPOSITORY/`
and end in `@sha256:` plus 64 lowercase hex digits. Public, foreign-project,
other-region, and mutable image references are rejected.
The source and artifact buckets must be different. The worker URL must end in
`/internal/tasks/execute`, and its audience must be the same `run.app` origin.
The control audience must be a different `run.app` origin. Both origins must use
Cloud Run's deterministic
`https://SERVICE-PROJECT_NUMBER.REGION.run.app` form with no trailing slash.
The service name, hyphen, and project number DNS segment must be at most 63
characters. Online plan reads the numeric project number and rejects guessed
legacy hash hostnames or any mismatch before mutation. Caller identities
must be service accounts in the configured project. User principals are not a
valid substitute because the HTTP boundary checks the caller service-account
email for each route. Intake, scheduler, and task caller identities must be
pairwise distinct, and all five runtime and caller service accounts must be
different.
Record the source SHA, build command, build context, SBOM or provenance record,
resolved digest, and exact Artifact Registry describe evidence in
`EVIDENCE-RECEIPT.md` before online planning.

The example cost limits are the runtime maxima: 250000 micros, or $0.25, per
job and 5000000 micros, or $5.00, for the pilot. The per-job value must be from
80000 through 250000 micros. The runtime reserves 80000 micros per bounded
provider attempt, so that range funds one, two, or three attempts. The pilot
total must cover at least one job. Budget notifications remain advisory; these
application values and the transactional 20-job limit are the hard bounds.

Build the two contexts locally only after the executable entrypoint tests pass.
The Node base must also be an immutable digest:

```bash
docker buildx build --load \
  --build-arg NODE_BASE_IMAGE="$PHASE2_NODE_BASE_IMAGE" \
  --file infra/gcp/phase2/containers/control.Dockerfile \
  --tag site-studio-phase2-control:local .
docker buildx build --load \
  --build-arg NODE_BASE_IMAGE="$PHASE2_NODE_BASE_IMAGE" \
  --file infra/gcp/phase2/containers/worker.Dockerfile \
  --tag site-studio-phase2-worker:local .
```

These commands do not push or deploy. A release process must push to Artifact
Registry, resolve each pushed digest, and put only those digest references in
the private environment file.

## Offline validation and plan

These commands make no cloud call:

```bash
bash infra/gcp/phase2/scripts/validate.sh
unset PHASE2_ONLINE_PLAN
bash infra/gcp/phase2/scripts/plan.sh | tee /tmp/phase2-local-plan.txt
```

Inspect the rendered plan and compare all identifiers with the intended project.
The plan deletes its temporary rendered manifests on exit.

## Online read-only plan

This stage calls Google Cloud only for reads and Cloud Run `--dry-run`
validation. It does not apply resources. Confirm the active gcloud identity and
configuration first. The Firestore bootstrap uses Application Default
Credentials, so ADC must belong to the reviewed operator identity and have
named-database transaction access. `gcloud auth login` alone is not sufficient:

```bash
gcloud auth list
gcloud config list
gcloud auth application-default print-access-token >/dev/null
PHASE2_ONLINE_PLAN=1 bash infra/gcp/phase2/scripts/plan.sh \
  | tee /tmp/phase2-online-plan.txt
```

The plan must prove that the named Firestore database exists. It also requires
both target Cloud Run services, the queue, Scheduler job, both globally named
buckets, and all five service accounts to be provably absent. Existing resources
are never adopted. This prevents retained Run traffic, foreign queued tasks,
bucket ownership collisions, and inherited service-account keys or privileges.
Review IAM authority, quota, project billing, names, and drift.
The plan reads the numeric project number, reconstructs both deterministic
service URLs, and requires the configured worker route and both OIDC audiences
to match exactly. It also describes the Artifact Registry repository at the
configured project and region, requires Docker format, and describes each exact
digest reference. The returned fully qualified digest must reproduce the exact
registry, project, repository, package, and digest from configuration. A Cloud
Run dry-run cannot substitute for these image provenance checks.
Do not reinterpret a missing database as permission to use `(default)`.

## Budget alert

A Google Cloud budget sends alerts and does not cap or stop spend. Create or
verify one before apply. This is an operator command because billing-account IAM
does not belong to either runtime service account:

```bash
gcloud billing budgets create \
  --billing-account="$PHASE2_BILLING_ACCOUNT" \
  --display-name="Site Studio Phase 2 shadow" \
  --budget-amount="${PHASE2_BUDGET_AMOUNT_USD}USD" \
  --filter-projects="projects/$PHASE2_PROJECT_ID" \
  --calendar-period=month \
  --threshold-rule=percent=0.50 \
  --threshold-rule=percent=0.90 \
  --threshold-rule=percent=1.00
```

Record the budget resource name and notification recipients. The spend guard is
layered: budget alerts for visibility, max one instance per service, queue rate
0.1/s, queue concurrency 1, and an application hard cap of 20 accepted jobs.
The application cap is authoritative because a budget cannot be a kill switch.

## Apply remains hard-disabled

Apply is mutation scaffolding, not an executable release path. The script
requires the reviewed plan and inert apply gates, rejects a Firestore emulator,
and then exits before its first cloud call. It reports that
`PHASE2_CREATE_ONLY_RUN_GATE` has no accepted value in this package.

The blocker exists because `gcloud run deploy` is a create-or-update operation.
An absence check followed later by that command has a time-of-check to
time-of-use window in which a same-name service could be created and then
modified. A post-deploy zero-traffic check would detect the conflict only after
the foreign service had already been changed. That does not satisfy the
one-shot, never-adopt contract.

The visible sequence has a second activation blocker: it creates the Cloud Tasks
queue and pauses it in the next command. That does not prove the queue was born
paused. Even though the proposed ordering has no authorized producer at that
point, a separate command is not an atomic initial-state guarantee. A future
apply path must create the queue paused or prove equivalent atomic containment.

Do not bypass the blocker locally. A separately reviewed change must replace
both Run deploy steps with a create-only API or equivalent atomic precondition,
add conflict tests, and record real project evidence. Until then, online plan is
the furthest authorized cloud action. The commands below the blocker remain
visible only so reviewers can assess the proposed inert sequence.

If that blocker is closed later, the proposed sequence verifies the named
Firestore database, creates fresh service accounts and buckets, installs narrow
IAM bindings, creates and pauses the queue, initializes exact paused controls
and a zeroed pilot budget, and deploys digest-pinned revisions with no traffic
and no deploy-time startup probe. It does not create a Scheduler job. The
initialization is idempotent only for an empty matching pilot and rejects unsafe
controls, a conflicting active pilot, existing pilot jobs, or a nonzero cost
ledger.

The proposed sequence rechecks ADC, repeats the exact Artifact Registry
repository and image digest describes, proves every managed resource name
absent, and re-describes the required named Firestore database. Those checks
must remain before mutation when the create-only blocker is eventually closed.
The replacement must also preserve one-shot failure semantics: any partial apply
requires classification and a reviewed recovery plan, not blind adoption or
rerun. Its postconditions must read each service and fail unless `status.url`
equals the configured no-slash audience and every reported traffic target is
zero. A partial apply or a failed postcondition check is not deployment success.

The proposed IAM grant matrix is intentionally asymmetric:

| Principal | Resource | Roles |
| --- | --- | --- |
| Control runtime | Source bucket | `roles/storage.objectCreator`, `roles/storage.objectViewer` |
| Control runtime | Phase 2 queue | `roles/cloudtasks.enqueuer`, `roles/cloudtasks.viewer` |
| Worker runtime | Source bucket | `roles/storage.objectViewer` |
| Worker runtime | Artifact bucket | `roles/storage.objectCreator`, `roles/storage.objectViewer` |
| Worker runtime | Project | `roles/aiplatform.user`, `roles/datastore.user` |
| Control runtime | Project | `roles/datastore.user` |
| Intake caller | Control service | `roles/run.invoker` |
| Scheduler caller | Control service | `roles/run.invoker` |
| Task caller | Worker service | `roles/run.invoker` |
| Control runtime | Task caller service account | `roles/iam.serviceAccountUser` |

Neither runtime gets `roles/storage.objectUser` or object deletion authority.
The queue-scoped viewer role is required for exact `ALREADY_EXISTS`
convergence: the control task adapter calls `getTask` with `responseView=FULL` and must
have both `cloudtasks.tasks.get` and `cloudtasks.tasks.fullView`. Enqueuer alone
provides full view but not task get.

Cloud Run IAM is service-scoped, while the application performs the narrower
route check. The intake service account is accepted only at the admission route,
the scheduler service account only at `/internal/reconcile`, and the task caller
service account only at the worker execution route. The control runtime gets
`iam.serviceAccounts.actAs` through `roles/iam.serviceAccountUser` only on the
task caller service account so it can attach that OIDC identity to Cloud Tasks.

The proposed inert baseline would create and authorize the intake caller service
account without attaching it to any workload. Local Phase 1 and Site Studio
cannot reach the internal-only control service. A future activation change must
name and provision a reviewed cloud ingress workload and network path that uses
this identity; the proposed baseline does not imply a connected intake path.

After a future create-only apply is implemented and separately approved, use
these exact read-only checks:

```bash
gcloud tasks queues describe "$PHASE2_QUEUE" \
  --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION" \
  --format='yaml(name,state,rateLimits,retryConfig)'
gcloud run services describe "$PHASE2_CONTROL_SERVICE" \
  --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
  --format=export
gcloud run services describe "$PHASE2_WORKER_SERVICE" \
  --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
  --format=export
gcloud storage buckets describe "gs://$PHASE2_ARTIFACT_BUCKET" \
  --project="$PHASE2_PROJECT_ID" \
  --format='yaml(name,location,iamConfiguration)'
gcloud storage buckets describe "gs://$PHASE2_SOURCE_BUCKET" \
  --project="$PHASE2_PROJECT_ID" \
  --format='yaml(name,location,iamConfiguration)'
gcloud scheduler jobs describe "$PHASE2_SCHEDULER_JOB" \
  --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
```

The last command must return not found. Confirm no traffic targets the new
revisions and neither service policy contains a public principal.

## Scheduler activation is withheld

There is deliberately no activation script. The current repository has no
cloud deployment receipt for the implemented Phase 2 runtime. Creating or
resuming Scheduler, resuming the queue, routing traffic, or changing any
persistent application control would exceed this inert infrastructure change.

After those implementations pass an independent review, activation requires a
new change containing all of the following:

1. A specific control and worker revision digest with verification receipts.
2. A dry-run and rollback target for traffic promotion.
3. A named cloud ingress workload and internal network path for the otherwise
   unattached intake caller service account.
4. A Scheduler create command using the scheduler caller service account and
   an OIDC audience fixed to the internal control URL.
5. A Scheduler pause command executed immediately after creation and evidence
   that its state is `PAUSED` before any later resume.
6. A queue resume command behind a separate exact gate.
7. An application control transaction that preserves the effect firewall, sets a
   fixed pilot allowlist, begins with `provider_enabled=false`, and cannot accept
   more than 20 jobs.
8. Evidence that all work is synthetic or disposable and has zero customer
   callbacks, messages, publishes, deployments, repository writes, or billing.

The reviewed activation change may use this exact Scheduler command sequence.
The create command is itself the explicit activation and creates an enabled job,
so the pause must follow immediately while application dispatch and the queue
are still off. Do not run it from this baseline:

```bash
CONTROL_URL="$(gcloud run services describe "$PHASE2_CONTROL_SERVICE" \
  --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
  --format='value(status.url)')"
[[ "$CONTROL_URL" == "$PHASE2_CONTROL_AUDIENCE" ]] || {
  printf 'control URL does not match PHASE2_CONTROL_AUDIENCE\n' >&2
  exit 1
}
gcloud scheduler jobs create http "$PHASE2_SCHEDULER_JOB" \
  --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION" \
  --schedule='*/30 * * * *' --time-zone=Etc/UTC \
  --uri="$CONTROL_URL/internal/reconcile" --http-method=POST \
  --headers='Content-Type=application/json' --message-body='{}' \
  --oidc-service-account-email="$PHASE2_SCHEDULER_SA@$PHASE2_PROJECT_ID.iam.gserviceaccount.com" \
  --oidc-token-audience="$PHASE2_CONTROL_AUDIENCE" --attempt-deadline=60s
gcloud scheduler jobs pause "$PHASE2_SCHEDULER_JOB" \
  --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
```

## Stop and rollback checklist

First contain dispatch and ingress. This is safe even if later cleanup is
deferred:

```bash
export PHASE2_STOP_GATE=STOP_PHASE2_SHADOW
bash infra/gcp/phase2/scripts/stop.sh
unset PHASE2_STOP_GATE
```

`stop.sh` pauses the queue and Scheduler first. It then invokes the exact-gated
pause-only CLI, which binds the configured project and named Firestore database,
verifies the active pilot inside the transaction, and sets
`global_pause=true`, `dispatch_enabled=false`, `worker_enabled=false`, and
`provider_enabled=false`. The CLI cannot enable a control and prints a receipt
containing only resource identity and safe control state. An already-paused
matching pilot is a successful idempotent result. A Firestore emulator endpoint
is refused because it could produce a false containment receipt.

The stop gate authorizes the script to pass the CLI's fixed
`PHASE2_PAUSE_GATE=PAUSE_PHASE2_SHADOW` value. Application Default Credentials
must be able to update the named database. A persistent-pause failure is
classified and makes the final stop result fail, but does not prevent the
remaining IAM containment attempts. Record the receipt or the classified
failure in `EVIDENCE-RECEIPT.md`. There is no command in this package that
enables persistent controls.

The stop path prevents new provider submissions after its controls and IAM
changes take effect. It cannot cancel a Vertex request that was submitted before
containment. Preserve the affected job, attempt, model-call ledger and provider
logs until that outcome and cost are classified; do not call the system drained
from the pause receipt alone.

Then verify, in order:

- queue state is `PAUSED` and its task count is recorded;
- Scheduler is absent or `PAUSED`;
- persistent global pause is on, dispatch is off, worker is off, provider is
  off, and the effect firewall remains intact;
- direct invoker bindings are removed or a reviewed known-good revision is the
  sole internal traffic target;
- no lease remains active and every accepted job has a terminal or parked state;
- Cloud Run request logs, Cloud Tasks attempts, Firestore rows, and GCS objects
  have been captured in the evidence receipt;
- no customer callback, message, publish, deploy, repository write, or payment
  occurred.

Do not delete the queue, Firestore database, either bucket, revisions, logs, or
service accounts during incident response. Deletion destroys evidence and is
not a rollback. Resource cleanup is a separately reviewed destructive operation.

## Secret rule

OIDC IAM is the baseline intake authentication, so Secret Manager is not
enabled and no secret is created. If a future external intake contract requires
HMAC, add one dedicated Secret Manager secret in the same reviewed change,
grant accessor only to the control runtime service account, pin an explicit
secret version, document rotation and overlap, and never expose the value in an
environment file, plan output, log, image, task body, or evidence receipt.
