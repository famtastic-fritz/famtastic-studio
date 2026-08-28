# Legacy proof pipeline: exact model input recipe

**Date:** 2026-08-23 | **Type:** read-only investigation | **Scope:** what the legacy proof pipeline feeds a model, so a like-for-like re-run is possible

**Hard constraint honored:** this investigation only read code and read-only production data (via `drush sqlq` over the existing SSH key). Nothing was called, started, configured, or dispatched in the live FAMtastic Designs proof pipeline. No writes were made anywhere in production.

---

## 0. Headline finding — read this before anything else

There are **two completely different systems** that have both produced "proof" output for FAMtastic Designs, and the six named creative directions in the example the task asked about ("The Rattler Field Guide") **did not come from the pipeline the task's known entry points describe.** They came from a third, unrelated system. Details in §3 and §5; this matters enormously for any like-for-like comparison — see §6.

| System | What it produces | Model call | Prospect data it needs |
|---|---|---|---|
| **A. Site Studio proof-jobs route** (`server/famtastic-proof-job-routes.js`, `server.js` `generateProofCampaign`/`generateProofArtifact`) | 3 generic directions (`a`/`b`/`c`, labelled "Bold and Modern" / "Trusted and Professional" / "Local and Approachable" by the route, or "Safe"/"Wild"/"OMG" if driven by the Drupal contract) | One CLI process per HTML document, via `shay -z "<prompt>" --ignore-rules` | Whatever is in `payload.prospect` — degrades to generic copy if empty |
| **B. Drupal `ProofCampaignService::createForProspect` image-free pilot** | 3 deterministic template pages, direction names literally `Safe`/`Wild`/`OMG` | **None.** Pure PHP string templates keyed on `business_category` | `business_name` only; category-based branching falls through to a generic default when category is `NULL` |
| **C. `website-delivery-swarm` six-direction benchmark** (`worktrees/shay-website-delivery-swarm/website-delivery-swarm/`) | 6 named creative concepts ("The Rattler Field Guide", "The Season Coil", …), each a full responsive site with distinct IA, artwork, copy | `codex exec -m gpt-5.6-sol` (generation) + `claude -p --model opus --effort high` (review), both invoked as local CLI subprocesses | `business_name` only — the richness is **model-invented**, not enrichment data |

Production evidence (read via SSH, see §5) proves campaign `pc-rattler-football-fan-portal-7323201e5fea183a` (id 21) was produced by **System C**, not System A or B, and that its source `famtastic_prospect` row (id 29) has `business_category`, `business_description`, `service_area`, `public_phone` all `NULL` — genuinely name-only plus Fritz's own email. So: **the creative richness is not hidden enrichment data the prospect table is missing. It is the model itself inventing a research-grade concept from a bare business name**, done by a system (C) that the task's stated entry points do not include.

The rest of this document gives the full input recipe for **all three systems**, since reproducing "what legacy does" requires knowing which of the three you mean.

---

## 1. System A — Site Studio proof-jobs route (the task's primary named entry point)

### 1.1 Model / provider / invocation

Entry point: `POST /api/integrations/famtastic/proof-jobs` in `server/famtastic-proof-job-routes.js:274-289`, wired in `server.js:1173-1181`:

```js
const { registerFamtasticProofJobRoute } = require('./server/famtastic-proof-job-routes');
registerFamtasticProofJobRoute({
  app,
  generateCampaign: generateProofCampaign,      // server.js:1177
  renderThumbnail: renderProofThumbnailHtml,     // server.js:1178
  ...
});
```

`generateProofCampaign` (`server.js:4751`) loops over each direction and calls `generateProofArtifact` (`server.js:4611`), which calls the model **twice per direction** (template pass + page pass, occasionally a third retry pass):

```js
// server.js:4622-4626 — pass 1, the shared template/header/footer
const rawTemplate = await completeWithShay(templatePrompt, { timeoutMs: 300000 });
...
// server.js:4646-4649 — pass 2, the actual page content
const rawPage = await completeWithShay(pagePrompt, { timeoutMs: 300000 });
...
// server.js:4661-4665 — conditional pass 3, only if content verification fails
const retryRawPage = await completeWithShay(buildStrictContentRetryPrompt(pagePrompt, contentCheck.failures, proofSpec), { timeoutMs: 300000 });
```

`completeWithShay` (`server.js:19614-19618`):

```js
function completeWithShay(prompt, opts = {}) {
  shayProvider.assertNoReasoningAuthority(opts, 'completion');
  const { timeoutMs = 120000, systemPrompt = null } = opts;
  const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  return shayProvider.complete(combinedPrompt, { timeoutMs, label: 'shay' });
}
```

