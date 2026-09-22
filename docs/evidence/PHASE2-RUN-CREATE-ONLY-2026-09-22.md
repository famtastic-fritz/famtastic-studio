# Phase 2 create-only primitive verification

September 22, 2026. **Review-branch source only; cloud apply remains hard-disabled.**
No provider, Google API, customer transport or canonical service was invoked.
See [the contract](../contracts/PHASE2-RUN-CREATE-ONLY.md) for its narrow boundary.

## Reviewed change

The operator-only module prepares an exact, immutable Cloud Run v2 POST-create
request using existing runtime validation and explicit allowlisted input. It has
no default transport, credentials, CLI or journal. Conflicts cannot become updates
or adoption; uncertain responses require read-only reconciliation. One original
handle cannot submit twice. Fresh handles still need a durable journal to reject
duplicate operation IDs before transport. Injected test callbacks are not such a
journal, nor proof that a real transport enforces deadlines/retry restrictions.

Independent review found a recovery defect: the pre-POST record said
`not_submitted`, although it could survive a crash after remote acceptance.
It now says `submission_unresolved`; the outcome-write-failure test inspects that
surviving intent. Rereview closed the finding. Accepted operations remain explicitly
not-ready/not-contained, with customer effects unauthorized. Current service name
validation is 1–49 characters in Node and the existing shell preflight.

Empty traffic is no longer described as zero traffic. Queue pause and initial IAM
containment remain separate unproved requirements. The former upsert-based apply
scaffolding is still unreachable and must be reconciled, not unlocked as-is.

## Executed evidence

Private receipt root:
`/Users/famtastic-fritz/Development/FAMtastic/worktrees/autopipeline-recovery.ggJXc1`.
Runs overlap; do not add their test counts.

| Receipt directory | Actual result | Scope |
| --- | --- | --- |
| `evidence-cloud-run-create-only-focused.mRH9QN` | 50 tests / 3 files; 1.68s suite, 2.972s guard | Earlier focused implementation; before final shell-boundary cases and recovery fix. |
| `evidence-cloud-create-paired-regression.tDQxX7` | 7 failed, 1,615 passed, 6 skipped; 136 files; 65.39s suite, 65.879s guard | Incorrect bare parallel invocation used default 5s timeout and omitted four paired fixture paths. Not a passing result. |
| `evidence-cloud-create-paired-serial.8gOyir` | 1,628 passed / 136 files; none failed/skipped; 217.41s suite, 219.135s guard | Established serial/paired profile, before the recovery-record fix. |
| `evidence-cloud-create-final-paired.3ScxAS` | **1,628 passed / 136 files; none failed/skipped**; 218.88s suite, 220.616s guard | Final runtime source, including recovery-record fix and 40 primitive-specific tests. |

Final execution also passes both repository lint checks, `prove:execution`,
`prove:execution:phase2`, offline infrastructure validation and whitespace checks.
Both proof commands report passed with zero external effects; their model/cloud
counters are fixtures, not real calls. All runs retain unchanged protected-data
inventories. The failed run was not fixed by relaxing source assertions: the
established bounded serial profile and all paired inputs were restored.

Final source: Studio base `0f2a656ba3403f8c2a2f40afeba92d649cee872b`, diff SHA-256
`37736d8c8b003b36c953a4892f576f7a99ff8029e700dcc0fb96b6fe4c35596b`;
Designs `9403fae7cca1611801dba134a1b524515b75a8f9`, clean at start.
Designs planning-only documents changed during this run; its runtime did not.
This receipt and final Studio documentation were added afterward.
Guard SHA-256:
`150e3feaa6f0c02cbae46a032cd92ca8a486a9db5cb278f540186edd38b0cfd4`.

## Reproduction and remaining gates

Use the existing guarded, disposable-data setup and all paired PHP harness paths.
For the full Studio invocation additionally set `SELECTED_DISPATCH_WORKER`,
`SELECTED_PORTAL_FRONTEND`, `SELECTED_PORTAL_DEPENDENCIES`, and
`SELECTED_CREDIT_POLICY_PHP` to the matching Designs checkout, then run:

```sh
npm test -- --no-file-parallelism --maxWorkers=1 --testTimeout=120000
npm run lint
npm run prove:execution
npm run prove:execution:phase2
/opt/homebrew/bin/bash infra/gcp/phase2/scripts/validate.sh
git diff --check
```

Actual durable operation journal, authorized bounded transport, interrupted-create
reconciliation, inherited IAM/queue containment, registry provenance and GCP canary
are not implemented/proven by this primitive. Cloud CLI authorization and hosted
GitHub Actions billing are still unresolved. Shared Drupal ownership, retained
independent QA, fresh managed journey and laptop-unavailable execution remain
required before claiming the four-part autonomous pipeline complete. No new
production flags, dispatch secret, provider credentials or service restart.
