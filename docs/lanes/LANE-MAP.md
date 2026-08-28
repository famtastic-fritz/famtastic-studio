# Lane map — Composer + Console Surface phase

**Written before building, per the directive.** Model tier per lane, owned paths,
contract file, and an honest hours estimate.

---

## 0. What is already done, so it is not re-estimated

**Group A is substantially complete as of `4934d711`**, built immediately before
this directive arrived:

| Item | Status | Evidence |
|---|---|---|
| A1 archetypes by business type and content shape | **done** | `server/kernel/layout-archetypes.js`, 4 archetypes, 12 tests |
| A2 real use of 1440 | **done** | containers 1120-1320px replacing a fixed 960; split/full-bleed/cards/band use the width |
| A3 vertical rhythm and hierarchy | **done** | 3 weights x 4 rhythm scales; body layouts rotate, no shape runs >2 |
| A4 director selects and writes into the data path | **done** | `directLayout()` runs in the pipeline and writes layout onto each section; `layout_provenance` records the reasoning |
| A5 mobile as a designed view | **partial** | a real collapse at 860px exists; **not yet verified by capture**, and "designed" is a stronger claim than "collapses correctly" |
| A6 every archetype passes the gates | **not started** | needs a capture per archetype at 1440 and 390 |

**So Group A's remaining work is A5 and A6: verification, not construction.**
That is ~3h, not the ~20h the group would cost from zero.

---

## 1. Lanes

Lanes own **disjoint paths**. No two lanes write the same file.

| Lane | Scope | Owned paths | Tier | Est |
|---|---|---|---|---|
| **L0 orchestrator** | contracts, merge review, gate review, retro | `docs/lanes/*`, `docs/contracts/*` | **TOP** | 4h |
| **L1 composer verify** | A5, A6: capture every archetype at both widths, run the gates, fix what fails | `scripts/capture/archetype-matrix.mjs`, `docs/research/archetypes/` | MID | 3h |
| **L2 portfolio registry** | B1: real paths registry over `FAMtastic/sites` + `FAMtastic/Apps`, inventory, backfill, `capability_class`, honest counts | `server/modules/portfolio/`, `public/pages/sites.*` | MID | 5h |
| **L3 console kit** | shared UI primitives every screen uses: panel, table, pill, route-badge, diff, toolbar | `public/kit/` | MID | 4h |
| **L4 editor** | B2, B4: section select, floating toolbar >=24px, inline edit, insert/reorder, live contrast+token checks at 100ms | `public/pages/editor.*`, `public/js/editor/` | MID | 8h |
| **L5 inspector** | B3: Content/Style/Advanced, box model, tokens.json binding, provenance, `mutable:false` | `public/js/inspector/` | MID | 6h |
| **L6 review + deploy** | B5, B10: visual diff, working-copy vs publish separation, deploy, rehearsed rollback | `public/pages/review.*`, `public/pages/deployments.*` | MID | 6h |
| **L7 SEO** | B6: score, checklist, metadata, Google + social preview, fixes as proposals | `server/modules/seo/`, `public/pages/seo.*` | **CHEAP** | 4h |
| **L8 build run + gate** | B7, B8: DAG with needs, judgement vs deterministic, live progress, verdict, lanes, repair queue, gaps | `public/pages/build-run.*`, `public/pages/gate.*` | MID | 8h |
| **L9 libraries** | B9: Media and Components over real assets, usage maps | `public/pages/media.*`, `public/pages/components.*` | **CHEAP** | 4h |
| **L10 system truth** | B11: capability from probes, ledger, proof packet, gaps, **every panel shows its API route** | `public/pages/system-truth.*`, `server/modules/truth/` | MID | 6h |
| **L11 learning** | B12: critic misses, routing proposals, ground truth, efficiency trend | `public/pages/learning.*` | **CHEAP** | 3h |
| **L13 recipes + DNA** | Recipes + DNA screen: saved recipes, per-stage routing, DNA history per run | `public/pages/recipes.*` | **CHEAP** | 4h |
| **L12 acceptance** | the MBSH end-to-end run, captures at both widths per screen | `docs/research/acceptance/` | MID | 5h |

