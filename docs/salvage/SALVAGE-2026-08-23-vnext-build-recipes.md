# Salvage: vNext build recipes and the agent/telemetry process

**Time box:** 30 minutes, honored. Search ended once the load-bearing artifacts
were found and read.
**Where it was:** `~/Development/FAMtastic/worktrees/shay-website-delivery-swarm/artifacts/website-delivery-swarm/`
**Not where expected:** the `famtasticdesigns` repo itself carries no build
recipes or agent process docs. Its only `recipe*` hits are Drupal core recipes,
which are unrelated. The identifiers from campaign 22's telemetry
(`famtastic-proof-local-promotion`, `website_proof.generate.v1`,
`autonomous_pipeline.py`) return zero hits anywhere on this machine, so that
specific generator is not recoverable here. The delivery-swarm artifacts are.

Seven campaign runs are present, including the three whose output was strong:
`rattler-football-fan-portal-fresh-20260819-001`, `the-set-club-fresh-20260819-001`,
`famu-corner-20260818`, plus `bossy-nails-by-pri`, `good-ole-candy-lady-shop`,
`palm-pepper`, `fort-pierce-black-church-six`.

---

## 1. The record correction is independently corroborated here

`website-build-brief.v2.json` for the Rattler run carries:

```json
"classification": "fresh_provider_executed_heldout_benchmark",
"customer": {"name": "Fritz Medine", "email": "fritz.medine@gmail.com"}
```

and

```json
"publication_boundary": {
  "external_mutation_allowed": false,
  "site_studio_execution_claimed": false
}
```

These were held-out benchmark runs against Fritz's own identity, explicitly
marked as not published and not claiming Site Studio execution. This is
independent corroboration of the record correction: they were never customer
deliveries.

## 2. The seam artifact already exists in prototype

Stage 34 and 38 of the Rattler run are `site-studio-packet`, emitted by
`autonomous_pipeline.py` deterministically in ~1.4s. The pipeline already
understood that its job ends at handing Site Studio a packet.

`website_build_brief.v2` is the precursor to the Selected Build Packet, and it is
richer than what was specified. Its fields:

| Field | Content |
|---|---|
| `schema`, `request_id`, `generated_at` | versioned identity |
| `classification` | benchmark vs real, the flag item 1 asks for |
| `customer` | name, email, `account_state` |
| `business` | name, industry, location, ownership_context, goal |
| `audience` | 5 segments |
| `brand` | status, `famtastic_scale`, and four explicit *contracts*: creative, typography, surface, reuse_policy; plus desired_feeling, required_symbols, avoid |
| `scope` | preview_pages, future_pages, features |
| `research_context` | business_context, **27 findings** each with `source_url`, `source_title`, `source_type`, `design_use`, `mutable`; plus creative_opportunities |
| `direction_contracts` | 6 directions, each with slug, mode, `famtastic_level`, strategy, information_architecture, visual_system, conversion_path, sections, `copy_seed` |
| `facts_requiring_confirmation` | 12 |
| `constraints` | 8 |
| `commercial_boundary` | sku, price, `checkout_allowed` |
| `publication_boundary` | `external_mutation_allowed`, `site_studio_execution_claimed` |

**Patterns worth stealing directly:**

- **`design_use` on every research finding.** Each fact states how it should be
  used in the design. Our packet's `facts[]` carries the claim and the verified
  source but never says what it is *for*. This is the single biggest quality
  lever in the file.
- **`mutable: false`** per finding: which facts the builder may not reword.
- **Brand expressed as *contracts*, not adjectives.** "Typography must be
  composed as artwork. Every direction needs a named..." is an instruction a
  builder can be held to. Our `palette_direction` prose is weaker.
- **`famtastic_scale` / `famtastic_level`** as a numeric dial per direction
  (restrained → medium → ultra), which is what produced the deliberate range.
- **`facts_requiring_confirmation`** as a first-class field, distinct from open
  questions.
- **`publication_boundary`** as an explicit machine-readable non-claim.

## 3. The agent/telemetry process: `famtastic.stage-journal.v2`

`agent-ledger.json` is a flat ordered list of stage records. Per record:

