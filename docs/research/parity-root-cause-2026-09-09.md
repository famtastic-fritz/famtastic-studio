# FAMtastic to Site Studio Next parity root cause

Date: 2026-09-09
Status: contract repair locally verified; visual parity rerun still required

## Finding

The first parity capture compared the live FAMtastic homepage with a synthetic
Site Studio fixture called `Signal Standard`. It correctly exposed that Studio
Next was rendering a generic light page, but it was not a valid same-fixture
comparison: the two sides had different content, route counts, and component
recipes.

## Root causes

1. The selected-build fixture carried `brand.palette` while the renderer only
   read `brand.palette_direction`. Missing tokens silently selected the white
   platform defaults.
2. Research sanitization retained only prose directions and discarded an
   approved machine-readable design contract. A research response could erase
   the selected theme while still appearing successful.
3. The selected-build packet did not require a design contract, so a build
   could proceed without exact colors or typography.
4. The deterministic composer is a generic brochure renderer. It does not yet
   consume the full FAMtastic page/component recipe, so matching tokens alone
   cannot guarantee matching structure or interaction.

## Repair applied

- Added the shared `design.md` contract to Site Studio Next.
- Preserved bounded `design_contract`, `tokens`, and legacy `palette` fields
  through research sanitization.
- Copied approved tokens exactly and carried approved body/heading typography
  into the generated stylesheet.
- Made selected-build handoff fail closed when the machine-readable design
  contract is missing.
- Added regression tests for contract preservation and fail-closed behavior.

## Evidence

- Full Site Studio Next suite: **66 test files, 876 tests passed**.
- Targeted contract suite: **54 tests passed**.
- Lint: `lint-no-monolith` and `lint-no-ambient-site` passed.

## Remaining parity gate

Create one identical fixture input for both renderers, including the same page
recipe, component instances, tokens, typography, assets, and copy. Capture
mobile, tablet, and desktop screenshots and compare structure, computed tokens,
navigation, typography, media slots, and interaction states. Do not create a
repository or deploy until that same-fixture comparison passes.
