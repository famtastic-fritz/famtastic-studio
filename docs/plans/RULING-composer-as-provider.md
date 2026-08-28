# RULING — COMPOSER AS A PROVIDER SLOT

**Date:** 2026-08-26 · **Owner:** Fritz · **Status:** RATIFIED
**Circumstance:** normal
**Supersedes:** the Group A plan to build layout archetypes as Site Studio's only path to page composition. Archetypes are not cancelled; they become one registered provider among several.

> Mirrored from Drive (`19WWaAe-txplxGfX_5bv1Cbh_GouJ9qBB`) on 2026-08-26 via the
> Drive connector, which returns an escaped rendering; unescaped and reflowed,
> content unedited except where **AMENDMENT A1 is applied inline and marked**.
> See `AMENDMENT-A1-composer-ruling.md` for the amendment as issued.

---

## 1. THE RULING

**Site Studio stops trying to be the best generator. It becomes the best system around generators.**

Page composition moves behind a **composer provider registry**, the same pattern already ratified for media providers and research providers. The composer slot is swappable per build, selected by recipe, scored by the existing quality gate, and recorded in Build DNA.

### Why
A one-line prompt to an external generator produced a page with eight distinct layout devices, named design tokens, a display/accent font pairing used compositionally, research-grounded pricing, and bilingual copy driven by a demographic fact. Site Studio's composer, after four months, emits one document shape for every business: `h2 → paragraph → full-width image`, repeated 8–12 times. The five calibration samples scored 66–71 for that reason and no other.

That gap is real and it is not closed by a better writer or a better image generator.

**But what the external generator did NOT produce is the entire reason Site Studio exists:** a mutation journal, a rehearsed rollback, a quality gate that can block, Build DNA, deploy to configured targets, multi-site management, honest states, a seam to FAMtastic Designs, or a `capability_class` that admits what it cannot rebuild. It made one good thing once, with no memory of having done it.

**Therefore:** generation is a commodity that improves monthly and is worth buying. The system around generation is the durable asset and is worth building. Site Studio owns the second and rents the first.

### What Site Studio owns permanently (never delegated to a composer)
- Research grounding and the Research Packet contract
- The site spec as the canonical structured record
- Design tokens (`tokens.json`) as the brand authority
- The quality gate: WebAIM Six, geometry, contrast, token adherence, aesthetic critic
- Build DNA, journal, undo, rollback
- Deploy adapters and verification
- The console and every operator surface
- `capability_class` and honest states
- The seam to Designs

### What a composer provider does
Takes a spec plus tokens plus media slots. Returns rendered pages. Nothing else. It never touches the journal, never deploys, never holds a credential, never decides what is true.

---

## 2. THE COMPOSER PROVIDER CONTRACT

```
composer_provider {
  id                      string   e.g. "archetype-native" | "kimi-cli" | "claude-cli"
  auth                    enum     subscription | mcp | none          # NEVER api_key
  output_stack            enum     html | react-tailwind | astro      # declared, not assumed
  capability_class        array    [brochure] | [brochure, application]
  accepts                 object   { spec: true, tokens: true, media_slots: true }
  deterministic           boolean  same input -> same output?
  cost_model              enum     free | per_build | per_token
  cost_estimate           number   per typical build, or null with reason
  can_multi_page          boolean
  can_use_provided_media  boolean  must render OUR generated images, not source its own
  status                  enum     live | declared | blocked
  blocker                 string   required when status != live
}
```

### Hard requirements on any composer provider
1. **It receives tokens and must use them.** Token adherence is measured on its output. A provider that ignores `tokens.json` fails the gate like any other build.
2. **It receives our media slots with `section_id` and `intent`, and must render them.** A composer that generates or sources its own imagery is rejected — provenance and cost tracking break.
3. **It must not invent facts.** Output is checked against the packet: any claim not in `facts[]` or `synthesis[]` is a defect. `not_found` stays empty.
4. **Its output passes the same gate as every other build.** No provider is exempt, no provider is trusted because it looked good once.
5. **Its stack is declared, never inferred.** Downstream deploy and editing behavior depends on it.
6. **It holds no credential.** Per the 2026-05-05 ruling, provider authentication belongs to Studio, not to generated sites or to the generator.

### Provider selection
Assigned **per build by the recipe**, exactly like brains per stage. Recorded in DNA with `routing_source`. Default is set per `business_type` and `capability_class` and may be overridden per run.

> **AMENDED — A2 (2026-08-26): the default is provider-by-job.** The first
> comparison run made timing the decisive column: `archetype-native` at 0ms and
> reproducible, `claude-cli` at 89s and different every run. Proof directions
> WANT variation — three proofs should be three theses, not three colourways —
> so they route to `claude-cli`. Rebuilds and edits MUST NOT vary, because a
> palette change must never silently redesign a page a client already approved,
> so they route to `archetype-native` or to cached composition. There is no
> single winner; there is a job-to-provider mapping.

