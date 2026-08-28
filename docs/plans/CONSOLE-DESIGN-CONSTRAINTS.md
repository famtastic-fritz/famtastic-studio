# Console design constraints — settled by research

Every constraint here traces to a fact in `docs/research/console-packet.json`
whose source was independently re-fetched (HTTP 200) before it was promoted. The
packet's `mutable: false` flag marks the ones a builder may not reword or
negotiate.

Ratified 2026-08-25. Round 1 of the research run; round 2 is outstanding.

---

## 1. No progress indicator under 1 second

State change only. Do not show a spinner for a stage that completes in under a
second — a looped animation there "flashes distractingly" and causes anxiety
about whatever appeared on screen.

*Source: NN/G Progress Indicators. `mutable: false`.*

## 2. Research stage: determinate progress, time estimate, interrupt control

Research is a multi-second, variable-duration stage, so it takes the ≥10s
treatment: a percent-done indicator, an estimate of remaining time, and a
clearly signposted way to interrupt.

Note the source's own hedge, which applies directly here: *lower* the 10s cutoff
when duration estimates are highly variable. Research duration is not
predictable, so it gets the determinate treatment regardless of the estimate.

*Sources: NN/G Progress Indicators; NN/G Response Time Limits. `mutable: false`.*

## 3. Builds run in the background — nothing holds the operator past 10 seconds

10 seconds is the limit for keeping attention on a dialogue; beyond it users
want to do something else, and RAIL puts abandonment at the same mark. A build
takes minutes. Therefore a build must never be a modal wait: it runs in the
background, and the operator is free to leave and return.

The corollary from the same source is a real requirement, not a nicety —
returning after >10s means the operator **must be able to reorient**. The build
view has to be readable cold, without having watched it.

*Sources: NN/G Response Time Limits; web.dev RAIL. `mutable: false`.*

## 4. All interactive targets ≥ 24 × 24 CSS pixels

WCAG 2.2 SC 2.5.8. Five exceptions exist (Spacing, Equivalent, Inline, User
Agent Control, Essential) — the Spacing exception permits smaller targets only
when 24px-diameter circles centred on each do not intersect.

**Known failure:** the mockup's floating toolbar does not meet this. It is a
cluster of adjacent controls, so the Spacing exception does not rescue it.

*Source: WCAG 2.2 SC 2.5.8. `mutable: false`.*

## 5. Click-to-edit target is 100ms, not 140ms

100ms is the documented limit for a user to feel they are *directly
manipulating* an object rather than issuing a command. Click-to-edit makes
exactly that claim, so it inherits exactly that budget. The prior 140ms had no
source. Applied in `PHASE-2-CONTRACTS.md`.

RAIL corollary: to land a visible response inside 100ms, process input within
50ms — the rest of the budget is already spoken for by other main-thread work.

*Sources: NN/G Response Time Limits; web.dev RAIL. `mutable: false`.*

## 6. Console INP gate ≤ 200ms — worst case on this machine, not p75

The 200ms good/needs-improvement boundary is adopted. **The 75th-percentile
measurement method is explicitly rejected for the console.**

The reason is that p75 is calibrated for anonymous public traffic across unknown
devices, where the tail is other people's hardware. This console has one
operator on one known machine. Measuring at p75 here would discard the worst
quarter of *the only user's* experience. The gate is therefore worst-case,
measured on the development machine.

This is a deliberate departure from the source's stated method, recorded as such:
the **threshold** is sourced, the **measurement method** is ours.

*Source: web.dev INP (threshold only). Method: operator decision, 2026-08-25.*

## 7. Retry: initial 1s, multiplier 2 — and nothing else from that source

Every Google Cloud Storage client converges on initial delay 1 second and
exponential multiplier 2. That convergence is the defensible part and is
adopted.

**Max backoff and retry counts are NOT adopted.** Those figures (30–300s; 3
retries to unlimited) are object-storage defaults. Our failure modes differ:
research queries and media generation are slow, expensive, and fail differently
from an object GET. Remains an open question in the packet.

*Source: Google Cloud Storage retry strategy (initial delay and multiplier only).
`mutable: true`.*

---

## Constraints added by round-2 gap closers

## 8. Non-text contrast ≥ 3:1

Applies to whatever identifies that a control exists, how to operate it, and its
state — focus rings, checkbox marks, slider thumbs, dropdown arrows, and the
background of a borderless input. Inactive controls are exempt, as are hover
treatments and state colours that never appear side by side. A hit-area border
needs 3:1 only when nothing else identifies the control.

*Source: WCAG 2.2 SC 1.4.11. `mutable: false`.*

## 9. Any timeout must offer turn-off, 10× adjust, or a 20-second warning

For any content-set time limit: let the operator turn it off, or adjust it over
a range of at least ten times the default, or warn before expiry with at least
20 seconds to extend by a simple action and at least ten permitted extensions.
Exempt: real-time events, cases where extending invalidates the activity, and
limits longer than 20 hours.

Combined with SC 2.2.6 from round 1 — no warning is required at all if state
survives 20 hours of inactivity. **Persisting run state past 20 hours is the
cheaper compliance path than building a warning-and-extend dialog.**

*Sources: WCAG 2.2 SC 2.2.1 and SC 2.2.6. `mutable: false`.*
