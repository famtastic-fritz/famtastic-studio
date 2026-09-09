# Design evolution contract — 2026-09-09

## Decision

The approved FAMtastic proof is the initial visual baseline. Site Studio Next
must not reinterpret that baseline when a customer later asks for more pages,
CMS-backed content, or a layout update. Future work carries the same
versioned `design_contract` and changes only the requested page/content scope.

## Contract fields

`brand.design_contract` schema version 1 now requires:

- approved color tokens and typography;
- a registered component recipe;
- layout rules (`max_width`, `gutter`, `grid`);
- mobile, tablet, and desktop responsive rules;
- asset preservation and rights-safe replacement policy; and
- evolution rules that preserve tokens/typography, constrain additions to the
  recipe, and require parity checks.

The research sanitizer preserves this bounded contract and drops unknown model
fields. The selected-build adapter fails closed if a paid, selected packet does
not carry the complete contract.

## Future page/update flow

1. Load the approved contract revision and immutable artifact baseline.
2. Add the requested page/content binding using the existing component recipe.
3. Keep untouched approved pages byte-identical where possible.
4. Create a new contract revision with a machine-readable change record.
5. Re-run mobile/tablet/desktop screenshot parity, accessibility, link, and
   asset checks before staging or deployment.

Drupal or another CMS may own content and records after handoff. It may not
silently change approved visual tokens, typography, layout, responsive rules,
or asset rights policy. A genuinely new visual direction is an explicit design
revision, not an accidental side effect of adding a page.

## Evidence

- Focused contract, sanitization, packet, and pipeline tests: **79 passed**.
- Full Site Studio Next suite: **68 files / 881 tests passed**.
- Lint: `lint-no-monolith` and `lint-no-ambient-site` passed.
- Real artifact parity proof: exact bytes and identical screenshots at 390,
  768, and 1280 pixels; browser verification passed; deploy plan remained
  `dispatched: false`.

The initial artifact path is therefore both exact and reusable: FAMtastic does
not render the whole site a second time, while Site Studio Next has a precise
contract for every later page it needs to build.

## Application boundary

The contract now also carries an explicit application lane: `capability_class`,
`recipe`, `backend`, and `functional_contract` survive the selected packet →
Studio brief → derived spec projection. This is how a future Shay expansion
can declare a Drupal/portal/database build without confusing visual parity with
behavioral proof. The current static artifact proof remains separate; login,
database persistence, commerce, and CMS mutations still require their own
behavioral fixtures and staging evidence.
