# Retro: the Site Studio rebuild

**Span:** 2026-08-21 to 2026-08-23 | **Outcome:** shipped and cut over
**Final gates:** lint OK, **529 tests / 36 files**, smoke 11/11, G4-0 PASS,
G4-1 PASS, exit 0 — twice consecutively on the shipped commit.

---

## 1. What was built

A greenfield single-operator production console: vanilla JS multi-page frontend,
modular Node backend, no build step, no framework. Eleven console pages. A
pipeline that takes a thin brief (a name, sometimes a category and a city) and
produces a real, verified, deployed site with a complete replay manifest.

Live at cutover: research grounded in live search with every cited source
independently re-fetched, per-stage model routing with recipe authority, imagery
generation, a deterministic brand-voice gate, DNA with full receipts, deploy to
FAMtasticInc with tested rollback, and standing efficiency telemetry.

## 2. The corrected framing on the template-stamp finding

The comparison against legacy found three of five real customers had received
**the same three directions, byte-identical except the business name**, sharing
one `generated_at` timestamp — a hair studio and a skin bar both given the same
near-black-and-lime-green palette.

**Those were never customer deliveries.** They were Designs-drift and test
proofs. The salvage artifacts corroborate it independently: the corresponding
build briefs carry `classification: fresh_provider_executed_heldout_benchmark`,
Fritz's own email, and an explicit
`publication_boundary: {external_mutation_allowed: false, site_studio_execution_claimed: false}`.

**What it does stand as** is the inefficiency that justified the rebuild: a
system that could not tell a pilot row from a customer record, in the same table,
with nothing in the schema marking the difference. That is a claim about data
hygiene, not about work sent to customers. `spec.origin` shipped so the confusion
cannot recur — every site is `legit`, `test`, or `needs declaration`, and console
counts split accordingly, permanently.

## 3. What the salvage pass bought

Found in `worktrees/shay-website-delivery-swarm/artifacts/`, not in the
famtasticdesigns repo. Three patterns went straight into the roster spec:

- **The repair loop is the product.** In the run that produced the good output,
  `browser-qa` failed three times and the pipeline repaired and re-ran until
  green, alternating expensive model repair with a 12ms deterministic pass.
  Quality came from loop-until-green against executable gates, not from one good
  generation.
- **The verifier is two things**, never merged: 17 machine-checkable booleans,
  and a separately *attributed* model review. Collapsing them yields a number
  that means nothing and cannot be appealed.
- **Honest non-reporting**: `provider_did_not_report`, never a zero.

It also showed `website_build_brief.v2` carrying `design_use` on every research
finding — what the fact is *for* — which our packet still lacks. Logged as the
biggest available quality lever.

## 4. Efficiency: measured, not assumed

**One bottleneck.** Research is 98.9–99.0% of build wall time; the CLI call is
99.6–100% of research. Everything else, including all inter-stage idle (5–8ms),
is about 1%.

**The win was concurrency:** three briefs, 430s sequential → **180s** concurrent,
**2.39x**, with per-brief times unchanged — three concurrent CLI processes cost
each other nothing.

**What the numbers refuted**, stated because they were the expected answers:
media-slot parallelism (nothing filled slots yet, so no serial cost existed),
retry cost from non-determinism (zero retries observed), expensive brains on
cheap work (five of six stages use no brain at all), repair-loop scoping and
prompt reuse (neither existed). A verified-fact cache was **declined on the
numbers**: max 0.4% saving, only on a retry that never happened.

**The audit's first job was fixing its own instruments.** `duration_ms` was
declared in the schema and never populated; the run's `started_at` was stamped
when research *finished*, so **a 113s run recorded itself as 1.09s**; and the
Builds console rendered a duration the API never sent, so that column had always
been blank.

## 5. Closing case study: the contradiction

This is the most instructive thing in the whole build, and it only surfaced
because the cutover was actually executed rather than described.

