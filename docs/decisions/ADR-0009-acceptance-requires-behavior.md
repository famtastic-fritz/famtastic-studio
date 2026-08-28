# ADR-0009: A rendered page is not proof

**Status:** accepted, 2026-08-25 (ruling 4)
**Circumstance:** normal
**Supersedes:** the implicit acceptance standard used through M5

## Context

Acceptance through M5 was "a page rendered and verified." Two findings in one
week showed that standard passing on output nobody would ship.

The outline defect: every section rendered its planning description where body
copy belonged. One h1, correct heading hierarchy, real nav, no broken links,
hero image present, 529 tests green. **0 of 10 paragraphs ended in sentence
punctuation.** Every gate passed on a page that said nothing to a customer.

MBSH: the load-bearing behavior is whether a vote records, a duplicate is
rejected, the menu enforces its entrée rule, the admin login holds, the
notification email sends. A rendered page proves none of it. **An acceptance
test built only on DOM verification would pass a completely broken MBSH.**

Both are the same class: absence-checking cannot see a page with all its parts
and none of its substance, and it equally cannot see a form posting into a void.

## Decision

**Acceptance is scoped by `capability_class`.**

**Brochure sites** must pass structural verification *and* a substance check:
copy must read as copy, not as the instruction that asked for it. The copy
stage's echo guard is the mechanism; a section whose body scores too close to
its instruction is rejected and renders empty rather than publishing the
outline.

**Application sites** must additionally declare **behavioral checks** and pass
them. A backend with no declared checks is accepted and recorded as
`verification: 'none_declared'` — the site is carried, and the absence of proof
is stated rather than implied.

**Studio states plainly what it does for a carried backend:** it deploys it and
runs the declared checks. It does not generate or model its contents.
`studio_understands_contents: false` is recorded in the data, so no later reader
mistakes a carried backend for a generated one.

## Consequences

- Studio's honest capability for an application site is **deploy and verify, not
  author**. That is a real capability and it is stated as such.
- An application site with no behavioral checks is visibly unproven in the
  console rather than counted beside a verified brochure site.
- The acceptance artifact for any future milestone must name which class it is
  and which checks it passed.

## What this does not claim

Behavioral checks prove the declared behaviors. They do not prove the
application is correct, and Studio has no model of what else it might do.
