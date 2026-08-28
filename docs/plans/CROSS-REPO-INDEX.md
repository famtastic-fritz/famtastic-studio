# Cross-repo index: what exists outside Site Studio

**Swept 2026-08-25.** SITE-LEARNINGS lineage (all worktrees, deduped by content
hash), the Designs repo, MBSH, site-context files, `skills/`, agent definitions,
`worktrees/`, and the Drive sync folder.

Marks: **applies-to-studio** (should govern Studio, currently does not) ·
**duplicated-in-studio** (exists both places, risk of drift) ·
**contradicts-studio** (conflicts with a Studio ruling) ·
**studio-lacks** (real capability Studio has no equivalent for).

## 0. The sweep itself found a problem

The SITE-LEARNINGS lineage exists in **14+ divergent copies** across worktrees.
Deduped by content hash, the largest is **not** the canonical one:

| Lines | Path |
|---|---|
| **8310** | `Reference/famtastic-worktrees/site-studio-runtime-vnext-closeout/SITE-LEARNINGS.md` |
| 7607 | `FAMtastic/SITE-LEARNINGS.md` ← treated as canonical |
| 7266 | `famtastic-wt-site-studio-working-mockup/` |
| 7264 | `famtastic-wt-site-studio-operator-integrity/` |
| 7252 | `famtastic-wt-phase-0/` |

**703 lines exist in a worktree copy that the canonical file does not have.**
Every worktree that ran a session appended locally and diverged. There is no
merge discipline, so "the learnings file" is not one file and reading the
canonical one does not mean you have read the learnings.

Separately, `Development/Notes/SITE-LEARNINGS.md` (1191 lines) is a different
document entirely under the same name.

## 1. Rulings

| Ruling | Where | Mark | Note |
|---|---|---|---|
| Site Studio Service Auth Ownership (2026-05-05) | canonical | **applies-to-studio** | Provider auth belongs to Studio/platform, not generated sites. Studio-next has no vault integration; it holds no provider credentials at all. |
| Proof crosses a portable artifact boundary (2026-08-01) | canonical | **contradicts-studio** | "generate through Shay... serve from `/proofs`". P0-I1 now forbids Studio any proof ingress. See BOUNDARY-CLASSIFICATION. |
| Screenshots after final packaging (2026-08-01) | canonical | **studio-lacks** | Ordering rule: generate, sanitize, inline CSS, fill media, strip scaffolding, render, *then* capture. Studio-next has no thumbnail stage. |
| Manifest-driven acceptance for creative proofs (2026-08-14) | canonical | **applies-to-studio** | Technical acceptance **and** visual contact-sheet review are both mandatory. Studio has the first, not the second. Directly relevant to the outline defect that passed every gate. |
| Adobe bridge acceptance ladder (2026-08-14) | canonical | **applies-to-studio** | source pinned → installed → registered → detected → read-only verified → disposable mutation → evidence. The right ladder for any provider, including the media registry below. |
| MBSH Site Boundary / MBSH Deploy Proof Boundary | canonical §6945, §7072 | **duplicated-in-studio** | Studio has its own deploy-verify discipline; these predate it. |
| Account ownership checked at edit and checkout (2026-08-10) | Designs | doctrine, correctly outside | Business surface. |
| Live-enabled ≠ live transaction proof (2026-08-10) | Designs | **applies-to-studio** | Configuration proof is not behavior proof. Studio's honest-state ladder agrees in spirit; not written down as a rule. |
| Provider proof vs fixture proof separately classified (2026-08-10) | Designs | **applies-to-studio** | Studio's gates report SKIPPED-WITH-REASON, which is the same instinct, unformalized. |

## 2. Skills

| Skill | Where | Mark | Note |
|---|---|---|---|
| `image-and-video-gen` | `FAMtastic/skills/` | **studio-lacks** | Substantial. Model decision tree with costs, identity locking, transparent extraction. See CONTENT-AGENT record. |
| `famtastic-hosting-checkout-qa` | `FAMtastic/skills/` | outside, doctrine | Business/checkout. |
| `schema-consistency-check` | `FAMtastic/skills/` | **applies-to-studio** | Schema drift checking; Studio has ad-hoc validators. |
| `adobe-firefly`, `export-site`, `deploy-to-vercel`, `web-design-guidelines`, `ui-ux-advisor` | plugin skills | **studio-lacks** | Design-guidance skills nothing in the pipeline consults. |

## 3. Capabilities Studio lacks entirely

| Capability | Where it lives | Mark |
|---|---|---|
| **Backend site model** (DB, endpoints, admin, cron, uploads) | `sites/site-mbsh-reunion/backend/` | **studio-lacks** — see MBSH-SPEC-GAP |
| **Commissioned art direction** (mascot, scene language, motion) | MBSH assets + STANDING-FINDING-art-direction | **studio-lacks** |
| **Dual-worker provider-neutral media** | `worktrees/shay-website-delivery-swarm/website-delivery-swarm/{openai_image_worker.py, gemini_flash_lite_image_worker.mjs}` | **studio-lacks** — see MEDIA-PROVIDER-REGISTRY |
| **Repair loop against executable gates** | delivery-swarm `agent-ledger.json` | **studio-lacks** — already logged in salvage |
| **Visual review as attributed opinion** | `famtastic.visual-review.v1` | **studio-lacks** |
| Platform vault / service bootstrap | `platform/capabilities/studio/` | **applies-to-studio** |

## 4. Contradictions to resolve

1. **2026-05-05 vs current credential reality.** Studio owns provider auth by
   ruling; in practice the Designs Gemini worker holds the media credential.
2. **2026-08-01 vs P0-I1.** Generation-side ownership vs boot-level prohibition.
3. **The canonical learnings file is not canonical.** 703 lines live elsewhere.

## 5. Proposed cross-repo learnings protocol

The failure mode is not that people did not write things down. They wrote them
down **in a place that did not converge**, in a **voice that hid the reason**.

**R1. One canonical learnings file per repo, and worktrees never append.**
A worktree appending to `SITE-LEARNINGS.md` creates a divergent copy the moment
it is not merged the same day. Sessions in a worktree write to
`docs/learnings/incoming/<date>-<session>.md`; a merge step folds them into the
canonical file on the default branch. Append-only files in shared worktrees are
how 703 lines went missing.

**R2. Every ruling records its reason and its duress.** Required fields:
`what`, `why`, and **`circumstance: normal | outage | deadline | unknown`**.
A ruling made because something was down says so, in the ruling. This single
field is what would have prevented the workaround-becomes-doctrine failure.

**R3. Cross-repo rulings are written once and referenced, never copied.**
A boundary ruling affects two repos, so it lives in one and the other links it.
Copies drift silently and both look authoritative.

**R4. Rulings expire if their circumstance was not `normal`.**
A ruling with `circumstance: outage` carries `review_by` (default 30 days). At
review it is re-ratified as doctrine or reverted. Nothing hardens by neglect.

**R5. A capability record exists per capability, in the repo that owns it,**
listing what it does, where its code is, what it costs, and its proof. Studio's
`docs/capabilities/` is the pattern; nothing else has one.

**R6. The index is regenerated, not maintained by hand.**
`scripts/cross-repo-index.mjs` should sweep for learnings files, skills, and
agent definitions and diff against this document, so drift shows up as a diff.

**R7. Sweep before a boundary decision, never after.** This document exists
because a boundary hardened without anyone reading the ruling that contradicted
it, which was sitting in the same file, 3800 lines up.