```
schema, task_id, order, stage, provider, model, execution_class,
attempt, fallback_used, started_at, completed_at, duration_ms,
asked_verbatim, given_verbatim, returned_verbatim,
input_sha256, output_sha256, command[], usage, cost, assertions{}, status
```

Notes that matter:

- **`execution_class`** distinguishes `cloud_provider_executed` from
  `deterministic`. Our DNA has no equivalent.
- **`asked_verbatim` / `returned_verbatim` plus input/output sha256.** This is
  exactly the raw-response retention gap logged as open in SITE-LEARNINGS. The
  prior system solved it and we regressed from it.
- **`usage` and `cost` record honest non-reporting** (`provider_did_not_report`,
  `provider_did_not_report_currency_cost`) rather than zero or null. Matches our
  A4 explicit-zero discipline.
- **`attempt` and `fallback_used`** are first-class, which is what makes a retry
  loop legible after the fact.
- **`assertions{}`** per stage: the stage states its own pass conditions.

## 4. The stage shape of the run that produced the good output

38 stages, ~75 minutes of provider time. The shape, not the count, is the lesson:

```
provider-preflight-codex        (cheap AUTH_OK gate before any real spend)
provider-preflight-claude
live-source-fetch               (grounding fetched BEFORE research)
live-research                   (claude-opus-5, 355s)
creative-direction              (gpt-5.6-sol)
visual-art                      (gpt-5.6-sol, 422s)
prototype-construction          (gpt-5.6-sol, 603s)
  -> browser-qa FAILED
  -> technical-repair
  -> browser-qa FAILED
  -> bounded-technical-finalization (deterministic, 14ms)
  -> browser-qa PASSED
  -> visual-review (claude-haiku)
  -> prototype-repair
  ... loop repeats 7 more times ...
site-studio-packet              (deterministic, 1.4s)
```

**Three patterns to steal:**

1. **Provider preflight before spend.** Two ~6s auth checks gate ~75 minutes of
   provider work. Cheap insurance we do not have.
2. **Grounding before research.** `live-source-fetch` runs *before*
   `live-research`, so the model reasons over already-fetched sources rather than
   searching blind. Our research module searches first and verifies after. Both
   are defensible; theirs likely produces better grounding, ours produces
   stronger verification. Worth combining.
3. **The repair loop is the product.** `browser-qa` failed three times and the
   pipeline repaired and re-ran until green, alternating a cheap deterministic
   finalization pass (12ms) with expensive model repair. The quality did not come
   from one good generation, it came from **loop-until-green with executable
   gates**. This is the most important finding in this document.

## 5. Executable quality gates: `famtastic.quality-report.v2`

17 boolean technical assertions, all machine-checkable, all true on the final
artifact:

```
exact_six_directions, exact_fourteen_route_profiles,
twelve_direction_screenshots, desktop_width_1440, mobile_width_390,
all_routes_passed, no_mobile_overflow, no_external_runtime_assets,
no_console_or_page_errors, no_heading_word_fragmentation,
no_inaccessible_scoped_horizontal_scrollers, number_contrast_passed,
focus_indicator_contrast_passed, no_number_heading_collisions,
solid_surface_text_contrast_passed, forms_begin_neutral_and_do_not_submit,
no_inline_event_handlers
```

Plus a separate `visual` block from a model reviewer with its own
`famtastic.visual-review.v1` schema and named reviewer provider/model.

**The split is the lesson:** technical quality is asserted deterministically and
cheaply; aesthetic quality is judged by a model and recorded as a *separate,
attributed* opinion. They are never conflated into one score.

## 6. What this changes in the roster spec

Direct inputs to the Build Agent Roster (item 5b):

- Add `provider-preflight` as stage 0.
- Every stage record carries `execution_class`, `attempt`, `fallback_used`,
  `asked_verbatim`/`returned_verbatim` + hashes, honest `usage`/`cost`, and its
  own `assertions{}`.
- The verifier is two agents, not one: a deterministic technical asserter and an
  attributed visual reviewer.
- The pipeline must support a bounded repair loop, not a linear pass.
- Interleave a cheap deterministic finalization pass between expensive repairs.
