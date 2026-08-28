# Orchestrator review of worker output (standing requirement)

Directive 2026-08-22 item 4: the orchestrator reviews all CLI worker output before merge, exactly as it reviews subagent output. This file records those reviews.

## Batch A3 (123 clusterable read-only routes), Kimi CLI, 2026-08-22

**Accepted with notes.** Records read the real source, verdicts are defensible, identity observations are concrete (they quote the ambient binding when they find one).

Verdict distribution: RETIRE 59, KEEP-CONVERT 51, ADAPT 12, ARCHIVE-FOR-FUTURE 1.

**Finding raised by reviewing this batch:** the census includes 3 route registrations from test harness files (`server/__smoke__/operator-fast-server.js` x2, `server/__smoke__/operator-action-repro.js` x1) out of 263 on main. The census `exclusions` rule skips `__tests__`, `*.test.js` and `*.spec.js` but not `__smoke__`. The worker correctly identified all three as harnesses and marked them RETIRE, so the disposition is right and no record is wrong. Recorded rather than regenerated: over-inclusion is the safe direction for a salvage census, and the reviewer caught it. If the census is regenerated for any other reason, add `__smoke__` to the exclusion patterns and note the count change.

**Second note:** only 1 of 123 records carries an `UNDETERMINED` marker. For simple read-only routes that is plausible, but the honest-gap instruction only pays off if workers actually use it. Spot-check a sample of the A1 and A2 batches specifically for confident claims about side effects that the source does not support, since those batches cover mutating and proof-adjacent surfaces where a confident guess is a real defect.

**Housekeeping:** the worker also wrote a helper `docs/salvage/records/extract-routes.js` that it was not asked to create. Harmless, left in place as evidence of how the batch was processed.

## Worker tier outage, 2026-08-22

Both worker runtimes named in the routing directive are unavailable:
- **Gemini CLI:** `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`. Requires migration to Antigravity. Antigravity is installed as a desktop app but exposes no CLI on PATH, so it cannot be driven as a background worker today.
- **Kimi CLI:** completed batch A3 (123 records), then returned `403 You've reached your usage limit for this billing cycle` on batches A1 and A2. Quota refreshes next cycle.

**Disposition:** batches A1 (19 proof, deploy and auth routes) and A2 (121 conversation, journal, event and mutating routes) rerouted to T2 subagents with orchestrator review. This costs more than the directive intends, and it is recorded rather than hidden. Note that A1 is arguably correct at a higher tier regardless: it covers the protected-revenue and auth surfaces, which the routing rules already reserve for premium judgment.

**For Fritz:** worker offload resumes when either Kimi quota refreshes or an Antigravity-based CLI path exists. Until then every tier below T2 is empty.

## Tier decision, 2026-08-22

The worker tier is **removed permanently** under the owner's one-attempt rule. See `docs/decisions/ADR-0004-worker-tier-removed.md`. Batch A3's 123 records remain part of the salvage set and are unaffected; one successful lane does not reopen the tier. No retry when the Kimi quota refreshes, no Antigravity migration, no further worker-infrastructure debugging.
