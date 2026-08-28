---
name: capability-record
description: The salvage review format for the Site Studio rebuild. Load when examining any legacy route, module, or test to decide whether it enters the greenfield tree. Produces a record with a KEEP-CONVERT, ADAPT, ARCHIVE-FOR-FUTURE, or RETIRE verdict.
---

# Capability record

Per decision D8, the entire legacy codebase is an evidence library, not a blueprint. Nothing enters `site-studio-next` without a record and a KEEP-CONVERT or ADAPT verdict. Records live in `docs/salvage/`, one file per capability, named `<area>-<slug>.md`.

The census is frozen at the start of Phase 1 (`docs/salvage/census-<date>.json`, generated mechanically). Individual records are mandatory for every public, mutating, proof, deploy, conversation, journal, event, auth, and production-boundary capability. Materially identical read-only routes may share one cluster record. Every exclusion carries a written reason. "Worth examining" is not a criterion; the gate is that the census is fully dispositioned.

## Format

```markdown
# Capability: <name>
**Source:** <repo>/<path>:<lines> @ <sha> (and the worktrees where it differs)
**Kind:** route | module | test | script | config
**Verdict:** KEEP-CONVERT | ADAPT | ARCHIVE-FOR-FUTURE | RETIRE
**Reviewed:** <date> by <agent/model tier>

## Purpose
One paragraph: what it does for the operator or the pipeline, in plain terms.

## Contract
- Inputs: parameters, body shape, env, files read
- Outputs: response shape, files written, events emitted
- Side effects: mutations, network calls, spawned processes, money or customer impact
- Identity: does it bind site_id explicitly, or rely on ambient state?

## Risks
Failure modes, hidden couplings, anything that touches protected revenue scope, anything that fabricates data or reports success it did not verify.

## Verdict reasoning
Why this verdict and not the others. For KEEP-CONVERT or ADAPT, name what changes on the way in (usually: identity binding, honest states, journaling, file size).

## Disposition
Where it lands in the new tree, or the branch/sha where it stays archived.
```

## Verdicts
- **KEEP-CONVERT:** the behavior is right and the code is close enough to port with mechanical changes. Rewrite it in the new module shape; do not paste.
- **ADAPT:** the idea is right, the implementation is not. Take the contract and the tests, write new code.
- **ARCHIVE-FOR-FUTURE:** real value, not MVP scope. Record it so the knowledge survives, leave the code where it is, name the phase that would revisit it. This verdict is first-class; using it is how the rebuild avoids dragging complexity forward.
- **RETIRE:** superseded, unsafe, or built on a premise the rebuild rejected. Say which premise.

## Tiering
Extraction and classification are mechanical work (T0/T1). Reserve premium reasoning for disputed verdicts and anything touching proofs, deploys, or isolation.
