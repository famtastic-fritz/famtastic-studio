# Design: typed research modules, provider registry, and sites-as-projects

**Status:** design only. Nothing below is built. It touches the data model, so it
is written and reviewed before code, per the sequencing ruling.
**Circumstance:** normal.

---

## 0. Why this exists, in one measurement

**98 of 256 requested sections (38%) rendered empty** across the after-set. Every
one was a `text` section asking for a fact the pipeline never gathered:
"Pricing", "Hours table with holiday exceptions", "mechanic bio, years,
certifications", "current typical turnaround stated as a number".

The copy stage was correct — it is instructed to return empty rather than invent
a fact. **Research declared page sections whose facts it never collected.**

One undifferentiated "research stage" cannot fix that, because there is nothing
in it to hold accountable: no part of it *owns* hours, or credentials, or
pricing. Typed kinds make the gap addressable, and the section-supply contract
(§4) turns it from an output warning into a **planning-time contract violation**
— the sitemap planner may not declare a section no scheduled kind can supply.

That is the primary justification. Everything else follows from it.

---

## 1. Research kinds

A registry, one entry per kind, each with its own schema, provider requirement,
downstream consumer, TTL, and `invalidated_by`.

| kind | question it answers | primary consumer |
|---|---|---|
| `entity` | who this business verifiably is | copy, spec identity |
| `industry` | category norms and vocabulary | copy, sitemap planner |
| `competitor` | who else, what they do well and badly | gap_niche, avoid list |
| `gap_niche` | the differentiator (derived from industry + competitor) | copy, hero |
| `visual` | what the category looks like **and the cliché to avoid** | art direction, image prompts |
| `audience` | who buys, what they need to see before booking | sitemap planner, CTA |
| `compliance` | what this profession legally cannot claim | copy guard |
| `local` | service area, landmarks, seasonality | local sections, SEO |
| `seo` | keywords, meta direction | head, meta |

**Two proposed additions, and the reasoning:**

- **`offering`** — services, durations, prices, packages. Splitting this out of
  `entity` is what the measurement argues for: "Pricing" and "Service intervals"
  were among the most common empty sections, and they are not identity facts.
  Without it, no kind owns the single largest empty-section category.
- **`operational`** — hours, booking method, address, parking, contact,
  cancellation policy. Same argument: "Hours table", "Map, hours table, phone,
  and directions footer block" were empty because these belong to nobody. They
  are also the most **stable** facts and the cheapest to cache, so giving them
  their own TTL is a direct build-time win.

**One proposed merge:** `seo` folds into `industry` + `local` rather than
standing alone. Its outputs (keywords, meta direction) are derived from category
vocabulary and service area, and it gathers no independent facts. Keeping it
separate invites a kind that re-asks what two other kinds already know. *Fold it,
but keep `seo_targets` as a derived output.*

**Kinds are `derived` or `gathered`.** `gap_niche` is derived (from industry +
competitor) and must never call a provider — it is reasoning over existing
findings. Derived kinds cannot be scheduled first, and this is enforceable.

### Kind record shape

```
{
  kind: 'operational',
  tier: 'gathered' | 'derived',
  depends_on: ['entity'],
  supplies_section_types: ['hours', 'contact', 'visit', 'policy'],
  schema_ref: 'schemas/research/operational.v1.json',
  provider_requirements: { needs_live_web: true, needs_corpus: false, must_verify_sources: true },
  ttl_days: 120,
  invalidated_by: ['business relocates', 'hours change', 'booking platform change'],
  cost_class: 'cheap'
}
```

---

## 2. Provider registry — same shape as `media-providers.js`

```
{
  id: 'claude-cli',
  serves_kinds: ['entity','industry','competitor','visual','audience','compliance','local','offering','operational'],
  auth: 'subscription',              // subscription | mcp | none — NEVER api_key
  can_verify_sources: true,
  mode: 'discovery',
  cost: { status: 'provider_did_not_report_currency_cost' }
}
{
  id: 'notebooklm',
  serves_kinds: ['industry','competitor','gap_niche','audience'],
  auth: 'mcp',
  can_verify_sources: false,         // it cites a corpus, it does not fetch the open web
  mode: 'synthesis',
  requires: 'a project notebook with sources already added'
}
```

`auth` has the same three legal values as the media registry and **no
`api_key`**, per the 2026-05-05 ruling. A kind whose
`provider_requirements.must_verify_sources` is true **cannot** be assigned to a
provider whose `can_verify_sources` is false — checked at recipe validation, not
at run time. That single rule prevents the most likely misconfiguration: asking a
synthesis engine to establish a fact it can only repeat.

