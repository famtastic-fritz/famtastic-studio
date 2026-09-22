# Durable execution options

## Decision

Implement the storage and recovery contract locally first, then move its queue
and worker adapters to Google serverless. Do not use an always-on VM, n8n or a
dashboard as a substitute for durable admission, idempotency and recovery.

| Option | Best use | Decision |
| --- | --- | --- |
| Local SQLite plus deterministic mock | Prove schema, intake, retry, lease, artifact and dead-letter semantics without cost or external effects | Implemented in Phase 1 |
| Google Cloud Tasks plus Cloud Run | Production asynchronous dispatch and stateless workers using the existing Google account | Recommended next adapter after independent proof |
| Oracle Always Free Arm VM | Later low-cost worker host for tolerant workloads | Optional, not the queue authority |
| ChatGPT, Codex or Gemini schedules | Operator reminders, audits and summaries | Supervision only, not durable job execution |
| n8n on a VM | Human-facing integrations after core correctness exists | Defer until a concrete integration requires it |

Google documents Cloud Tasks as at-least-once delivery and explicitly requires
idempotent handlers. That matches the implemented job key, artifact identity and
fencing contract. A future adapter can persist the local dispatch intent, submit
a named Cloud Task and reconcile missing submission without changing task
identity. Cloud Run can host the worker, while the pause and approval controls
remain authoritative application state.

Oracle's current documentation still describes Always Free resources for the
life of the account, including an Ampere allocation equivalent to 2 OCPUs and
12 GB memory, 200 GB combined boot and block storage and 10 TB monthly outbound
transfer. It also says idle instances may be reclaimed after a seven-day window
when CPU, network and, for A1, memory measures remain below 20 percent. Capacity
can be unavailable. This makes Oracle useful for optional compute, not a sound
place to hide the dispatch ledger or the only recovery mechanism.

Sources:

- [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Google Cloud Tasks delivery model](https://docs.cloud.google.com/tasks/docs/dual-overview)
- [Google Cloud Run jobs](https://docs.cloud.google.com/run/docs/create-jobs)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite online backup](https://www.sqlite.org/backup.html)

## 2026-09-21 Phase 2 implementation addendum

The Google serverless option remains the selected design, now as an inert cloud
shadow candidate rather than an activated service. Two private Cloud Run
services separate admission/reconciliation from execution. Cloud Tasks carries
IDs-only named dispatch, a named Firestore database holds the durable state, and
two private GCS buckets hold immutable source wrappers and observations. Initial
infrastructure intends a settled baseline with both revisions at zero traffic,
the queue paused and Scheduler absent. The current apply path is hard-disabled,
so no such cloud baseline is claimed.

The provider choice is `gemini-3.1-flash-lite` on Vertex through the stable
`v1` API. Google's model page describes the model as stable and supporting
structured output and thinking. Vertex documents `MINIMAL` as its default
thinking level and as close as possible to a zero thinking budget, but thinking
tokens can still occur. The pricebook therefore charges both response and
reasoning tokens at the documented standard global rate. As of this review,
Google lists $0.25 per million text/image/video input tokens and $1.50 per
million response and reasoning tokens for standard global inference.

The candidate fixes the provider identity, model, API version, location,
thinking level, JSON schema, prompt size, combined output/thinking-token limit
and reservation amount in code. Reported usage must have zero cached tokens and
an exact total. These source checks do not replace a low-cap real GCP canary,
which remains a separate activation gate.

At-least-once delivery requires proof on both sides of submission. The Phase 2
candidate records a worker-claim acknowledgement deadline and advances a fenced
dispatch generation when a submitted task never claims. Old generations then
fail before model work. It also treats an `ALREADY_EXISTS` task whose FULL record
cannot be read as unknown execution risk, not safe deduplication. These are
application recovery properties; an always-on VM, n8n or a chat schedule would
not supply them.

The current infrastructure scaffold is intentionally non-executable. In
addition to the create-or-update Cloud Run problem, its separate queue-create
and queue-pause commands do not prove an initially paused queue. A future apply
must close both boundaries. Operational pause also cannot cancel a Vertex call
after submission, so live containment evidence must retain and reconcile the
model-call cost ledger.

The Oracle VM option still does not close the execution gap. Hosting this code
on a permanent VM would not itself establish transactional admission, dispatch
reconciliation, lease fencing, provider checkpoints or cost accounting. n8n and
scheduled chat jobs remain optional supervision or integration tools, not the
durable authority.

Additional sources reviewed on 2026-09-21:

- [Gemini 3.1 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Vertex thinking controls](https://cloud.google.com/vertex-ai/generative-ai/docs/thinking)
- [Vertex generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Cloud Run HTTPS invocation](https://cloud.google.com/run/docs/triggering/https-request)
- [Cloud Tasks delivery model](https://cloud.google.com/tasks/docs/dual-overview)
