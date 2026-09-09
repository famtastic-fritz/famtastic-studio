# Design System Audit — site-studio-next console

Date: 2026-08-28
Scope: `public/app.css`, `public/kit/app-components.css`, `public/kit/app-pages.css` (~3,200 lines of CSS), all 18 shared primitives in `public/kit/*.js`, all 14 console pages in `public/pages/*.{html,js}`, and the orphaned `public/pages/site-view/*.js` module tree.
Method: full read of both token/component stylesheets and both agent reports below; every claim is cited to a file and line number so it can be re-checked against the live code rather than trusted on faith.

This is a read-only investigation. Nothing in the codebase was changed to produce this report.

---

## Summary

**Components reviewed:** 18 shared kit primitives, 14 console pages, 3 stylesheets, 1 orphaned 6-file module tree (1,150 lines)
**Issues found:** 27, spanning token coverage, naming, dead CSS, accessibility, and honest-state compliance
**Score: 65/100**

The foundation is genuinely strong: 47 real design tokens with documented WCAG contrast math (actual measured ratios in the comments, not asserted), a full light/dark mode, and — in its best files (`region.js`, `tabs.js`, `toggle.js`, `empty-state.js`) — some of the most rigorous state-machine and accessibility work you'll find in a hand-rolled vanilla-JS console. The score isn't dragged down by sloppiness; it's dragged down by a small number of concrete, fixable problems concentrated in specific files: two pages that fabricate "verified" UI state in direct contradiction of this project's own binding honest-states doctrine, a phantom token namespace that only works by accident, and 1,150 lines of better code sitting unused on disk next to a worse hand-rolled replacement. None of this requires a rewrite — it requires targeted fixes in a handful of named files (see Priority Actions).

Rough weighting: token foundation ~75/100, component completeness ~65/100 (wide spread — several 10/10s, several 3-4/10s), page/pattern consistency ~50/100 (the weakest area), documentation ~80/100 (a real strength — most files carry rationale, not just description).

---

## Naming Consistency

| Issue | Components | Recommendation |
|---|---|---|
| Four competing class-naming conventions across the 18 kit primitives, with no documented standard | Proper BEM: `card.js`, `region.js`, `tabs.js`, `toggle.js`, `shay-workspace.js`. Flat `kit-*` prefix: `diff.js`, `empty-state.js`, `panel.js`, `route-badge.js`, `toolbar.js`. Split/mixed within one file: `rail.js`, `shell.js`, `recipe-builder.js`. Ad hoc/inline: `canvas-edit.js` (`fam-` prefix + data-attributes), `new-site-builder.js` (raw ids + inline styles) | Standardize on BEM (`block__element--modifier`) — it's already the pattern in the most mature files (`region.js`, `toggle.js`, `tabs.js`) and is the only one of the four that scales cleanly |
| Page-level class prefixes don't reliably track the page they belong to | `automations.js` uses `skill-*` (page id is `automations`); `work.js` splits `ingestion-*` / `work-*` within itself (renamed from "Work" to "Ingestion Hub" without renaming the older half); `settings.js` and `site-view.js` independently invented a shared `ide-*` vocabulary unrelated to any other page; `media.js` literally reuses `proofs-jump-off` copy-pasted from `proofs.js` | Prefix every page's classes with its own page id, the way `gate-*`, `seo-*`, and `shadow-*` already correctly do; rename the `ide-*` pair and `automations`' `skill-*` to match |
| Two spellings of the same "primary button" modifier, only one of which is styled | `btn--pri` (`new-site-builder.js:69,204`; `shell.js:116,277`; `rail.js:156,239` — 6 call sites, only 1 reachable via a scoped selector) vs. the real `btn--primary` (`app-components.css:38`, correctly used by `recipe-builder.js:116`, `shay-workspace.js:142`) | Delete `btn--pri` everywhere; use `btn--primary` |
| The two "honest state" machines disagree on how they turn a state name into a CSS class | `region.js` hyphenates underscores (`region__status--not-implemented`, line 231) while `empty-state.js` preserves them (`kit-empty-not_proven`) | Pick one transform (hyphenation matches normal CSS convention) and apply it in both |

---

## Token Coverage

