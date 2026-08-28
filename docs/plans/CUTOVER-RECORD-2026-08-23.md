# Cutover record: executed 2026-08-23

> **SCOPE CORRECTION (2026-08-25, ruling 4).** "System of record for production
> site builds" is scoped to **what Studio can represent**. Studio's spec
> vocabulary covers pages, sections, brand and media — a brochure site. It has
> no field for a database, endpoint, session, scheduled job or upload target, so
> a site with a server-side runtime cannot be represented, only carried.
> **MBSH is deployed and live and Studio could not rebuild it.** Sites now carry
> `capability_class` (`brochure | application`) and the console shows it, so the
> limit is visible rather than implied.

**Authorized by:** Fritz, closing sequence item 4.
**Pre-cutover tag:** `pre-cutover-2026-08-23` (pushed)
**Gates on the cut commit:** lint OK, 521 tests / 36 files, smoke 11/11, G4-0 PASS,
G4-1 PASS, exit 0.

---

## 1. Rollback rehearsal — PASSED, before anything was flipped

Run against real deploys of the acceptance site, not a fixture:

```
deploy #1  dep_mt6fjv2hb99ruo2x   16 files
edit index.html (inserted a CHANGED marker)
deploy #2  dep_mt6fjv39o9rbej6m   prior: dep_mt6fjv2hb99ruo2x
rollback   -> restored dep_mt6fjv2hb99ruo2x

restored bytes match original: true
CHANGED marker present after rollback: false
```

The rollback path in the runbook is proven, not assumed.

## 2. What was flipped

**Site Studio (next) is now the system of record for builds.**

- Installed `com.famtastic.studio-next` LaunchAgent, port **3400**, loopback only,
  `RunAtLoad`, `KeepAlive`, throttled.
- Boot clean: `P0-I1 preflight cleared 60 files`, 15 modules loaded.
- Every console route and API verified 200: `/`, `/sites`, `/builds`, `/proofs`,
  `/deployments`, `/media`, `/applications`, `/api/sites`, `/api/builds`,
  `/api/proofs`.
- New telemetry verified live: the acceptance run shows
  `duration_ms: 326048`, `cost: $0 + 1 unreported`, and the one-click outcome
  decision round-tripped (`shipped`, persisted, reflected in `/api/builds`).

**Legacy is cold, not gone.** `com.famtastic.studio` was booted out of the
domain: port 3340 no longer answers, and its plist remains installed at
`~/Library/LaunchAgents/com.famtastic.studio.plist`. It is one
`launchctl bootstrap` away for the 30-day window. The two use different ports,
so nothing had to be overwritten to make room.

## 3. What was NOT flipped, and why — read this part

**The proof webhook flip was not executed. It is not executable as specified,
for two independent reasons, and neither is a matter of effort.**

**Reason one: Studio-next cannot serve proof ingress, by invariant.** `D3` makes
proofs read-only and `assertNoProofRoutes()` runs inside the P0-I1 preflight,
refusing boot if any proof ingress is registered. Next has exactly one proof
route in the entire codebase, `GET /api/proofs`. Adding a webhook receiver would
fail the boot invariant that revenue-safety gate G4-1 depends on.

**Reason two: production has no dispatch path to any Studio.** Verified
read-only: no `SITE_STUDIO_URL` in settings or env, and
`famtastic_proof.settings` does not exist as a config object. Production has
never dispatched to Site Studio and cannot today. For it to reach a
loopback-bound local service it would need the Cloudflare Tunnel, which is
logged in POST-SHIP as not built.

**The CUTOVER-AMENDMENT's interim state therefore contains a contradiction**
that this execution surfaced: it says the proof webhook keeps being served "by
the new path, not the stamp logic", but the new path is forbidden from serving
it by the same invariants that make the cutover safe. Amendment and invariant
cannot both hold. The invariant wins, because G4-1 rests on it.

**The practical effect is benign, and is the outcome the standing rule wanted
anyway: the live proof pipeline is completely untouched.** Proof generation
never ran through Studio; it happens inside Drupal and adjacent tooling. Cutting
the build path over does not disturb it in any way.

## 4. "One real proof job verified" — not performed

It cannot be, per section 3: there is no ingress on the new path and no dispatch
from production. Recorded as not done rather than substituted with something
that resembles it. The nearest real evidence is section 2's live verification of
the build path and the acceptance artifact.

## 5. Watch list, next 48 hours (per runbook §3)

- `execution_status` distribution on new packets — a collapse to `no_findings`
  means the research CLI is failing. Note it is now retried on both an empty
  packet and a transient adapter failure.
- The `origin` split on `/api/sites` — real customer sites must land `legit`,
  never `unknown`.
- Media fill rate — currently ~60-80% per run, the rest lost to generator
  rate-limiting and honestly declared.
- The efficiency log at `.studio/dna/efficiency.jsonl` — one line per run.

## 6. Reversal, if wanted

```bash
launchctl bootout gui/$UID/com.famtastic.studio-next
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.famtastic.studio.plist
```

Legacy returns on 3340. Nothing was deleted, and no production record was
written at any point in this cutover.