The recipe assigns providers **per kind**, exactly as it assigns brains per
stage, with the same `routing_source` provenance.

---

## 3. The combination is the pipeline, not an either/or

```
claude CLI (discovery)      →   verified sources     →   NotebookLM (synthesis)
finds candidates,               added to the             reads across the whole
fetches each one,               project notebook         accumulated corpus,
promotes only 2xx                                        cites what it used
```

**Breadth then depth.** Discovery is good at finding and proving a source exists;
synthesis is good at reasoning across many sources at once, including ones added
weeks ago. Each position is a slot, so a future custom module can occupy either
without changing the contract.

**The rule that keeps it honest:** a fact may only be promoted to `facts[]` by a
provider with `can_verify_sources: true`. Synthesis output lands in
`synthesis[]` with its citations, and is never silently merged into verified
facts. Two different epistemic statuses, two different fields — the same
discipline as `facts` vs `customer_claims`.

---

## 4. The section-supply contract

**This is the part that closes the 38% loop.**

Each kind declares `supplies_section_types`. The sitemap planner, before
declaring a page section, checks that **some scheduled kind can supply it**.

```
plan.sections = ['hero','services','pricing','hours','reviews']
scheduled_kinds = ['entity','industry','visual']

pricing  -> supplied by 'offering'      NOT SCHEDULED  -> violation
hours    -> supplied by 'operational'   NOT SCHEDULED  -> violation
reviews  -> supplied by NO KIND                        -> unsuppliable
```

Three honest outcomes, and the third matters most:

1. **Schedule the missing kind** and proceed.
2. **Drop the section** from the plan. A page without a pricing section beats a
   page with an empty one.
3. **Declare it `needs_operator_input`** — some facts (real reviews, real
   photos, a licence number) cannot be gathered by any provider at any cost.
   Marking those explicitly is the honest version of what currently renders as a
   hole, and it is the same discipline as `unfilled-pending-human` for imagery.

`SECTION_WITHOUT_COPY` stays as the output-side backstop, but it should approach
zero once the contract runs at planning time. **A defect that fires at planning
time costs a config change; the same defect at render time costs a whole build.**

---

## 5. Sites are projects

A project owns:

```
project/
  site_id, capability_class, deploy_target, tokens
  customer_ref            -> a LINK to the Designs customer record, never a copy
  corpus/
    notebook_id
    sources[]             { url, added_at, verified_at, http_status, sha256 }
    packets[]             every research packet ever produced, by kind, over time
  decisions[]             ADR-style, with R2 circumstance + expiry
  lessons[]               what this project taught
  dna_history[]           every run
  conversations[]
  telemetry{}
```

**`customer_ref` is a link, not a duplicate.** Copying the customer record into
Studio would recreate the exact drift the boundary work just corrected: two
systems of record for identity, diverging silently. Designs owns identity
(doctrine, ADR-0010).

**The corpus grows.** A rebuild extends research; it does not redo it. This is
the compounding asset — in year three MBSH's notebook knows the committee's
history and what worked at the 25th, and no generator without a corpus can
produce that.

---

## 6. TTL and caching — for research AND copy

Revised per the measurement that copy, not research, is now the dominant cost.

**Research caching, per kind.** A rebuild re-runs only expired kinds:

| kind | ttl | why |
|---|---|---|
| `entity` | 365d | identity facts barely move |
| `operational` | 120d | hours and address change occasionally |
| `compliance` | 180d | regulations move slowly |
| `offering` | 90d | prices and packages drift |
| `local` | 180d | |
| `industry` | 90d | |
| `visual` | 60d | category aesthetics move faster than facts |
| `competitor` | 30d | goes stale fastest |
| `gap_niche` | derived | recomputed whenever either input changes |

**Copy caching, which is the bigger lever now.** Copy is 54.5s of a 351s build
and was 425s before parallelism. The cache key is content-derived:

```
copy_cache_key = sha256(
  instruction, section.type, business.name, business.voice_anti_patterns,
  avoid_list, facts_referenced_by_this_section
)
```

A rebuild that changes only the palette re-renders every page and **re-writes no
copy**. A section whose instruction and supporting facts are unchanged keeps its
body. This is invisible today because nothing caches, and it is worth more than
any model-routing change: the fastest CLI call is the one not made.

