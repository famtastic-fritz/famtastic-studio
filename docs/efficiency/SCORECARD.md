# E5 Efficiency Scorecard: before vs after

> **RETIRED 2026-08-25 — "only research uses a brain."** DNA recorded the spec
> stage as `model: 'none'` while the copy stage inside it spawned a CLI once per
> page. **Two of six stages are model-backed** (research and spec), and the
> model-backed share of wall time is ~92-99%, not ~24-32%. **The dollar figure is
> unchanged and still $0.00 attestable** — both stages run on subscription CLIs
> that report no per-call cost, and both record an explicit non-report. Nothing
> was charged that went unrecorded; what was understated is how much of the build
> is model-backed and therefore unpriced. See COST-RESTATEMENT-2026-08-25.md.

**Date:** 2026-08-23 | All numbers measured on real briefs with live research.
**Rule honored:** changes shipped only where the numbers convicted the current way.

---

## The headline

| Metric | Before | After | Change |
|---|---|---|---|
| **Wall time, 3-brief batch** | **430s** (sequential) | **180s** (concurrent) | **2.39x faster** |
| Wall time, single build | 113-180s | unchanged | no regression |
| Reported cost per proof | $0.00 + 1 unreported stage | **$0.00 + 2 unreported stages** | corrected 2026-08-25 — see COST-RESTATEMENT |
| Premium-brain share | 1 of 6 stages (16.7%) | unchanged | no change |
| Images per dollar | **0 images, $0** | unchanged | generation still not wired |
| Retries per build | 0 | 0 | unchanged |
| Inter-stage idle | 5-8ms | 5-8ms | already negligible |
| Cost/duration visible in console | **no** (column was blank) | **yes** | now visible |
| Efficiency series on disk | **none** | one line per run | now standing |

**Per-brief times were unchanged under concurrency** (122/180/123s vs
128/182/120s), which is the important control: three concurrent CLI processes
cost each other nothing. The 2.39x is real throughput, not a measurement artifact.

## What the money actually looks like

**Cost per proof: $0.00 that we can attest to, plus one stage that cannot
report.** Five of six stages record an explicit, checkable zero. Research runs on
a plan-backed CLI that hands back no tokens or dollars, so it records
`provider_did_not_report` rather than a zero that would claim the build was free.

**Images per dollar is 0 / $0.** Not a good ratio or a bad one -- generation is
not wired, by the standing no-API-key rule. The imagery bridge declares 10-11
slots per site and fills none. This is the one headline metric that cannot
improve without a decision from Fritz.

## Changes shipped (cap of 3 honored: 2 shipped, 1 declined)

**1. Concurrent batch builds** (`pipeline.runBatch`). The only thing E2
convicted. Bounded (default 3, ceiling 8) because unbounded fan-out over a
plan-backed CLI finds its rate limit in production rather than in a test. A
failing brief is isolated to its own result slot rather than failing the batch.
**Before/after on the same three briefs: 430s -> 180s.**

**2. Standing efficiency telemetry.** One append-only line per finished run in
`.studio/dna/efficiency.jsonl`, plus run-level duration and cost surfaced in the
Builds console. Writing it can never fail a build that already succeeded.

**3. Declined: the verified-fact cache.** E2 measured source verification at
1-495ms of a ~120,000ms build. Maximum possible saving **0.4%**, and only on a
retry, which occurred **zero times** across every run. The invalidation
complexity would cost more than it could ever return. **Not built, on the
numbers.**

## Defects found by the audit itself

The audit's first job was making its own instruments trustworthy, and three of
them were not.

1. **`duration_ms` was declared in the DNA schema and never populated.** Every
   stage recorded null.
2. **The run's `started_at` was stamped when research finished**, excluding the
   stage that is 99% of the build: **a 113s run recorded itself as 1.09s.**
3. **The Builds console rendered `row.duration_ms` and the API never sent it**,
   so that column had always been blank.

Every efficiency conclusion drawn before these were fixed would have been wrong.

## What did NOT change, and why

Stated because the expected optimizations were mostly unavailable:

- **Stage parallelism inside a build:** spec, compose, build, record total under
  50ms. Parallelizing them all to zero saves under 0.04%.
- **Routing:** the default recipe is unchanged. Five of six stages already cost
  nothing, and the one brain-using stage has no cheaper alternative that passes
  its gate. See `ROUTING-RECOMMENDATION.md`.
- **Media parallelism:** nothing fills media slots, so there is no serial cost
  to parallelize. It should be built concurrent from the start when generation
  is wired.
- **Repair-loop scoping and prompt reuse:** neither exists yet. Zero cost today.

## Standing telemetry, and the Rung-3 hook

Every finished run now appends: timestamp, run_id, site_id, outcome, total_ms,
per-stage ms, stage count, retry count, premium stage count, reported cost, and
the count of stages that could not report cost. Drift becomes a series rather
than a discovery.

**This is the learning engine's food.** What a suggestion layer would need that
we are **not** yet capturing:

- **Quality per run, machine-readable.** We record whether verify passed, not how
  good the output was. Without a quality signal, telemetry can only ever
  recommend "cheaper and faster", which optimizes toward worse sites. The
  salvage pass found the pattern: a deterministic technical assertion set plus a
  separately attributed model review.
- **The prompt actually sent and the response actually received.** Still not
  retained. Without it, a suggestion layer can correlate outcomes with stages
  but never with *what was asked*.
- **Operator judgment.** Nothing captures "Fritz shipped this proof" versus
  "Fritz rejected it", which is the only ground truth for proof quality that
  matters commercially.
- **Per-brief difficulty.** P.I.T is reliably ~50% slower than the others across
  every run. Nothing records why, so the series cannot separate "this build got
  slower" from "this brief is harder".
- **Counterfactuals.** We record what a run did, never what the alternative
  would have cost, so no recommendation can be evidence-backed until A/B runs
  are recorded as pairs.
