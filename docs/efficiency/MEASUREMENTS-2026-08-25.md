# Measurements, 2026-08-25 — controlled, idle machine

Every number here carries the conditions it was taken under and what would
invalidate it, per ADR-0011 R2 extended to measurements.

**Conditions:** machine idle (load 3.3-4.8) after five orphaned `server.js`
processes were killed; single build, no concurrent work; brief = Starlight Skin
Bar; 6 pages; 10 media slots; copy concurrency 3; imagery concurrency 2.
**Invalidated by:** adding or removing a model-backed stage; changing copy or
imagery concurrency; a change in page count per build.
**Expires:** 2026-09-08.

## The regression, diagnosed

| | serial copy | parallel copy | change |
|---|---|---|---|
| **total** | **558.9s** | **351.1s** | **1.59x** |
| research | 133.2s (23.8%) | 112.0s (31.9%) | unchanged |
| spec | 425.0s (76.0%) | 238.5s (67.9%) | 1.78x |
| compose + build + verify + record | 0.75s | 0.59s | noise |

**The load hypothesis is dead.** Both runs are on an idle machine. The 3-4x
regression was entirely the copy stage running one CLI call per page serially.

**Inside spec, parallel run:**

| | |
|---|---|
| copy (6 pages, concurrency 3) | **54.5s** |
| imagery (10 slots, concurrency 2) + derivation | ~184s |

## The correction this replaces

`docs/efficiency/BASELINE.md` recorded **"research is 98.9-99.0% of build wall
time."** That was **true when measured** on 2026-08-23 and false two days later,
because the copy stage and the imagery adapter were added in between. It was
quoted as fact to diagnose this regression and produced the wrong answer twice:
first "this is the CLI call", then "this is machine load."

Research is now **24-32%**. Spec is **68-76%**.

## What is now the bottleneck

Imagery: ~184s for 10 slots at concurrency 2, roughly 18s per slot amortised.
The concurrency of 2 is not arbitrary — it was set after the provider returned
HTTP 429 at higher fan-out, so raising it needs a measured retry/backoff story
rather than a bigger number.

Copy is no longer dominant: 54.5s of a 351s build, 15.5%.

## Related finding: 38% of sections render empty

Across the five-sample after-set, **98 of 256 requested sections (38%)** came
back with no copy. Every one was `type: text` asking for a fact the pipeline
never gathered: "Pricing", "Hours table with holiday exceptions", "mechanic bio,
years, certifications", "current typical turnaround stated as a number".

The copy stage was behaving correctly — it is instructed to return empty rather
than invent a fact. **The cause is upstream: research declares page sections
whose facts it never collects.** Now counted as `SECTION_WITHOUT_COPY`
(warning), so the hole is visible to the gate instead of silent. Warning rather
than blocking because the fix is research coverage, and a blocking gate would
fail builds for a cause the build cannot address.
