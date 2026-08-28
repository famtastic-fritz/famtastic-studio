# ADR-0006: A Settings provider field is allowed; the non-goal is narrowed, not ignored

**Date:** 2026-08-23 | **Status:** accepted (owner instruction, 2026-08-23) | **Narrows:** plan v1.0 section 0 non-goals and CONVENTIONS item 12

## The conflict, stated plainly
The ratified plan lists "model selectors in operator chrome" as a non-goal, and `CONVENTIONS.md` item 12 repeats it as "no model/provider selectors". The PROVE list asserts it. Fritz then instructed, explicitly:

> Configurable in Settings/Admin: a provider field showing which CLI is active, swappable, with an honest status check (installed? authenticated? responds?).

A lane building the adapters noticed the collision and flagged it rather than quietly picking a side. That was the right call, and it is why this ADR exists instead of a silent edit.

## Resolution
The non-goal was written against a specific failure mode: a console that asks the operator to pick a model per action, turning a production tool into a playground and making every output's provenance a matter of what someone selected in a dropdown that day. That failure mode is still forbidden.

**What is now allowed:** exactly one admin-level configuration field, in Settings/Admin, naming which CLI adapter Shay uses, with an honest per-adapter status check. It is configuration, not operator chrome.

**What remains forbidden, unchanged:**
- Per-action or per-request model pickers anywhere in the operating surfaces (Work, Site View, canvas, conversation rail, Builds).
- Any control that lets a model be chosen at the moment of doing work rather than configured once.
- Tenant, team, billing or plan chrome of any kind.

**Per-stage routing is not a selector.** `resolveStageRouting()` reads model and agent per stage from the resolved recipe. That is a recipe edit made deliberately and recorded in DNA with a `routing_source`, not a control in the chrome.

## Consequence
`CONVENTIONS.md` item 12 is amended to carry the narrower rule, so a future agent does not "fix" the Settings field by deleting it. The PROVE assertion is scoped to the operating surfaces rather than the whole shipped asset set.

## Why this is recorded rather than just done
A ratified non-goal being narrowed by a later instruction is exactly the kind of change that, left unrecorded, becomes an argument six weeks later about whether someone broke the contract. The instruction is the owner's to give; the record is mine to keep.
