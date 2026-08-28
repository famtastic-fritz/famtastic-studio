# Cost restatement: which recorded numbers were understated, and by how much

**Cause.** DNA recorded the spec stage as `model: 'none'` while the copy stage
inside it spawned a CLI once per page. Every figure derived from that field
counted spec as free. True when written; false the moment copy was wired.
Corrected to `cli-selected` on 2026-08-25.

## What was wrong

| Figure | As recorded | Corrected | Direction |
|---|---|---|---|
| Premium-brain stage share | **1 of 6** (research only) | **2 of 6** (research + spec) | understated 2x |
| Model-backed share of wall time | ~24-32% (research) | **~92-99%** (research + spec) | **understated ~3x** |
| Stages reporting a provider cost | 1 | 2 | understated |
| Reported cost per proof | `$0.00 + 1 unreported stage` | `$0.00 + 2 unreported stages` | see below |

**Verified against a live run.** `par-starlight2`, idle machine, after the fix:
`premium 2/6`, with both research and spec carrying
`cost=provider_did_not_report_currency_cost`.

## What was NOT wrong

**The dollar figure is unchanged and still honest: $0.00 attestable.** Both
model-backed stages run through subscription CLIs that do not report a
per-call cost, so both record
`provider_did_not_report_currency_cost` rather than a fabricated zero. No paid
API is involved. What changed is that **two** stages carry that non-report, not
one — so the *unmeasured* surface is twice what was claimed.

The imagery provider is keyless and separately records
`keyless_public_endpoint_reports_no_cost`. Also unchanged.

## The honest summary

Nothing was ever charged that we failed to record. What we understated is **how
much of the build is model-backed and therefore unpriced**: roughly a third of
wall time was presented as the model-backed portion when the real figure is
nearly all of it. Any statement of the form "only research uses a brain" is
retired.

**Restated cost line, for reuse:**

> $0.00 attestable. Two of six stages (research, spec) are model-backed via
> subscription CLIs that do not report per-call cost; both record an explicit
> non-report. Imagery is a keyless endpoint reporting no cost. Nothing is
> billed to an API key.

**Measured at** 2026-08-25, idle machine, 6-page build, copy concurrency 3,
imagery concurrency 2. **Invalidated by:** adding or removing a model-backed
stage; connecting any provider that does report cost; moving any stage to a
paid API.
