# ADR-0012: The bar is what Fritz built by hand while Studio was down

**Status:** accepted, 2026-08-26
**Circumstance:** normal

## Context

Site Studio was down for close to four months. During that time Fritz kept
shipping — by hand, and outside Site Studio. MBSH is the clearest example: a
live application with five tables, ~14 endpoints, twelve authenticated admin
pages, cron, and commissioned art direction, built directly in its own repo
while the monolith was untangleable.

**Several of the defect classes found in this rebuild are things he had already
solved by hand out there.** Which means "the pipeline improved" is not the
question worth answering.

Test-suite counts do not answer it either. 529 tests were green while the
acceptance artifact that closed M5 published its own outline.

## Decision

**The standing quality benchmark is: does the generated output beat what Fritz
was producing by hand while Studio was down?**

Not "is it better than last week's build." Not "did the gates pass." Not "is the
score above a threshold." The comparison is against **hand-built work that
actually shipped to real customers**.

Three consequences:

1. **The comparison set is real hand-built sites**, MBSH first among them, not
   synthetic fixtures and not previous pipeline output. A regression against our
   own last build is a warning; failing to reach the hand-built bar is the actual
   verdict.
2. **The bar includes what the pipeline cannot yet do.** MBSH's edge is
   commissioned art direction and a working backend. Studio can do neither. That
   gap is the honest measure of distance, and it is recorded rather than scored
   around — see `STANDING-FINDING-art-direction.md` and `MBSH-SPEC-GAP.md`.
3. **The aesthetic cutoff is calibrated to Fritz's own verdicts**, because he is
   the person who produced the bar. No published threshold can stand in for that,
   and the research confirms none exists.

## A note on where the defects surfaced

Most of these defects surfaced on **throwaway calibration sites** — `cal-*`,
`aft-*`, `af3-*`, invented businesses built only to be measured. **That is
exactly where they should surface**, and it is why the calibration set exists:
a throwaway site is cheap to build, cheap to break, and carries no customer
consequence when it does.

The corollary is that a green run on a throwaway site proves nothing about a
real one until the throwaway is *read*, not merely scored.

## What this does not mean

It does not mean the pipeline must match MBSH before anything ships. It means
the gap is stated honestly in every quality claim, rather than a pipeline-only
improvement being reported as if it cleared the bar.