The cutover amendment said the proof webhook would keep being served *by the new
path rather than the stamp logic*. Reasonable on its face. But
`assertNoProofRoutes()` runs inside the P0-I1 preflight and **refuses boot on any
proof ingress** — and that same invariant is what revenue-safety gate G4-1 rests
on. Studio cannot serve a proof webhook without breaking the guarantee that makes
it safe to run at all. Independently, production had no dispatch path to any
Studio: no `SITE_STUDIO_URL`, and `famtastic_proof.settings` did not exist.

**A plan document and a boot invariant made incompatible claims, and both had
been ratified.** Neither review caught it. What caught it was trying to do the
thing.

**The ruling: the invariant wins, permanently.** Proof generation is Designs-owned
and its modernization is Designs' migration, POST-SHIP #1. The M5 criterion "one
real proof job via Studio" was struck as based on a false premise, and replaced
with one already met.

**The lesson worth carrying:** a document can be ratified and still be false. An
invariant that refuses to boot cannot. When the two disagree, the executable one
is the one telling the truth — and the cheapest way to find the disagreement is
to execute, not to review again.

## 5b. The second case study: the acceptance artifact passed while broken

The contradiction above was found by executing instead of reviewing. This one
was found by looking at the output instead of the gates, and it is the more
uncomfortable of the two.

**M5's acceptance artifact carried the defect that makes it unshippable, and
closed M5 anyway.**

Re-examined against the calibration finding, `ACCEPTANCE-starlight-home.html`
is the same shape as the five calibration samples. **0 of its 10 paragraphs end
in sentence punctuation.** The hero's opening line is
`name, one-line positioning, city, primary Book CTA` — an instruction to a
writer, published to the customer. The rest are production notes: "3-4 cards
linking into the full menu", "4-6 images or before/afters with consent". The
headings are outline labels: "Trust strip", "Results / gallery". The palette is
default blue-on-white, so no brand direction reached the render either.

**The mechanism was structural, not a bad generation.** The pipeline had no copy
stage at all: `research -> spec -> compose`. Research declares sections as
strings like `"Hero: name, one-line clinical positioning, primary Book CTA"`,
spec-derive split on the colon, and compose rendered the half after it. That half
is an instruction. **Nothing in the pipeline ever wrote prose**, so the system
published its own outline, five consecutive builds running.

**Why it read as progress.** The typed-sections fix, shipped hours before, was
reported as a quality win on the evidence that the page went from one run of
paragraphs to "seven real headings". That was true and it was the wrong measure.
Typing the sections made the *outline* render more cleanly — it promoted outline
fragments into tidy headings and well-formed paragraphs. The page got more
finished-looking and no more shippable. **A structural improvement was measured,
and reported, as product quality.**

Every gate passed throughout: one h1, correct heading hierarchy, real nav, no
broken links, hero image present, 529 tests green. None of it could see the
problem, because **absence-checking cannot detect a page that has all of its
parts and none of its substance.** The gates were asking "is it there?" when the
only question that mattered was "does it say anything?"

**The fix, landed after.** `spec-derive` now keeps the outline in `instruction`
and starts `body` as **null**, so the outline cannot reach a render at all;
compose already refuses to render a falsy body, so missing copy shows as missing
instead of being impersonated by the note asking for it. `copy.js` is the stage
that fills `body`, and its echo guard is part of the stage rather than downstream
of it: a returned body scored too close to its instruction is rejected outright.
Fixed in the data model, not with a better prompt.

**The two lessons, and they compound.** First: a green gate is evidence about the
gate, not about the product — every check here passed on output no one would
send a customer. Second, and worse: **when you improve the structure of something
broken, it looks like progress.** The honest test is not whether the artifact
improved, it is whether it became shippable. Nobody read the page. The measure
reported was a count of headings.

## 5c. The third case study: a ruling nobody could see

The other two were found by executing instead of reviewing, and by reading the
output instead of the gates. This one was found by looking for where a decision
was *written down*, and it is the cleanest of the three.

**The ruling that became a boot invariant was never in the canonical learnings
file.**

