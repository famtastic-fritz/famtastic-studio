import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));

describe('Shay reusable candidate ledger',()=>{
  it('records exact review source while leaving runtime discovery on its stable pin',()=>{
    const ledger=read('../config/repositories/candidate-captures.v1.json');
    const runtime=read('../config/repositories/catalog.v1.json');
    const entry=ledger.entries.find(item=>item.id==='shay-phone-site-desk-v1');
    expect(ledger.kind).toBe('read_only_candidate_ledger');
    expect(entry.site_source_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(entry.component_review_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(entry.component_catalog_id).toBe('phone-site-desk-shay-capture');
    expect(entry.runtime_library_pin_changed).toBe(false);
    for(const flag of ['neutral_package_available','install_tested','executable_import_proven','production_proven','owner_accepted'])expect(entry.readiness[flag]).toBe(false);
    expect(runtime.entries.find(item=>item.id==='component-studio').revision).toBe('5371b242a314cb4c689d39bf0e975bf8373b2b0d');
  });
});
