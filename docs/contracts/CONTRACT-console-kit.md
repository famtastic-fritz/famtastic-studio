# Contract: console kit (L3)

**Blocks six lanes, so it is small and stable before anything consumes it.**

`public/kit/` exports primitives every screen uses. No screen may define its own
version of one of these; a second implementation is a defect, not a variation.

## Required exports

```js
panel({ title, route, children })     // route is REQUIRED, see below
table({ columns, rows, cellRender })
pill(label, status)                   // ok | warn | bad | unknown
routeBadge(route)                     // renders the API route a panel reads from
emptyState({ state, reason })         // A14 honest states, reason REQUIRED when not 'available'
diffView({ before, after, mode })     // 'text' | 'visual'
toolbar({ actions })                  // every target >= 24x24 CSS px
```

## Non-negotiable rules

1. **`panel()` requires a `route`.** B11 demands every panel display the API route
   it reads from; making it a required argument means a panel cannot exist
   without one. A panel showing data from nowhere is the thing this prevents.
2. **Honest states only.** `emptyState` requires a `reason` for anything other
   than `available`. "No data" without a reason is indistinguishable from a
   broken fetch, which is the failure this project keeps finding.
3. **Targets >= 24x24 CSS px** in `toolbar()`, enforced by a test that reads the
   computed box, not by review. The mockup's floating toolbar fails this and is
   knowingly not copied.
4. **No progress indicator under 1s** (sourced: a spinner under 1s causes
   anxiety). `panel()` must not render a spinner for a fetch that has not yet
   taken 1s.
5. **Vanilla JS, no framework, no build step.** Protects click-to-edit.

## Acceptance

A kit demo page rendering every primitive, captured at 1440 and 390, plus a test
asserting (a) `panel()` throws without a route, (b) `emptyState` throws without a
reason for a non-available state, (c) every toolbar target measures >= 24px.