**Both caches carry `invalidated_by`, not only a TTL** — see §7.

---

## 7. `invalidated_by`, generalized

The pattern proved on measurements applies to everything with a shelf life. A
timestamp expires on *time*; `invalidated_by` expires on *events*, which is how
things actually go stale. "Research is 99%" did not age out — it was invalidated
the moment a stage was added.

**The general shape:**

```
{
  value: <the thing>,
  established_at: <ISO>,
  expires_at: <ISO | null>,        // time-based shelf life, may be null
  invalidated_by: [<event>, ...],  // structural triggers
  superseded_by: <ref | null>
}
```

Applied:

| artifact | expires_at | invalidated_by |
|---|---|---|
| measurement | 14d | a model-backed stage added or removed; concurrency changed |
| research kind | per-kind TTL | a new competitor appears; the business relocates; site redesign |
| token audit | none | tokens change; the composer changes |
| screenshot baseline | none | the renderer version changes; viewport set changes |
| ruling | only if `circumstance != normal` | **the circumstance that produced it ends** |
| copy cache entry | none | instruction, avoid list, voice, or a referenced fact changes |
| capability record | 90d | the underlying provider or CLI version changes |

**The ruling row is the one that would have mattered.** The preview-ownership
ruling was made because Studio was down. It should have carried
`invalidated_by: ['Site Studio returns to service']` — and Studio returned to
service. The event fired. Nothing was watching, so an outage workaround became a
boot invariant instead.

**Implementation note:** `invalidated_by` entries should be *checkable* where
possible (`studio_uptime_days > 7`) rather than prose, so a sweep can fire them
rather than a human remembering. Prose is acceptable as a starting point; a
checkable predicate is the goal.

---

## 8. The avoid list is structural

A **required** output of `visual` and `gap_niche`, never optional, consumed by
**both** the copy stage and the image-prompt stage.

```
avoid: {
  visual: ['lavender-and-white gradient', 'stock hands-on-shoulders massage',
           'lotus flower iconography'],
  language: ['pamper', 'indulge', 'luxurious escape', 'oasis', 'me time'],
  structural: ['testimonial carousel above the fold'],
  source: 'competitor scan of 6 local skincare sites, 2026-08-25',
  invalidated_by: ['a new competitor enters the local set']
}
```

**It must be research-derived, never prompt-derived.** A hardcoded avoid list is
our taste; a derived one is evidence about *this category in this place*. Kim
Chang Suk produced "avoid the salon-industry cliché" by accident, once. Making it
structural is what turns that accident into the anti-generic mechanism.

**Enforcement:** the copy stage already rejects a body that echoes its
instruction. It gains a second check — a body containing an avoided phrase is
rejected the same way. The image-prompt stage appends the visual avoid list as
negative direction.

---

## 9. Two telemetry metrics this makes possible

**Research utilization** — the fraction of verified findings carrying a
`design_use` that actually appear in the output. This is a direct measure of the
*computed-then-not-consumed* failure class, which is one of the two shapes nearly
every defect here has taken. **It would have caught the outline defect and
brand-by-luck automatically**, because in both cases the utilization rate would
have collapsed while every gate stayed green.

**Edit location** — which sections the operator edits before shipping. If every
hero gets rewritten, the copy stage is weak on heroes. This is Rung 3 fed by real
signal rather than a self-assigned score.

---

## 10. Migration and sequencing

Nothing here is a rewrite; every step is additive and reversible.

1. **Kind registry + section-supply contract, reporting only.** Run it against
   existing plans and report violations without blocking. Cheap, and it measures
   the real size of the gap before anything changes.
2. **Split `entity` into `entity` + `offering` + `operational`.** The three kinds
   the measurement most demands.
3. **Provider registry + recipe routing per kind**, with the
   verification-capability rule enforced at recipe validation.
4. **Project record**, with `customer_ref` as a link. Back-fill from existing
   sites; a site with no corpus is a project with an empty one.
5. **Caching, copy first** — it is the bigger lever and does not need the corpus.
6. **NotebookLM synthesis position**, once the corpus has something in it.
7. **Section-supply contract flips to blocking** once violations are near zero.

**Open questions for Fritz** — none blocking; recorded so they are not lost:

- Should `needs_operator_input` sections render as a visible placeholder for the
  operator only, or be omitted from the page entirely?
- Does a project's corpus survive a site being deleted? (I would keep it — the
  research is the expensive part.)
- One notebook per project, or one per kind within a project?