`2026-08-23 — Preview ownership resides in FAMtastic, not Site Studio` existed in
exactly one place: `worktrees/shay-website-delivery-swarm/docs/SITE_LEARNINGS.md`.
Not in `FAMtastic/SITE-LEARNINGS.md`. A later session read it as settled
architecture and hardened it into P0-I1, which revenue gate G4-1 then came to
rest on.

It contradicted two earlier rulings, and **both of those were in the canonical
file the whole time**:

- **2026-05-05** — provider authentication belongs to Site Studio/platform, not
  to generated sites. Shipped with a proof packet.
- **2026-08-01** — generate through Shay, serve from `/proofs`. Generation on the
  production side, serving on the business side.

Neither was rescinded on the merits. Studio went down, work rerouted, and the
reroute was written up **in the same voice as a ruling** — in a file that did not
converge with the one anybody would read.

Two independent failures had to line up:

1. **The lineage forked silently.** 14+ worktree copies, and the canonical file
   was not the largest: one copy carried 15 sections the canonical had never
   seen. Reading the canonical file did not mean you had read the learnings.
2. **The format could not express duress.** Nothing distinguished "we decided
   this" from "we did this because the alternative was down."

Reconciliation merged 7607 into 8901 lines, 201 sections, and the detector now
reports clean. The format fix is `circumstance` plus expiry: tagged `outage`,
that ruling would have lapsed around 2026-09-22 instead of becoming law.

**The counterfactual is the point.** Nobody had to be careless. A person acting
reasonably read the only file in front of them.

## 5d. What the three case studies share

| | Found by | What was invisible |
|---|---|---|
| The contradiction | executing the cutover | a ratified document and a boot invariant disagreeing |
| The outline defect | reading the output | a page with all its parts and none of its substance |
| The worktree ruling | asking where it was written | a decision in a file that did not converge |

Every gate was green for all three. **The failure was never in the code. It was
in what the code could see.**

Absence-checking cannot see a page that says nothing. A review cannot see a
document contradicting an invariant it never loads. A learnings file cannot warn
you about the copy it does not know exists. In each case the system was working
exactly as built, and what it was built to check was not the thing that mattered.

The durable move is not more gates. It is asking, before trusting any green
result, **what this check is structurally incapable of noticing** — and then
looking at that directly, by hand, with your own eyes on the artifact.

## 5e. The sixth and seventh instances: stages that were never tested at all

The sharpest of the set, because the gates were not merely blind to a defect —
they were **testing a pipeline that did not include the stage.**

**The copy stage had never run in a pipeline test.** Derivation used to write
`body` directly on the fallback path, and `writeCopy` only fills a section whose
body is falsy. Every section arrived pre-filled, so the stage was skipped
entirely. Removing that bypass — the same bypass that published "Opening
statement" as a hero — made **fourteen tests reach for the real CLI and time
out.** They had been green for as long as the copy stage had existed, and green
meant nothing: the stage under test was never entered.

**Then the sweep asked the same question of every other stage, and imagery
failed it too.** The executor guards on `media_slots.length`; the research stub
declared no media prompts; zero slots were produced; the stage was never
entered. Confirmed by probe rather than by reading — `fetch` was never called
and no preflight was ever recorded.

Both now have stubs and both are exercised. The sweep also turned up a plain
field mismatch that had been invisible for the same reason: research emits
`{slot, prompt}` and derivation read `entry.role`, so **every research-declared
slot name had always been discarded**, which is why every spec on disk shows
`media-1`, `media-2`.

**Why this class is so hard to see.** A skipped stage produces no error, no
warning, and no failing assertion. It produces a *faster green test run*. Every
signal points the right way. The only thing that reveals it is asking a question
no test asks: **not "did this pass?" but "did this run?"**

The generalisation, now standing: **a stub that satisfies a stage's precondition
by being empty silently deletes that stage from the test.** An empty research
packet is not a neutral fixture — it is a fixture that turns off everything
downstream of it that guards on non-emptiness.

## 5f. Instances eight, nine and ten: I fixed `body` and left the identical defect in the sibling field

