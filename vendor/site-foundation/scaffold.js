import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail, normalizeRemote, readManifest } from './git.js';

export const REPO_SCAFFOLD_SCHEMA_VERSION = 1;
export const CONTRACT_VERSION = '1.1.0';
export const FOUNDATION_VERSION = '1.2.0';
export const COMMUNICATION_CONTRACT_VERSION = 1;
const LEGACY_REQUIRED_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'design.md', 'CHANGELOG.md', 'SITE-LEARNINGS.md', 'CONVERSATIONS.md', '.gitignore', '.env.example', '.famtastic/site-manifest.json', 'docs/research/README.md', 'docs/research/sources.json', 'docs/DEPLOYMENT.md', 'docs/PORTABILITY.md', 'docs/legal/README.md', 'docs/assets/provenance.json'];
export const REQUIRED_FILES = [...LEGACY_REQUIRED_FILES, 'CODEX.md', 'FAMTASTIC-CONTEXT.md', 'SITE-STATE.md', '.famtastic/communications.json', 'docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md'];
const REQUIRED_FILES_BY_CONTRACT = { '1.0.0': LEGACY_REQUIRED_FILES, [CONTRACT_VERSION]: REQUIRED_FILES };
const REQUIRED_COMMUNICATION_TEMPLATES = [
  { id: 'customer_staging_review_ready', version: 1 },
  { id: 'customer_intake_submitted', version: 2 },
  { id: 'customer_proof_ready', version: 4 },
  { id: 'customer_revision_received', version: 2 },
  { id: 'customer_message_reply', version: 2 },
  { id: 'standard', version: 2 },
];
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
    installed_recipes: [{ id: 'site-foundation', version: FOUNDATION_VERSION }], canonical_url,
    publication: { state: 'staging', legal_review: 'required', seo_review: 'required', release_receipt: null },
  };
  // A site creates evidence and a delivery intent; it never owns credentials or
  // sends customer mail directly. FAMtastic Designs owns the authenticated
  // SMTP boundary, durable outbox, template/version selection and receipts.
  const communications = {
    schema_version: COMMUNICATION_CONTRACT_VERSION,
    contract: 'famtastic-designs-centralized-delivery',
    site_id,
    delivery_authority: {
      service: 'FAMtastic Designs',
      system_of_record: 'famtastic_pipeline',
      transport: 'authenticated_famtastic_designs_smtp',
      dispatch: 'central_outbox_only',
      direct_site_smtp: 'forbidden',
      direct_site_provider_api: 'forbidden',
    },
    sender: {
      brand: 'FAMtastic Designs',
      signing_name: 'Shay',
      signature_text: '— Shay\nFAMtastic Designs',
      from_and_reply_to: 'environment_configured_famtastic_designs_mailbox_only',
    },
    template_registry: {
      authority: 'famtastic_pipeline',
      templates: [
        { id: 'customer_staging_review_ready', version: 1 },
        { id: 'customer_intake_submitted', version: 2 },
        { id: 'customer_proof_ready', version: 4 },
        { id: 'customer_revision_received', version: 2 },
        { id: 'customer_message_reply', version: 2 },
        { id: 'standard', version: 2 },
      ],
    },
    delivery_intent: {
      required_fields: ['site_id', 'recipient', 'template_id', 'template_version', 'purpose', 'artifact_or_workspace_url', 'idempotency_key'],
      required_receipts: ['outbox_record', 'template_id_and_version', 'smtp_message_id_or_explicit_failure'],
      proof_rule: 'A local proof artifact is not customer delivery. FAMtastic Designs records the central outbox and SMTP result separately.',
    },
  };
  const docs = {
    'README.md': `# ${business_name}\n\n${description}\n\nBusiness owner: ${business_owner.name}. Builder: ${builder.name}. This is a complete, independent customer source repository, not a folder in the builder's repository.\n\nRead [design.md](design.md), [deployment](docs/DEPLOYMENT.md), [portability](docs/PORTABILITY.md), and the mandatory [FAMtastic Designs communication delivery contract](docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md). Run \`node .famtastic/verify-repository.mjs\` before delivery. Source validation is not deployment proof.\n`,
    'AGENTS.md': `# ${business_name}: agent operating contract\n\nRead README.md, design.md, FAMTASTIC-CONTEXT.md, SITE-STATE.md, SITE-LEARNINGS.md and CONVERSATIONS.md before changes. Verify Git root, common directory, branch, origin and site identity before any writes. The business owns its website, application and records; ${builder.name} is the builder, not the business owner. Preserve authored documents, backend source, data and approved assets during rebuilds.\n\n## Mandatory FAMtastic Designs communication route\n\nRead \`.famtastic/communications.json\` and \`docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md\` before creating or changing a contact confirmation, customer communication, review invite, proof, revision, or delivery notice. This site never sends SMTP mail or calls an email-provider API directly. It returns a versioned, idempotent delivery intent plus its artifact/workspace evidence to FAMtastic Designs. FAMtastic Designs selects the approved template, renders the branded message, signs it as Shay, routes it through its authenticated SMTP boundary, and records the outbox and SMTP receipt. A local proof is not customer delivery.\n\nKeep credentials, customer records, private conversations and bearer links out of Git. Reuse pinned packages at build time without introducing a runtime dependency on the agency or studio. Run the site tests and repository validator before committing; distinguish local, pushed, deployed and production-proven states. Update design, learnings, changelog and research after meaningful work.\n`,
    'CLAUDE.md': '# Claude startup\n\nRead AGENTS.md, FAMTASTIC-CONTEXT.md, SITE-STATE.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md. Before any communication or proof change, read .famtastic/communications.json and docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md. Customer source and business records belong to this independent repository. Follow the repository identity preflight before mutation. Do not add direct SMTP or provider-email sending.\n',
    'CODEX.md': '# Codex startup\n\nRead AGENTS.md, FAMTASTIC-CONTEXT.md, SITE-STATE.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md. Verify the exact repository/worktree identity before writes. Before any communication or proof change, read .famtastic/communications.json and docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md. This repo produces delivery intents and evidence only; FAMtastic Designs owns template selection, Shay signature, SMTP dispatch and delivery receipts.\n',
    'GEMINI.md': '# Gemini and Antigravity startup\n\nRead AGENTS.md, FAMTASTIC-CONTEXT.md, SITE-STATE.md, design.md, SITE-LEARNINGS.md and CONVERSATIONS.md. Before any communication or proof change, read .famtastic/communications.json and docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md. Do not place customer source in agency/platform repositories, overwrite authored records during regeneration, or add direct SMTP/provider-email sending.\n',
    'design.md': `# ${business_name}: design contract\n\nThis versioned contract records the actual selected design inputs. It is not automatic owner approval. Preserve authored design choices during rebuilds; record a versioned change when direction changes.\n\n\`\`\`json\n${JSON.stringify(design_contract, null, 2)}\n\`\`\`\n\n## Responsive and accessibility acceptance\n\nVerify 390, 768 and 1280 pixel layouts, keyboard navigation, readable contrast, reduced motion and form error states. Preserve asset rights and provenance.\n`,
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- Bootstrapped independent customer source repository with site-foundation 1.2.0, mandatory creator credit, and the FAMtastic Designs centralized communications route. No deployment or outbound message is implied.\n',
    'SITE-LEARNINGS.md': '# Site learnings\n\nRecord site-specific observations, decisions, failed approaches and verification evidence here. Generalized reusable lessons belong in the owning library; link their pinned versions rather than duplicating their source authority.\n',
    'CONVERSATIONS.md': '# Conversation decisions\n\nThis repository stores curated, redacted decisions, not raw private conversations. For each entry record date, decision, source task reference, affected commit and verified private archive link when available. Never claim a Drive upload from a local sync-folder write alone.\n',
    'FAMTASTIC-CONTEXT.md': '# FAMtastic Designs shared context\n\nThis customer site is part of the FAMtastic Designs delivery ecosystem while remaining independently owned. Reuse validated patterns only through explicit, versioned contracts. The universal communication rule is central delivery: this repo creates a delivery intent and evidence; FAMtastic Designs selects the template, brands and signs the message as Shay, dispatches through its authenticated SMTP boundary, and records the receipt. Read `.famtastic/communications.json` and `docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md` before changing that boundary.\n',
    'SITE-STATE.md': `# ${business_name}: site state\n\n- Local source: initialized; verify the current Git branch and commit before any claim.\n- Pushed source: not proven by this scaffold.\n- Deployed preview: not configured by this scaffold.\n- Production-proven runtime: not configured by this scaffold.\n- Customer accepted: not recorded by this scaffold.\n- Communication/proof delivery: a local artifact or build result is not customer delivery. FAMtastic Designs must retain a central outbox and SMTP receipt under the communication contract.\n`,
    '.gitignore': 'node_modules/\nvendor/\n.env\n.env.*\n!.env.example\ndist/\ncoverage/\n.DS_Store\n*.log\n*.sql\n*.sqlite\n',
    '.env.example': '# Document required variable names and purpose here. Never include production values.\n',
    '.famtastic/site-manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    '.famtastic/communications.json': `${JSON.stringify(communications, null, 2)}\n`,
    'docs/research/README.md': '# Research\n\nCapture sources, retrieval dates, findings, alternatives and decisions before implementation. Separate observations from inferences and customer claims. Store source records in sources.json; keep private raw archives outside Git.\n',
    'docs/research/sources.json': '{"schema_version":1,"sources":[]}\n',
    'docs/DEPLOYMENT.md': '# Deployment and rollback\n\nDeployment is not configured by this scaffold. Before launch document build/test commands, runtime requirements, exact public/private roots, secret provisioning, immutable release and prior-release rollback, database backup/restore and provider verification. Do not publish a source repository wholesale.\n',
    'docs/PORTABILITY.md': '# Portability\n\nA fresh clone must install from this repository lockfiles, build and test without neighboring agency or studio checkouts. Include application, approved public assets, runtime/version requirements and deployment tooling. Export private database/uploads and provision secrets separately; never commit them. Prove restore before a host move.\n',
    'docs/FAMTASTIC-DESIGNS-COMMUNICATION-DELIVERY.md': `# FAMtastic Designs centralized communication delivery\n\n## Non-negotiable route\n\nThis site is an independent source repository. It does **not** own an SMTP credential, a direct email-provider API key, template rendering authority, or a customer-mail delivery record. Any contact confirmation, proof/review notice, revision acknowledgement, or customer communication must become a delivery intent returned to FAMtastic Designs. The authoritative machine contract is \`.famtastic/communications.json\`.\n\nFAMtastic Designs then: (1) verifies that the customer/proof state permits the notice, (2) selects the versioned template, (3) renders the FAMtastic Designs branded message, (4) signs it as **Shay**, (5) sends it only through the authenticated FAMtastic Designs SMTP boundary, and (6) stores the immutable outbox/template/SMTP result.\n\n## Delivery intent required fields\n\nA sender supplies \`site_id\`, recipient, purpose, \`template_id\`, \`template_version\`, authenticated artifact or workspace URL, and a stable idempotency key. A local proof artifact is neither an email send nor customer delivery. Never report proof delivery without the central outbox record and SMTP message ID or explicit terminal failure.\n\n## Active template families\n\n- \`customer_staging_review_ready\` v1 — a narrow owner-approved staging review; it is not a proof-room substitute.\n- \`customer_intake_submitted\` v2 — receipt for a verified customer request entering review.\n- \`customer_proof_ready\` v4 — owner-approved authenticated proof/workspace review.\n- \`customer_revision_received\` v2 — receipt for permitted customer feedback.\n- \`customer_message_reply\` v2 — account-owned conversation reply.\n- \`standard\` v2 — neutral operational notification; it must not borrow proof or commercial language.\n\nTemplate IDs and versions are source contracts. Do not substitute a campaign, provider template, or copied HTML. A template change must be made in the FAMtastic Designs control plane with its tests and registry update.\n\n## Hard boundaries\n\n- No \`SMTP_*\`, mail password, Resend/SendGrid/Mailgun token, or similar sender credential belongs in this repo.\n- No local app, static form, worker, or agent may bypass the central outbox with direct SMTP or a provider SDK.\n- FAMtastic Designs keeps the sender identity and reply path environment-configured; no address is invented here.\n- Existing eligibility, customer-state, consent, and owner-policy gates still apply. Central routing does not itself authorize a send.\n- Keep customer data, bearer links, mail bodies, and delivery receipts out of public build artifacts and Git unless the business has explicitly approved a protected record.\n`,
    'docs/legal/README.md': '# Privacy and terms release gate\n\nReview actual data flows, analytics, booking, newsletter consent and service terms with the business. Author public policies matching implemented behavior. The scaffold does not invent a legal policy or claim compliance. Staging robots are noindex-by-default; production publication requires reviewed policies, canonical metadata and sitemap.\n',
    'docs/assets/provenance.json': '{"schema_version":1,"assets":[],"policy":"Only approved assets with ownership and permitted reuse records may ship."}\n',
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n',
    '.famtastic/verify-repository.mjs': "import { requireRepositoryContract, preflightRepository } from './site-foundation/index.js';\nimport { fileURLToPath } from 'node:url';\nconst root = fileURLToPath(new URL('../', import.meta.url));\nconst manifest = requireRepositoryContract(root);\npreflightRepository({ repository_path: root, site_id: manifest.site_id, remote_url: manifest.repository.url, require_clean: false });\nconsole.log(JSON.stringify({valid:true,site_id:manifest.site_id,contract_version:manifest.contract_version}));\n",
  };
  const creditPolicy = fs.readFileSync(new URL('CREATOR-CREDIT.md', import.meta.url), 'utf8');
  docs['docs/CREATOR-CREDIT.md'] = creditPolicy;
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md', 'design.md']) docs[name] += '\n## Mandatory creator credit\n\nRead docs/CREATOR-CREDIT.md. Preserve existing footer text and append the exact approved linked PNG once. No tier exemptions; only an explicit recorded owner override. Credit does not change business identity or authorize a release.\n';
  // Vendored bytes make the generated repository independently verifiable.
  for (const name of ['index.js', 'git.js', 'scaffold.js', 'package.json', 'site-repository.schema.json', 'creator-credit.js', 'credit-html.js', 'CREATOR-CREDIT.md']) docs[`.famtastic/site-foundation/${name}`] = fs.readFileSync(new URL(name, import.meta.url), 'utf8');
  docs['.famtastic/site-foundation/famtastic-designs-logo-v1.png'] = fs.readFileSync(new URL('famtastic-designs-logo-v1.png', import.meta.url));
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
  if (!manifest || manifest.schema_version !== 1 || !REQUIRED_FILES_BY_CONTRACT[manifest.contract_version] || manifest.format !== 'source_repository') throw fail('contract_required', 'site-foundation source_repository contract 1.0.0 or 1.1.0 is required');
  if (expectedSiteId && manifest.site_id !== expectedSiteId) throw fail('site_identity_mismatch', 'Manifest belongs to another site');
  if (!manifest.business_owner?.name || !manifest.builder?.name || !manifest.repository || !Array.isArray(manifest.installed_recipes)) throw fail('contract_invalid', 'Business owner, builder, repository and installed recipes are required');
  const missing = REQUIRED_FILES_BY_CONTRACT[manifest.contract_version].filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) throw fail('contract_files_missing', `Required site records are missing: ${missing.join(', ')}`);
  if (fs.readFileSync(path.join(root, 'design.md'), 'utf8').trim().length < 160) throw fail('design_contract_required', 'design.md must contain the substantive site design contract');
  if (manifest.contract_version === CONTRACT_VERSION) requireCommunicationsContract(root, manifest.site_id);
  return manifest;
}

