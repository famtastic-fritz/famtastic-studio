# ADR-0008: The research kernel is a shared capability, not Studio's private code

**Status:** Accepted (ratified by Fritz 2026-08-23)
**Related:** ADR-0007 (platform boundary and Selected Build Packet)

---

## Context

`research.js`, `spec-derive.js` and `packet.js` were built inside Site Studio,
but research grounding is not a Studio concern. FAMtastic Designs needs the same
capability for intake and proof generation. The default outcome of that
situation is a fork: Designs copies the module, the two drift, and within weeks
there are two definitions of what a verified fact is.

## Decision

**These three modules are designated the proto-Research-Center: one
implementation, no forks.**

Both platforms reach it through a single callable interface,
`server/kernel/research-center.js`, which exposes exactly four capabilities:

```
research.run                 live search, then independent re-fetch of every cited source
research.packet.validate     the packet schema is part of the seam
research.packet.read
spec.derive                  packet -> creative spec
```

`describe()` returns the interface version, packet schema version, capability
list, and where the implementation currently lives, so a consumer can assert
compatibility rather than assume it.

**Rule: if a platform needs behavior this interface does not expose, extend the
interface. Never copy `research.js`.**

## Why a facade instead of direct imports

The moment two platforms import module internals, the internals become the
contract and the capability can never move. With the facade in place, relocating
the implementation later -- into its own service, its own repo, behind a network
call -- is a **relocation, not a rewrite**. Callers keep calling the same four
functions.

The facade is deliberately thin. It adds no logic, so it cannot become a second
place where research behavior lives.

## The seam, stated

```
Designs ─┐
         ├─> research-center.js ─> research.js / spec-derive.js / packet.js
Studio  ─┘        (interface)              (one implementation)
```

Today the implementation is co-located with Studio. That is an accident of
history, recorded here so it is not mistaken for ownership. Studio does not own
research; it currently hosts it.

## Consequences

- Relocation is scheduled work, not a rewrite, and is logged in POST-SHIP.
- The packet schema version is now part of a cross-platform contract, so bumping
  it is a breaking change for two consumers rather than one.
- A Designs-side change to research behavior lands in one place and both
  platforms get it.