The creative director still selects the **visual thesis and information architecture** and writes them into the data path. The composer renders that decision; it does not make it. A provider that ignores the direction is a provider that fails token adherence and thesis-alignment, and the gate says so.

---

## 3. INITIAL REGISTRY

> **AMENDED by A1.1 — the original "wire `kimi-cli` first" is RESCINDED.**

| id | auth | stack | status | blocker |
|---|---|---|---|---|
| `archetype-native` | none | html | **live** | — |
| `claude-cli` | subscription | html \| react-tailwind | **wire first** | — |
| `kimi-cli` | subscription | react-tailwind | **declared** | cost unverified; only permissible on its cheapest qualifying model, and only after a measured cost-per-build comparison |
| `kimi-api` | api_key | react-tailwind | **blocked** | violates the no-credential rule; bills separately from subscription |

**Wire `claude-cli` first.** It already rides the subscription, is already the research brain, is already probed and working, and can compose. The lesson from the external comparison was never "use that specific vendor" — it was **a strong model composing freely beats a template engine.**

Any Kimi involvement in research, preview generation, or media is **POST-SHIP** (A1.2). Do not scaffold adapters for it now beyond a `declared` registry row with its blocker stated.

---

## 4. SCORING — HOW A PROVIDER EARNS THE DEFAULT SLOT

No provider is chosen by reputation. Run the same brief through each registered provider and score with the existing gate:

- WebAIM Six (blocking)
- geometry at 1440 and 390
- contrast
- token adherence (reported, and **zero tokens applied is a hard fail**)
- aesthetic rubric 40/30/30, one isolated judge per dimension
- fact compliance against the packet
- cost and wall time
- **operator verdict** — ship / edit-then-ship / reject

Record the comparison as a normal Build DNA artifact with `measured_at`, `conditions`, and `invalidated_by: ['provider version change', 'recipe change', 'gate threshold change']`.

`archetype-native` is not retired for losing. It stays as the free, deterministic, fully-owned fallback, and it is the only provider guaranteed available when a subscription is down.

---

## 5. CONSEQUENT DECISIONS REQUIRED

### 5a. OUTPUT STACK — **RESOLVED by A1.3: Option C.**

The vanilla-JS rule was ratified for **the console**, to protect sub-100ms click-to-edit. It was never decided for **generated sites**, and one decision has been silently governing both.

Options considered were A (vanilla HTML only), B (React + Tailwind only), and **C (per-site, declared in the spec)**.

**Ruled: C.** `output_stack` becomes a declared spec field, per site. Console editing capability varies by stack and says so honestly. Where the canvas cannot manipulate a stack it declares `edit_support: view_only` rather than silently degrading. Declaring the limit honestly is preferable to pretending.

### 5b. BENCHMARK FACTS — packet schema addendum

The honesty rule that correctly blocks invented facts is also blocking legitimately researchable market facts, and that is the direct cause of 98 of 256 empty sections.

Add a third category alongside `facts[]` and `not_found[]`:

```
benchmarks[] {
  claim         "typical fade pricing in Port St. Lucie runs $25-$35"
  kind          pricing | hours_pattern | service_menu | demographic | seasonality
  sources       [urls, independently re-fetched]
  applies_to    market | category | locality
  display_rule  indicative | range_only | never_as_own_claim
  confidence    high | medium | low
}
```

**The distinction, stated once so it is never blurred:** "this shop charges $30" is a business fact and stays `not_found` until the customer supplies it. "Fades in this market run $25–$35" is a market fact, is researchable, and may appear on a proof as an indicative range clearly marked as such. A benchmark may never be rendered as the customer's own claim.

This also supplies the section types that currently come back empty: pricing, hours patterns, service menus, and demographic-driven structural decisions (a 24% Hispanic locality justifying bilingual copy is a public fact driving a design choice, not a translation).

### 5c. LANE CHANGE

**L1 changes from "build layout archetypes" to "build the composer registry and score providers."** The archetype work already shipped and becomes provider #1. This is less work and lands sooner. Group A verification (A5, A6) still applies, and now applies to every provider rather than to one composer.

---

## 6. WHAT THIS RULING DOES NOT DO

- It does not make Site Studio dependent on any single vendor. That is the point of a registry.
- It does not lower the quality bar. Every provider passes the same gate.
- It does not delegate truth. Research, facts, tokens, and the spec stay Studio's.
- It does not retire `archetype-native`. Owning a free deterministic fallback is what keeps the registry honest.
- ~~It does not resolve 5a.~~ **5a is resolved by A1.3 (Option C).**

---

## 7. UNRELATED DEFECT FOUND WHILE WRITING THIS

Shareable proof links at `famtasticdesigns.com/proofs/share/<id>/<token>` return the generic site meta tags to any non-JS fetch. A customer sharing their proof in iMessage, WhatsApp, or LinkedIn gets a preview card reading "FAMtastic Designs | Agentic AI Business Solutions Engineering Studio" rather than anything about their proof.

Server-rendered per-proof meta (title, description, and an og:image of the first direction) is a small change with an immediate customer-facing effect. **This is a Designs-repo item, not Site Studio.**