`shayProvider.complete` (`lib/brain/shay-provider.js:96-153`) is the actual model call:

```js
child = spawn(process.env.SHAY_BIN || 'shay', ['-z', prompt, '--ignore-rules'], {
  cwd: os.tmpdir(),
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
```

**How:** a local CLI subprocess (`shay -z <full prompt as a single argv> --ignore-rules`), not an SDK or a direct HTTPS call to any model API. `-z` is a one-shot flag; the whole model reply is the single stdout emission. No system prompt is ever passed by the proof path (`systemPrompt` is always `null` here) — the "system rules" the task asked about are inline in the user-turn prompt text itself (§1.2).

**Which model:** Site Studio itself never names one. `lib/brain/shay-provider.js` has a module comment: *"FAMtastic is the platform, Shay is the agent that runs it... model choice is not Studio's business."* There is a hard assertion (`assertNoReasoningAuthority`) that throws if any caller tries to pass `model`, `provider`, `brain`, or fallback variants of those keys anywhere in the options object. Model selection is entirely internal to the `shay` binary (`~/.local/bin/shay`, a Python CLI — `shay_cli.main`) and its own config.

**UNDETERMINED (repo-level):** exactly which underlying model `shay -z` resolves to for a given call. This is controlled by `~/.shay/config.yaml`, which is Fritz's personal runtime config, not part of either repo, and can change between sessions. As read on this machine on 2026-08-23, the top-level default is:
```yaml
model:
  default: gpt-5.4
  provider: openai-codex
  base_url: https://chatgpt.com/backend-api/codex
```
i.e. GPT-5.4 routed through an OpenAI Codex / ChatGPT-backend integration, authenticated via Fritz's ChatGPT subscription rather than a bearer API key. Whether the `-z` one-shot path uses this exact default or a different route-specific model is not visible from the CLI wrapper (`shay_cli` ships as an installed wheel with no readable `.py` source at `~/.local/share/uv/tools/shay-shay/`). **To pin this down exactly, run `shay --help` / inspect `shay_cli`'s dispatch for the `-z` flag, or add temporary logging to `lib/brain/shay-provider.js` in a sandbox — do not do this against the live route.**

**Credentials:** none read or required by Site Studio. Per the module docstring: *"Auth comes from the Shay CLI itself (subscription / configured provider) — no API key is read or required here."* `shayProvider.complete` spawns with `env: { ...process.env }` — it inherits whatever the launchd Studio process's environment already has, and `shay` resolves its own credentials from `~/.shay/` (`auth.json`, `config.yaml`, `auth/` directory) independent of Site Studio.

**Failure behavior:** `complete()` resolves to `''` on timeout, non-zero exit, or spawn error — never rejects. Callers must treat empty string as failure; `generateProofArtifact` does this via `stripAiHtml(rawTemplate).length < 50` checks that throw a 502.

### 1.2 Exact prompt shape

Two prompts per direction, built by `buildProofPromptContext` (`server.js:4466`) → consumed by `buildTemplatePrompt` (`server.js:3922`, not proof-specific — shared with normal Site Studio builds) and `buildProofPagePrompt` (`server.js:4532`, proof-specific).

**Prompt 1 — template pass.** Feeds through `buildTemplatePrompt(spec, ['index.html'], briefContext, decisionsContext, assetsContext, systemRules, analyticsInstruction, {outputDir})`. `decisionsContext` is always `''` and `analyticsInstruction` is always `''` for proofs. The three real inputs are `briefContext`, `assetsContext` (hardcoded string `'No proof-specific assets were supplied unless listed in the spec.'`), and `systemRules`.

`briefContext` (`server.js:4479-4531`) is built as:

```
PROOF MODE:
- This is a pre-sale, single-page static proof, not a production Site Studio build.
- Build only enough to help a prospect choose a design direction.
- Do not mention Proof Mode to the visitor.
- Do not add Netlify deploy assumptions, production deployment copy, or live backend promises.

DESIGN BRIEF:
- Goal: ${brief.goal || 'Drive trust and lead capture'}
- Audience: ${brief.audience || cb.ideal_customer || 'Prospective customers'}
- Tone: ${...brief.tone... || 'professional, clear'}
- Visual direction: ${JSON.stringify(brief.visual_direction || {}, null, 0)}
- Must-have sections: home

CLIENT BRIEF:
- Business: ${cb.business_description}
- Ideal customer: ${cb.ideal_customer}
- Differentiator: ${cb.differentiator}
- Primary CTA: ${cb.primary_cta}
- Services: ${cb.services joined}
- Service area: ${cb.geography}
- Contact methods: ${cb.contact_methods}
- Style notes: ${cb.style_notes}

${mandatoryClientContent}   <- see §1.3, the CLIENT CONTENT CONTRACT block

PROOF ID: ${proofId}
```

