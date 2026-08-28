# Boundary classification: doctrine vs workaround

**Asked for:** 2026-08-25. **Scope:** every cross-repo boundary ruling found in
the SITE-LEARNINGS lineage, the Designs repo, and the site-context files.
**Not done here:** no change to P0-I1. It is load-bearing for revenue safety
today and stays exactly as it is until ruled on.

## The premise, tested

The claim to test was: *the 2026-08-23 Designs ruling was a workaround for Site
Studio being down, and it hardened into architecture.*

**The evidence supports it.** The decisive find is a ruling from **three and a
half months earlier**, in the opposite direction:

> **2026-05-05 — Site Studio Service Auth Ownership**
> "Provider authentication now belongs to Site Studio/platform, not to generated
> sites... verifies that a generated site consumes Studio-owned services instead
> of owning provider accounts. MBSH is the first proof."

That is production capability deliberately centralized **into** Studio, with a
proof packet behind it. Nothing rescinded it on the merits. What happened later
is that Studio went down, work rerouted, and the reroute got written up as
architecture.

Second corroborating find, **2026-08-01**:

> "generate through Shay, package each direction as script-free standalone HTML
> ... serve it from `/proofs`"

Generation on the Studio/Shay side, **serving** on the Designs side. That is the
pre-outage split, and it is the split that makes sense: Designs is the storefront
that shows a customer their proof; Studio is the workhorse that makes it.

## Classification

### DOCTRINE — keep, these are a real business/production split

| Boundary | Where | Why it is doctrine |
|---|---|---|
| Customer identity and accounts | Designs learnings, 2026-08-10 | Account ownership is checked on edit and at checkout; a second customer's attempt is rejected. This is the system of record for who someone is. |
| Intake and the quote/solution-finder funnel | Designs learnings | Where a prospect enters the business. Business surface by definition. |
| Purchases, Commerce, Stripe, orders | Designs learnings, 2026-08-10 | Money. Regulatory and financial system of record. Never Studio's. |
| Proof **decisions** (which direction the customer picks) | Designs learnings | A commercial decision by a customer, recorded against their account. |
| Email, SMTP, two-way reply ingestion | Designs learnings, 2026-08-10 | Customer communication under the business identity. |
| Customer-visible timeline and review links | Designs learnings, 2026-08-01 | The customer's window into their own job. |
| Consent and outreach records | `OperationalLedger.php` | Legal obligation attached to the business entity. |

These are all answers to *"what does the business know and owe about this
customer."* They belong to Designs on the merits and would still belong there if
Studio had never gone down.

### WORKAROUND — flag, revisit, these compensate for an outage or a gap

| Boundary | Where | Why it is a workaround |
|---|---|---|
| **Preview/proof generation** | 2026-08-23 ruling, hardened into P0-I1 | Directly contradicts 2026-08-01 ("generate through Shay"). Generation is production capability. It moved because Studio was unavailable, not because Designs is the right home for it. |
| **Build DNA ownership** | legacy `site-studio/server.js:4714` writes `design-dna.json` under the proof output dir | DNA is build telemetry: `style_fingerprint`, `layout_variant`, `font_pairing`, `media_fulfillment`, `generation_time_ms`. It describes how the *builder* worked. Storing it beside the customer-facing proof put build telemetry in the storefront. |
| **Artifact hosting** (`/proofs`) | 2026-08-01 | Serving the artifact is arguably Designs'. **Owning** it is not. Today the only durable copy of some proofs lives on the Designs side, which makes Designs the de-facto artifact store for build output. |
| **Media/imagery generation** | Designs Gemini worker is "current" | The worker holds the credential, so Studio cannot generate without crossing into Designs. That is a credential-location accident, not a design. |
| Provider credentials for build-time services | contradicts 2026-05-05 | 2026-05-05 explicitly centralized these in Studio's vault. Any build-time provider key now living on the Designs side is drift from a ratified ruling. |

### AMBIGUOUS — needs your call, genuinely arguable

| Boundary | The tension |
|---|---|
| Proof **hosting** vs proof **storage** | Serving from a customer-facing domain is a business function. Being the only place the bytes exist is not. These can be separated: Studio owns the artifact and its DNA, Designs serves a copy. |
| Screenshot/thumbnail generation | Currently packaged with serving. It is a build output, but it exists to make the storefront card look right. |

## What P0-I1 actually forbids, precisely

`assertNoProofRoutes()` refuses boot on `/proof-jobs/`, `/integrations/famtastic`,
and `/proof.*callback`. It is deliberately **narrow**: it does not forbid
`/api/proofs`, because D3 requires that read path.

So the invariant forbids Studio **serving proof ingress** — accepting a job or a
callback. It does not forbid Studio *generating* a proof and handing it over.
**That distinction is the whole reclamation path**, and it means reclamation does
not require weakening the revenue-safety guarantee.

## Proposed staged reclamation (for your ruling, not yet actioned)

The ordering principle: **never make Studio a listener.** Every stage keeps
Designs as the only thing production dispatches to, and keeps P0-I1 intact.

**Stage 0 — no code, decide the target.** Ratify or reject the target split:
Studio owns generation, DNA, and the artifact of record; Designs owns identity,
intake, money, decisions, communication, and serving. Everything below assumes
that target.

**Stage 1 — reclaim Build DNA. Low risk, no ingress.**
Studio already writes complete DNA for its own builds. Extend it to accept a
DNA record produced elsewhere, so there is one build-telemetry store. Designs
keeps writing its copy; Studio becomes the system of record. Reversible by
ignoring the store. **No P0-I1 change.**

**Stage 2 — reclaim artifact-of-record. Low risk, no ingress.**
Studio keeps the durable copy of each generated proof plus its hash; Designs
serves a copy and remains the customer-facing URL. Verify by hash equality
before anything depends on it. **No P0-I1 change.**

**Stage 3 — reclaim generation, outbound only.**
Designs continues to *receive* the job from production, then **calls Studio** to
generate, and serves the result. Studio is a callee, never a listener: no route
matching the forbidden patterns is added, so **P0-I1 stays exactly as written**.
This is the stage that restores 2026-08-01's actual arrangement.
Requires: an authenticated Studio-side generate endpoint that is not a proof
ingress route, and a Designs-side client with a timeout and fallback to today's
path.

**Stage 4 — only if ever wanted: direct ingress.**
This is the only stage that would require touching P0-I1, and **it is not
needed** for any of the value above. Recommendation: do not do it. The invariant
is cheap to keep and it is what makes G4-1 provable.

**What would have to be true before Stage 3:** Studio up with an uptime record
that survives its own restart policy; a rollback that returns to today's path in
one config change; and a real proof generated both ways with outputs compared.

## The meta-finding

An outage produced a routing decision. The routing decision got written into a
learnings file. A later session read that file as settled architecture and
hardened it into a boot invariant. **At no point did anyone decide that Designs
should own production capability** — it accreted, because a workaround written
down in the same voice as a ruling becomes indistinguishable from one.

The protocol fix is in `CROSS-REPO-INDEX.md`: rulings must record *why* they were
made, and a ruling made under duress must say so.
