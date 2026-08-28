# Legacy salvage sweep — 2026-08-23

**Type:** strictly time-boxed (~30 min), read-only salvage. **Framing:** Site Studio is the authority on what a build needs; everything below is evidence to steal from, not a spec to follow (decision D8). Nothing was called, started, or dispatched in the live FAMtastic Designs proof pipeline; no writes were made anywhere except this one file. Prior trace read first: `docs/research/legacy-input-recipe-2026-08-23.md` (this repo) — it explicitly left `prompts/v1/` and `provider_pipeline.py` unread; that gap is what this sweep closes.

---

## 1. `website-delivery-swarm` — prompt patterns and enrichment tricks worth stealing

Location: `~/Development/FAMtastic/worktrees/shay-website-delivery-swarm/website-delivery-swarm/`. There are **two separate driver scripts** in this worktree and they use the prompt material differently — this matters for anyone reusing it:

- `provider_pipeline.py` (main, mtime 2026-08-22) is the **live generator**. It builds full prompts as inline f-strings and pipes them straight into `codex exec` / `claude -p` subprocesses.
- `autonomous_pipeline.py` (mtime 2026-08-22) is a **packaging/audit step**. Its `prepare()` function reads *already-generated* JSON out of a prior `--artifact` directory (`load(artifact / source_name)`, line 341) and writes ledger entries that quote `prompts/v1/*.txt` as the nominal prompt label for the record — it does not send them to a model itself in this path (`autonomous_pipeline.py:333-345`).

So the three short files under `prompts/v1/` (`research-synthesis.txt`, `creative-direction.txt`, `visual-review.txt`, each a single ~350-500 byte paragraph) are **not** the operative prompts — they're a condensed charter used for record-keeping. The real prompts are the long f-strings in `provider_pipeline.py`. Findings below draw from both, labeled accordingly.

### 1.1 Fetch real sources before the model ever sees the request — fail closed if it can't

`provider_pipeline.py:247-249,251` (`fetch_live_references`):
```python
def fetch_live_references(intake: dict, output: pathlib.Path, ledger: Ledger) -> dict:
    """Fetch intake references now so live research cannot be inferred from citations alone."""
    ...
    require(len(references) >= 3, "Fresh live research requires at least three HTTPS reference sources")
```
Every reference URL is `curl`'d deterministically (status, content-type, byte count, SHA-256 recorded per source) *before* the research-stage prompt is built, and the run hard-fails if fewer than 3 succeed. Then `provider_pipeline.py:535-538` (`research_prompt`):
> "Use web search now. Begin with the independently fetched source-verification record... Prefer official university, government, accessibility, and primary sources. Do not invent business facts, prices, reviews, permits, availability, claims, or domain results. Every finding needs a direct HTTPS source URL and a design-use explanation. Mutable facts must be marked mutable."

**Verdict: STEAL THIS.** This is the mechanism that could make "specificity from thin input" true rather than model confabulation — it forces the model to ground in fetched, hashed, verifiable sources instead of general knowledge. Caveat worth flagging: the actual production Rattler run the prior trace found had an *empty* `telemetry.prompt_snapshot` and a name-only prospect record — i.e., whatever ran for that specific campaign either predates this grounding step or bypassed it. This is what the tool is supposed to do now, not confirmed proof of what produced that one historical artifact.

### 1.2 Force differentiation with a named-technique menu, then verify uniqueness in code, not just in the prompt

`provider_pipeline.py:550` (`direction_prompt`, sent to Codex):
> "Every visual_system must explicitly name (1) a display-typography composition technique beyond bold/color/italic, such as outlined, layered, interlocked, condensed-versus-serif, vertical, kinetic, dimensional, or editorial type; (2) a subject-native pattern or texture system applied to backgrounds and containers; and (3) a depth system using borders, embossing, shadows, translucent layers, material edges, or lighting... Reuse of proven components, grids, and interaction patterns is allowed when adapted to this subject; wholesale cloning of a prior site is not."

