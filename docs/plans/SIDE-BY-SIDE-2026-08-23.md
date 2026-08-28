# Side-by-side: new canonical path vs legacy output

**Date:** 2026-08-23
**Question this answers:** for the same five real customer briefs, would I send
the new path's output to a customer, and is it better than what legacy actually
produced?
**Production access:** read-only `drush sqlq` SELECTs over the existing SSH key.
No writes. The legacy path was never invoked; its side is the output it had
already produced, read from `proof_variant`.

---

## 1. The five briefs

All five are real external customers pulled from production `famtastic_prospect`,
newest first. None is a test entry and none uses Fritz's email. This replaces the
earlier comparison set, which was five of Fritz's own `customer_portal` entries
whose variants came from System C, a standalone benchmark tool.

| # | Business | Real customer email domain | Brief fields | Legacy variants |
|---|---|---|---|---|
| 31 | I sell shoes | yahoo.com | 3 | 0 |
| 30 | Pros In Training (The P.I.T) | ProsInTraining.org | 5 | 3 |
| 18 | The Beehive Studio | (external) | 6 | 3 |
| 17 | Starlight Skin Bar | (external) | 6 | 3 |
| 16 | Kim Chang Suk Hair Salon | (external) | 6 | 3 |

"Brief fields" is the honest real-world input: a name, sometimes a category, a
city, a phone. Nothing else. That thinness is the point of the test.

---

## 1a. RECORD CORRECTION (2026-08-23, ratified by Fritz)

**The template-stamp output described below was never delivered to a customer.**
Those rows are Designs-drift and test proofs: benchmark and pilot runs that
landed in `proof_variant` because the table was the convenient place to put them,
not because anyone shipped them.

This is corroborated independently in the salvage artifacts
(`docs/salvage/SALVAGE-2026-08-23-vnext-build-recipes.md`): the corresponding
build briefs carry `classification: fresh_provider_executed_heldout_benchmark`,
`customer: Fritz Medine`, and an explicit
`publication_boundary: {external_mutation_allowed: false, site_studio_execution_claimed: false}`.

**What the finding does stand as:** the inefficiency that justified the rebuild.
A `no_image_pilot_v1` stamp writing three near-identical rows per business into
the same table that holds real proof records, with nothing in the schema marking
them as pilot output, is precisely why the console could not tell a customer
from a fixture and why the rebuild was necessary. That is the honest claim, and
it is a claim about **process and data hygiene**, not about work sent to
customers.

The site-inventory truth pass (`spec.origin`, shipped this session) exists so
this specific confusion cannot recur: every site is `legit`, `test`, or
`needs declaration`, and console counts split accordingly, permanently.

Read section 2 with that framing.

---

## 2. What legacy actually produced

Three of the five (campaigns 11, 12, 13 -- Kim Chang Suk, Starlight, Beehive)
received the **same three directions, byte-identical except the business name**:

```
"Bold and Modern"          325-331 chars of DNA
"Trusted and Professional" 334-340 chars
"Local and Approachable"   326-332 chars
```

Direction "a" for The Beehive Studio and direction "a" for Starlight Skin Bar
differ in exactly one field:

```json
{"source":"no_image_pilot_v1","direction":"a","direction_name":"Bold and Modern",
 "business_name":"<THE ONLY DIFFERENCE>",
 "palette":{"bg":"#0c0f0a","accent":"#b8f135","ink":"#f4f7ee"},
 "typography":"System sans headlines, generous body",
 "layout":"Hero-first landing with section blocks",
 "generated_at":"2026-08-02T16:01:28+00:00"}
```

The `generated_at` timestamp is identical across all three businesses: one
generation event, stamped onto unrelated companies. A hair studio and a skin bar
both received the same near-black background with a lime-green accent.

One of the five (P.I.T, campaign 22, `source: site_studio_local`) got genuinely
real work: a full design system, a stated research boundary, provenance
telemetry, and a generated hero image. That is a different and better legacy
path than the one the three salons hit.

One of the five (I sell shoes) got nothing at all: no campaign, no variants.

**Legacy summary (reframed per 1a): 1 of 5 got real pipeline work, 3 got pilot
stamp rows, 1 has no campaign at all. None of these were customer deliveries.
The point is that the system could not tell them apart.**

---

## 3. What the new path produced

Full canonical flow on the claude adapter, live research (WebSearch + WebFetch),
every cited source independently re-fetched before being trusted, packet feeding
spec feeding build.

| Business | Time | Status | Verified facts | Open qs | Customer claims | Pages |
|---|---|---|---|---|---|---|
| I sell shoes | 94s | partial | 0 | 12 | 3 | 9 |
| Pros In Training | 139s | partial | 0 | 14 | 5 | 13 |
| The Beehive Studio | 107s | no_findings | 0 | 0 | 6 | 3 |
| Starlight Skin Bar | 124s | partial | 0 | 10 | 6 | 7 |
| Kim Chang Suk | 119s | ok | 1 | 10 | 6 | 5 |

The differentiation legacy could not do:

