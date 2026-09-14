// Build-time source ownership. There is no implicit remote creation or publishing.
import fs from 'node:fs';
import path from 'node:path';
import { createGitDelivery } from './git-delivery.js';
import { preflightRepository, createRepoScaffold, requireRepositoryContract, dirtySnapshot, git, readManifest } from '../../vendor/site-foundation/index.js';

function fail(code, message) { return Object.assign(new Error(message), { code, statusCode: 409 }); }
const hostingRoot = '/home/nineoo/public_html/famtasticinc-landing';

export function createRepositoryLifecycle({ paths, journal }) {
  function inventory() {
    const entries = [];
    for (const [name, root] of Object.entries(paths.roots || {})) {
      if (name !== 'sites' && !name.startsWith('portfolio_')) continue;
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const repository_path = paths.within(name, entry.name);
        const manifest = readManifest(repository_path);
        if (manifest) entries.push({ site_id: manifest.site_id, repository_path, repository_url: manifest.repository?.url });
      }
    }
    return entries;
  }
  function controlFile(dir, name) { return path.resolve(dir, git(dir, ['rev-parse', '--git-path', name])); }
  function begin({ site_id, brief, retry = false }) {
    const { dir } = paths.resolveSite(site_id, { createIfMissing: true });
    const manifest = readManifest(dir);
    const remote = brief?.repository?.url || manifest?.repository?.url || null;
    // Retry is allowed only against exactly the failed run's captured bytes.
    let expected = null;
    if (retry && fs.existsSync(path.join(dir, '.git'))) {
      const receiptFile = controlFile(dir, 'site-foundation-failed.json');
      if (fs.existsSync(receiptFile)) {
        const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
        if (receipt.site_id !== site_id || receipt.head !== git(dir, ['rev-parse', 'HEAD'])) throw fail('retry_repository_changed', 'Repository no longer matches the failed build receipt');
        expected = receipt.changes;
      }
    }
    const checked = preflightRepository({ repository_path: dir, site_id, remote_url: remote, allow_uninitialized: true, expected_changes: expected, registry: inventory() });
    if (checked.initialized && manifest) requireRepositoryContract(dir, site_id);
    if (fs.existsSync(path.join(dir, 'application/composer.json')) || manifest?.capability_class === 'application') throw fail('application_generation_unsupported', 'This application repository must use its own build recipe, not the brochure generator');
    const session = { site_id, dir, remote, branch: manifest?.repository?.branch || brief?.repository?.branch || 'main', initialized: checked.initialized, lock: null, prior_changes: expected || {} };
    if (checked.initialized) lock(session);
    return session;
  }
  function lock(session) {
    const file = controlFile(session.dir, 'site-foundation-build.lock');
    try { const fd = fs.openSync(file, 'wx', 0o600); fs.writeSync(fd, JSON.stringify({ site_id: session.site_id, pid: process.pid })); fs.closeSync(fd); }
    catch (error) { if (error.code === 'EEXIST') throw fail('repository_busy', 'Another build holds this repository lock; inspect it before retrying'); throw error; }
    session.lock = file;
  }
  function bootstrap(session, brief, derivedSpec) {
    if (session.initialized) {
      const authored = fs.readFileSync(path.join(session.dir, 'design.md'), 'utf8');
      const machine = /```json\s*([\s\S]*?)```/.exec(authored);
      if (machine) {
        let design;
        try { design = JSON.parse(machine[1]); } catch { throw fail('design_contract_invalid', 'Authored design JSON is invalid; preserve and repair it explicitly'); }
        const differentTokens = design.tokens && Object.keys(design.tokens).some(key => design.tokens[key] !== derivedSpec.tokens?.[key]);
        if (differentTokens) throw fail('design_revision_required', 'The new build would change authored design tokens; create an explicit design revision first');
      }
      return [];
    }
    const design_contract = derivedSpec.brand?.design_contract || {
      schema_version: 1, source: 'derived-spec', approval: 'operator_review_required',
      tokens: derivedSpec.tokens, typography: { direction: derivedSpec.brand?.type_direction || 'System font stack in generated stylesheet' },
      component_recipe: [...new Set(derivedSpec.pages.flatMap(page => page.sections.map(section => section.type)))],
      responsive: { viewports: [390, 768, 1280], rule: 'Verify generated layouts before approval' },
      asset_policy: { rights_safe_only: true, preserve: true },
    };
    const scaffold = createRepoScaffold({ site_id: session.site_id, business_name: brief.business?.name || derivedSpec.business?.name || session.site_id, description: brief.business?.description || '', business_owner: brief.business_owner, design_contract, repository: { url: session.remote, branch: session.branch } });
    journal.append({ site_id: session.site_id, initiator: 'pipeline', intent: 'repository.bootstrap', changes: scaffold.files.map(file => ({ path: file.path })), result: { status: 'authorized_local_materialization', contract_version: '1.0.0' }, evidence: [], rollback_ref: null });
    createGitDelivery().prepare({ repository_path: session.dir, site_id: session.site_id, hosting_root: hostingRoot, target_path: `${hostingRoot}/${session.site_id}`, remote_url: session.remote, branch: session.branch, scaffold, message: 'Initialize independent site foundation' });
    session.initialized = true;
    lock(session);
    return scaffold.files.map(file => ({ ref: file.path, content: file.contents }));
  }
  function finish(session, result) {
    if (!session.initialized) return result;
    try {
      const changes = dirtySnapshot(session.dir);
      const generated = new Set(['spec.json', ...Object.keys(session.prior_changes), ...(session.generated || []), ...(result?.composed?.pages || []).map(page => page.path), ...(result?.composed?.assets || []).map(asset => asset.path)]);
      const unexpected = Object.keys(changes).filter(file => !generated.has(file) && !file.startsWith('assets/') && !file.startsWith('media/'));
      if (unexpected.length) throw fail('unrelated_build_changes', `Build refuses unrelated source changes: ${unexpected.join(', ')}`);
      const receiptFile = controlFile(session.dir, 'site-foundation-failed.json');
      if (result?.outcome !== 'success') {
        fs.writeFileSync(receiptFile, JSON.stringify({ site_id: session.site_id, head: git(session.dir, ['rev-parse', 'HEAD']), changes }), { mode: 0o600 });
        return result;
      }
      journal.append({ site_id: session.site_id, initiator: 'pipeline', intent: 'repository.commit', changes: Object.keys(changes).map(file => ({ path: file })), result: { status: 'authorized_local_commit' }, evidence: [], rollback_ref: null });
      const delivery = createGitDelivery().prepare({ repository_path: session.dir, site_id: session.site_id, hosting_root: hostingRoot, target_path: `${hostingRoot}/${session.site_id}`, remote_url: session.remote, branch: session.branch, expected_changes: changes, message: 'Build verified site source' });
      if (fs.existsSync(receiptFile)) fs.unlinkSync(receiptFile);
      return { ...result, repository: delivery };
    } finally {
      if (session.lock && fs.existsSync(session.lock)) fs.unlinkSync(session.lock);
    }
  }
  return { begin, bootstrap, finish };
}
