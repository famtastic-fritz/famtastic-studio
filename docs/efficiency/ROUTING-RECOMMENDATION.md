# E3 Brain-per-stage routing recommendation

**Date:** 2026-08-23 | **Method:** one honest probe per candidate, exact output
recorded; no assumed capabilities.

---

## 0. Account-state probe results

| Brain | Result | Evidence |
|---|---|---|
| **claude CLI** 2.1.239 | **AVAILABLE** | `AUTH_OK`, exit 0, 6,602ms |
| **kimi CLI** 0.37.2 | **AVAILABLE** | `AUTH_OK`, exit 0, 7,527ms |
| **gemini CLI** 0.55.1 | **PERMANENTLY RETIRED** | `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` |
| **Antigravity IDE** 1.107.0 | **NO-HEADLESS-PATH** | `chat` exits 0 with **zero bytes**; answer goes to the GUI |
| **Ollama** (local, free) | **AVAILABLE** | `gemma3:4b`, `qwen3:8b`, `glm4:9b` |

gemini and Antigravity are closed permanently. See `GOOGLE-ROUTE-FINDING.md`.
**Fixable by Fritz:** the gemini blocker is account state, not code. Nothing in
this repo can resolve it.

## 1. The matrix is smaller than expected, and that is the finding

**Five of six pipeline stages use no brain at all.** spec, compose, build, verify
and record are deterministic and cost nothing. There is exactly **one live cell**
in the brain-per-stage matrix today: **research**.

| Stage | Gate | Needs a brain? | Recommendation |
|---|---|---|---|
| research | parseable packet + independently verifiable sources | **yes** | see §2 |
| spec | derives from packet deterministically | no | keep deterministic |
| compose | template composition | no | keep deterministic |
| build | file writes | no | keep deterministic |
| verify | Playwright assertions | no | **never** give this a brain |
| record | journal write | no | keep deterministic |

Routing every stage to the cheapest brain that passes its gate is, today, a
one-cell decision. The rest of the matrix belongs to the roster's future stages
(designer, SEO, alt-text), which are spec'd and not wired.

## 2. The research cell: claude vs kimi

Both were given the same real task (research The Beehive Studio and return
strict JSON with retrievable sources).

| | claude CLI | kimi CLI |
|---|---|---|
| Web search + fetch | yes | **yes** (WebSearch + WebFetch) |
| Gate: parseable by our `extractJson` | yes | **yes, unmodified** |
| Facts extracted (Beehive) | 6-8 | **8** |
| Open questions | 9-11 | 6 |
| Wall time observed | 113s, 118.5s, 120.9s, 121s, 123s, 126s, 180s | **54.3s, 111.6s** |
| Reported cost | did-not-report (subscription) | did-not-report (subscription) |

**Quality is genuinely comparable.** kimi found the same Setmore source, hit the
**same Yelp 403** claude did, and independently surfaced the same
My-Salon-Suite-vs-Phenix location conflict claude flagged -- plus a ZIP code typo
claude did not catch. Its output carries a reasoning preamble and a
`To resume this session:` footer, and **our existing `extractJson` handles both
without modification** (verified against the captured 10,420-byte output: 8 facts,
6 open questions extracted cleanly).

**On speed, I am not making a speedup claim.** kimi's two samples are 54.3s and
111.6s. claude's seven are 113-180s. kimi looks faster and may well be, but n=2
against a variance range that wide does not support a number. **What is
established: kimi is a viable research brain, at comparable quality, at no
additional cost.**

### Recommendation for research

**Keep claude as the default. Wire kimi as a configured alternative and a
fallback.** Reasons:

- claude has seven observed runs and a known failure mode (one empty packet in
  eight, now retried). kimi has two runs and no failure data.
- Both are subscription-backed, so switching saves no dollars.
- The real value of kimi is **redundancy and concurrency headroom**: two
  independent subscription CLIs means a batch can be split across both, and an
  outage on one does not stop builds.

**Do not switch the default on two samples.** Promote kimi to default only after
it has a comparable run count. Recorded as a POST-SHIP measurement task.

## 3. Ollama: where a free local brain actually fits

Probed via the HTTP API (the `ollama run` CLI pollutes stdout with spinner
escape codes and is unusable for capture).

| Model | Task | Wall | Gate result |
|---|---|---|---|
| gemma3:4b | alt-text | 17,067ms | **PASS** — 84 chars, no preamble |
| gemma3:4b | strict JSON | 3,272ms | **FAIL** — wrapped in ```json fences |
| qwen3:8b | alt-text | 88,870ms | PASS content, **too slow** |
| qwen3:8b | strict JSON | 31,340ms | **PASS** — clean, unfenced |
| glm4:9b | alt-text | 165,715ms | PASS content, **far too slow** |
| glm4:9b | strict JSON | 5,749ms | **FAIL** — fenced |

**Ollama cannot do research.** No web access; it would fabricate sources, which is
the one thing this system refuses to do.

**Ollama is a good fit for bounded mechanical work**, which is exactly the roster
stages not yet wired: alt-text, meta descriptions, summarization. `gemma3:4b` is
the pick — an order of magnitude faster than the others and it passed the
alt-text gate cleanly. The fence problem is trivially handled (our `extractJson`
already tolerates fences) or by a stricter prompt.

**One quality caveat worth recording:** every local model reached for
"Luxurious"/"Luxury" in the skincare meta description. Starlight's own brand voice
**explicitly forbids** "luxurious". A local model will not honor brand contracts
it was not given, so these stages must be fed the brand constraints, not just the
task.

## 4. What changes in the default recipe

**Nothing, on this evidence.** The default recipe keeps research on claude and
every other stage deterministic. That is already the cheapest configuration that
passes every gate:

- five of six stages already cost zero and cannot be cheaper
- the one brain-using stage has no cheaper alternative (both candidates are the
  same subscription cost) and no better-evidenced one
- routing research to a local model would break the source-verification contract

**The efficiency win is not in routing.** It is in concurrency (E4).

## 5. Lane dispositions

- **gemini:** killed permanently, per standing rule and the terminal error.
- **Antigravity:** no headless path; closed.
- **kimi:** **revived** (ADR-0004 addendum). Wire as alternative + fallback.
- **Ollama:** viable for future mechanical stages; `gemma3:4b` preferred.
- **codex:** scaffolded, not probed this pass; it is not a research candidate
  because the research gate needs live web tools. Recorded as untested rather
  than assumed either way.
