# ADR-0010: Studio generates, Designs serves. Studio is never a listener.

**Status:** accepted, 2026-08-25 (ruling 1)
**Circumstance:** normal
**Supersedes:** the 2026-08-23 preview-ownership ruling, reclassified as an
outage workaround
**Restores:** 2026-05-05 (Site Studio Service Auth Ownership) and 2026-08-01
(generate through Shay, serve from `/proofs`)

## The classification, ratified

**WORKAROUND, not doctrine:** preview generation, Build DNA ownership, artifact
hosting, media generation, build-time provider credentials.

The 2026-05-05 ruling centralized provider auth into Studio with a proof packet
behind it. The 2026-08-01 ruling put generation on the Studio/Shay side and
serving on the Designs side. Neither was rescinded on the merits. Studio went
down, work rerouted, and the reroute was written up in the same voice as a
ruling, which made it indistinguishable from one.

**DOCTRINE, unchanged:** customer identity, intake, purchases, proof decisions,
email, customer-visible timeline, consent records. These answer *what the
business knows and owes about this customer* and belong to Designs on the merits.

## Doctrine: Stage 4 is permanently off the table

**Site Studio will never accept proof ingress.** Not as a deferred option, not
behind a flag. P0-I1's `assertNoProofRoutes()` stays exactly as written, and
revenue gate G4-1 continues to rest on it.

This costs nothing, because the invariant forbids Studio *serving* ingress, not
Studio *generating* and handing over. Every stage worth doing is reachable with
Studio as a callee.

## The shape

```
production ──dispatch──> Designs ──calls──> Studio
                            │                  │
                       serves result     generates, owns DNA
                                          and artifact of record
```

Designs is the only thing production dispatches to. Studio is called and
returns. **Studio opens no route that production can reach.**

## Stages

**Stage 1 — Build DNA becomes Studio's.** Studio accepts a DNA record produced
elsewhere so there is one build-telemetry store. Designs keeps writing its copy.
Reversible by ignoring the store. No ingress, no P0-I1 change.

**Stage 2 — artifact of record becomes Studio's.** Studio keeps the durable copy
plus its hash; Designs serves a copy and stays the customer-facing URL. Verified
by hash equality before anything depends on it. No ingress, no P0-I1 change.

**Stage 3 — generation returns to Studio.** Designs still receives the job from
production, then calls Studio to generate, and serves the result. Requires an
authenticated Studio-side generate endpoint that is **not** a proof ingress
route, and a Designs-side client with a timeout and fallback to today's path.
No P0-I1 change.

**Preconditions for Stage 3:** Studio up with an uptime record that survives its
own restart policy; rollback to today's path in one config change; one real proof
generated both ways with outputs compared.

## Credentials return LAST, and are not moving yet

Build-time provider credentials returning to Studio's vault — restoring
2026-05-05 in full — is **planned, gated, and deliberately not part of Stages
1-3.** It happens only after Stage 3 is proven in production.

**Recorded now so the drift is visible:** today the Designs Gemini worker holds
the media credential, which contradicts a ratified ruling. That contradiction is
known, accepted for now, and scheduled — not forgotten. Until then Studio calls
the worker across the seam and holds no key, which is why
`server/kernel/media-providers.js` has no legal `api_key` auth mode.

## Why an outage workaround became architecture

Nobody decided Designs should own production capability. A routing decision made
under duress was written into a learnings file in the same voice as a ruling; a
later session read it as settled and hardened it into a boot invariant. The
protocol fix is ADR-0011's `circumstance` field: a ruling made during an outage
must say so, and expires unless re-ratified.