The short-form version of the same rule, `prompts/v1/creative-direction.txt:1`:
> "Color swaps of one template fail."

And it isn't left to the model's word — `provider_pipeline.py:304,313` (`validate_directions`, runs after the model returns):
```python
require(len({item["slug"] for item in directions}) == 6, "Direction slugs must be unique")
require(len({item["information_architecture"] for item in directions}) == 6, "Information architectures must be unique")
```

**Verdict: STEAL THIS.** The combination is the point: give the model a concrete menu of named techniques instead of "be creative," then check for accidental sameness in code (set-uniqueness on the IA string) rather than trusting the model's claim of distinctness.

### 1.3 Independent reviewer: triage from a contact sheet, reject on a named smell-list, gate on an executable numeric bar

`provider_pipeline.py:634` (`review_prompt`, sent to Claude):
> "You are an independent release reviewer. You did not create this work. Inspect the desktop and mobile contact sheets... first; open an individual direction screenshot only when the contact sheet reveals a possible defect... Reject any direction whose typography is only generic bold/color/italic treatment, whose surfaces lack visible subject-native pattern/texture/depth, whose symbolism could fit an unrelated business, or whose layout is merely a recolored template. Also reject poster-like pages, clipped mobile layouts, weak copy, illegible contrast, pristine-form failures, inaccessible rails, or unclear conversion... Set reviewer.provider anthropic, reviewer.model to the exact model you are running, independent true..."

The bar is not just prompt text — it's re-checked as code, `provider_pipeline.py:495,503` (`visual_pass`):
```python
def visual_pass(review: dict):
    return (
        review.get("release_decision") == "pass"
        ...
        and all(item.get("overall", 0) >= 8 and all(score >= 7 for score in item.get("scores", {}).values()) for item in review["directions"])
    )
```

**Verdict: STEAL THIS.** Three separable tricks worth lifting independently: (a) "you did not create this work" framing to break sycophancy, (b) contact-sheet-first triage so the reviewer only pays per-image attention cost where a defect is suspected, (c) forcing the model to self-report its own exact model identity into the structured output for the audit trail, then never trusting the model's own pass/fail claim — recomputing the gate from its per-dimension scores in code.

### 1.4 CLI invocation contract: schema-locked output, scoped tools, hard per-call budget, full ledger

`provider_pipeline.py:148-153` (`claude_review`):
```python
command = [
    "claude", "-p", "--model", CLAUDE_MODEL, "--effort", "high",
    "--allowedTools", "Read", "--add-dir", str(output), "--json-schema", schema,
    "--output-format", "json", "--max-budget-usd", "8", prompt
]
```
Every call (`codex_json` at :133, `claude_json` at :177, `claude_review` at :148) writes one `ledger.record(...)` entry with the literal prompt, given/returned payloads, cost, usage, and boolean assertions (e.g. `"provider_exit_zero"`, `"structured_output_valid"`, `"independent_provider"`).

**Verdict: STEAL THIS.** `--json-schema` + `--output-format json` forces structured output at the CLI boundary instead of parsing prose; `--allowedTools` scopes exactly what each stage may touch (the reviewer gets `Read` only); `--max-budget-usd 8` is a hard per-call cost ceiling, not just a global one; and every call becomes one auditable ledger row. This is a clean, generic pattern for any CLI-subprocess-based agent pipeline, independent of the creative-writing content.

### 1.5 Bounded repair: one consolidated pass, skip if nothing changed

`provider_pipeline.py:513,518`:
```python
parser.add_argument("--max-repairs", type=int, default=1)
...
require(0 <= args.max_repairs <= 1, "Preview release permits zero or one consolidated repair cycle")
```
`references/six-direction-benchmark-contract.md` (final paragraph):
> "Speed is governed by bounded review, not by weakening the gate. The default preview budget is one initial independent review, one consolidated repair, and one post-repair review only when rendered artifact hashes changed. Unchanged work reuses its recorded verdict."

