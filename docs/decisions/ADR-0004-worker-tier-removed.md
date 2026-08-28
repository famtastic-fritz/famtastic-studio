# ADR-0004: CLI worker tier removed permanently

**Date:** 2026-08-22 | **Status:** accepted (owner rule, applied by the orchestrator) | **Supersedes:** the worker-CLI portion of amendment A8 and ADR-0003 item 2

## Owner rule
> If the Gemini/Kimi CLI calls fail — errors, timeouts, unusable output, or they need more orchestrator babysitting than they save — kill that lane immediately and permanently, note it in the capture, and run everything on Claude lanes without asking. No retry loops, no debugging sessions on worker infrastructure. One honest attempt during the Phase 1 census; failure means removal, working means it stays as the bulk tier.

## The one honest attempt (Phase 1 salvage census, 2026-08-22)
Three worker lanes were launched against the frozen census, one per batch.

| Lane | Runtime | Result |
|---|---|---|
| A3, 123 clusterable read-only routes | Kimi CLI | **Succeeded.** 123 records, good quality, reviewed and accepted. |
| A1, 19 proof/deploy/auth routes | Kimi CLI | **Failed.** `403 You've reached your usage limit for this billing cycle`. |
| A2, 121 conversation/journal/event/mutating routes | Kimi CLI | **Failed.** Same 403. |
| (any) | Gemini CLI | **Failed before dispatch.** `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`; requires migration to Antigravity, which is installed as a desktop app but exposes no CLI on PATH. |

## Verdict: REMOVED
The attempt failed. Gemini never ran at all. Kimi completed one of three lanes and then failed in a way that required the orchestrator to detect the failure, kill stuck processes, re-split the work, and reroute both remaining batches to T2 subagents. That is precisely the "more orchestrator babysitting than they save" condition.

**Both CLI worker runtimes are removed from the routing model permanently.** No retry when the Kimi quota refreshes. No Antigravity migration attempt. No further worker-infrastructure debugging. This decision is not revisited unless Fritz reopens it explicitly.

**What A3's output does not change:** the 123 records Kimi produced are good and stay in the salvage set. One successful lane does not earn the tier a second chance under a rule that says one attempt.

## Routing model in force from now
| Tier | Runtime | Use for |
|---|---|---|
| T2 | Claude Code subagents (Sonnet-class) | all bulk and implementation work, including what the worker tier was meant to absorb: census extraction, inventory diffs, schema validation, scaffolds, capability-record drafting, doc generation, test writing |
| T3 | orchestrator (Fable-class) | planning, architecture, integration verification, disputed verdicts, anything touching proofs, deploys, or isolation |
| Reviewer | Codex, read-only sandbox | adversarial review only, never a worker |

There is no tier below T2. Every retro reports actual per-tier usage, and the cost of bulk work at T2 rates is stated plainly rather than absorbed quietly.

## Consequence to accept honestly
Bulk work now costs roughly an order of magnitude more than the original routing intended. The A2 batch alone consumed about 637k tokens across five T2 sub-lanes for work the directive meant for a CLI worker. The efficiency north star is served instead by not dispatching a model at all where a deterministic script will do: the salvage census generator and the Drive mirror are both plain scripts precisely for this reason, and that is the pattern to reach for first.

---

## Addendum, 2026-08-23: the evidence changed, half of it

**The original decision stood on the evidence of its day and is not being
rewritten.** Both worker CLIs failed their one honest attempt, so the tier was
removed. That was correct then. Re-probing under the efficiency directive
produced different results for one of the two.

### kimi: now works, re-enters the matrix

```
$ kimi -p "Return exactly AUTH_OK"
exit=0  elapsed_ms=7527
kimi version 0.37.2
• AUTH_OK
```

Whatever blocked it on the original attempt no longer does. kimi returns to the
E3 brain-per-stage trial as a live candidate. Note for whoever wires it: its
output carries a bullet-point reasoning preamble and a session-resume footer
around the answer, so an adapter must extract rather than read stdout raw.

### gemini: permanently retired, not merely failed

```
$ gemini -p "Return exactly AUTH_OK"
exit=1  elapsed_ms=2599
Error authenticating: IneligibleTierError: This client is no longer supported
for Gemini Code Assist for individuals. To continue using Gemini, please
migrate to the Antigravity suite of products
```

This is a different class of failure from the original one. Google ended the
individual tier; the client is unsupported, and no retry or version bump changes
that. **gemini is never to be probed, benchmarked, or scaffolded against again.**

The Google replacement route, Antigravity, was evaluated within a 15-minute box
and has **no headless invocation** our adapter interface can drive. See
`docs/efficiency/GOOGLE-ROUTE-FINDING.md` for the exact commands, outputs, and
the narrow conditions that would reopen it.

### Net effect on this ADR

The worker tier is no longer removed on the grounds that *all* worker CLIs fail.
It is: **kimi live, gemini permanently retired, no Google route available,
Ollama available locally and free.** The E3 trial decides what actually gets
routed where, on measured evidence.