| Category | Defined | Hardcoded Values Found |
|---|---|---|
| **Colors** | 24 dark-mode tokens + 24 light-mode overrides (47 custom properties total across all categories, confirmed by direct read of `app.css`) | ~50+ raw hex/rgba values outside `app.css`. The largest cluster (app-components.css:317-417, the "L3 console kit primitives" and Cockpit-swarm additions from 2026-08-26/27) references **8 custom properties that are never defined anywhere in the codebase** — `--dim`, `--warn`, `--bad`, `--accent`, `--stroke`, `--stroke2`, `--glass2`, `--mono` — and only renders correctly because every reference carries a fallback (`var(--dim, #555)`). Confirmed via repo-wide grep: zero definitions exist. Separately, `canvas-edit.js:37-47` uses 5 raw hex values with no `var()` attempt at all (defensible if it's injecting into a cross-origin-equivalent iframe document that can't see the parent's `:root`, but undocumented either way) |
| **Spacing** | 7-step scale, `--space-1` (4px) through `--space-7` (48px) | Respected inside `app.css`/`app-components.css`; bypassed routinely by inline styles — `settings.js` alone carries 90 `style="..."` attributes, `site-view.js` carries 32 plus 15 direct `.style.x =` mutations, both with arbitrary pixel values |
| **Typography** | 2 font families + 8 size steps + 2 line-heights, all `var()`-based | 11 hardcoded `font-size` declarations vs. 74 tokenized (86% compliant) across the two component stylesheets; exactly one raw `font-family: serif` (`app-pages.css:1389`); font-weight has no token at all — raw numbers like `650`/`750` appear directly in `app-components.css`'s `shay-workspace`/`pcard` rules |
| **Motion** | **Zero tokens defined** | 11 distinct raw transition/animation-duration values in active use (0.1s–3.2s), including an apparent unintentional drift — 0.15s appears 14 times, 0.14s appears 3 times, doing the same job in different rules |

---

## Component Completeness

`format.js` is pure string formatting with no DOM output — not scored as a UI component.

| Component | States | Variants | A11y | Docs | Score |
|---|---|---|---|---|---|
| `region.js` | ✅ 8 states incl. `partial`, exceptionally documented | N/A (single machine) | ✅ `aria-live="polite"` + `aria-atomic` — best in the kit | ✅ 41-line rationale header | **10/10** |
| `tabs.js` | ✅ active/built-panel | N/A | ✅ full ARIA tablist + roving tabindex + arrow/home/end keys | ✅ | **10/10** |
| `toggle.js` | ✅ checked/disabled, enforced disabled-reason | N/A | ✅ `role="switch"`, `aria-checked`, WCAG 2.2 target size | ✅ cites the WCAG SC it satisfies | **10/10** |
| `toolbar.js` | ✅ disabled, enforced reason | ✅ floating, danger | ✅ `role="toolbar"`, WCAG 24px enforced | ✅ | 9/10 |
| `route-badge.js` | N/A | ✅ computed vs. route | ⚠️ `title` tooltip only | ✅ | 8/10 |
| `canvas-edit.js` | ✅ selected/editing/error/ok | ❌ none | ⚠️ tabindex+role retrofit, but role never updates once editing starts | ✅ extensive, dated fix note | 7/10 |
| `diff.js` | ✅ missing/identical | ✅ text/visual mode | ⚠️ `alt` text only | ✅ | 7/10 (class-name collision bug, see below) |
| `empty-state.js` | ✅ 8 states, enforced reason | N/A | ❌ no `aria-live` (gap vs. sibling `region.js`) | ✅ rich rationale | 7/10 |
| `panel.js` | N/A | N/A (required-arg contract) | ⚠️ semantic tags only | ✅ | 7/10 |
| `card.js` | ⚠️ state string unvalidated | ✅ 9 documented card types | ❌ none beyond native button | ✅ | 6/10 |
| `rail.js` | ✅ 5+ states | N/A | ⚠️ two good live-regions, but hand-rolled tab switcher has none | ✅ strong "honesty contract" header | 6/10 |
| `shell.js` | ✅ nav/palette/kill-switch | ⚠️ only `has-rail` | ⚠️ good hotkeys, but command-palette modal has no `role="dialog"` or focus trap | ✅ | 6/10 |
| `pill.js` | N/A | ⚠️ comment claims 8 statuses, CSS only styles 5 | ❌ | ⚠️ stale vs. actual CSS | 5/10 |
| `table.js` | N/A (CSS-only hover) | ❌ | ⚠️ native semantics only | ⚠️ one line | 5/10 |
| `new-site-builder.js` | ⚠️ state driven entirely by inline styles, no CSS hook | ✅ 8 recipe options | ❌ 4 unassociated form labels | ⚠️ functional only | 4/10 |
| `recipe-builder.js` | ⚠️ "dispatching" is a client-side `setTimeout`, not a real request | ✅ 4 engine roles | ❌ 3 unassociated form labels | ⚠️ functional only | 4/10 |
| `shay-workspace.js` | ⚠️ permanently fabricated data, `pending` step has no visual state | ✅ | ✅ `role="log"` + live | ❌ doesn't disclose the data is fake | **3/10** |

---

## Priority Actions

1. **Fix the honest-state violations — this is the project's own core promise, broken in three places.** `settings.js:267,272,279,300` hardcodes green "Active" badges and `alert()` calls standing in for real verification, with zero fetch behind any of it; `site-view.js:74-100` hardcodes a static page outline and wires a component palette to `insertComp()`, a function that is never defined anywhere in the file (every click throws); `shay-workspace.js:6-26` permanently renders fabricated build steps and terminal logs with invented timestamps, and `rail.js:367` mounts it as the default active tab regardless of whether a provider is even connected — directly contradicting `rail.js`'s own header comment that it "never simulates a reply or dresses up an 'active' state that isn't real." All three pages also silently swallow every fetch error (`settings.js:78-80,213-215,429-431`; `site-view.js:334-336,457-459,513-515`), so `error` isn't a reachable state on either page.

2. **Resolve the orphaned `public/pages/site-view/` tree (1,150 lines across 6 files) vs. the live `site-view.js`.** The orphaned tree is kit-driven, honest-states-disciplined, and was purpose-built to pair with `kit/canvas-edit.js` — genuinely better code, confirmed unreferenced anywhere in `public/` or `server/`. The live page that replaced it is worse on every axis above and is also the one page in the whole console that exceeds the 500-line lint cap (530 lines, `site-view.js`) with a mechanical `LINT-EXCEPTION` comment but no companion ADR, which this project's own convention skill requires. Either wire the orphaned tree back in or delete it — carrying both is pure liability.

3. **Kill the phantom token namespace.** Replace `--dim` → `--color-text-dim`, `--warn` → `--color-warn`, `--bad` → `--color-error`, `--accent` → `--color-accent`, `--stroke`/`--stroke2` → `--color-border`/`--color-border-strong`, `--mono` → `--font-mono` throughout `app-components.css:317-417`. As written, these ~15 rules only look correct by coincidence of their fallback values, don't respond to the light-mode media query, and will silently stop matching the rest of the system the next time someone touches the real palette.

4. **Sweep the dead CSS hooks.** `btn--pri` (6 call sites, 5 of them unstyled), `btn--small` vs. `btn--sm` (two spellings for the same concept, neither styled), and `rail.js`'s hand-rolled `tabs__btn`/`is-active` switcher (zero CSS, zero ARIA, duplicating the fully-accessible pattern `tabs.js` already implements two files away) should either get real styles or be replaced with the classes that already work.

5. **Add a motion token scale** (e.g. `--duration-fast: 0.15s; --duration-base: 0.25s; --duration-slow: 0.8s`) and fix the accidental 0.15s/0.14s drift while touching those rules — motion is the one token category with zero coverage today.

---

## Appendix A — Dead / orphaned CSS hooks (full list)

Cross-referenced against all three stylesheets (`app.css`, `app-components.css`, `app-pages.css`), not just the file where each class is defined:

- **`btn--pri`** — referenced at `new-site-builder.js:69,204`, `shell.js:116,277`, `rail.js:156,239` (6 refs). Only `.planprev .acts .btn--pri` exists (`app.css:768-777`), which reaches just the `shell.js:277` palette button; the other 5 call sites get no primary styling at all.
- **`btn--small` / `btn--sm`** — `shay-workspace.js:142,151` uses the first spelling, `shell.js:186` the second. Neither is defined anywhere.
- **`tabs__btn` / `is-active`** — `rail.js:354,359,406,407,413,414` (6 refs). No CSS rule in any of the 3 stylesheets.
- **`kit-diff-side`, `kit-diff-before`, `kit-diff-after`** — `diff.js:18,51-52`. No rules exist.
- **`orb--active`** — `shay-workspace.js:39`. Base `.orb`/`.orb--sm` exist (`app.css:298-320`); the `--active` modifier does not.
- **`pill--bad`, `pill--info`, `pill--dim`** — named in `pill.js:1`'s own header comment as valid statuses, but only `ok/warn/unknown/error/empty` are actually styled (`app-components.css:131-159`).
- **`region__banner`, `region__banner--partial`** — used at `region.js:176`, styled nowhere, and the `partial` state itself is missing from `app-components.css`'s own region-states rationale comment (lines 162-170), which enumerates every other state.
- **Class-name collision**: `diff.js:14` gives the diff root the mode class `kit-diff-${mode}`, which for the default `mode:'text'` produces `kit-diff-text` — the identical string `diff.js:40` gives the inner `<pre>`. The one CSS rule for `.kit-diff-text` (`app-components.css:350`) lands on both elements, only one of which it was written for.
- **Ownership leak**: `card.js`'s `renderCard()` produces the entire `shay-card`/`shay-card__*` family (12+ classes, used on every rail conversation entry) with zero rules in `app-components.css` — they live in `app-pages.css:283-332` instead, contradicting `app-components.css`'s own header comment that it "owns everything rendered *inside* the shell's `<main>`" for shared primitives.
- **Likely orphaned from `kit/`** (defined in `app-components.css`, not referenced by any of the 18 kit files — may still be used by page-level scripts): `.kit-site-id`, the full `.pgrid`/`.pcard*` family, `.denominator-legend` family, `.btn--danger` (unused even though `toolbar.js` has its own separate `.kit-toolbar-danger` for the same concept), `.recipe-dag__node-model`.

## Appendix B — Accessibility gaps (full list)

- `rail.js`'s Workspace/Notes tab switcher (lines 349-417) has no `role="tab"`, no `aria-selected`, no keyboard arrow navigation — `tabs.js` in the same directory already implements the complete accessible pattern.
- `shell.js`'s command palette (⌘K overlay, lines 241-282) is a full modal with no `role="dialog"`/`aria-modal`, no focus trap, and no focus-return on close.
- `new-site-builder.js` (4 fields, lines 34-64) and `recipe-builder.js` (3 fields, lines 101-108) both create `<label>` elements never programmatically associated with their inputs (`for`/`id` mismatch or missing entirely) — a real gap in a codebase that otherwise takes accessibility seriously.
- `empty-state.js` has no `aria-live` region despite doing the same job as `region.js`, which does.
- `canvas-edit.js` retrofits `role="button"` + `tabindex` for selectable elements but never swaps the role once `contenteditable` is turned on for the same element.
- `shay-workspace.js` styles the `completed` and `running` step states but not `pending`, the third literal status its own `DEFAULT_STEPS` data uses.

## Appendix C — Duplication that belongs in `kit/` instead of per-page

- **"No site_id in URL" guard** — near-identical hand-written implementations in `gate.js:15-36`, `seo.js:16-37`, `site-view.js:11-21`.
- **`famSection()`/`kvBlock()` helpers** — byte-for-byte duplicated between `builds.js:81-107` and `shadow.js:36-62`.
- **`applications.js` and `deployments.js`** — ~95% identical; effectively one template instantiated twice with different endpoint/heading strings.
- **The "IDE workspace" shell** — `settings.js` and `site-view.js` each independently hand-build the same `ide-workspace`/`ide-sidebar`/`ide-section`/`ide-tree`/`ide-stage` scaffold from scratch.
- **Inline-styled "library card grid"** — `components.js:132-177` (22 inline styles) and `media.js:209-291` (32 inline styles) independently build visually similar catalog card grids, neither reusing `kit/card.js` or each other.

## Appendix D — Page-by-page honest-states compliance

Pages that comply well and are worth using as the reference pattern for new pages: **`sites.js`, `gate.js`, `shadow.js`, `work.js`, `proofs.js`, `deployments.js`, `applications.js`** — each drives real loading/empty/error states off `region.js`/`empty-state.js`, and several (`sites.js`, `gate.js`, `shadow.js`, `deployments.js`) explicitly document a specific fabrication they found and removed before shipping.

Pages with real violations: **`settings.js`, `site-view.js`** (fabricated verified state, silent error-swallowing — see Priority Action 1), **`seo.js`** (snippet-preview fields fall back to plausible-looking placeholder text like `"Page Title"`/`"example.com"` instead of an honest "missing" marker, unlike the "not scored"/"not computed" convention used elsewhere in the same file).

Minor doc/code drift: `shadow.js:4-6`'s header comment claims the page is "intentionally NOT wired into config/pages.json or the shared nav" — it demonstrably is, in both `config/pages.json:101` and `kit/shell.js:34`, and calls `renderShell({pageId:"shadow"})` itself.

Also worth flagging: the orphaned `site-view/canvas.js` (Appendix A/priority action 2) hardcodes a fake `SEO 91` badge on every row and a static `published · live` badge — the exact fabricated-score pattern `sites.js`'s own header comment explicitly refuses to do, in code that never ships but still sits in the tree.