export function requireCommunicationsContract(root, expectedSiteId = null) {
  const file = path.join(root, '.famtastic', 'communications.json');
  let contract;
  try { contract = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw fail('communications_contract_invalid', 'FAMtastic Designs communications contract must be valid JSON'); }
  if (
    contract?.schema_version !== COMMUNICATION_CONTRACT_VERSION
    || contract.contract !== 'famtastic-designs-centralized-delivery'
    || (expectedSiteId && contract.site_id !== expectedSiteId)
    || contract.delivery_authority?.service !== 'FAMtastic Designs'
    || contract.delivery_authority?.system_of_record !== 'famtastic_pipeline'
    || contract.delivery_authority?.transport !== 'authenticated_famtastic_designs_smtp'
    || contract.delivery_authority?.dispatch !== 'central_outbox_only'
    || contract.delivery_authority?.direct_site_smtp !== 'forbidden'
    || contract.delivery_authority?.direct_site_provider_api !== 'forbidden'
    || contract.sender?.brand !== 'FAMtastic Designs'
    || contract.sender?.signing_name !== 'Shay'
    || contract.sender?.signature_text !== '— Shay\nFAMtastic Designs'
    || !Array.isArray(contract.template_registry?.templates)
    || REQUIRED_COMMUNICATION_TEMPLATES.some(required => !contract.template_registry.templates.some(template => template?.id === required.id && template?.version === required.version))
    || !Array.isArray(contract.delivery_intent?.required_fields)
    || !Array.isArray(contract.delivery_intent?.required_receipts)
  ) throw fail('communications_contract_invalid', 'FAMtastic Designs centralized delivery, template, and Shay signature contract is required');
  return contract;
}