...then conditionally appended:
- a style-fingerprint prompt block (`styleFingerprint.buildFingerprintPromptBlock`) if `spec.style_fingerprint.palette` is set
- a font-pairing prompt block (`fontRegistry.buildFontPromptContext`)
- a layout-variant prompt block (`layoutRegistry.buildLayoutPromptContext`)

`systemRules` (`server.js:4508-4515`, despite the name this is inline prompt text, not an API `system` parameter):

```
RULES:
- Generate polished, specific copy from the client brief. Avoid placeholder text.
- Make this proof visually distinct from other directions using the selected layout, palette, typography, density, and shape.
- Every major section must include data-section-id and data-section-type.
- Editable headings, body copy, CTA text, phone, and email should include data-field-id and data-field-type.
- Use static HTML and self-contained CSS. Do not depend on Tailwind, JavaScript, a CDN, or external assets for layout or presentation.
- Do not create multiple pages. All navigation should point to sections within index.html.
```

**Prompt 2 — page pass.** `buildProofPagePrompt(spec, templateContext)` (`server.js:4532-4589`), where `templateContext` is the reusable header/footer/CSS extracted from pass 1's output (`loadTemplateContext`). Full literal structure:

```
You are a premium website builder. Generate index.html for a single-page proof website.

SITE: ${spec.site_name}
BUSINESS TYPE: ${spec.business_type}
PAGE CONTENT: Hero, trust/value proposition, services (${services}), local/service area (${serviceArea}), social proof or credibility, final CTA (${cta})

${mandatoryClientContent}    <- CLIENT CONTENT CONTRACT, §1.3

${famSkeletons.HERO_SKELETON}
${famSkeletons.DIVIDER_SKELETON}
${famSkeletons.NAV_SKELETON}
${famSkeletons.INLINE_STYLE_PROHIBITION}
${getLogoNoteBlock(spec)}

${templateContext}

STRUCTURE:
<!DOCTYPE html>
<html lang="en">
  <!-- Copy the template head, then add page title, SEO description, and one <style data-page="index"> block. -->
<body>
  <!-- Copy the template header/nav, but single-page nav links may point to section anchors. -->
  <main>
    <!-- Generate the full one-page proof content here. -->
  </main>
  <!-- Copy the template footer. -->
</body>
</html>

CONTENT REQUIREMENTS:
- Use real copy based on the client brief, not lorem ipsum.
- ... (10 more bullets, verbatim in server.js:4568-4580)

STYLE REQUIREMENTS:
- Honor the selected layout variant, font pairing, palette, density, and shape from the proof spec.
- Make this direction feel intentional and different from other possible proof directions.

OUTPUT FORMAT:
Respond with ONLY the complete HTML document from <!DOCTYPE html> to </html>. No explanation, no markdown fences.
```

**Prompt 3 (conditional retry).** `buildStrictContentRetryPrompt` (`server.js:4372-4384`) appends the original page prompt with a `PREVIOUS OUTPUT FAILED CLIENT CONTENT VERIFICATION` block listing the exact `verifyClientBriefContent` failures, plus a fresh copy of the CLIENT CONTENT CONTRACT and an instruction to fix every failure. Fires only when pass-2 output fails the content check (§1.4).

### 1.3 Every variable interpolated — the CLIENT CONTENT CONTRACT block

`buildMandatoryClientContentBlock(spec, {proofOnly})` (`server.js:4209-4247`) is the single block repeated in both prompts (and the retry prompt). It reads through `getProofClientBriefFields(spec)` (`server.js:4182`, not shown in full above but reads `spec.client_brief.*` and `spec.site_name`/`spec.business_type`) and interpolates, each defaulting to the literal string `NOT PROVIDED` when absent:

