# Capture: closing sequence — imagery, quality signal, outcome capture, cutover

**When:** 2026-08-23 (final session)
**Gates at close:** lint OK, 521 tests / 36 files, smoke 11/11, G4-0 PASS, G4-1 PASS, exit 0
**Cutover:** executed. Build path live on 3400; legacy cold on 3340, recoverable.

---

## What shipped

**Imagery, wired and filling.** Preflight before spend, parallel slot filling
(built concurrent from the start because the efficiency audit predicted serial
filling would be the next bottleneck), a per-run budget cap, and full provenance
per image: provider, exact prompt sent, byte count, sha256 of the bytes written.
A failure is declared-unfilled with a reason; nothing is ever substituted. A test
pins that by asserting no file is written for a failed slot and no neighbour's
image is reused for it.

**Brand-voice gate**, deterministic on purpose: a model judging another model's
brand compliance shares its blind spot, and the audit found every local model
reaching for a word one brand explicitly forbids. Its pass/fail is the first
machine-readable quality signal in DNA, and it reports a *vacuous* pass when a
brand declared no anti-patterns rather than letting an empty check read as an
endorsement.

**Outcome capture**, the Rung-3 ground truth: shipped / edited_then_shipped /
rejected / pending, one click from Builds, prior decisions kept in history
because rejected-then-shipped is a different signal from shipped.

## Four defects the real runs exposed

1. **Research was not retried on unparseable output**, only on an empty packet.
   One garbled CLI response cost a whole acceptance run. Transient adapter
   failures now retry; `not_installed` does not, because a second probe cannot
   help.
2. **A keyless generator rate-limits.** Concurrency 4 with no backoff filled 2 of
   9 slots. A 429 is a wait, not a no: concurrency dropped to 2 and 429s retry
   with growing waits. Fill rate went 2/9 to 9/11.
3. **The voice extractor mined a punctuation fragment** — `") rather than to
   abstract"` — as a forbidden term. Banning a parsing artifact is worse than
   missing a term, so terms are now filtered for plausibility.
4. **The hero image rendered nowhere.** Research-derived specs carry sections as
   plain STRINGS, so `section.type` is never `'hero'` and a section-scoped image
   silently never rendered while the files sat on disk. Placement moved to page
   level.

## The cutover, and the part that could not happen

Build path cut over cleanly. Rollback was rehearsed first against real deploys.

**The proof webhook flip is not executable as specified, and this execution is
what surfaced it.** Studio-next is forbidden proof ingress by `assertNoProofRoutes()`
inside the P0-I1 preflight — the same invariant revenue-safety gate G4-1 rests
on. Separately, production has no dispatch path to any Studio: no
`SITE_STUDIO_URL`, and `famtastic_proof.settings` does not exist. The cutover
amendment and the boot invariant cannot both hold; the invariant wins.

The effect is benign and is what the standing rule wanted: **the live proof
pipeline never ran through Studio and is completely untouched.**

"One real proof job verified" is recorded as **not performed**, not as something
approximated.

## Open

- Proof generation's real home is Designs (POST-SHIP, first cross-platform
  migration). The webhook question belongs there, not here.
- Image art direction: images are real and usable; nobody has directed them.
- Raw CLI response retention still open; roster telemetry closes it.
- One test failure seen once earlier today, never reproduced across many
  subsequent full runs, identity unknown.
