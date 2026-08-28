# ADR-0007: The FAMtastic Designs / Site Studio boundary, and the Selected Build Packet

**Status:** Accepted (amendment, ratified by Fritz 2026-08-23)
**Supersedes:** nothing. Amends the working assumption that Site Studio owns the
whole path from intake to deploy.

---

## Context

Site Studio was built as though it owned everything from a customer brief to a
live site. In practice two platforms exist and the seam between them was never
named, so proof generation, research, and build logic drifted across both.

## Decision

**FAMtastic Designs owns:** intake → research packet → creative spec → proofs and
proof DNA. Its output is **preview-only**. Designs never deploys.

**Site Studio owns:** selected build packet → production build → deploy → verify
→ journal. Studio is the system of record for builds.

**The seam is a single versioned artifact: the Selected Build Packet.** It is the
only supported way work crosses from Designs to Studio. No shared database
reads, no reaching into each other's directories, no implicit conventions.

```
Designs                                    Studio
-------                                    ------
intake
  -> research packet   ─┐
  -> creative spec      ├─> SELECTED BUILD PACKET ─> production build
  -> proofs + proof DNA ┘        (versioned)         -> deploy
     (preview only)                                  -> verify
                                                     -> journal
```

## The Selected Build Packet

Schema `selected_build_packet.v1`. Required content:

| Field | Why it is required |
|---|---|
| `schema_version` | the contract is versioned or it is not a contract |
| `packet_id`, `created` | identity and ordering |
| `customer` | `{id, name, email}` -- A1 identity binding needs a real subject |
| `chosen_direction` | which proof direction the customer picked, by id and name |
| `spec` | the creative spec for that direction |
| `brand` | palette, typography, voice, and any contracts |
| `asset_refs[]` | references to assets, never inlined bytes |
| `research_packet_ref` | `{packet_id, brief_hash, source_adapter}` -- provenance back to grounding |
| `origin` | `legit` or `test`, per the truth pass |
| `boundary` | `{external_mutation_allowed, deploy_authorized}` -- explicit, from the salvage pattern |

Two rules that make it a real boundary:

1. **Studio validates on receipt and refuses an invalid packet.** No partial
   acceptance, no defaulting missing fields.
2. **`deploy_authorized: false` means Studio may build but must not deploy.** The
   packet carries its own permission rather than Studio inferring it.

## Consequences

- Proof generation currently living in Studio is on borrowed time. It keeps
  running (see the cutover amendment) but its target home is Designs.
- The research kernel is shared rather than duplicated (ADR-0008).
- Moving either platform's internals is safe as long as the packet holds.
- A packet can be replayed: it carries its own provenance refs.