```
CLIENT CONTENT CONTRACT (AUTHORITATIVE — higher priority than synthetic fallbacks):
BUSINESS NAME: ${businessName}
BUSINESS TYPE: ${businessType}
SERVICES: ${services}
REQUIRED SERVICE CARDS: ${numbered list}
CITY / SERVICE AREA: ${serviceArea}
PHONE: ${phone}
EMAIL: ${email}
PRIMARY CTA: ${primaryCta}
TARGET CUSTOMER: ${idealCustomer}
DIFFERENTIATOR: ${differentiator}
BUSINESS DESCRIPTION: ${businessDescription}
LOGO: ${logo}
PHOTOS: ${photos}
COLORS: ${colors}
STYLE PREFERENCE: ${stylePreference}
REQUIRED PAGES / SECTIONS: ${requiredPages}
TESTIMONIALS: ${testimonials}
FAQS: ${faqs}
CREDENTIALS: ${credentials}
REFERENCE WEBSITES: ${referenceWebsites}

MANDATORY CONTENT RULES:
- Render every REQUIRED SERVICE CARD above ...
- Do NOT rename services to generic terms like "Web Presence", "Brand Identity", "Growth Campaigns", "Reliable Service", or "Proven Results".
- Use the PRIMARY CTA as the main button text ...
- Use the BUSINESS DESCRIPTION in the hero section ...
- ... (full text at server.js:4209-4247)
[+ if proofOnly:] PROOF MODE RULE: A proof with missing client content is invalid. Prefer sparse, honest sections over invented generic sections.
```

**Where every one of those values ultimately comes from**, tracing back through `mapRequestToCampaign` (`server/famtastic-proof-job-routes.js:52-83`), which is what builds `base_spec.client_brief` from the HTTP request body:

| Prompt field | Source expression | Falls back to |
|---|---|---|
| `business_name`/`site_name` | `payload.prospect.business_name` | *(required — request 422s without it)* |
| `business_type`/category | `payload.prospect.category` | `'local business'` |
| `service_area`/geography | `payload.prospect.service_area` | `'the local area'` |
| `business_description` | `payload.prospect.description` | `` `${businessName} provides ${category} services in ${serviceArea}.` `` — a **template-generated sentence**, not a model output |
| `services` | `payload.prospect.services` (array) | `[category]` |
| `primary_cta` | `payload.prospect.primary_cta` | `'Call Today'` if phone present, else `'Request a Quote'` |
| `phone` / `email` | `payload.prospect.phone` / `.email` | `''` |
| `ideal_customer` | `payload.prospect.ideal_customer` | `` `Customers in ${serviceArea}` `` |
| `differentiator` | `payload.prospect.differentiator` | `` `Responsive ${category} service with local expertise` `` |
| `primary_goal`→design_brief.goal | `payload.prospect.primary_goal` | `'Build trust and generate qualified inquiries'` |
| logo/photos/colors/style/testimonials/FAQs/credentials/reference sites | **not populated by `mapRequestToCampaign` at all** — these only exist if a caller builds `base_spec` directly against `generateProofCampaign`/`generateProofArtifact` (the internal API, `server.js:1592`/`1577`) rather than through the signed proof-jobs route | `NOT PROVIDED` |

**This is the load-bearing fact for question 3.** `mapRequestToCampaign` only reads `payload.prospect.*`. Nothing in this route calls a discovery/enrichment service, hits an external API, or reads any table other than what the caller already put in the POST body. If `payload.prospect` is name-only, the entire CLIENT CONTENT CONTRACT for every field except `BUSINESS NAME` degrades to a **template-generated one-line default** (e.g. *"X provides local business services in the local area."*) — the model gets almost nothing to work with, and `verifyClientBriefContent`'s own banned-phrase list (`'a local business ready to grow online'`, `'web presence'`, `'brand identity'`, `'growth campaigns'`) exists specifically because this degradation is a known failure mode the code defends against.

**Direction names/labels fed to the model:** via `variant.direction_name` → `spec.design_brief.visual_direction.direction_name` (`normalizeProofSpec`, `server.js:4425-4464`), which for the hardcoded `DIRECTIONS` const in `famtastic-proof-job-routes.js:8-12` is one of `'Bold and Modern'`, `'Trusted and Professional'`, `'Local and Approachable'`. **Note:** `mapRequestToCampaign` ignores whatever `directions`/`direction_contract` the Drupal v2 payload sends (`routes.js:87` — `variants: DIRECTIONS`, the hardcoded const, not `payload.directions`); this is the exact contract mismatch documented in `docs/decisions/ADR-0002-proof-contract-schema-mismatch.md`. So even when Drupal sends `direction_contract` naming `a`/`b`/`c` "Safe"/"Wild"/"OMG" with an intent string, System A silently discards that and substitutes its own three generic labels. There is no code path in System A that would ever produce a name like "The Rattler Field Guide" — its direction vocabulary is a 3-item hardcoded array.

### 1.4 Post-processing (question 4)

In order, after each model call:

