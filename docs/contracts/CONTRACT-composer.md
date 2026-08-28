# Contract: composer verification (L1) — A5 and A6

**A1-A4 are built (`4934d711`). This lane VERIFIES, and fixes only what
verification convicts.**

## A5 — mobile as a designed view, not a reflow accident

The claim to disprove: "robustness by absence" still applies. A single column
reflows perfectly because there is no layout to reflow, and that is
indistinguishable from good responsive design in every metric.

**Required:** for each of the 4 archetypes, a capture at 1440 and 390 showing the
390 view is a *collapse of a real layout* — that at 1440 the page uses
multi-column shapes, and at 390 those shapes stack deliberately.

**Pass condition, deterministic:** at 1440 a page must contain at least one
element whose computed `grid-template-columns` resolves to two or more tracks.
If every element is single-track at 1440, the page has no layout and A5 is
**not met**, regardless of how well it reflows.

## A6 — every archetype passes the existing gates

Per archetype: WebAIM Six, contrast, geometry at 1440 and 390, token adherence
**reported** (never blocking — no published threshold exists).

## Output

`docs/research/archetypes/MATRIX.md`: a row per archetype x width, with the
deterministic facts and the capture filename. Any archetype failing a gate is a
**DEFECT** and fixed here. An archetype that passes but looks wrong is a
**MISSING CAPABILITY**, specified rather than patched.

## Explicitly not in scope

Judging whether the archetypes are *good*. The aesthetic cutoff is unplaced until
Fritz's verdicts land, so the critic reports and does not block.