Repair prompts (`provider_pipeline.py:624,642`) are scoped hard: *"Do not touch unflagged sites unless needed for a shared critical defect"* / *"Do not weaken a bold direction into a generic template."*

**Verdict: NOTE ONLY.** Good operational discipline (cap iteration at 1, hash-gate re-review, explicitly forbid the repair pass from regressing quality to pass the gate) but it's a cost/process control rather than a prompt technique — worth keeping in mind if a review-and-repair loop gets built, not something to lift verbatim.

### 1.6 The `prompts/v1/*.txt` one-liners themselves

`prompts/v1/research-synthesis.txt:1`, `prompts/v1/creative-direction.txt:1`, `prompts/v1/visual-review.txt:1` — full text quoted in 1.2/1.3 above plus:
> "Never invent a price, credential, statistic, legal status, testimonial, schedule, domain result, or affiliation." (research-synthesis.txt)

**Verdict: NOTE ONLY.** These read as a compressed summary of the same rules the long `provider_pipeline.py` prompts spell out in full (the ">=7 / >=8" numbers match exactly between the two). Good as quotable north-star lines for a style guide or contract doc; not to be mistaken for a complete working prompt on their own — see the caller-mismatch note at the top of this section.

**What I did not look at in this codebase:** `library/`, `pilots/`, `benchmarks/`, `config/`, `schemas/`, `provider-schemas/`, `provider_resume.py`, `resume_provider_pipeline.py`, `template_library.py`, `human_tester.py`, `engine.py`, `prove.mjs`, `gemini_flash_lite_image_worker.mjs`, `tests/`, and the `make_brief_and_architecture` / `stage_design_fonts` helper bodies in `provider_pipeline.py`. The image-prompt generation instructions embedded in the direction JSON schema were not read either.

---

## 2. Old vNext build engine — bounded branch search

**Branch found:** `feature/site-studio-runtime-vnext-closeout` (only branch matching vnext/build-engine/runtime search terms out of the full `git branch -a` list). Diverged from `main` at `798c9bb0`; last commit `659e8f24` (2026-07-31, "docs(site-studio): document immutable deployment target"); 34 commits ahead of the merge-base; **not merged into main** (`git branch --merged main` does not list it). Not checked out in any attached worktree — read entirely via `git show <branch>:<path>`.

### 2.1 Headline correction to the task's premise: main is not the smaller version

Raw counts: the branch's `site-studio/runtime-vnext/` has 94 tracked files and **2** family-runner implementations (`families/deterministic-tool-runner.js`, `families/text-model-runner.js`). Main's `site-studio/runtime-vnext/` has 191 tracked files and **32** family-runner implementations (`research-runner.js`, `architecture-decider-runner.js`, `creative-director-runner.js`, `design-token-runner.js`, `component-selector-runner.js`, `custom-component-builder-runner.js`, `page-builder-runner.js`, `page-copy-runner.js` + `page-copy-shay-runner.js`, `logo-runner.js` + `logo-shay-runner.js`, `media-planner-runner.js`, `media-generation-runner.js`, `stock-media-runner.js`, `shared-assets-runner.js`, `seo-pack-runner.js`, `sitemap-planner-runner.js`, `assembly-runner.js`, `js-behavior-runner.js`, `pwa-runner.js`, `content-qa-runner.js`, `content-repair-runner.js`, `structural-qa-runner.js`, `browser-qa-runner.js`, `visual-critic-runner.js`, `proof-curator-runner.js`, `gap-logger-runner.js`, `repo-bootstrap-runner.js`, `config-scaffold-runner.js`, `netlify-staging-deploy-runner.js`, `prod-deploy-router-runner.js`, `assembly-runner.js`).

This isn't two independent lineages — main's code says outright that it absorbed the branch. `site-studio/server.js:27-29`:
> "// Operator V1 — durable deployment jobs + the deploy subprocess runner\n// (ported from feature/site-studio-runtime-vnext-closeout; see those modules\n// for the immutable-target contract)."