1. **`stripAiHtml`** (`server.js:4149-4157`) — strips a leading ` ```html ` fence and trailing ` ``` `, finds `<!DOCTYPE html>` or `<html`, discards anything before it.
2. **Minimum-length / tag sanity check** — `templateHtml.length < 50 || !/<html[\s>]/i.test(templateHtml)` throws 502.
3. **Logo SVG extraction** (`famSkeletons.extractLogoSVGs`) if `proofSpec.famtastic_mode` — pulls inline `<svg>` logo markup out into a separate file.
4. **Template artifact parsing** (`writeTemplateArtifacts`) — splits the template pass output into reusable head/header/footer blocks written to disk; fails the whole artifact with 502 if it can't parse a head or header block.
5. **`verifyClientBriefContent`** (`server.js:4284-4342`) run on the page HTML's *visible body text only* (`extractVisibleBodyText` strips `<script>`/`<style>`/`<svg>`/`<head>`/tags first). Checks, each independently togglable: business name present, every declared service present as literal text, primary CTA present, phone digits present (compared digit-only), business-description word-overlap (≥3 of the description's first 8 words ≥5 chars each must appear), and a hardcoded banned-generic-phrase list. **On failure it does not just log — it re-prompts the model once (pass 3, §1.2) and re-checks; if still failing, the whole artifact request 502s.**
6. Page HTML written to `index.html`; `applyTemplateToPages` re-merges template head/header/footer into the page file; **the content check runs a second time** against the final merged file.
7. **`fulfillProofMedia`** (`server/proof-media-fulfillment.js`, out of scope of this doc but noted: this is a separate generated-image step, distinct from the text model call, using `scripts/google-media-generate`) — fills empty `data-slot-status="empty"` image slots.
8. **Thumbnail screenshot** via Playwright (`generateProofThumbnail` → `captureScreenshotForShay`), only if a `proofUrl` was supplied.
9. `design-dna.json` written with the full `proofSpec` snapshot, style fingerprint, layout/font choices, and the content-verification result.
10. **At the campaign-callback-delivery stage** (`server/famtastic-proof-job-routes.js:packageProofHtml`, called from `run()` in the job service before HTTP callback delivery): inlines the shared `assets/styles.css` as a `<style>` block; base64-inlines any local `<img src>` under 750KB, replacing `data-slot-status="generated"` images that are missing/oversized with a **thrown error** (so a job can't silently ship a broken image), and replacing `data-slot-status="empty"` placeholder images with a CSS wordmark span; adds portability CSS; strips `<script>` tags, `on*` attributes, and `javascript:` URLs (`sanitizeProofHtml`); and rewrites customer-facing scaffolding language (`stripCustomerVisibleScaffolding` — regex-removes any element whose text matches `/placeholder|reserved (visual|image) slot|proof mode|proof-safe|image placeholder|hero photo slot|content (is|still) missing/i`, and text-replaces internal jargon like "throughout the proof" → "throughout the page").

None of this post-processing adds creative content — it is exclusively validation, sanitization, and format massaging of what the model already produced.

---

## 2. System B — Drupal `ProofCampaignService::createForProspect`, image-free pilot path (`ProofCampaignService.php:85-177`)

This is the path that actually produced almost all of the 19 `ready` production campaigns per ADR-0002 (created 07-31 through 08-19, before `SITE_STUDIO_URL` was ever set, so remote dispatch to System A never fired).

- **Model call: none.** `stubHtml`/`pilotContent` (`ProofCampaignService.php:775-901`) are pure PHP string-template functions, keyed only on `$category` (a small switch/match over category strings — e.g. `bakery`, `salon`) and the free-text `$description`. When `$category` is `NULL` (as it is for name-only prospects), it falls into whatever the default branch of `pilotContent` returns — a generic tagline/services list, not business-specific content.
- **Direction names are literally hardcoded**: `self::CORE_DIRECTIONS = ['a'=>'Safe','b'=>'Wild','c'=>'OMG']` (`ProofCampaignService.php:40-44`). `design_dna` written per variant (`ProofCampaignService.php:143-154`) is a small fixed object: `source: 'no_image_pilot_v1'`, `direction`, `direction_name`, `business_name`, a hardcoded `palette()` lookup by direction letter, a ternary for typography/layout by direction letter. No AI-generated field anywhere.
- **Trigger condition:** only runs when `FAMTASTIC_ALLOW_NO_IMAGE_PILOT_PROOFS=1` or `FAMTASTIC_ALLOW_STUB_OUTREACH=1` is set AND `SiteStudioProofClient::isRemote()` is false (`ProofCampaignService.php:92-94`) — i.e. it's an explicit opt-in stub path for when no real generator is configured, not a fallback silently substituting for missing AI content.
- **Prospect input:** only `business_name`, `business_category`, `business_description`, contact fields — read directly off the `Prospect` entity, no enrichment step.

This path structurally cannot produce anything like "The Rattler Field Guide" — its direction vocabulary is 3 fixed words and its content is category-switched boilerplate.

---

## 3. System C — `website-delivery-swarm` six-direction benchmark (the actual source of "The Rattler Field Guide")

Location: `/Users/famtastic-fritz/Development/FAMtastic/worktrees/shay-website-delivery-swarm/website-delivery-swarm/` — a standalone Python/Node toolchain, **not part of either of the two repos named in the task's known entry points**, and not reachable from the Site Studio proof-jobs HTTP route or from `ProofCampaignService::createForProspect`.

### 3.1 Model / provider / invocation

`provider_pipeline.py`:

```python
CODEX_MODEL = os.getenv("FAMTASTIC_CODEX_MODEL", "gpt-5.6-sol")
CLAUDE_MODEL = os.getenv("FAMTASTIC_CLAUDE_REVIEW_MODEL", "opus")
...
codex_command = ["codex", "exec", "--ephemeral", "--ignore-rules", "--sandbox", "read-only", "-m", CODEX_MODEL, prompt]
...
claude_command = ["claude", "-p", "--model", CLAUDE_MODEL, "--effort", "high", ...]
```

**How:** two separate CLI subprocess calls — OpenAI's `codex exec` CLI (model `gpt-5.6-sol` by default, overridable via `FAMTASTIC_CODEX_MODEL`) for generation, and the `claude -p --model opus --effort high` CLI for review/QA. Both are local CLI tools, authenticated via their own subscription/session state, same pattern as System A's `shay` wrapper (spawn a CLI, not an SDK/API call). `ledger.record(stage, "openai", CODEX_MODEL, ...)` confirms the provider is logged per-call in an audit ledger (`references/six-direction-benchmark-contract.md` mandates: *"Claims about model diversity must name the actual providers and models used."*).

**Credentials:** inherited from each CLI's own logged-in session (Codex CLI's own auth, Claude CLI's own auth) — again, not read or supplied by this pipeline directly.

### 3.2 What is fed to the model — the six-direction benchmark contract

`references/six-direction-benchmark-contract.md` specifies the *shape* of what must come out, not a literal prompt template (the actual prompt text lives under `prompts/v1/` in that worktree and was not transcribed here — out of the task's named scope, and reading the full prompt corpus of a separate, undocumented system is a larger job than this recipe). Key contract terms:

- Exactly **six** directions per project: 1 "restrained" (FAMtastic level 0-3), 1 "medium" (4-7), 4 "ultra" (8-10).
- Each direction requires: distinct information architecture, distinct primary artwork, customer-specific copy, desktop + mobile screenshots, and a browser-QA pass (no horizontal overflow, missing image, missing alt text, console error, page error, failed request).
- Each direction must use a **named display typography treatment** and a **business-specific material/texture/pattern system** — i.e. the contract explicitly demands the model invent a named creative concept per direction, which is exactly what produced "The Rattler Field Guide" / "The Season Coil" / etc.
- Deliverables per batch: manifest, research record, build brief, agent ledger, prompt ledger, technical QA, independent visual review, SHA-256 integrity ledger, review room.
- Explicit constraint: "An official mark, mascot, person, or affiliation may not be copied or implied without authority" — i.e. the model is instructed to invent original variations rather than reproduce a real trademark (relevant given "Rattler" strongly suggests FAMU's mascot).

### 3.3 Where the input data comes from — confirmed empirically, not from documentation

Production DB read (read-only, via `drush sqlq` over SSH, 2026-08-23):

```
proof_campaign id=21, campaign_id=pc-rattler-football-fan-portal-7323201e5fea183a
  studio_job_id = local-showcase-6641390829eaf59ee978cd4d71ceb4cc
  generation_status = ready

famtastic_prospect id=29 (joined via proof_campaign.prospect_id):
  business_name = "Rattler Football Fan Portal"
  business_category = NULL
  business_description = NULL
  service_area = NULL
  public_phone = NULL
  public_email = fritz.medine@gmail.com
```

`proof_variant` rows for campaign 21, `design_dna__value` (JSON), direction `a`:

```json
{
  "direction_name": "The Rattler Field Guide",
  "concept_name": "The Rattler Field Guide",
  "source_direction": "direction-a",
  "famtastic_level": 2,
  "creative_band": "restrained",
  "strategy": "A calm, credible weekly utility for fans who primarily need trusted official handoffs. The hero pairs a compact editorial introduction with the next-season milestone and four large mobile actions; original serpent references remain subtle and structural. Every mutable item carries its season, source, retrieval date, and a Verified Handoff chip. Persistent language identifies the site as an unofficial, independent fan concept.",
  "information_architecture": "Dashboard-first architecture: utility hero; Game Day actions; 2026 schedule preview; official roster finder; 2025 completed-season snapshot; Bragg naming story; history and Hall of Fame discovery; reserved player-family spotlight; verified support pathways; governance disclosures. Deeper stories appear after the recurring weekly tools.",
  "source_manifest": "rattler-football-fan-portal-fresh-20260819-001",
  "source": "site_studio_local",
  "telemetry": {
    "provider": "openai-codex-swarm",
    "agent_name": "famtastic-six-direction-benchmark",
    "flow_key": "website_proof.generate.v1",
    "task_key": "proof.generate",
    "prompt_snapshot": "",
    "input_snapshot": { "source_request_id": "famtastic:rattler-football-fan-portal-20260819-fritz-001", "directions": ["a","b","c"] },
    "source_sha": ""
  }
}
```

Direction `b` ("The Season Coil") carries the identical `source_manifest`/`telemetry.agent_name`/`telemetry.provider`, confirming this is one coherent run, not per-variant noise.

**Conclusion, stated plainly:** the prospect record backing this campaign is genuinely name-only (matching what the task said production `famtastic_prospect` rows look like). "The Rattler Field Guide" and its five siblings are **not sourced from any discovery/enrichment step reading real business data** — `telemetry.prompt_snapshot` is an empty string (the actual prompt text was not retained in this record) and `input_snapshot` shows only a `source_request_id` and the direction list, nothing else. The richness is the model's own invention, grounded only in the business name string "Rattler Football Fan Portal" (which a general-knowledge model can reasonably associate with Florida A&M University's Rattlers) plus whatever the `six-direction-benchmark-contract.md` prompt scaffolding demands (research record, named concept, distinct IA per direction). This was produced by a **manual/benchmark run of System C against one specific prospect**, evidenced by the Claude Code session artifact directories found locally:
- `~/.claude/projects/-Users-famtastic-fritz-Development-FAMtastic-worktrees-shay-website-delivery-swarm-artifacts-website-delivery-swarm-rattler-football-fan-portal-fresh-20260819-001`
- `~/Library/Caches/claude-cli-nodejs/...rattler-football-fan-portal-fresh-20260819-001`

— matching the `source_manifest` value exactly, dated 2026-08-19. This is a one-off benchmark/demo run against a real production prospect record, not the routine automated behavior of the pipeline the task's entry points describe.

**UNDETERMINED:** the exact literal prompt text System C sent to Codex/Claude for this run (`telemetry.prompt_snapshot` is empty in the persisted DB row, and the full `prompts/v1/` template files in the swarm worktree were not read line-by-line for this recipe — that would be a substantial second investigation into a fourth codebase). To reproduce System C exactly, read `worktrees/shay-website-delivery-swarm/website-delivery-swarm/prompts/v1/` and `provider_pipeline.py` in full, and locate the run's actual artifact directory (`artifacts/` under that worktree, or the `~/.claude`/`~/Library/Caches/claude-cli-nodejs` session paths above) for the literal transcript.

**UNDETERMINED:** how System C's output reached the production `proof_variant` table given `SITE_STUDIO_URL` was never set (so the normal signed HTTP callback documented in `SiteStudioCallbackController.php` / `ProofCampaignService::acceptCallback` would have had nothing dispatching to it). The `studio_job_id` format `local-showcase-<hex>` matches `ProofCampaignService::prepareWebsiteRequestShowcase` (`ProofCampaignService.php:254-286`), which only *mints* that job id — it does not generate content itself; something (a script, `drush`, or a direct call into `acceptCallback`) then supplied the six variants against that job id from outside the traced HTTP surface. Confirming the exact mechanism would require reading the swarm worktree's Drupal-handoff code (`autonomous_pipeline.py`'s docstring — *"This module does not run or modify Site Studio. It owns the work before the handoff... emits the event FAMtastic consumes"* — suggests it calls `acceptCallback` or an equivalent ingestion path directly) — out of scope for this read-only pass but flagged here as the next concrete thing to check before trusting this data further.

---

## 4. Fonts, layout, and palette inputs (System A only, for completeness)

Not part of the model's business-content input but part of the "STYLE REQUIREMENTS" surface fed into every proof prompt:

- **Layout variant:** `resolveProofLayoutVariant` (`server.js:4394-4398`) — validates `variant.layout_variant` against `layoutRegistry.getVariant`, falls back to `layoutRegistry.DEFAULT_VARIANT_ID`. For the proof-jobs route, this is one of the three hardcoded `layout_variant` values in `DIRECTIONS` (`split_screen`/`standard`/`centered_hero`).
- **Font pairing:** `resolveProofFontPairing` (`server.js:4400-4406`) — validates against `fontRegistry`, or auto-picks by vertical via `fontRegistry.pickPairingForVertical(business_type)`.
- **Style fingerprint / palette:** `buildProofStyleFingerprint` (`server.js:4408-4424`) — either reuses a valid `spec.style_fingerprint` or generates one via `styleFingerprint.generateStyleFingerprint(design_brief, {vertical, userMessage: [business_description, style_notes, goal].join(' '), clientBrief, brand:null})`, then merges in a hardcoded palette from `PROOF_COLOR_MOOD_PALETTES[colorMood]` (colorMood from the direction's `color_mood`, e.g. `'bold'`/`'calm'`/`'warm'` in the hardcoded `DIRECTIONS`).

All three of these are deterministic/registry-driven, not model calls — they narrow the prompt's style instructions, they don't add business content.

---

## 5. Verification method (for the reader's confidence in §0/§3)

All of the following were read-only:
- `git log`, `grep`, `sed -n`, `cat` against `site-studio` and `sites/site-famtastic-designs` (both already-checked-out local worktrees).
- `ssh xrdj7j99xhzt@p3plzcpnl497512.prod.phx3.secureserver.net 'cd ~/public_html && vendor/bin/drush sqlq "SELECT ..."'` — five `SELECT`-only queries against `proof_campaign`, `proof_variant`, `famtastic_prospect`, using the existing configured SSH key, no writes, no `drush` commands beyond `sqlq` reads. Full commands and output are reproduced in §3.3 above.
- Local filesystem reads of `~/.shay/config.yaml` (model default only — no secrets copied into this document) and the `website-delivery-swarm` worktree's contract/pipeline source files.
- No `shay`, `codex`, or `claude` CLI was invoked. No HTTP request was made to the FAMtastic Designs Drupal site, the Site Studio proof-jobs route, or any provider API. No file was written under production, the `site-studio` repo, the `sites` repo, or the `website-delivery-swarm` worktree.

---

## 6. What would make a like-for-like comparison unfair or impossible

1. **You must decide which of the three systems "legacy" means before comparing anything.** If the new pipeline is being compared against "legacy produces six named creative concepts," that is System C — a one-off benchmark tool with its own prompt corpus, its own model choices (Codex `gpt-5.6-sol` + Claude `opus`), and its own contract (`six-direction-benchmark-contract.md`), not the automated Site Studio route (System A) or the Drupal pilot (System B). Comparing a new pipeline's output against System C's output while believing you're comparing against "the proof pipeline" is comparing against the wrong baseline.
2. **System A structurally cannot produce System C-quality output from a name-only prospect** — its prompt degrades every missing field to a template-generated one-liner, and its direction vocabulary is a hardcoded 3-item array (`Bold and Modern`/`Trusted and Professional`/`Local and Approachable`), never named creative concepts. If the comparison target is "what Site Studio's proof-jobs route produces," a name-only prospect is expected to (and by design, per `verifyClientBriefContent`'s banned-phrase list) produce sparse, generic-but-not-fake content — not six named concepts.
3. **System B produces zero model-generated content at all** — comparing it to any model-backed system on "creative quality" is comparing a template engine to an LLM.
4. **The exact model behind System A (`shay -z`) is not statically knowable from either repo** — it's resolved by a personal CLI tool's own config/session, which can differ by machine and by time. A rerun today may hit a different model than whatever produced any given historical proof, even holding the prompt constant.
5. **`schema_version` 2 fields (`direction_contract`, `website_discovery_v2/v3`) are accepted but discarded by System A's `mapRequestToCampaign`** (ADR-0002) — so even if the Drupal producer is sending richer `direction_contract` data today, Site Studio silently ignores it and substitutes its own hardcoded three directions. Anyone assuming "the direction names Drupal sends make it into the prompt" is wrong for System A as it stands on this branch.
6. **System C's actual prompt text was not retained** (`telemetry.prompt_snapshot` empty in the DB) and its full prompt templates live in a fourth, unread codebase (`prompts/v1/` under the swarm worktree) — reproducing it exactly requires a follow-up read of that worktree, which this investigation did not do in full (see UNDETERMINED items in §3.3).
7. **Whatever mechanism moved System C's output into `proof_variant` bypassed the documented HTTP callback contract** (`SITE_STUDIO_URL` was never set, so nothing should have been able to call `acceptCallback` normally) — meaning production's `proof_variant` table contains at least one campaign whose provenance doesn't match either documented ingestion path. Anyone building tooling that assumes "everything in `proof_variant` came through the signed Site Studio callback" should re-check that assumption before relying on the table's `source`/`telemetry` fields as ground truth for how a variant was produced.
