# Site Studio Next recipe registry

The recipe catalog is the shared vocabulary between FAMtastic Designs, Site
Studio Next, and each delivered site repository. A catalog entry is a
versioned capability boundary, not a promise that Site Studio can regenerate
every implementation from prose.

## Registry rules

- Recipe IDs are stable; released versions are immutable.
- `capability_class: brochure` means the deterministic composer can generate
  the declared surface.
- `capability_class: application` means the recipe carries an application
  boundary and its acceptance obligations. The site repository remains the
  implementation authority unless a generator is explicitly proven.
- Customer data, uploads, secrets, and credentials never enter a recipe.
- A site-specific solution becomes a reusable recipe only after its evidence
  is redacted, its contract is documented, and it passes a synthetic fixture
  plus at least one independent fixture.

## Event Cinema v1

`event-cinema-v1` is the first application recipe. It is extracted from the
MBSH reunion site and records the reusable product boundary:

- cinematic public shell;
- verified attendee portal;
- role-based committee operations;
- owner CMS/editorial boundary;
- moderated media/archive pipeline;
- commerce/ticket entitlement boundary; and
- transactional email outbox.

The source repository is referenced as evidence, not copied into Site Studio:
`sites/site-mbsh-reunion-event-cinema`.

The minimum acceptance surface is behavioral as well as visual: public-shell
parity, authorization boundaries, form and endpoint behavior, media
moderation, payment-to-entitlement behavior, and launch receipts. A rendered
homepage alone cannot certify this recipe.

## Promotion path

```text
site repo lesson
  -> redacted candidate pattern
  -> synthetic fixture and contract tests
  -> independent fixture validation
  -> owner review
  -> immutable recipe version
  -> site adoption through a pinned reference
```

This keeps improvements discoverable across a portfolio without copying one
customer's implementation or allowing a one-off workaround to become a global
default.
