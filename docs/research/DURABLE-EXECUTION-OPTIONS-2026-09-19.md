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