The pattern that produced nearly every defect here found a new hiding place: the
fields *next to* the one that was fixed.

The copy stage routes `body` through an echo guard, so an outline can no longer
reach a page as body text. **Every other user-visible field derivation writes was
left echoing its note.**

- **`heading` — eighth.** A real build published `Final CTA band` and
  `Credential and license strip` as `<h2>`. Layout vocabulary: the shape a
  designer was asked to build, not page language. **5 of 129 headings.**
- **`meta description` — ninth, and the most externally visible defect found in
  this project.** Every one of the five pages shipped its SEO *direction* as its
  meta description: *"Every keyword above is a template — the city,
  neighborhood, and state must be substituted before publication."* That is a
  note to a writer, published to search engines.
- **`alt` text — tenth.** Every image on every page shipped `alt="media-1"`,
  `alt="media-2"`. The alt attribute held an **identifier**. WebAIM Six passed on
  all five, because it checks that alt is *present*. **An accessibility gate
  cannot see its own most common failure when the failure is meaningless-but-
  present text.**

**How they were found.** Not by a gate — every gate was green. By **looking at
the render**, then asking the obvious follow-up: *if the outline leaked into
`body`, which other fields does derivation write?* The sweep took minutes once
the question was asked.

**The generalisation:** a fix scoped to one field is a fix scoped to one field.
When a defect comes from a *source* (research notes reaching the page), every
consumer of that source has it until each is checked. The right unit of repair is
the source, not the symptom.

## 5g. Robustness by absence

The five scored samples sat in a narrow 66-71 band, and reflowed perfectly from
1440 to 390. That looked like responsive design working. It was not.

**The 390 view is the 1440 view with narrower text — a single column reflows
trivially because there is no layout to reflow.** Nothing used the width at 1440.
Every section was identical in construction: heading, paragraph, full-width
image, repeated eight to twelve times.

**Robustness by absence** is the name for it: a system passes a test because it
never attempts the thing the test is checking. It is indistinguishable from
robustness by design in every metric, and distinguishable instantly by eye.

The same shape as a skipped stage passing its tests, and as an accessibility gate
passing on `alt="media-1"`. **A check confirms the presence of a thing; it cannot
confirm that the thing was worth doing.**

## 6. Defects worth remembering

Roughly thirty landed and fixed across the build. The ones that taught something:

- **P0-I1 was theatre twice.** ESM static imports evaluate before the preflight
  statement runs; then my own guard compared the boot set against itself.
- **Three cross-site path escapes**, each found by fixing the previous one — the
  third because lexical containment followed symlinks.
- **DNA claimed research ran on no provider** while it spawned a real CLI for two
  minutes. Correcting it broke every run, because usage was only recorded for
  no-provider stages and A4 correctly refuses a run with missing usage.
- **`routing_source` was dropped on the floor** — passed by the pipeline, not
  declared by `recordStage`.
- **Media prompts went nowhere** for the whole build until the bridge; then the
  hero image rendered nowhere because research-derived sections were plain
  strings and `section.type` was never `'hero'`.
- **A spec called itself `research-derived` with zero verified facts.**

The pattern across most of them: **nothing errored.** Silent degradation, every
time. The tests that caught them were the ones asserting a claim was *true*, not
that code ran.

## 7. Numbers

| | |
|---|---|
| Tests | 529 across 36 files |
| Gates | lint, tests, smoke 11/11, G4-0, G4-1 — all PASS, exit 0 |
| Build wall time | 113–185s, of which ~99% is research |
| Batch throughput | 2.39x (430s → 180s on three briefs) |
| Cost per proof | $0 attestable + 1 stage that cannot report |
| Imagery | 9 of 15 slots on the acceptance run; 0 substitutions, ever |
| Production writes | **zero**, throughout |

## 8. What is parked

`POST-SHIP.md` is the standing backlog. Item #1 is the Designs proof webhook
migration. Also open: image art direction, raw CLI response retention, the build
agent roster wiring, and a machine-readable quality signal richer than the
brand-voice gate.
