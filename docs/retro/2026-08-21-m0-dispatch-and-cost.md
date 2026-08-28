# M0 dispatch map and model-tier cost report

Required attachment to `2026-08-21-m0.md` (directive items 4-5). Covers the pre-go gate and Phase 0 through M0, on branch `studio-rebuild/phase-0`.

## Dispatch map

| # | Lane / dispatch | Runtime | Tier | Owned paths or scope | Ran with | Outcome |
|---|---|---|---|---|---|---|
| 1 | Orchestrator (this session) | Claude Code, Fable-class | T3 | kernel, `server/index.js`, `config/*`, project skills, all docs, integration verification | n/a | kernel + 3 skills + every gate run + all dispositions |
| 2 | Codex review round 1 | `codex exec --sandbox read-only`, codex-cli 0.147.0 | reviewer | whole plan vs both repos | sequential | 4 BLOCKER, 11 MAJOR, verdict NOT SAFE |
| 3 | Codex review round 2 | same | reviewer | fixed items only | sequential | 10 resolved, 5 partial, SAFE WITH FIXES |
| 4 | Codex review round 3 | same | reviewer | 5 partials only | sequential | 5 resolved, SAFE TO START PHASE 0 |
| 5 | Drive upload (contract docs) | Claude Code subagent, Sonnet | T2 | 10 docs to Drive via connector | solo | 10 uploaded, one re-done via base64 after quote normalization |
| 6 | API modules | Claude Code subagent, Sonnet | T2 | `server/modules/{work,sites,platform,operations,admin}`, `config/providers.json` | parallel with 7, 8 | 13 endpoints |
| 7 | Console | Claude Code subagent, Sonnet | T2 | `public/**`, `server/modules/console` | parallel with 6, 8 | console-kit + 11 pages |
| 8 | Gates | Claude Code subagent, Sonnet | T2 | `scripts/*`, `tests/*` | parallel with 6, 7 | 2 lint rules, 32 tests, Playwright smoke |
| 9 | Drive tree + mockup restore | Claude Code subagent, Sonnet | T2 | Drive folder creation, mockup download | solo | tree created, mockup restored at 50119 bytes |
| 10 | Mirror upload (superseded) | Claude Code subagent, Sonnet | T2 | 25-file mirror via connector | solo | killed at 5/25; replaced by the free script path |

Lanes 6, 7 and 8 were the only true parallel fan-out: three lanes, disjoint paths, one shared interface fixed in advance by the kernel and `CONVENTIONS.md`. Wall clock for all three was about three minutes.

## Model-tier cost report

Harness-reported subagent token totals. The orchestrator's own usage is not separately metered by this harness, and Codex runs on its own subscription and is not metered here. Stating that plainly rather than inventing numbers.

| Tier | Dispatches | Reported tokens | Notes |
|---|---|---|---|
| T0 local (Ollama) | 0 | 0 | **Tier retired by owner directive 2026-08-22.** Never used. |
| T1 cheap | 0 | 0 | **Not used. This was the real gap.** Redefined by directive as Gemini and Kimi CLIs on existing subscriptions. |
| T2 standard (Sonnet subagents) | 6 | ~669k | 107k + 110k + 110k (build lanes), 232k (Drive upload), 90k (Drive tree), 10k+ (mirror, killed at 5/25) |
| T3 premium (orchestrator) | whole session | not separately metered | planning, dispositions, production investigation, integration verification |
| Codex (adversarial only) | 3 rounds | not metered here | separate subscription; never used as a worker |

## Honest reading of these numbers

- **Roughly a third of T2 spend went to file copying.** Lanes 5, 9 and 10 (Drive work) burned about 332k tokens moving bytes. That work is now `cp` in `scripts/sync/drive-mirror.sh` at zero cost, since Drive for Desktop is installed. The lesson generalizes: any lane whose output is deterministic given its input should not be a model dispatch.
- **No cheap-tier work was dispatched at all.** Every implementation lane went to T2 by default. Under the plan's own routing rules, scaffolds and test writing were T1 work. The corrective is directive item 4 and it lands in Phase 1.
- **The three build lanes were well spent.** Each produced working code that passed the gates after one integration fix, at about 110k tokens apiece.
- **The most valuable dispatches were the cheapest to run**: three Codex rounds on an existing subscription turned a plan with four blockers into one cleared to start.

## Tier definitions in force from Phase 1 (directive 2026-08-22)

| Tier | Runtime | Use for |
|---|---|---|
| Worker CLI | `gemini` and `kimi` CLIs as background shell processes on existing subscriptions, no API keys | bulk mechanical work: census extraction, inventory diffs, schema validation, scaffolds, capability-record drafting |
| T2 | Claude Code subagents, Sonnet | implementation, integration, debugging |
| T3 | orchestrator, Fable-class | planning, architecture, disputed verdicts, anything touching proofs, deploys, or isolation |
| Reviewer | Codex, read-only sandbox | adversarial review only, never a worker |

Orchestrator reviews all CLI worker output before merge, exactly as it reviews subagent output. Actual per-tier usage is reported in every retro from here on.
