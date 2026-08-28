# Capture: five real briefs through the full canonical flow

**When:** 2026-08-23
**Milestone:** the real test replacing like-for-like, per Fritz's reframe
**Branch:** studio-rebuild/phase-2, merged to main as `7cce210b`, pushed

---

## What happened

Ran the five most recent real external customer briefs from production
`famtastic_prospect` through the full canonical flow on the claude adapter with
live research. Compared against what legacy had already produced for the same
businesses, read read-only from `proof_variant`. Wrote
`docs/plans/SIDE-BY-SIDE-2026-08-23.md`.

## RECORD CORRECTION (appended 2026-08-23, ratified)

The template-stamp rows described below were **not customer deliveries**. They
are Designs-drift and test proofs -- benchmark and pilot output written into
`proof_variant` with nothing in the schema marking it as such. Corroborated by
the salvage artifacts, whose build briefs carry
`classification: fresh_provider_executed_heldout_benchmark` and an explicit
`publication_boundary` denying publication and Site Studio execution.

The finding stands as **the inefficiency that justified the rebuild**: a system
that cannot distinguish a pilot row from a customer record. It is not a claim
that bad work reached customers. `spec.origin` shipped this session so the
distinction is permanent.

## The finding that matters

Legacy gave three of the five real customers the **same three directions,
byte-identical except the business name**, sharing a single `generated_at`
timestamp. A hair studio and a skin bar both received the same near-black
background with a lime-green accent. One customer (P.I.T) got genuinely strong
work from a different legacy path, including a generated hero image. One got
nothing at all.

The new path differentiates: Starlight Skin Bar reasons a midnight-indigo and
champagne-gold palette from its own name and produces a policies page covering
contraindications; Kim Chang Suk gets bone and espresso with terracotta plus an
explicit instruction to avoid the salon-industry cliche.

Research also refused to invent. Starlight returned zero verified facts after
searching the exact name, address and phone, said so, and asked whether a Google
Business Profile is claimed and what the state cosmetology license number is.

## Defects found and fixed

1. **`execution_status` was inert** (`43933455`). It gated `ok` on having zero
   open questions, which honest research never has, so `ok` was unreachable and
   every packet reported `partial` whether it carried eight verified facts or
   none. Now keyed off evidence.

2. **An empty research packet was silently accepted** (`927c3494`). One live run
   in eight returned exit 0 with parseable JSON and nothing in it. The pipeline
   built a three-page site and reported success with verified true. Two retries
   of the same brief returned 8 and 6 facts, so it is transient. Now retried
   once, with "empty" defined narrowly so an honest thin result never retries.

## My own error, recorded

The first pass passed briefs with flat keys where the contract is nested
(`brief.business`). The customer's phone, address, hours and category were
silently dropped and every page rendered the site_id slug as its `<h1>`. I
initially read this as a product defect before checking the contract. Corrected
and re-run; the first set of outputs is invalid and is marked as such.

## Known gaps left open

- The raw CLI response is not retained, so an empty packet cannot be
  distinguished after the fact from a malformed one. Observability, not
  correctness.
- Live research is non-deterministic: the same brief gave 0, 8 and 6 verified
  facts across three consecutive runs. Inherent to live search; means a single
  unretried run is not a stable quality measure.
- The new path does not generate imagery. This is the one dimension where
  legacy's campaign-22 output is competitive.

## Gates

lint OK, 452/452 tests across 31 files, smoke 11/11, G4-0 PASS, G4-1 PASS,
`npm run gates` exit 0, verified independently on merged `main` after a fresh
`npm ci`.

## Production safety

Read-only throughout: five SELECT-only `drush sqlq` queries against
`proof_campaign`, `proof_variant`, `famtastic_prospect`. The legacy path was
never invoked. Cutover remains a hard stop for Fritz.
