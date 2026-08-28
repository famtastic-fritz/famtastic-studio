# ADR-0011: The cross-repo learnings protocol

**Status:** accepted, 2026-08-25 (ruling 2)
**Circumstance:** normal

## Context

Two failures, one cause.

**Divergence.** The SITE-LEARNINGS lineage exists in 14+ copies across
worktrees. Deduped by content hash the largest is **not** the canonical file: a
worktree copy carries 8310 lines against the canonical 7607. **703 lines exist
only outside the canonical file.** Every worktree appended locally and none
merged back. Reading the canonical file does not mean you have read the
learnings.

**Voice.** A routing decision made because Studio was down was written in the
same voice as a ruling. A later session read it as architecture and hardened it
into a boot invariant. Nothing in the format distinguished a workaround from a
decision.

A learnings file that silently forks is worse than none, because it is trusted.

## Decision — R1 through R7

**R1. One canonical learnings file per repo; worktrees never append.**
Sessions in a worktree write `docs/learnings/incoming/<date>-<session>.md`. A
merge step folds them into the canonical file on the default branch. Append-only
files in shared worktrees are how 703 lines went missing.

**R2. Every ruling records its circumstance.** Required frontmatter:
`circumstance: normal | outage | deadline | unknown`, plus `what` and `why`.
A ruling made because something was down says so.

**R3. Cross-repo rulings are written once and referenced, never copied.**

**R4. Anything not `normal` expires.** A ruling with `circumstance` other than
`normal` carries `review_by` (default 30 days). At review it is re-ratified as
doctrine or reverted. **Nothing hardens by neglect.**

**R5. A capability record per capability**, in the repo that owns it.

**R6. The index is regenerated, not hand-maintained.**
`scripts/learnings-divergence.mjs` makes forks detectable.

**R7. Sweep before a boundary decision, never after.**

## Retro-tagging

Existing rulings are tagged where circumstance is **determinable from evidence**,
and `unknown` otherwise. Guessing would defeat the purpose of the field.

| Ruling | Circumstance | Basis |
|---|---|---|
| 2026-05-05 Service Auth Ownership | `normal` | Shipped with a proof packet and a verification command. Nothing indicates duress. |
| 2026-08-01 portable artifact boundary | `normal` | Written from a first real campaign's findings. |
| 2026-08-14 manifest-driven acceptance | `normal` | Written from a completed proof lane with evidence. |
| **2026-08-23 preview ownership** | **`outage`** | Ratified by Fritz 2026-08-25 as an outage response; contradicts 2026-08-01 with no stated reason. **Now superseded by ADR-0010.** |
| 2026-08-23 P0-I1 proof-ingress prohibition | `normal` | Independently correct on revenue-safety grounds; re-ratified 2026-08-25 as permanent doctrine. |
| ADR-0004 worker tier removed | `unknown` | Removed after both CLIs failed one honest attempt. kimi later answered clean, so the original failure may have been transient. Not determinable. |
| Everything else in the lineage | `unknown` | Not determinable from the text. Marked, not guessed. |

## Consequences

- A ruling without `circumstance` is incomplete and should be rejected in review.
- `unknown` is an honest, common state. It is not a failure to record.
- The 2026-08-23 preview ruling is the first thing R4 would have caught: tagged
  `outage`, it would have expired on ~2026-09-22 rather than becoming law.