`site-studio/server.js:311-312`:
> "// runtime-vnext is the only build engine. Site Studio sends capability requests\n// to Shay; it never retains a legacy provider-owned execution escape hatch."

**Verdict: the branch is not a hidden fuller engine sitting unmerged.** It's the earlier, contract-first phase of the same effort; its distinctive contributions (deploy-runner immutable-target contract, the V1 build route) were ported into main by name, and main then built out 30 more family runners past where the branch stopped. Anyone reaching for this branch expecting undiscovered build capability will not find it — what's there instead is process rigor that didn't fully survive the port (2.2) and a safety pattern main has since graduated past needing (2.3).

### 2.2 What the branch had that main appears to have dropped: per-artifact JSON Schema contracts

Branch `contracts/` (20 schema files): `build-request.schema.json`, `page-manifest.schema.json`, `component-plan.schema.json`, `media-plan.schema.json`, `qa-report.schema.json`, `deploy-report.schema.json`, `verification-report.schema.json`, `design-token-pack.schema.json`, `architecture-decision.schema.json`, `content-packet.schema.json`, `js-behavior-plan.schema.json`, `proof-report.schema.json`, `build-assembly-manifest.schema.json`, `seo-pack.schema.json`, `template-copy-record.schema.json`, `transform-record.schema.json`, `common.schema.json`, `html.schema.json`, `page-instance.md`, `page-types.md`.

Main `contracts/` (9 files, 0 of them `*.schema.json`): `README.md`, `execution-families.md`, `fam-dna-assets.js`, `migration-policy.md`, `model-runner.md`, `nav-vocabulary.js`, `project-context.md`, `recipe-dsl.md`, `state-authority.md`.

The branch's own Definition of Done named this explicitly, `COMPLETION-PLAN.md` (branch):
> "D8 | Contract schemas validated at every stage handoff | Schema-invalid artifact fails the run naming the field path"

**Verdict: STEAL THIS (worth verifying first).** If the greenfield pipeline doesn't already validate every stage's output against a JSON Schema before the next stage consumes it, this is a concrete, scoped, previously-implemented gap to close — 20 ready-made schema shapes existed for exactly this purpose at one point. I did not open any of the 20 schema files to check their contents, and I did not check whether main validates stage handoffs some other way (e.g. inline `require()` assertions instead of schema files) — that's the next thing to check before assuming this is a true gap rather than a relocation.

### 2.3 Shadow/strangler safe-migration pattern (main has since graduated past it)

`harness/reports/m12-shadow-proof.md` (branch, full file read):
> "M12 delivered a bounded, working Site Studio build path through runtime-vnext for both single-page and multi-page sites. The path does not use `claude -p` or `spawnClaude` as the orchestration backbone. Legacy `sites/<TAG>/dist/` remains untouched; vNext publishes to `sites/<TAG>/dist-vnext/`."
> "Comparison artifact generated per shadow run with verdict contract: `match`, `mismatch`, `incomplete`, `blocked`."

**Verdict: NOTE ONLY.** Main's `server.js:311` already declares runtime-vnext the sole build engine, so the specific old-vs-new dual-write-and-diff mechanism is no longer load-bearing there. But `characterization-harness.js`, `compare-runs.js`, and `generate-parity-report.js` are still present on main (`site-studio/runtime-vnext/harness/`) with newer reports (`gate4-parity-final.md`, dated 2026-08-10, well after this branch's last commit) — so the lineage continued independently on main rather than being abandoned. The reusable idea for the future — isolate a new engine's output to its own path and compute an automatic match/mismatch verdict rather than eyeballing diffs — is worth keeping in back pocket for the *next* engine swap, not for right now.

### 2.4 A documented, hard-won bug catalog (worth remembering even without the code)

`COMPLETION-PLAN.md` (branch, revision 4, "after Codex adversarial rounds 1 (17), 2 (12), and 3 (6). All 35 complaints accepted and incorporated."):

