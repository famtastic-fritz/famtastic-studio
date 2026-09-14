import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail, normalizeRemote, readManifest } from './git.js';

export const REPO_SCAFFOLD_SCHEMA_VERSION = 1;
export const CONTRACT_VERSION = '1.0.0';
export const REQUIRED_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'design.md', 'CHANGELOG.md', 'SITE-LEARNINGS.md', 'CONVERSATIONS.md', '.gitignore', '.env.example', '.famtastic/site-manifest.json', 'docs/research/README.md', 'docs/research/sources.json', 'docs/DEPLOYMENT.md', 'docs/PORTABILITY.md', 'docs/legal/README.md', 'docs/assets/provenance.json'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createRepoScaffold({ site_id, business_name, business_owner = { name: business_name }, builder = { name: 'FAMtastic Designs', url: 'https://famtasticdesigns.com' }, description = '', design_contract, target = 'unconfigured', repository = {}, canonical_url = null } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site_id || '')) throw fail('identity_invalid', 'site_id must be lowercase kebab-case');
  if (!business_name?.trim()) throw fail('business_required', 'business_name is required');
  if (!design_contract || design_contract.schema_version !== 1 || Object.keys(design_contract).length < 2) throw fail('design_contract_required', 'A substantive design_contract v1 is required');
  if (!business_owner?.name || !builder?.name) throw fail('owner_required', 'Business owner and builder must be identified separately');
  normalizeRemote(repository.url);
  if (canonical_url && !/^https:\/\/[^/?#]+\/?$/.test(canonical_url)) throw fail('canonical_invalid', 'canonical_url must be an explicit HTTPS origin');
  const manifest = {
    schema_version: 1, contract_version: CONTRACT_VERSION, format: 'source_repository', site_id, business_name, business_owner, builder, target,
    repository: { mode: repository.mode || 'create_or_existing', url: repository.url || null, branch: repository.branch || 'main', state: 'local_only' },
    design_contract_sha256: digest(design_contract), generated_by: 'site-foundation',
    installed_recipes: [{ id: 'site-foundation', version: CONTRACT_VERSION }], canonical_url,
    publication: { state: 'staging', legal_review: 'required', seo_review: 'required', release_receipt: null },
  };
  const docs = {
    'README.md': `# ${business_name}\n\n${description}\n\nBusiness owner: ${business_owner.name}. Builder: ${builder.name}. This is a complete, independent customer source repository, not a folder in the builder's repository.\n\nRead [design.md](design.md), [deployment](docs/DEPLOYMENT.md), and [portability](docs/PORTABILITY.md). Run \`node .famtastic/verify-repository.mjs\` before delivery. Source validation is not deployment proof.\n`,
    'AGENTS.md': `# ${business_name}: agent operating contract\n\nRead README.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md before changes. Verify Git root, common directory, branch, origin and site identity before any writes. The business owns its website, application and records; ${builder.name} is the builder, not the business owner. Preserve authored documents, backend source, data and approved assets during rebuilds.\n\nKeep credentials, customer records, private conversations and bearer links out of Git. Reuse pinned packages at build time without introducing a runtime dependency on the agency or studio. Run the site tests and repository validator before committing; distinguish local, pushed, deployed and production-proven states. Update design, learnings, changelog and research after meaningful work.\n`,
    'CLAUDE.md': '# Claude startup\n\nRead AGENTS.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md. Customer source and business records belong to this independent repository. Follow the repository identity preflight before mutation.\n',
    'GEMINI.md': '# Gemini and Antigravity startup\n\nRead AGENTS.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md. Do not place customer source in agency/platform repositories or overwrite authored records during regeneration.\n',
    'design.md': `# ${business_name}: design contract\n\nThis versioned contract records the actual selected design inputs. It is not automatic owner approval. Preserve authored design choices during rebuilds; record a versioned change when direction changes.\n\n\`\`\`json\n${JSON.stringify(design_contract, null, 2)}\n\`\`\`\n\n## Responsive and accessibility acceptance\n\nVerify 390, 768 and 1280 pixel layouts, keyboard navigation, readable contrast, reduced motion and form error states. Preserve asset rights and provenance.\n`,
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- Bootstrapped independent customer source repository with site-foundation 1.0.0. No deployment is implied.\n',
    'SITE-LEARNINGS.md': '# Site learnings\n\nRecord site-specific observations, decisions, failed approaches and verification evidence here. Generalized reusable lessons belong in the owning library; link their pinned versions rather than duplicating their source authority.\n',
    'CONVERSATIONS.md': '# Conversation decisions\n\nThis repository stores curated, redacted decisions, not raw private conversations. For each entry record date, decision, source task reference, affected commit and verified private archive link when available. Never claim a Drive upload from a local sync-folder write alone.\n',
    '.gitignore': 'node_modules/\nvendor/\n.env\n.env.*\n!.env.example\ndist/\ncoverage/\n.DS_Store\n*.log\n*.sql\n*.sqlite\n',
    '.env.example': '# Document required variable names and purpose here. Never include production values.\n',
    '.famtastic/site-manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'docs/research/README.md': '# Research\n\nCapture sources, retrieval dates, findings, alternatives and decisions before implementation. Separate observations from inferences and customer claims. Store source records in sources.json; keep private raw archives outside Git.\n',
    'docs/research/sources.json': '{"schema_version":1,"sources":[]}\n',
    'docs/DEPLOYMENT.md': '# Deployment and rollback\n\nDeployment is not configured by this scaffold. Before launch document build/test commands, runtime requirements, exact public/private roots, secret provisioning, immutable release and prior-release rollback, database backup/restore and provider verification. Do not publish a source repository wholesale.\n',
    'docs/PORTABILITY.md': '# Portability\n\nA fresh clone must install from this repository lockfiles, build and test without neighboring agency or studio checkouts. Include application, approved public assets, runtime/version requirements and deployment tooling. Export private database/uploads and provision secrets separately; never commit them. Prove restore before a host move.\n',
    'docs/legal/README.md': '# Privacy and terms release gate\n\nReview actual data flows, analytics, booking, newsletter consent and service terms with the business. Author public policies matching implemented behavior. The scaffold does not invent a legal policy or claim compliance. Staging robots are noindex-by-default; production publication requires reviewed policies, canonical metadata and sitemap.\n',
    'docs/assets/provenance.json': '{"schema_version":1,"assets":[],"policy":"Only approved assets with ownership and permitted reuse records may ship."}\n',
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n',
    '.famtastic/verify-repository.mjs': "import { requireRepositoryContract, preflightRepository } from './site-foundation/index.js';\nimport { fileURLToPath } from 'node:url';\nconst root = fileURLToPath(new URL('../', import.meta.url));\nconst manifest = requireRepositoryContract(root);\npreflightRepository({ repository_path: root, site_id: manifest.site_id, remote_url: manifest.repository.url, require_clean: false });\nconsole.log(JSON.stringify({valid:true,site_id:manifest.site_id,contract_version:manifest.contract_version}));\n",
  };
  // Vendored bytes make the generated repository independently verifiable.
  for (const name of ['index.js', 'git.js', 'scaffold.js', 'package.json', 'site-repository.schema.json']) docs[`.famtastic/site-foundation/${name}`] = fs.readFileSync(new URL(name, import.meta.url), 'utf8');
  return { schema_version: 1, manifest, files: Object.entries(docs).map(([filePath, contents]) => ({ path: filePath, contents })) };
}

/** Missing files only: an authored document is never silently regenerated. */
export function scaffoldChanges(root, scaffold) {
  return scaffold.files.filter(file => {
    const full = path.join(root, file.path);
    let current = root;
    for (const part of file.path.split('/')) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw fail('symlink_rejected', `Scaffold path is a symlink: ${file.path}`);
    }
    return !fs.existsSync(full);
  });
}
export function requireRepositoryContract(root, expectedSiteId = null) {
  const manifest = readManifest(root);
  if (!manifest || manifest.schema_version !== 1 || manifest.contract_version !== CONTRACT_VERSION || manifest.format !== 'source_repository') throw fail('contract_required', 'site-foundation source_repository contract 1.0.0 is required');
  if (expectedSiteId && manifest.site_id !== expectedSiteId) throw fail('site_identity_mismatch', 'Manifest belongs to another site');
  if (!manifest.business_owner?.name || !manifest.builder?.name || !manifest.repository || !Array.isArray(manifest.installed_recipes)) throw fail('contract_invalid', 'Business owner, builder, repository and installed recipes are required');
  const missing = REQUIRED_FILES.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) throw fail('contract_files_missing', `Required site records are missing: ${missing.join(', ')}`);
  if (fs.readFileSync(path.join(root, 'design.md'), 'utf8').trim().length < 160) throw fail('design_contract_required', 'design.md must contain the substantive site design contract');
  return manifest;
}
