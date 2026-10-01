# Mobile owner navigation discovery 1.0.0

Site Studio Next pins Component Studio revision `397e341c0962ab8e2595663164ad5efa6bc731cf`. That catalog includes `mobile-owner-nav` 1.0.0, a neutral installable phone owner control with service and retail examples. The Component Studio installer and tests verify independent file-hash-receipted installs and that a tap does not falsely mark an uncompleted route active.

Discovery uses the existing read-only `/api/libraries` and `/api/component-recipes` paths. The configured Component Studio checkout must have the pinned origin and exact HEAD; a missing or different checkout reports unavailable. Site Studio Next does not import or run the package, and no customer build receives it automatically. The original salon site does not depend on this library at runtime.

| Capability | State |
|---|---|
| Neutral mobile owner navigation source | Captured in Component Studio 1.0.0 |
| Independent installation for two configurations | Locally tested |
| Exact-revision Site Studio Next catalog discovery | Locally tested against pinned checkout |
| Site Studio executable import/generation | Not implemented |
| Shay production use of the new package | Not implemented; existing site navigation is independent |
| Owner phone acceptance | Pending Fritz's physical-phone check |

The month calendar, account security controls, Google connection, Booksy data, reservation authority and creator-credit clearance are separate capabilities. See [reuse research](../research/MOBILE-OWNER-DESK-REUSE-2026-10-01.md) for their evidence and acceptance gates.
