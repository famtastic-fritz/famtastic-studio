# Learning Spine Contract v1

The learning spine connects three independent authorities without merging their
repositories:

```text
FAMtastic Designs --selected packet--> Site Studio Next --bootstrap--> site repo
       ^                                      |                         |
       | product/CX feedback                  | receipts and recipes   | build, QA, incidents
       +--------------------------------------+-------------------------+
```

## Records

`server/kernel/learning-spine.js` defines the portable records:

- `SiteManifest`: identity, owner, contract version, recipes, capability class,
  environments, and parity policy.
- `RecipeMetadata`: a versioned reusable pattern with capabilities, required
  inputs, acceptance tests, maturity, and owner.
- `LifecycleEvent`: a typed event connecting a site/run to contract versions,
  recipe versions, evidence, and a status.
- `LessonRecord`: a redacted symptom/root-cause/pattern record. A lesson is
  never globally reusable just because it came from one site; it must remain a
  candidate until privacy review and owner promotion.
- `EvidenceReceipt`: a durable pointer to a build, parity, QA, staging, launch,
  or incident artifact, optionally protected by a SHA-256 digest.

All records are schema-versioned and fail closed. Identifiers and version
references are bounded so a typo cannot silently create an unqueryable record.
Evidence is referenced by path or receipt id; customer uploads, secrets, bearer
links, and raw PII do not belong in the shared learning records.

## Persistence

`createLearningSpine({ paths })` writes atomically beneath
`.studio/learning/{sites,recipes,lessons,receipts}`. The existing append-only
event spine remains the delivery mechanism for live lifecycle events; these
records provide durable, queryable evidence and promotion state.

## Promotion rule

1. Capture a site-local lesson with evidence.
2. Remove customer-specific content and perform privacy review.
3. Validate the pattern against a synthetic fixture and another site type.
4. Have the platform owner promote it to a versioned recipe.
5. Roll it out through the shared QA workflow and record the resulting receipts.

This gives MBSH a path to become an `event-cinema@1` recipe without copying its
customer data or turning every one-off implementation into a global skill.

