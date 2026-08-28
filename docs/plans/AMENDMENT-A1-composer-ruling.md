# AMENDMENT A1 to RULING — COMPOSER AS A PROVIDER SLOT

**Date:** 2026-08-26 · **Owner:** Fritz · **Status:** RATIFIED
**Circumstance:** normal
**Applies to:** `docs/plans/RULING-composer-as-provider.md` — applied when that file was copied into the repo. Sections 3, 5a, and 5c are amended. Everything else stands.

> Mirrored from Drive (`1JNPI3dsjMLlrmeCxH-rLpyuvMsveOipt`) on 2026-08-26 via the
> Drive connector, which returns an escaped rendering; unescaped and reflowed,
> content unedited.

---

## A1.1 — `kimi-cli` is NOT wired. Demoted to declared, with a cost blocker.

The original registry said "wire `kimi-cli` first." **That is rescinded.**

Owner ruling: the Kimi CLI tends to be expensive, and is only acceptable if routed to its cheapest qualifying model. It is not wired now, and it is not the first provider.

Registry status changes to:

| id | auth | stack | status | blocker |
|---|---|---|---|---|
| `archetype-native` | none | html | **live** | — |
| `claude-cli` | subscription | html \| react-tailwind | **wire first** | — |
| `kimi-cli` | subscription | react-tailwind | **declared** | cost unverified; only permissible on its cheapest qualifying model, and only after a measured cost-per-build comparison |
| `kimi-api` | api_key | react-tailwind | **blocked** | violates the no-credential rule; bills separately from subscription |

**Wire `claude-cli` first.** It already rides the subscription, is already the research brain, is already probed and working, and can compose. The lesson from the external comparison was never "use that specific vendor" — it was **a strong model composing freely beats a template engine.** That capability is already available on tooling in use.

`kimi-cli` may be scored later, on its cheapest qualifying model, if and only if a measured comparison justifies it. Record the cost estimate before running it at volume, not after.

## A1.2 — Kimi data/research integration is a POST-LAUNCH addition.

Any Kimi involvement in research, preview generation, or media is deferred until after the current build is complete and shipped. It is recorded in POST-SHIP, not scheduled into any current lane. Do not scaffold adapters for it now beyond a `declared` registry row with its blocker stated.

This keeps the current phase's scope closed. The registry pattern already makes adding it later a config change rather than a rewrite, which is the entire point of the pattern.

## A1.3 — 5a resolved: output stack is per-site.

Owner ruling on the open question in section 5a: **Option C.** `output_stack` becomes a declared spec field, per site. The console states its editing reach honestly per site rather than implying uniform capability — where the canvas cannot manipulate a stack, it declares `edit_support: view_only` rather than silently degrading.

## A1.4 — 5c stands, with the provider order corrected.

L1 still changes from "build layout archetypes" to "build the composer registry and score providers." `archetype-native` remains provider #1 and the free deterministic fallback. The first comparison run is **`archetype-native` vs `claude-cli`** on the same brief, scored by the existing gate, with renders brought to the owner for verdicts.

---

**Everything else in the ruling is unchanged**, including: what Site Studio owns permanently, the six hard requirements on any composer provider, the scoring method, the benchmark-facts schema addendum (5b), and the share-link meta defect noted for the Designs repo (section 7).

---

## A2 — Provider-by-job, and composition caching (added 2026-08-26)

Ratified after the first comparison run. The bake-off's decisive column was **timing, not layout count**: `archetype-native` at 0ms and reproducible, `claude-cli` at 89s and different every run. Those suit different jobs.

- **Proof directions WANT variation.** Three proofs should be three theses, not three colourways. → `claude-cli`.
- **Rebuilds and edits MUST NOT vary.** A palette change must never silently redesign a page a client already approved. → `archetype-native`, or cached composition.

**The default is therefore provider-by-job, not one winner.**

**Composition caching:** recompose only when *structure* changes. Never on a token or copy edit. A palette change re-renders; it does not re-compose.
