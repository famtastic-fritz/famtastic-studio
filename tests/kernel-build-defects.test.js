import { describe, it, expect } from 'vitest';


// Measured on the five-sample after-set: 98 of 256 requested sections (38%) came
// back empty, and every one was type 'text' asking for a fact the pipeline never
// gathered. The copy stage was behaving correctly; research had declared page
// sections whose facts it never collected. Empty is honest but it is a hole, and
// a hole is invisible to every other check: no outline text to catch, no imagery
// to orphan.
describe('SECTION_WITHOUT_COPY: an empty body is a counted defect, not a silent hole', () => {
  it('counts sections that asked for copy and rendered nothing', async () => {
    const { detectDefects } = await import('../server/kernel/build-defects.mjs');
    const { defects } = detectDefects({
      sections: [
        { id: 'a', instruction: 'Pricing', rendered_body: '' },
        { id: 'b', instruction: 'Introduce the shop', rendered_body: 'A real sentence about the shop.' },
        { id: 'c', instruction: 'Hours table', rendered_body: null },
      ],
      pageType: 'home', wordCount: 400,
    });
    const d = defects.find((x) => x.code === 'SECTION_WITHOUT_COPY');
    expect(d).toBeTruthy();
    expect(d.empty_sections).toBe(2);
    expect(d.asked_sections).toBe(3);
    expect(d.over_threshold).toBe(true);
    // The instruction is carried so the operator can see WHAT could not be written.
    expect(d.sections.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });

  it('does not fire when every asked section got copy', async () => {
    const { detectDefects } = await import('../server/kernel/build-defects.mjs');
    const { defects } = detectDefects({
      sections: [{ id: 'a', instruction: 'Introduce the shop', rendered_body: 'A real sentence.' }],
      pageType: 'home', wordCount: 400,
    });
    expect(defects.find((x) => x.code === 'SECTION_WITHOUT_COPY')).toBeUndefined();
  });

  // Warning, not blocking, and deliberately: the fix is upstream research
  // coverage, and a blocking gate would fail builds for a cause the build cannot
  // address. It exists so the hole is counted.
  it('is a warning, because the cause is upstream of the build', async () => {
    const { DEFECT_CODES } = await import('../server/kernel/build-defects.mjs');
    expect(DEFECT_CODES.SECTION_WITHOUT_COPY).toBe('warning');
  });

  it('reports a ratio below the threshold without flagging it as over', async () => {
    const { detectDefects } = await import('../server/kernel/build-defects.mjs');
    const sections = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, instruction: 'x', rendered_body: i === 0 ? '' : 'Real copy here.' }));
    const { defects } = detectDefects({ sections, pageType: 'home', wordCount: 400 });
    const d = defects.find((x) => x.code === 'SECTION_WITHOUT_COPY');
    expect(d.ratio).toBe(0.1);
    expect(d.over_threshold).toBe(false);
  });
});

// A slot that serves no section is placed by position, which is what put a face
// on a credential section and papers on the floor at a page's close.
describe('MEDIA_SLOT_UNBOUND', () => {
  it('counts filled slots that serve no section', async () => {
    const { detectDefects } = await import('../server/kernel/build-defects.mjs');
    const { defects } = detectDefects({
      sections: [], pageType: 'home', wordCount: 400,
      mediaSlots: [
        { id: 'a', state: 'filled', section_id: 'hero' },
        { id: 'b', state: 'filled' },
        { id: 'c', state: 'unfilled' },
      ],
    });
    const d = defects.find((x) => x.code === 'MEDIA_SLOT_UNBOUND');
    expect(d.unbound).toBe(1);
    expect(d.filled).toBe(2);   // the unfilled slot is not counted
    expect(d.slots).toEqual(['b']);
  });

  it('does not fire when every filled slot is bound', async () => {
    const { detectDefects } = await import('../server/kernel/build-defects.mjs');
    const { defects } = detectDefects({
      sections: [], pageType: 'home', wordCount: 400,
      mediaSlots: [{ id: 'a', state: 'filled', section_id: 'hero' }],
    });
    expect(defects.find((x) => x.code === 'MEDIA_SLOT_UNBOUND')).toBeUndefined();
  });

  // Warning, not blocking: specs predating section_id would otherwise fail for a
  // schema change they came before.
  it('is a warning', async () => {
    const { DEFECT_CODES } = await import('../server/kernel/build-defects.mjs');
    expect(DEFECT_CODES.MEDIA_SLOT_UNBOUND).toBe('warning');
  });
});