> "The actual defect, verified against the pre-fix code: only `$&`, `` $` ``, `$'`, and `$$` were corrupted... the old loop re-scanned already-substituted text, so a resolved value that itself looked like a template was substituted again, producing out-of-order output."
> "This bug was described from reading the code three times and got a different wrong answer each time. It was settled only by executing the old and new engines side by side."

Also named as live defects at the time: an abort-listener leak on the timeout path (`runner.js:295-297`, listener not removed and in-flight provider call never aborted), a stub OpenAI image adapter that always throws, a documented "→ Ollama" fallback with no registered target, and Gemini/Codex adapters that ignore `abortSignal` entirely.

**Verdict: NOTE ONLY.** Not code to port — a pre-flight checklist. Three concrete, transferable lessons for whoever owns the greenfield engine's own templating/expression layer and provider adapters: (1) test string-interpolation against literal `$&`/`$$`/`$'`/`` $` `` in values, a classic `String.prototype.replace` special-pattern trap; (2) don't re-scan already-substituted output in a template loop; (3) don't trust code review alone for this class of bug — run old and new side by side and diff the actual output.

### 2.5 Declarative recipe DSL and provider-neutral execution families

`contracts/execution-families.md` (branch, "FROZEN 2026-07-22"): five families — `TextModelRunner`, `ImageGenerator`, `ImageEditor`, `BrowserCapture`, `DeterministicToolRunner` — each with a fixed input/output shape, a provider-adapter registry (`ModelRunnerRegistry.register('TextModelRunner', 'anthropic', AnthropicTextAdapter)`), and a default timeout/retry table (e.g. TextModelRunner: 180s timeout, 2 retries, stage-owned).

`contracts/recipe-dsl.md` (branch): stages authored in YAML with `needs` (dependencies), `foreach` (fanout), `guard` (conditional skip), `compensation` (failure-handler stage), and `on_failure: fail_fast|continue`.

The plan document itself flags the trap here, `COMPLETION-PLAN.md` §0.1 (branch):
> "The original Phase 5 list — architecture, content, design tokens, components, media, SEO, QA, deploy, proof — are **recipe stages** authored in YAML against those five families, not new runtime subsystems."

**Verdict: NOTE ONLY.** I did not verify whether main's 32 `*-runner.js` files are still organized as YAML-authored stages against these same 5 provider-neutral families, or whether that abstraction eroded as the runner count grew — that would require reading `main`'s `recipes/` YAML and a sample of the runner files, which is exactly the "reading the whole engine" this sweep was told not to do. Flagging the abstraction as something that existed, deliberately, and was warned against being confused with a bigger stage count — worth a follow-up read of `site-studio/runtime-vnext/recipes/*.yaml` on main before assuming it's intact or assuming it's gone.

**What I did not look at:** any family-runner `.js` implementation (branch or main), any `harness/*.js` script body, any `lib/*.js` implementation file, the other ~13 markdown briefs in the branch's `runtime-vnext/` root (`CAPTAIN-BRIEF.md`, `M12-SHADOW-STRANGLER-BRIEF.md`, `SITE-STUDIO-MODULAR-REWRITE-*.md`, etc.), the rest of `COMPLETION-PLAN.md` past its first ~100 lines (it is long — revision 4 after three adversarial rounds), the 20 schema files' actual field definitions, `main`'s `recipes/*.yaml`, `main`'s newer `gate4-parity-*.md` reports, and `LEGACY-AUDIT.md` on main (title suggests it may already cover adjacent ground — not opened). Other branches glanced at only by name, not content: `site-studio-extract`, `v2-source`, `consolidate/autonomous-flows`, `feature/prompt-to-completion-pipeline` — these matched no vnext/build-engine/runtime keyword and were not opened.

---

## Time-box accounting

Elapsed at write-up: ~9 minutes of investigation (two `date +%s` checkpoints spanning the full sweep, well inside the 30-minute box), plus this write-up. Stopped by scope discipline, not by running out of the clock — both targets hit a natural "establish what exists, don't read the whole thing" boundary before the 30-minute mark.
