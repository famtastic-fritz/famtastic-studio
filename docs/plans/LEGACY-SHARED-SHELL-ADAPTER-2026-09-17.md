# Proposed bounded legacy shared-shell adapter

Read-only inspection corrected the earlier assertion that the legacy family
lacks usable markers. `server.js:3769` already extracts exact `<head>`,
`header[data-template="header"]`, `footer[data-template="footer"]` and
`style[data-template="shared"]` from `_template.html`. Its page contract copies
header/footer verbatim and supplies `<main>`. `writeTemplateArtifacts` records
`_partials/_nav.html`, `_partials/_footer.html` and shared CSS.

The recorded family is present in
`/Users/famtastic-fritz/Development/FAMtastic/sites/site-drop-the-beat/dist-baseline/`:
`_template.html` has the marked header/footer/shared CSS, and `index.html` has a
single main plus `data-section-id`, `data-section-type`, `data-field-id` and
`data-field-type` attributes. This is structural reference evidence only, not
authority to rebuild or reuse that customer's content. Neither location changed.

Propose `legacy-shared-shell-v1` in Next, independent of the legacy handler:

1. Consume manifest-bound selected page, canonical template and shared assets.
   Verify unique semantic boundaries and exact selected/template chrome. Work
   from parsed source offsets and copy slices; do not reserialize or beautify
   original pages. An unbound upstream absolute template_path is insufficient.
2. Permit only absent, explicitly scoped root-level HTML pages. Copy selected
   head/header/footer and approved source component sections without changing
   existing pages/assets. Preserve all relative URLs; nested-page URL rewriting
   is outside v1. Validate that every referenced asset/page exists in final scope.
3. Assemble main only from an explicitly mapped ordered list of existing
   `data-section-id` components. Fill unique existing `data-field-type="text"`
   fields with escaped authoritative text and record exact input/output hashes.
   Require a recorded transformation permission for those fields. No arbitrary
   inner HTML, guessed content, CSS changes, new layouts or provider calls.
4. Bind page title and component/field maps to requested scope and exact content
   source records. Existing `products_services`, `page_list` and content-status
   intake answers identify requests; they do not automatically authorize new
   marketing copy or supply missing authored paragraphs. Existing request asset
   ownership, likeness and AI-use statements retain their separate meanings.
5. Run full static navigation/resource, responsive, structural accessibility,
   source parity and rights QA. Existing selected pages and assets must remain
   byte-identical. The resulting export records the real transformation and
   materialized scope; incomplete content or features cannot yield readiness.

Explicit unsupported cases: absent canonical template bytes; differing selected
and template chrome; duplicate/unparseable boundaries or field IDs; nested
target paths; components with forms/scripts or undeclared behavior; missing
authoritative field text; absent transformation permission; requested component
not present in the source family. Report each case as a stage-specific issue.

This proposal is ready for parent review before implementation. No generic
redesign or fresh generation is proposed, and no business choice blocks coding
the adapter. A real customer's absent content/permission still requires its
normal authority record before that particular transform can execute.
