# Legacy shared-shell local proof — 2026-09-17

Implements the approved `LEGACY-SHARED-SHELL-ADAPTER-2026-09-17.md` plan. Synthetic owned content mirrors the legacy marked template family; no customer content was copied or legacy source modified.

## Implemented boundary

`legacy-shared-shell-v1` parses source offsets in a strict HTML subset and assembles only absent root-level HTML pages from explicitly named main components. Selected pages and assets retain their original bytes. Header/footer and marked shared CSS match template bytes (external stylesheet comparison permits the legacy writer's surrounding whitespace trim). Page-specific head styles remain; title and existing description require explicit authored replacements. Unsupported metadata, scripts/forms/events, unsafe URLs, external resources, ambiguous nesting/IDs and unsupported fields fail closed. This is not a generic HTML or generation fallback.

Content record and transformation permission independently bind source/template hashes, output, component IDs, record ID/revision, exact field paths and content hash. Lineage retains input records/bytes, field offsets and hashes, head changes and output hash. Mapped Studio continuations run in the existing verified repository. A pre-write guard rejects an output already present on disk, including case variants; stage retry retains existing retry semantics.

## Verification

- 69 tests across 9 files passed in 17.71s with both actual PHP harness paths configured: legacy shared shell, old selected slots, source export roundtrip, source finalization, planning roundtrip, manifest language ordering, staging worker, pipeline and repository guards.
- Shell suite: 20 cases including inline/external shared CSS, actual browser QA at 390/768/1280, missing-resource callback gating, stale/revoked permission, malformed source and mapped second revision. Existing index/about bytes and authored README stay unchanged; no provider calls. Duplicate/restart does not build again.
- Actual PHP selected staging harness: 42 assertions passed using synthetic adapters. Next lint passed. This does not prove a running Drupal database or live hosting.
- Hosting, callbacks and authority records use synthetic fixtures. No credentials read, provider calls, target allocation, real jobs/mail, legacy edits, service change, push/merge or deployment occurred.

## Remaining implementation

Normal producer writers must capture/export authored page content, current transformation permission and template/component hashes; propagate current source/scope/rights/hosting/delivery authority; and generate this bounded recipe from those records. Other unsupported site families continue through planning, not a ready receipt. This increment does not complete general automatic site building. Runtime activation and customer delivery remain separate from local proof. Drive mirror omitted under explicit two-worktree-only scope.
