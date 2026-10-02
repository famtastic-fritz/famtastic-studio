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
  it('tracks the narrow Service Path install separately from the unfinished phone desk',()=>{
    const ledger=read('../config/repositories/candidate-captures.v1.json');
    const entry=ledger.entries.find(item=>item.id==='shay-service-path-v1');
    expect(entry.component_review_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(entry.component_catalog_id).toBe('service-path');
    expect(entry.component_version).toBe('1.0.0');
    expect(entry.readiness.neutral_package_available).toBe(true);
    expect(entry.readiness.install_tested).toBe(true);
    expect(entry.readiness.discovery_tested).toBe(true);
    expect(entry.readiness.executable_import_proven).toBe(false);
    expect(entry.readiness.production_proven).toBe(false);
    expect(entry.runtime_library_pin_changed).toBe(false);
  });
  it('tracks the live Shay Connect Card instance without enabling a Studio import',()=>{
    const ledger=read('../config/repositories/candidate-captures.v1.json');
    const runtime=read('../config/repositories/catalog.v1.json');
    const entry=ledger.entries.find(item=>item.id==='shay-connect-card-v1');
    expect(entry.site_source_commit).toBe('de89941c05a75dc3c5bbaa09c38c27a6b93e3e66');
    expect(entry.component_review_commit).toBe('01ac5ec310220a8337caf69dfb7b869dd6c47c36');
    expect(entry.customer_url).toBe('https://tightenupyourlocs.com/connect/');
    expect(entry.component_catalog_id).toBe('connect-card');
    expect(entry.component_version).toBe('1.1.0');
    expect(entry.readiness.install_tested).toBe(true);
    expect(entry.readiness.discovery_tested).toBe(true);
    expect(entry.readiness.customer_instance_deployed).toBe(true);
    expect(entry.readiness.executable_import_proven).toBe(false);
    expect(entry.readiness.production_proven).toBe(false);
    expect(entry.readiness.owner_accepted).toBe(false);
    expect(entry.runtime_library_pin_changed).toBe(false);
    expect(runtime.entries.find(item=>item.id==='component-studio').revision).toBe('5371b242a314cb4c689d39bf0e975bf8373b2b0d');
  });
});
