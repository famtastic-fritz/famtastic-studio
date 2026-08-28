# Build Agent Roster: the production pipeline as named stage slots

**Status:** Spec (docs first, wiring follows). Ratified direction, Fritz 2026-08-23.
**Informed by:** `docs/salvage/SALVAGE-2026-08-23-vnext-build-recipes.md`
**Related:** ADR-0007 (boundary), ADR-0008 (shared research)

---

## The model

The production pipeline stops being a monolithic `run()` and becomes an ordered
set of **stage slots**. A slot is a named responsibility with a declared
contract. The **recipe assigns the brain** to each slot: which provider, which
model, which agent, or `deterministic` for slots that must never involve a model.

This is already half-true: `resolveStageRouting()` makes the recipe authoritative
for per-stage model and agent, and records `routing_source`. The roster extends
that from a routing detail into the pipeline's organizing principle.

## The roster

Twelve slots. Ten are the roster Fritz named; two come from the salvage pass and
are marked.

| # | Slot | Responsibility | Default brain |
|---|---|---|---|
| 0 | **provider-preflight** *(from salvage)* | Cheap auth check per provider the recipe will use. Fails the run before any real spend. | deterministic + trivial provider ping |
| 1 | **recipe-reader** | Resolve the recipe, freeze a snapshot, assign every downstream brain, record `routing_source`. | deterministic |
| 2 | **repo-builder** | Create the site tree, scaffolding, and the build root. | deterministic |
| 3 | **component-finder** | Find existing components before anything creates one. Check-existing-before-creating is the contract. | recipe-assigned |
| 4 | **media-finder** | Resolve media from the registry; identify gaps as gaps rather than filling them silently. | recipe-assigned |
| 5 | **designer** | Palette, typography, surface language, direction. Consumes brand contracts from the packet. | recipe-assigned |
| 6 | **page-builder** | Compose pages from spec plus resolved components and media. | recipe-assigned |
| 7 | **seo** | Titles, meta, structured data, internal linking against `seo_targets`. | recipe-assigned |
| 8 | **cms-environment** | Environment, config, and CMS wiring where the target needs it. | deterministic |
| 9 | **technical-verifier** *(split, from salvage)* | Executable boolean assertions. Never a model. | deterministic |
| 10 | **visual-reviewer** *(split, from salvage)* | Aesthetic judgment, recorded as an attributed opinion with named provider and model. | recipe-assigned |
| 11 | **deploy** | Publish, verify, persist the active release pointer. Honors `boundary.deploy_authorized` from the packet. | deterministic |

### Why the verifier is two slots

The salvage artifacts keep `famtastic.quality-report.v2` (17 machine-checkable
booleans) separate from `famtastic.visual-review.v1` (a model's opinion, with the
reviewer's provider and model named). They are never merged into one score.

Technical quality is asserted, cheaply and deterministically. Aesthetic quality
is judged, expensively and fallibly, and is recorded as **whose** judgment it
was. Collapsing them produces a number that means nothing and cannot be
appealed.

## Per-agent telemetry

Every slot execution writes one record into DNA. The shape is taken from
`famtastic.stage-journal.v2`, which already solved this:

```
schema, task_id, order, slot, provider, model, execution_class,
attempt, fallback_used,
started_at, completed_at, duration_ms,
asked_verbatim, given_verbatim, returned_verbatim,
input_sha256, output_sha256,
command[],
usage{}, cost{},
assertions{}, status
```

Non-negotiable properties:

- **`execution_class`** distinguishes `deterministic` from
  `cloud_provider_executed`. A slot that claims deterministic and calls a model
  is a contract violation, and the field makes it visible.
- **`asked_verbatim` / `returned_verbatim` plus input/output hashes.** This
  closes the raw-response retention gap currently logged as open. When a stage
  returns something empty or wrong, the record says what was asked and what came
  back.
- **`usage` and `cost` report honest non-reporting.** `provider_did_not_report`
  rather than `0`. A zero we did not measure is a lie; A4 already requires
  explicit zero usage and cost, and this is the same discipline.
- **`attempt` and `fallback_used`** are first-class, so a repair loop is legible
  after the fact rather than looking like duplicate stages.
- **`assertions{}`** per slot: each slot states its own pass conditions and
  whether they held.

## The repair loop

The single most important salvage finding: **quality did not come from one good
generation, it came from loop-until-green against executable gates.** In the run
that produced the good output, `browser-qa` failed three times; the pipeline
repaired and re-ran until it passed, alternating expensive model repair with a
cheap deterministic finalization pass.

The roster therefore is not a linear sequence. Slots 6 through 10 form a bounded
loop:

```
page-builder -> technical-verifier
                  |- pass -> visual-reviewer -> pass -> deploy
                  |- fail -> repair (recipe-assigned) -> deterministic-finalize -> re-verify
```

Bounds, so it can never run away:
- maximum repair attempts per run, from the recipe
- a repair that does not change the output hash ends the loop (no thrash)
- every attempt is its own telemetry record with `attempt` incremented

## Grounding order

The salvage pipeline ran `live-source-fetch` **before** `live-research`, so the
model reasoned over already-fetched sources. Our research module searches first
and verifies after.

Both are defensible and they are not exclusive: theirs produces better grounding,
ours produces stronger verification. The target is both -- fetch declared sources
up front, then search for what is missing, then verify everything cited. Logged
as a research-center refinement, not a roster slot.

## Wiring order

1. Telemetry record shape into DNA, with `execution_class` and verbatim capture.
   This also closes the raw-response retention gap, so it is first.
2. Slot registry plus recipe-assigned brains, extending `resolveStageRouting()`.
3. Split the verifier into technical and visual slots.
4. Bounded repair loop.
5. Remaining slots wired one at a time, each landing with tests.

Nothing here changes behavior on its own. The roster is how the existing
pipeline gets named, measured, and made loopable.
