import { afterEach, expect, it } from 'vitest';
import { fixture, packet } from './staging-worker-fixture.mjs';
import { encodeSourceExport } from '../server/kernel/source-export-wire.js';
let f;
afterEach(() => { f?.cleanup(); f = null; });
// Store transaction tests only. Synthetic QA/build flags do not prove generation.
function claimedSource(project, site, repository) {
  const p = packet();
  Object.assign(p, { project_id: project, request_id: `request-${project}`, packet_id: `packet-${project}`, idempotency_key: `key-${project}` });
  const accepted = f.store.accept(p), { job, token } = f.store.claim(accepted.id);
  job.qa = { passed: true };
  job.build = { outcome: 'success', site_id: site, repository: { repository_path: repository } };
  job.source_export = encodeSourceExport({ schema: 'famtastic.finalized-source.v1', scope_complete: true, site_id: site, repository: { repository_path: repository }, run_id: `run-${project}` });
  return { job, token };
}
it.each(['site', 'repository'])('normal source writer rejects a second project sharing the %s', collision => {
  f = fixture();
  const first = claimedSource('first', 'owned-site', '/synthetic/owned-repository');
  const original = f.store.recordSource(first.job, first.token);
  f.store.release(first.job, first.token);
  const second = claimedSource('second', collision === 'site' ? 'owned-site' : 'other-site', collision === 'repository' ? '/synthetic/owned-repository' : '/synthetic/other-repository');
  expect(() => f.store.recordSource(second.job, second.token)).toThrow('source_mapping_already_bound');
  expect(f.store.sourceMappings()).toEqual([original]);
  f.store.release(second.job, second.token);
});
it('normal writer respects a pending first-association mapping', () => {
  f = fixture();
  const mapping = { project_id: 'association-owner', site_id: 'owned-site', repository_path: '/synthetic/owned-repository', association_id: 'pending-association' };
  f.store.recordAssociation(mapping, { project_id: mapping.project_id });
  const second = claimedSource('second', 'owned-site', '/synthetic/owned-repository');
  expect(() => f.store.recordSource(second.job, second.token)).toThrow('source_mapping_already_bound');
  expect(f.store.sourceMappings()).toEqual([mapping]);
  expect(f.store.readAssociation(mapping.association_id).state).toBe('callback_pending');
  f.store.release(second.job, second.token);
});
it('association writer respects a normal mapping and exact owner can checkpoint again', () => {
  f = fixture();
  const first = claimedSource('first', 'owned-site', '/synthetic/owned-repository');
  const original = f.store.recordSource(first.job, first.token);
  expect(f.store.recordSource(first.job, first.token)).toEqual(original);
  expect(() => f.store.recordAssociation({ project_id: 'second', site_id: 'owned-site', repository_path: '/synthetic/owned-repository', association_id: 'other' }, { project_id: 'second' })).toThrow('source_association_already_bound');
  expect(f.store.sourceMappings()).toEqual([original]);
  expect(f.store.listAssociations()).toEqual([]);
  f.store.release(first.job, first.token);
});
