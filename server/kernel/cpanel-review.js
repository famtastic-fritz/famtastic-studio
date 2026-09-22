import { reviewDirectoryUrl } from './review-directory-url.js';
// Narrow cPanel review transport. The capability provider supplies authenticated
// request/read/probe/backup/restore functions; none acquire credentials here.
import fs from 'node:fs';
import { digest, stagingError } from './staging-store.js';
import { safePublicPath } from './staging-contract.js';
import { selectedReviewArtifact } from './selected-review-artifact.js';
import { readSourceRestrictions, assertProtectedSourceAccess } from './source-use-restrictions.js';

export function createCpanelReview({ paths, journal, binding, transport }) {
  const target = structuredClone(binding);
  const url = reviewDirectoryUrl(target.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !(url.hostname === 'famtasticinc.com' || /^[a-z0-9-]+\.famtasticinc\.com$/.test(url.hostname))
    || !/^\/home\/nineoo\/public_html\/[a-z0-9-]+$/.test(target.target_path)
    || !/^[a-z0-9-]+$/.test(target.remote_subdirectory)
    || !target.site_id || !target.customer_id || target.access !== 'protected_review'
    || !target.host_aliases?.length) throw stagingError('review_target_invalid');
  const bindingHash = digest(target);
  async function deploy({ job, operation_id }) {
    if ((job.build?.site_id || `project-${job.packet.project_id}`) !== target.site_id || job.packet.continuation.customer.id !== target.customer_id) throw stagingError('hosting_identity_conflict');
    const declared = job.packet.continuation.hosting_target;
    if (declared?.staging_url !== target.url || declared?.target_path !== target.target_path || declared?.remote_subdirectory !== target.remote_subdirectory) throw stagingError('hosting_packet_target_mismatch');
    if (job.qa?.passed !== true || job.build?.outcome !== 'success') throw stagingError('qa_required');
    const root = paths.within('staging', operation_id);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const statePath = paths.within('staging', operation_id, 'hosting.json');
    let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { binding_sha256: bindingHash, uploaded: {} };
    if (state.binding_sha256 !== bindingHash) throw stagingError('hosting_target_changed');
    const save = () => {
      journal.append({ site_id: target.site_id, initiator: job.id, intent: 'review.checkpoint', changes: [{ operation_id }], result: { status: state.status || 'pending' }, evidence: { binding_sha256: bindingHash } });
      const tmp = paths.within('staging', operation_id, 'hosting.tmp');
      const fd = fs.openSync(tmp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, statePath);
    };
    // Only selected public bytes or the exact owner-authorized credit derivative.
    // The transform receipt remains private. Never source
    // manifests, .htaccess supplied by a customer, backend code or symlinks.
    const files = selectedReviewArtifact(job, paths).files.map(f => {
      if (!safePublicPath(f.path)) throw stagingError('public_file_rejected');
      const bytes = Buffer.from(f.content_base64, 'base64');
      if (digest(bytes) !== f.sha256) throw stagingError('output_digest_mismatch');
      const local = paths.within('sites', target.site_id, f.path);
      if (!fs.existsSync(local) || fs.lstatSync(local).isSymbolicLink() || digest(fs.readFileSync(local)) !== f.sha256) throw stagingError('stale_built_artifact');
      return { ...f, bytes };
    });
    const manifest = files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes.length }));
    const manifestHash = digest(manifest);
    if (state.manifest_sha256 && state.manifest_sha256 !== manifestHash) throw stagingError('hosting_operation_conflict');
    state.manifest_sha256 = manifestHash;
    // Every resume revalidates immutable vhost/root and access before uploads.
    const preflight = await transport.preflight(target);
    if (preflight?.verified !== true || preflight.target_path !== target.target_path || preflight.hostname !== url.hostname || preflight.site_id !== target.site_id) throw stagingError('hosting_preflight_failed');
    if (!state.backup) { state.backup = await transport.backup({ target, operation_id, manifest }); save(); }
    if (!state.backup?.verified || !state.backup?.ref) throw stagingError('backup_not_verified');
    await transport.protect({ target, operation_id });
    const access = await transport.verifyAccess(target);
    assertProtectedSourceAccess(readSourceRestrictions(paths, target.site_id), job.packet, access);
    if (!access.anonymous_denied || !access.aliases_denied || !access.noindex) throw stagingError('review_access_failed');
    try {
      for (const f of files) {
        // Read back before skipping; timeout after upload is not a new upload.
        const remoteHash = await transport.fileHash({ target, path: f.path });
        if (remoteHash !== f.sha256) {
          const parts = f.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            await transport.mkdir({ target, path: parts.slice(0, i).join('/') });
          }
          state.uploaded[f.path] = f.sha256; save(); // Persist write intent before uncertain transport.
          await transport.upload({ target, path: f.path, bytes: f.bytes, expected_sha256: remoteHash });
          if (await transport.fileHash({ target, path: f.path }) !== f.sha256) throw stagingError('upload_verification_failed');
        }
        state.uploaded[f.path] = f.sha256; save();
      }
      for (const f of files) {
        const proof = await transport.probe({ target, path: f.path, redirect: 'error' });
        if (proof.status !== 200 || !proof.https_verified || !proof.noindex || digest(proof.bytes) !== f.sha256) throw stagingError('https_verification_failed');
      }
      const finalAccess = await transport.verifyAccess(target);
      assertProtectedSourceAccess(readSourceRestrictions(paths, target.site_id), job.packet, finalAccess);
      if (!finalAccess.anonymous_denied || !finalAccess.aliases_denied || !finalAccess.noindex) throw stagingError('review_access_failed');
      state.status = 'verified'; save();
      return { verified: true, review_only: true, url: target.url, target_path: target.target_path,
        remote_subdirectory: target.remote_subdirectory, manifest_sha256: manifestHash,
        binding_sha256: bindingHash, rollback_ref: state.backup.ref, operation_id, final_launch: false };
    } catch (e) {
      // Restore only our operation's bytes; provider must CAS every changed
      // file, keep protection enabled, and hash the restored manifest.
      const rollback = await transport.restore({ target, operation_id, backup: state.backup, uploaded: state.uploaded });
      state.status = rollback?.verified ? 'rolled_back' : 'rollback_exception';
      state.uploaded = {}; save();
      if (!rollback?.verified) throw Object.assign(stagingError('rollback_not_verified'), { permanent: true });
      throw e;
    }
  }
  return { deploy: async options => {
    if (transport.claim) await transport.claim(options.operation_id);
    try { return await deploy(options); } finally { if (transport.release) await transport.release(); }
  } };
}

// API serialization used by the injectable provider and its contract harness.
// Compare-and-swap/backup/protection remain mandatory capabilities above.
export function createCpanelFileApi({ request, target }) {
  const bound = structuredClone(target);
  const scoped = path => {
    if (!/^[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(path) || path.includes('..') || path.startsWith('/')) throw stagingError('cpanel_path_rejected');
    return `${bound.target_path}/${path}`;
  };
  return {
    async mkdir({ path }) {
      const full = scoped(path), at = full.lastIndexOf('/');
      const response = await request({ route: 'json-api/cpanel', params: { cpanel_jsonapi_user: 'nineoo', cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'mkdir', path: full.slice(0, at), name: full.slice(at + 1), permissions: '0755' } });
      if (response?.event?.result !== 1) throw stagingError('cpanel_mkdir_failed');
    },
    async upload({ path, bytes }) {
      const full = scoped(path), at = full.lastIndexOf('/');
      const response = await request({ route: 'execute/Fileman/upload_files', form: { dir: full.slice(0, at), overwrite: '1', name: full.slice(at + 1), bytes } });
      if (response?.status !== 1 || response.data?.failed) throw stagingError('cpanel_upload_failed');
    },
  };
}
