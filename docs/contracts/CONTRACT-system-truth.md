# Contract: System Truth (L10) — B11

**Primary reference:** `docs/plans/reference/site-studio-vision.html`, screen
`op`. The mockup already names the API route beside each panel, which is the
requirement, not a decoration.

## Panels, and the route each reads from

| Panel | Route | Exists today |
|---|---|---|
| Capability truth | `/api/capabilities` | **no** |
| Blockers vs non-blockers | `/api/blockers` | **no** |
| Cost + approval | `/api/cost` | **no** |
| Run ledger | `/api/runs` | partial (`/api/pipeline/runs`) |
| Proof packet | `/api/runs/:id/proof` | **no** |
| Artifact provenance | `/api/artifacts` | **no** |
| Gap + workaround log | `/api/gaps` | **no** |
| Deferred decisions | `/api/decisions` | **no** |

**Eight routes to build.** They are listed here so the lane is scoped honestly:
this is a backend lane wearing a frontend hat.

## The rule that makes this screen worth having

**Capability truth is computed from PROBES, never from documents.** A capability
record that reads a markdown file and reports what it says is a document viewer,
not a truth surface. `/api/capabilities` must execute a check — does the binary
exist, does the route respond, did the last run succeed — and report
`NOT_PROVEN` where it cannot.

This is the whole point of the screen. This project has repeatedly found
documents asserting things the code contradicted: a ratified plan that a boot
invariant refused, a learnings file whose canonical copy was smaller than a
worktree's, a measurement quoted two days after it stopped being true.

## Non-negotiable

1. **Every panel displays its route**, enforced by `panel()` requiring one.
2. **Honest states.** `NOT_FOUND` and `NOT_PROVEN` are first-class. A panel that
   cannot reach its route says so; it never renders empty as if the answer were
   zero.
3. **Blockers and non-blockers are separate lists**, and gaps are separate from
   failures. What failed and what is missing are different questions.
4. **Cost states the unpriced surface.** Two of six stages are model-backed via
   subscription CLIs that report no per-call cost. The panel says `$0.00
   attestable` plus the count of stages that cannot report, never a bare `$0.00`.

## Acceptance

The screen at 1440 and 390, with every panel showing a real route and at least
one panel honestly reporting `NOT_PROVEN` rather than fabricating a green.
