# Site Studio Next Design Contract

Site Studio Next consumes the selected design contract emitted by FAMtastic
Designs. A palette paragraph, a screenshot, or a human note is not enough for
the build boundary: the selected packet must carry the approved machine-readable
tokens, typography, layout rules, component recipe, and asset references.

## Required handoff invariants

- `brand.design_contract.schema_version` is `1` for this contract shape.
- `brand.design_contract.tokens` contains `bg`, `fg`, `accent`, and `muted`.
- `brand.design_contract.typography` contains the approved `body` and optional
  `headings` stacks.
- `brand.design_contract.component_recipe` names the approved component
  vocabulary; new pages compose those components instead of inventing a new
  template.
- `brand.design_contract.layout` contains the approved `max_width`, `gutter`,
  and `grid` rules.
- `brand.design_contract.responsive` contains explicit mobile, tablet, and
  desktop behavior.
- `brand.design_contract.asset_policy` preserves approved assets and requires
  rights-safe replacements when an asset must change.
- `brand.design_contract.evolution` keeps tokens and typography stable, allows
  additions only through the component recipe, and makes parity a required
  gate.
- The renderer copies those values; it never reinterprets an approved token set
  from prose.
- `site_needs.pages`, section types, layout archetypes, and CTA targets remain
  part of the selected packet and are rendered as authored, not replaced by a
  generic page template.
- Every media slot has an explicit page/section binding and rights-safe asset
  reference.
- An approved proof may cross the seam as an immutable `artifact_bundle`.
  When present, Site Studio uses the artifact composer and copies the approved
  HTML, CSS, JavaScript, and media bytes without re-composition. Operational
  files such as `spec.json` remain internal and are excluded from deployment.
- Mobile, tablet, and desktop parity is a release gate before repository
  creation or deployment.

## FAMtastic baseline example

```json
{
  "schema_version": 1,
  "tokens": {
    "bg": "#0a0a0a",
    "fg": "#eaeaea",
    "accent": "#7cfc00",
    "muted": "#888888"
  },
  "typography": {
    "body": "Inter, -apple-system, system-ui, Segoe UI, sans-serif",
    "headings": "Space Grotesk, Inter, -apple-system, system-ui, sans-serif"
  },
  "component_recipe": ["proof-shell", "hero", "section", "cta"],
  "layout": {
    "max_width": "72rem",
    "gutter": "clamp(1rem, 4vw, 4rem)",
    "grid": "12-column"
  },
  "responsive": {
    "mobile": "stack",
    "tablet": "two-column",
    "desktop": "max-width"
  },
  "asset_policy": {
    "preserve": true,
    "rights_safe_only": true
  },
  "evolution": {
    "preserve_tokens": true,
    "preserve_typography": true,
    "additions_must_use_recipe": true,
    "parity_required": true
  }
}
```

## Evolution rule for page additions

The first approved proof is the visual baseline. A later request to turn a
one-page site into a five-page site, or to move content into Drupal or another
CMS, does not create a new visual direction. FAMtastic sends the existing
contract revision plus the new page content and section bindings. Site Studio
Next then:

1. loads the existing contract and immutable artifact baseline;
2. composes the new page from the registered component recipe and responsive
   rules;
3. leaves untouched approved pages byte-identical whenever possible;
4. creates a new contract revision and records what changed; and
5. reruns mobile, tablet, desktop, accessibility, asset, and screenshot parity
   checks before staging or deployment.

The CMS may change content, records, and page data. It may not silently change
approved tokens, typography, layout, responsive behavior, or asset rights
policy. If a requested change needs a new visual system, it is a deliberate
design revision with a new contract version and owner review—not an accidental
drift during a content update.

## Static proof versus application delivery

The artifact parity gate proves the visual handoff. It does **not** prove a
database, login, shopping cart, form submission, CMS mutation, or client
portal. When a project needs those capabilities, the selected packet must also
declare `capability_class: "application"`, a versioned `recipe`, a backend
descriptor, and a `functional_contract` listing the behaviors that must be
tested. Site Studio carries or deploys that backend and runs the declared
behavioral checks; it does not pretend to generate or understand an opaque
Drupal/portal runtime from a screenshot.

This is the intended shape for a future Shay-style expansion:

```json
{
  "capability_class": "application",
  "recipe": "drupal-decoupled-tri-tier-v1",
  "backend": {
    "root": "backend",
    "runtime": "drupal-jsonapi",
    "schema_file": "backend/schema.yml",
    "deploy_target": "staging",
    "verify": [{ "name": "request persists", "kind": "behavioral" }]
  },
  "functional_contract": {
    "portal": ["login", "request persistence"],
    "data": ["availability"]
  }
}
```

That application lane is separate from the current `$199` static proof lane.
It is designed now so a one-page proof can grow into a five-page CMS or portal
without losing its visual contract, but the database and authenticated flows
still require their own fixture, behavioral tests, staging evidence, and
deployment receipts before they are called proven.

This baseline is a contract example, not a license to apply FAMtastic styling
to every client. A customer-selected direction may replace it only when the
replacement is explicit in the packet and passes the same parity and
accessibility gates.

## Boundary rule

FAMtastic owns research, creative direction, proofs, and selection. Site Studio
Next owns composition, build, verification, deployment, and rollback. If the
selected packet cannot express the approved design, the handoff fails closed;
Site Studio must not guess.
