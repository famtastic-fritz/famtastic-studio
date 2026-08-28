# E1 Baseline: what the build actually costs, before any change

> **RETIRED 2026-08-25 — "only research uses a brain."** DNA recorded the spec
> stage as `model: 'none'` while the copy stage inside it spawned a CLI once per
> page. **Two of six stages are model-backed** (research and spec), and the
> model-backed share of wall time is ~92-99%, not ~24-32%. **The dollar figure is
> unchanged and still $0.00 attestable** — both stages run on subscription CLIs
> that report no per-call cost, and both record an explicit non-report. Nothing
> was charged that went unrecorded; what was understated is how much of the build
> is model-backed and therefore unpriced. See COST-RESTATEMENT-2026-08-25.md.

**Date:** 2026-08-23 | **Runs:** 3 real briefs, live research, full canonical flow
**Tooling:** `scripts/efficiency-report.mjs` (derives from DNA; no synthetic timing)

---

## 0. Two telemetry defects fixed before measuring

Neither number below would have been trustworthy without these.

- **`duration_ms` was declared in the DNA schema and never populated.** Every
  stage recorded `null`. Now derived at the point of record.
- **The run's own `started_at` was stamped when research *finished*.** Research
  deliberately runs before `dna.startRun()` so `research_packet_ref` is known at
  open and never mutated, so the record excluded the most expensive stage
  entirely: **a 113s run reported itself as 1.09s.** The pipeline now passes the
  true start.

A baseline built on the old numbers would have shown builds completing in about
a second and every efficiency conclusion downstream would have been wrong.

## 1. Per-run totals

| Brief | Total | Stage sum | Idle | Concurrency | Retries | Premium stages |
|---|---|---|---|---|---|---|
| base-starlight | 127,572ms | 127,568ms | 5ms | fully sequential | 0 | 1 / 6 |
| base-pit | 181,576ms | 181,569ms | 7ms | fully sequential | 0 | 1 / 6 |
| base-beehive | 119,865ms | 119,857ms | 8ms | fully sequential | 0 | 1 / 6 |

**Sequential total for the three: 429,013ms (~430s).**

## 2. Per-stage breakdown

| Stage | starlight | pit | beehive | Share of build | Brain | Cost |
|---|---|---|---|---|---|---|
| research | 126,358ms | 179,686ms | 118,541ms | **98.9 – 99.0%** | claude CLI | did-not-report |
| verify | 1,184ms | 1,861ms | 1,297ms | 0.9 – 1.1% | none (Playwright) | explicit $0 |
| spec | 17ms | 11ms | 8ms | ~0.0% | none | explicit $0 |
| build | 7ms | 10ms | 10ms | ~0.0% | none | explicit $0 |
| compose | 1ms | 0ms | 0ms | ~0.0% | none | explicit $0 |
| record | 1ms | 1ms | 1ms | ~0.0% | none | explicit $0 |

## 3. Inside research: where the 99% goes

Measured directly via the new packet `timings` field:

| Brief | CLI call | Source verification | Sources checked | CLI share |
|---|---|---|---|---|
| t-starlight | 112,909ms | 1ms | 0 | 100.0% |
| t-beehive | 120,949ms | 495ms | 3 | 99.6% |

**The entire build cost is one CLI invocation.** Source verification is already
parallel (`Promise.all` over distinct URIs) and costs half a second at most.

## 4. Cost

- **Dollar cost per build: $0 reported.** Five of six stages record an explicit,
  checkable zero. Research records `provider_did_not_report` /
  `provider_did_not_report_currency_cost` because it runs on a subscription CLI
  that does not hand back tokens or dollars. That is a known unknown, recorded as
  one rather than flattened to zero.
- **Image cost per run: $0, and structurally so.** Nothing generates images. The
  imagery bridge declares slots (10-11 per site) and fills none.
- **Premium-brain share: 1 of 6 stages (16.7%).** The other five are
  deterministic and cannot cost anything.

## 5. Parallelism, as it actually is

`fully_sequential` on all three runs, confirmed by zero overlap between stage
intervals. Total idle between stages: **5-8ms per run**. The pipeline's own
overhead is negligible; it is not where time goes.

## 6. Variance is real and must not be averaged away

The same Beehive brief has produced 118.5s, 120.9s, 123s and (in an earlier
session) a run that returned an empty packet. P.I.T is consistently the slowest
(180-182s) across every run. Research wall time is a function of how much the
model chooses to search, which varies per invocation. Single-sample numbers here
are labeled as such.
