# CUTOVER DECISION PACKET, REVISED

**Prepared:** 2026-08-23 | **Supersedes:** CUTOVER-PACKET-2026-08-22.md | **For:** Fritz
**Change since the last packet:** five real production briefs have been run through shadow with legacy evidence attached, and the Shay rail is wired.

**Recommendation: DO NOT CUT OVER, and reconsider the question itself.** See section 4a, which was found after this packet was first drafted and changes what is being decided.

---

## 1. The commit

| | |
|---|---|
| Commit | `7df4985ed3eea6fed97d241c056bfa000872ab79` |
| Short | `7df4985e` |
| Gate command | `npm run gates` |
| Result | lint OK, 369 tests, 11 of 11 smoke, G4-0 PASS, G4-1 PASS, exit 0 |

---

## 2. The shadow evidence

Five campaigns, selected by the orchestrator as the five most recent in production `proof_campaign`, newest first, read read-only. **The legacy path was never invoked.** Its side of each comparison is the output it had already produced, read from `proof_variant`.

| Business | Campaign | New path | Legacy |
|---|---|---|---|
| Rattler Football Fan Portal | pc-rattler-football-fan-portal-7323201e | 3 pages, verified, 830ms | 6 variants |
| The Set Club | pc-the-set-club-33cd280f | 3 pages, verified, 451ms | 6 variants |
| The FAMU Corner | pc-the-famu-corner-c221b733 | 3 pages, verified, 479ms | 6 variants |
| The Good Ole Candy Lady Shop | pc-the-good-ole-candy-lady-shop-e616a624 | 3 pages, verified, 374ms | 6 variants |
| Bossy Nails by Pri | pc-bossy-nails-by-pri-4ce235eb | 3 pages, verified, 428ms | 6 variants |

Every run completed all six stages with verification passing. Inspect any of them at http://localhost:3400/builds; the comparison view is at /shadow.

---

## 3. What this proves

The pipeline runs end to end on real production records, inside a fail-closed boundary, producing a real verified site with a complete replay manifest, and records its evidence where an operator can inspect it. Nothing touched production beyond read-only queries.

---

## 4. What this does NOT prove, and why it still blocks cutover

**The five production briefs are name-only.** Every one carries a business name and an email address, and nothing else: no category, no description, no service area, no phone, no hours. All five use Fritz's own email.

Consequently:

- The new path produced **three generic structural pages** per site.
- Legacy produced **six named creative directions** per campaign, with concept names like "The Rattler Field Guide" and "The Season Coil".
- Every stage recorded `model: none` and `composer: deterministic`, and every cost entry reads *"no model provider is connected for this stage"*.

**This is not a like-for-like comparison and must not be read as one.** It demonstrates that the plumbing works on real records. It does not demonstrate that the new path produces work you would send a customer, because with no model connected and a name-only brief it structurally cannot yet.

The gap is not a defect in the pipeline. It is two missing inputs: a model provider, and briefs with real content in them.

---

## 4a. THE FINDING THAT CHANGES THE QUESTION

**"Legacy" is not one system. It is three, and the five campaigns in section 2 were produced by none of the ones cutover would replace.**

| | What it is | Model call | Produced |
|---|---|---|---|
| **System A** | Site Studio proof-jobs route (`server/famtastic-proof-job-routes.js` to `generateProofCampaign`) | `shay -z` spawned as a local CLI subprocess | the documented path; **never used in production, because `SITE_STUDIO_URL` was never set** |
| **System B** | Drupal `ProofCampaignService` image-free pilot | **none at all**, pure PHP string templates, directions hardcoded to Safe / Wild / OMG | most of the 19 `ready` production campaigns |
| **System C** | `website-delivery-swarm`, a standalone benchmark tool outside both repos | `codex exec -m gpt-5.6-sol` for generation, `claude -p --model opus --effort high` for review, both as CLI subprocesses | **all five campaigns in section 2** |

**Verified independently by the orchestrator, not taken from the lane's report.** Every one of the five campaigns carries `"provider":"openai-codex-swarm"` and `"agent_name":"famtastic-six-direction-benchmark"` in its stored `design_dna`. The concept names are System C's: "The Rattler Field Guide", "The Continuous Table", "The Hill Brief", "Porch Table", "Polished & Punctual".

### What this means for the comparison

The five briefs were compared against **a one-off manual benchmark run from 2026-08-19**, not against the pipeline that serves customers. That comparison was never like-for-like and could not have been, whatever input we fed it.

### Where the creative richness comes from, answered empirically

The Rattler prospect record is genuinely name-only: `business_category`, `business_description`, `service_area` and `public_phone` are all NULL. There is no hidden enrichment step. `telemetry.prompt_snapshot` is an empty string and `input_snapshot` carries only a request id and a direction list. **The model invented a research-grade concept from a bare business name**, helped by its own world knowledge that "Rattler" maps to FAMU.

So the answer to the question the previous packet raised is: nothing is missing from the brief. The richness is the model, and the model was reached through CLI subprocesses, which is exactly the architecture the owner has mandated for Shay.

### Two things that are now UNDETERMINED and matter

1. **The exact model behind `shay -z`** is not pinned anywhere in either repo. It resolves through personal runtime config (`~/.shay/config.yaml`) which can drift.
2. **How System C's output reached production `proof_variant` at all**, given the signed callback contract was never active. Something wrote to the production database outside the documented path. That is worth knowing before trusting any path.

### Consequence for the decision

Cutover was framed as replacing a working legacy pipeline. In fact:
- The path cutover would replace (System A) **has never run in production**.
- The path that has been serving (System B) **calls no model at all**.
- The output that looks impressive (System C) **is a benchmark tool nobody has wired into anything**.

"Cut over or extend shadow" may be the wrong question. The real one is which of these three should become the production path, and System C is the only one that has demonstrably produced work worth sending a customer.

---

## 5. What would actually make this decision safe

1. **Connect a model provider** to the pipeline stages. The seam exists and is marked; the routing table is data. Until then the composer is deterministic by design and honest about it.
2. **Find or create briefs with real content.** The production prospect records are effectively empty. Either richer prospect data exists somewhere this orchestrator has not looked, or the discovery step that populates it is not running.
3. Re-run the comparison. Then the packet can say something meaningful about output quality rather than about plumbing.

Item 2 is worth attention independently of the rebuild: **if production prospects are genuinely name-only, the legacy pipeline is producing six creative directions from a business name and an email.** That is either impressive or a sign the real brief lives somewhere other than `famtastic_prospect`, and it is worth knowing which before either path is trusted with new customer work.

---

## 6. Unchanged from the previous packet

- The outreach zero-write guarantee rests on **containment, not observation** (G4-1 skips three of five audit locations; the outreach queue is in the production database and checking it needs the contact the gate forbids).
- Go-live has never resolved a real domain; it records `dns_evidence: absent` honestly when none is supplied.
- The standing cross-site risk: three separate containment defects appeared in this build, each from a new surface finding its way around the shared boundary. Maintain the rule that every new surface goes through the shared resolver and the bound identity.
- **Cutover precondition (ADR-0002):** the serving instance must already run code at or after `8a1d38bd` BEFORE `SITE_STUDIO_URL` is set. Setting the variable first is the failure mode. G4-0 is the mechanical check.

---

## 7. Shay

The rail is wired: per-site conversation, typed cards rendered structurally, a context envelope built on every ask. With no provider configured it returns `provider_unavailable` carrying the envelope it would have sent, and produces zero cards. It does not fabricate a reply. The model connection is the same missing input as section 5 item 1.
