---
name: dna-capture
description: Instrumentation checklist for Build DNA and recipes. Load when writing or reviewing any pipeline stage, so every run records a replayable manifest automatically and no stage has to be re-instrumented later.
---

# DNA capture

Per decision D7, DNA recording is automatic and total from run one. There is no opt-in and no sampling. A stage that runs without recording is a defect, not a gap.

## Per run
`run_id`, `recipe_ref`, `research_packet_ref`, final outcome, operator interventions, retro notes slot.

## Per stage
`stage`, prompt or template used, model and agent, inputs hash, outputs ref, duration, cost estimate, verification result.

## Replay manifest (amendment A4, required)
Every DNA record carries an immutable manifest, or the run cannot claim to be replayable:
- `schema_version`
- `source_commit` and `tree_hash`
- resolved recipe snapshot and its hash
- resolved prompt snapshot and hash per stage
- ordered stage dependency graph
- `attempt_id` and `retry_of` per stage execution
- input and output artifact refs with sha256 digests
- model and tool configuration versions
- external asset IDs and digests
- actual token usage and cost
- verifier version and evidence ref

**Rerun definition:** the same resolved graph executing against new declared inputs, with every stage reaching its verification requirement. Byte-identical model output is not required and must never be the assertion.

## Rung 3 readiness
The comparison keys must be present from the first run so the learning layer bolts on without re-instrumenting: stage timings, cost, verification scores, and operator edit counts (an implicit quality signal). Every pipeline run ends with a `retro` stage that writes structured lessons even before any analysis engine exists.

## Checklist for a new stage
1. Does it write a stage entry unconditionally, including on failure and on retry?
2. Does a failed stage record enough to locate the failure and retry at stage level only, never re-running the whole pipeline?
3. Are inputs hashed and outputs digested, so a later rerun can prove what changed?
4. Is the prompt snapshotted as resolved, not as a template reference that can drift?
5. Are cost and duration real measurements, not estimates presented as facts?