**Total: ~70 hours of working time.** Not elapsed time.

---

## 2. Model tier rationale

Per the routing rule — cheapest plausible tier first, escalate only on failure,
one tier at a time, log every escalation.

- **TOP (L0 only).** Contracts, merge review, quality-gate review, retro. Nothing
  else. This is the lane that decides what "done" means.
- **MID (L1, L2, L4, L5, L6, L8, L10, L12).** Implementation against a written
  contract, integration, and debugging. These touch the data model or invariants.
- **CHEAP (L7, L9, L11).** Screen work against an already-built kit, over
  endpoints that already exist, where a deterministic gate checks the output.
- **LOCAL (ollama).** Lint, formatting, log summarisation inside any lane. Free
  and its output is always checked by code.
- **Deterministic-first everywhere:** contrast, token adherence, WebAIM Six,
  geometry, byte comparison and route existence are computed, never judged.

---

## 3. Dependency order

```
L0 contracts ──> L3 console kit ──> L4 editor ──> L5 inspector
                      │                              │
                      ├──> L7 SEO                    └──> L6 review + deploy
                      ├──> L9 libraries
                      ├──> L8 build run + gate
                      ├──> L10 system truth
                      └──> L11 learning
L2 portfolio registry ─────────────────────────────> L12 acceptance
L1 composer verify (independent, can run first)
```

**L3 blocks six lanes**, so it is built first and small. **L2 blocks acceptance**,
because acceptance requires MBSH loaded from the real sites root.

---

## 4. The reference set, now complete

All four mockups are present at their real paths, copied from the Drive sync
folder on 2026-08-26:

| File | Bytes | Role |
|---|---|---|
| `site-studio-vision.html` | 78,457 | **PRIMARY REFERENCE** — fullest statement of intent |
| `site-studio-editor-v3.html` | 35,728 | the property inspector |
| `site-studio-console-v2.html` | 68,280 | earlier console pass |
| `shay-operator-console-mockup.html` | 50,119 | first pass, Shay rail |

The session record is already mirrored at
`docs/plans/SESSION-RECORD-2026-08-26-console-and-quality-engine.md`.

**Directional per D1: structure and function must match; pixel parity is not a
gate and never will be.**

### What vision.html changes about this plan

Its nav is authoritative and differs from what the lanes assumed in three ways:

```
Operate   work · sites · site (EDITOR) · proofs
Produce   build run · quality gate · recipes + DNA · media · components · deployments
Know      system truth · learning · settings
```

1. **"Site view" is the EDITOR**, and it lives under Operate, not Produce. The
   editor is an operating surface, not a production one.
2. **"Recipes + DNA" is a screen** and had no lane. Added as **L13**.
3. **`applications`, `automations` and `shadow` are not in the vision nav.**
   **RULED 2026-08-26: keep all three.** The vision file is a design sketch, not
   an inventory, and an omission there is never a delete instruction. Folded into
   the nav: applications and automations under **Produce** (both are things the
   operator produces and runs), shadow under **Produce** (it is a build mode).
   **Unreconciled item closed.**

### Screens that exist today vs the vision

| | |
|---|---|
| Built, in vision | work, sites, site-view, proofs, builds, media, components, deployments, settings |
| **In vision, not built** | **quality gate**, **recipes + DNA**, **system truth**, **learning** |
| Built, not in vision | applications, automations, shadow — **kept, folded into Produce** (ruled 2026-08-26) |

## 5. Acceptance, restated

No screen is done on a green test count. Every screen needs a capture at 1440 and
390 of the **working surface**.

Phase acceptance is the MBSH run: loaded from the real sites root, opened, a
section edited and journaled, undone, SEO run on its real metadata, a proposal
reviewed as a visual diff, the gate passed with evidence, deployed to its real
target, rolled back with bytes verified identical — and `capability_class:
application` stated honestly where Studio cannot rebuild the backend.

**The honest note on that last point:** MBSH's backend is 5 tables, ~14 endpoints
and 12 authenticated admin pages. Studio deploys and verifies it as an opaque
attachment. The acceptance run proves Studio can *carry* MBSH. It does not prove
Studio can build it, and the screen must say so.
