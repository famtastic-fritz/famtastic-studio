# Cutover amendment: scope narrowed to the production build path

> ## CORRECTED IN WRITING — 2026-08-23, by Fritz's ruling
>
> **The P0-I1 invariant WINS, permanently. Site Studio never serves proof
> ingress.**
>
> This document's "interim state" below said the proof webhook would keep being
> served *by the new path rather than the stamp logic*. That was based on a false
> premise. `assertNoProofRoutes()` runs inside the P0-I1 preflight and refuses
> boot on any proof ingress -- the same invariant revenue-safety gate G4-1 rests
> on -- so Studio cannot serve it, and production has no dispatch path to any
> Studio regardless (no `SITE_STUDIO_URL`; `famtastic_proof.settings` does not
> exist).
>
> **Proof generation is and remains Designs-owned.** Its modernization is
> Designs' migration (POST-SHIP #1), not a Studio route. Section 2's interim row
> and its diagram are superseded by this note; the target-state row was always
> correct and is now the only path.
>
> **M5 criteria corrected:** "one real proof job via Studio" is **struck** as
> based on a false premise. The substitute criterion, **already met**, is: one
> real build deployed and rolled back with byte-identical restoration, plus the
> imaged acceptance run.



**Status:** Ratified by Fritz 2026-08-23. Amends
`CUTOVER-PACKET-2026-08-23-REVISED.md`.
**Related:** ADR-0007 (boundary), ADR-0008 (shared research kernel)

---

## What changes

The original cutover packet treated cutover as one event covering everything
Site Studio does. That was wrong, because Studio does two things that belong to
different platforms.

**What cuts over now:** Site Studio's **production build path** becomes the
system of record for builds.

- research-grounded build (live search, every cited source independently
  re-fetched before it is trusted)
- per-stage model routing, with the recipe authoritative and `routing_source`
  recorded
- DNA: full replay manifest, resolved snapshots, digests, attempt ids, explicit
  zero usage and cost
- deploy to FAMtasticInc under a path, DNS pointed at the created folder on go-live

**What does not cut over:** proof generation. It is not Studio's to own
(ADR-0007). It stays where it is, running, until it migrates.

## The interim state, stated plainly

**The proof webhook keeps being served.** Nothing is switched off. The change is
*what serves it*: the new research-grounded path, **not the stamp logic**.

This matters because the stamp logic is the thing that produced three
near-identical `no_image_pilot_v1` rows per business. Continuing to serve the
webhook while retiring the generator behind it is the whole point of this
amendment: the contract to callers is unchanged, the output stops being a
template.

```
before:  webhook -> stamp logic (no_image_pilot_v1) -> proof_variant
interim: webhook -> new research-grounded path      -> proof_variant
target:  webhook -> Designs' modular process        -> proof_variant
                    (Studio out of the proof path entirely)
```

## Target state

Proof generation migrates fully into Designs' modular process, the one the
salvage pass documented: provider preflight, live-source-fetch before research,
creative direction, visual art, prototype construction, and a bounded repair
loop against executable quality gates.

Logged as **the first cross-platform migration** in POST-SHIP.

## Standing orders unchanged

Both remain as ordered and are not deferred by this amendment:

1. **Imagery bridge.** The one dimension where legacy output is competitive.
2. **Raw-response retention.** The prior system recorded `asked_verbatim`,
   `returned_verbatim`, and input/output hashes per stage. We regressed from
   that and it is being restored.

## What still gates the cutover decision

Cutover execution remains a hard stop for Fritz. This amendment narrows *what is
being decided*, not *who decides it*.

Ready:
- production build path, gates green
- boundary and seam contract defined and tested
- research designated shared, no forks
- site origin truth pass, so counts distinguish test from real

Outstanding before the decision is worth making:
- imagery bridge
- raw-response retention
- cutover mechanics with a rollback runbook
