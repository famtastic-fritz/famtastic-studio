# Capture: architecture ratification, cutover amendment, M5

**When:** 2026-08-23 (second session of the day)
**Branch:** main (phase-2 already merged)
**Gates at close:** lint OK, 475 tests / 33 files, smoke 11/11, G4-0 PASS, G4-1 PASS, exit 0

---

## What was ratified

**The boundary (ADR-0007).** FAMtastic Designs owns intake through proofs and
never deploys. Site Studio owns selected build packet through journal and is the
system of record for builds. The seam is one versioned artifact, the Selected
Build Packet, implemented and tested: fail-closed validation, asset references
only (bytes may not cross), and deploy authorization carried in the packet rather
than inferred. An absent permission is malformed, never a denial.

**Research as shared capability (ADR-0008).** `research.js`, `spec-derive.js` and
`packet.js` are the proto-Research-Center behind one thin facade
(`research-center.js`, four capabilities, `describe()` for compatibility
assertion). Studio does not own research; it currently hosts it. Relocation later
is a relocation, not a rewrite.

**Cutover narrowed.** The production build path cuts over. Proof generation does
not. The webhook keeps being served, by the research-grounded path rather than
the stamp logic. Full migration into Designs is logged as the first
cross-platform migration in POST-SHIP.

## Record correction

The template-stamp rows were **not customer deliveries**. Independently
corroborated in the salvage artifacts, whose build briefs carry
`classification: fresh_provider_executed_heldout_benchmark`, Fritz's own email,
and an explicit `publication_boundary` denying publication. The finding stands as
the inefficiency that justified the rebuild: a system that could not tell a pilot
row from a customer record.

`spec.origin` shipped so it cannot recur. Sites are `legit`, `test`, or
`unknown`, inferred only where defensible and never optimistically. A bare
`site-` prefix is deliberately not a test marker, because real properties use it.
Live counts: 0 legit, 5 test, 5 needing declaration, instead of a flat "10 sites".

## Salvage (30 min, honored)

Found in `worktrees/shay-website-delivery-swarm/artifacts/`, not in the
famtasticdesigns repo. Three patterns stolen into the roster spec:

1. **The repair loop is the product.** In the run that produced the good output,
   `browser-qa` failed three times; the pipeline repaired and re-ran until green,
   alternating expensive model repair with a 12ms deterministic pass. Quality
   came from loop-until-green against executable gates, not from one good
   generation.
2. **Verifier is two things.** A deterministic technical asserter (17 booleans)
   and an attributed visual reviewer, never merged into one score.
3. **Honest non-reporting.** `provider_did_not_report` rather than zero.

Also found: `website_build_brief.v2` is a richer precursor to the Selected Build
Packet, notably `design_use` on every research finding (what the fact is *for*)
and `mutable: false`. Our packet carries the claim and source but never says what
it is for. Biggest available quality lever, logged.

## Defects found and fixed this session

1. **DNA claimed research ran on no provider.** The routing table still said
   "no research provider is connected; zero live lookups" while research spawned
   the claude CLI for ~2 minutes per run. Every record said `model: none` for a
   stage running a real model. A false claim on the proof surface.
2. **Correcting it exposed a second:** usage/cost were only recorded for
   `model: none` stages, so a provider-backed stage recorded null and the A4
   assertion correctly failed the entire run. Now records honest non-reporting.
3. **`routing_source` was dropped on the floor.** The pipeline computed it;
   `dna.recordStage` did not accept the parameter. The provenance field existed
   and was unanswerable from the record it annotates.
4. **Media prompts went nowhere.** Research produced 8-13 per brief; spec-derive
   dropped all of them. Now declared slots in state `unfilled` with the prompt
   attached. Verified in a browser: 11 unfilled slots on Starlight.

## M5

Declared with proof against each bar item
(`M5-DECLARATION-2026-08-23.md`). Real end-to-end run
`run_mt6b8hw4n64nj7ug`, success in 113s, recipe saved, 10 media slots, manifest
tree hash present, every routing and cost claim in the record now true.

Stated limit: G4-1 is 6 passed / 4 SKIPPED-WITH-REASON. A skip is not a pass. The
outreach guarantee rests on containment, not observation.

## Open, honestly

- Raw CLI response retention (roster telemetry closes it, sequenced first)
- Image generation (bridge declares, nothing fills)
- Roster wiring (spec'd, not built)
- Live research non-determinism (0/8/6 facts on one brief across three runs)
- One unreproduced test failure, seen once, not reproduced in 11 subsequent runs,
  identity unknown because the output was piped rather than captured
