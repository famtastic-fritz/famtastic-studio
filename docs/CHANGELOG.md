# Site Studio Next change log

## 2026-09-13 — Read-only candidate recipe discovery

Added `GET /api/component-recipes` to discover specifications from sibling
Component Studio while preserving readiness flags and explicitly reporting an
unavailable library. Existing component inventory remains intact. Four focused
discovery tests and seven inventory tests pass locally. No executable owner UI
import, scheduling runtime or production deployment is claimed.

See [capability and learning](capabilities/OWNER-DESK-RECIPE-DISCOVERY.md).
