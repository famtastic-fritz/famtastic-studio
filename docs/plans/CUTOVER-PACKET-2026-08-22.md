# CUTOVER DECISION PACKET

**Prepared:** 2026-08-22 | **For:** Fritz | **Decision required:** whether to cut the FAMtastic Designs proof pipeline over to the greenfield path, or extend shadow.

**This decision is yours alone.** It is one of the two hard stops in the project contract. Nothing in this packet has been actioned toward cutover, and I will not action it without your explicit word.

---

## 1. What you are deciding

Whether the new modular pipeline replaces the legacy proof path for live customer work.

**My recommendation: DO NOT CUT OVER YET.** Extend shadow. The reasoning is in section 5, and it rests on one specific gap rather than a general lack of confidence.

---

## 2. The commit this packet is bound to

| | |
|---|---|
| Tree | `site-studio-next` on branch `studio-rebuild/phase-2` |
| Commit | `d59401b88aabc27ad16b2bff9fd6f6fc625ad7dc` |
| Short | `d59401b8` |
| Producer repo (FAMtastic Designs) | `b5652ec6` |
| Gate command | `npm run gates` |
| Result on this commit | lint OK, 357 tests, 11 of 11 smoke pages, G4-0 PASS, G4-1 PASS, exit 0 |

Re-run `npm run gates` at this commit to reproduce every claim below.

---

## 3. What is proven

- **The console operates real sites.** Five real sites on disk, real pages, real specs, journaled mutations with byte-exact undo, click-to-edit measured at p50 12ms and p95 23ms against a 140ms target.
- **The pipeline builds a real site from a brief** through research, spec, compose, build, verify and record, with total DNA capture carrying a complete replay manifest, and a recipe savable from any successful run.
- **Deploy publishes to FAMtasticInc** under a receipted path, excluding operational files, verified by re-hashing the published bytes, with an explicit active-release pointer and a rollback that switches the pointer back and re-verifies it.
- **Proofs is read-only**, asserted by a test that no mutating route is reachable, not by a comment.
- **Isolation holds under adversarial test**: concurrent A/B site switching, identity conflict and spoofing, event delivery isolation, journal and conversation isolation, sequence independence, and path escape including symlink attacks.
- **Revenue safety**: the greenfield server has no proof ingress in its module closure, carries no proof secrets, and its shadow dispatcher cannot open a socket. G4-0 proves the current signed producer contract is accepted offline at pinned SHAs.

---

## 4. What is NOT proven, stated plainly

**This is the section that matters.**

1. **Zero-write to the outreach queue is an argument from containment, not observation.** G4-1 reports three of five audit locations SKIPPED-WITH-REASON. Two paths do not exist on this machine. The third, outreach consent state, lives in the Drupal database on the production host; verifying it would require the exact production contact the gate forbids. There is no code path from a shadow run to that queue, which is a structural argument, and it is not the same as having looked.
2. **No real customer brief has been shadow-run against the legacy path.** The shadow machinery works and produces comparison records, but every run so far used synthetic briefs, and `legacy_evidence` is honestly recorded as `absent` because the legacy path was never invoked. **You have no side-by-side output comparison on real work.**
3. **Go-live has never resolved a real domain.** It records DNS evidence when supplied and honestly records `absent` when not. On this machine it has always been absent.
4. **Shay is not wired to a model.** The conversational rail is cut. The pipeline's composer is deterministic and records itself as such.
5. **The proof contract mismatch is fixed but never exercised in production.** Production has no `SITE_STUDIO_URL` set, so remote dispatch has never run. See ADR-0002 for the trigger condition.

---

## 5. Why I recommend extending shadow

The engineering is sound and the gates are green, but **the single most important input to this decision does not exist yet: a real customer brief processed by both paths with their outputs compared.** Everything in section 3 says the new path works. Nothing in it says the new path produces work you would send a customer, because that has never been tested against the old path on real input.

Cutting over on synthetic evidence would be trading a known-good revenue path for one that is well-built but unproven on the only workload that matters.

**What would change my recommendation:** three to five real briefs run through shadow with legacy evidence supplied, their outputs compared, and no material difference you would not accept. That is hours of work, not days, and it needs your involvement only to say which briefs.

---

## 6. Standing risk to carry regardless of the decision

Three separate cross-site defects were found in this build: a path escape through the shared resolver, a pipeline retry taking its site from a run record instead of the bound identity, and lexical containment that followed symlinks. Each was fixed at the shared boundary. **The pattern is that every new surface touching site state has found a way around containment.**

Mitigation, which should outlive this project: any new surface touching site state goes through the shared path resolver and the bound identity, and the adversarial suites gain a case for that surface. This is a design property to maintain, not a set of closed tickets.

---

## 7. If you decide to cut over

The legacy path stays running and untouched. Cutover means setting `SITE_STUDIO_URL` to the greenfield endpoint. **Precondition from ADR-0002: the serving instance must already run code at or after `8a1d38bd`, since setting that variable first is the failure mode.** G4-0 is the mechanical check.

## 8. If you decide to extend shadow

Say which briefs. I will run them, supply the legacy evidence, produce the comparison, and bring you a revised packet. Nothing else is blocked by that decision.