- **Starlight Skin Bar** -- "lean into the name literally but expensively":
  midnight-indigo base (#161B2E), champagne-gold accent (#D9BE8F), nude-blush
  neutral. Pages include *First Visit (What To Expect + How To Find Studio 6)*
  and a *Policies* page covering cancellation, no-show, late arrival and
  contraindications. That is an esthetician working out of a suite, not a
  generic salon.
- **Kim Chang Suk Hair Salon** -- bone/oat and espresso-brown with a terracotta
  accent and a sage secondary, plus an explicit instruction to *avoid the
  salon-industry cliche*.
- **The Beehive Studio** (from the retry, see section 5) -- distinct again.

Each carries a brand voice with stated anti-patterns. Starlight's forbids
"pamper", "indulge", "luxurious escape", and miracle claims.

Research refused to invent. Starlight returned **zero** verified facts after
searching the exact name, the street address, and the phone number, and said so,
then asked the useful questions: is a Google Business Profile claimed, is the
legal entity under a different name, what is the Arizona Board of Cosmetology
license number. Legacy asserted "Bold and Modern" with total confidence and
zero evidence.

---

## 4. Honest assessment against "would I send these to a customer"

**Better than legacy on 4 of 5, decisively.** For the three salons legacy
templated, the new path produces business-specific palettes, page structures and
voice, plus an evidence trail and a real question list. For "I sell shoes",
legacy produced nothing and the new path produced a 9-page structure and 12
honest questions.

**Not clearly better on P.I.T.** Legacy's campaign-22 output is genuinely strong,
including a generated hero image. The new path produced more pages (13) and more
questions (14) but zero verified facts on this run, and it does not generate
imagery. This one is a real contest, not a walkover.

---

## 5. What this run exposed, honestly

**5a. One in eight live research runs came back empty.** The Beehive Studio run
returned a packet with zero facts, zero open questions, zero media prompts and no
confidence notes. Two immediate retries of the same brief returned 8 facts and 6
facts respectively, so the failure is **transient, not systematic**.

**This was the most important finding in this document, and it is now fixed.**
There was no retry: the pipeline accepted the empty packet, built a 3-page site
from brief fallback, and reported `outcome: success, verified: true`. An operator
scanning results would have seen a thin site that looks finished rather than a
research call that failed.

**Fixed in `927c3494`.** A completely empty packet is retried once. "Empty" is
defined narrowly as nothing usable at all -- zero verifiable facts *with* real
open questions is a legitimate answer for a thin brief and does not trigger a
retry, which a test pins. If the second attempt is also empty the packet is
reported as `no_findings` with a note saying it was attempted twice, never
dressed up.

**5b. The raw CLI response is not retained.** When a packet comes back empty,
nothing on disk distinguishes "searched and genuinely found nothing" from "the
CLI returned junk". The journal records `execution_status: no_findings` and
stops. Observability gap; makes 5a harder to diagnose than it should be.

**5c. Research output is non-deterministic across runs.** The same Beehive brief
produced 0, 8, and 6 verified facts on three consecutive live runs. This is
inherent to live web search and is not a defect in itself, but it means a single
run is not a stable quality measure, and a customer-facing proof should not be
built from one unretried attempt.

**5d. Fixed during this run: `execution_status` was inert.** It gated `ok` on
having zero open questions. Honest research always surfaces unknowns, so `ok` was
unreachable and every packet reported `partial` regardless of whether it carried
eight verified facts or none. Now keyed off evidence. Committed as `43933455`.

**5e. Fixed during this run: my own harness bug.** The first pass passed briefs
with flat keys (`business_name`) where the contract is nested (`brief.business`).
The customer's phone, address, hours and category were silently dropped
(`customer_claims: []`) and every built page rendered the site_id slug as its
`<h1>` and `<title>`. Corrected and re-run; pages now carry the real business
name and all six customer claims. **This was my error, not a product defect** --
recorded here because the first set of outputs is invalid and should not be used
for judgment.

---

## 6. Recommendation

5a was the one finding that would have put a visibly broken proof in front of a
customer, and it is closed (`927c3494`).

The quality question Fritz asked is answered: **yes on the three templated
salons and on the empty one, contested on P.I.T.** The remaining honest caveats
are 5b (raw CLI response not retained, an observability gap, not a correctness
one) and 5c (live search is non-deterministic, inherent rather than fixable).

**Recommendation: the output-quality case for cutover is made.** The decision is
Fritz's and remains a hard stop. Before cutting over, one item worth deciding:
whether the new path needs image generation to match legacy's campaign-22
output on P.I.T, since that is the single case where legacy is competitive.

---

## 7. Provenance

- Gates at time of writing: lint OK, 452/452 tests across 31 files, smoke 11/11,
  G4-0 PASS, G4-1 PASS, `npm run gates` exit 0.
- Production touched read-only only: five SELECT-only `drush sqlq` queries
  against `proof_campaign`, `proof_variant`, `famtastic_prospect`.
- New-path artifacts under `.studio-next-data/sites/v2-*`, packets under
  `.studio/packets/v2-*`, DNA under `.studio/dna/`.
- The superseded first pass (`canon-*` site ids) is invalid per 5e.
