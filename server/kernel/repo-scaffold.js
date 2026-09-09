/**
 * Deterministic per-site repository defaults.
 *
 * This produces the files a new site repository must start with. It does not
 * run git, create a remote, or push anything; those are explicit transport
 * operations after the target/repository contract has been approved.
 */
import crypto from 'node:crypto';

export const REPO_SCAFFOLD_SCHEMA_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function safeSiteId(value) { return text(value) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function createRepoScaffold({ site_id, business_name, description = '', design_contract, target = 'famtasticinc-shared', repository = {} } = {}) {
  if (!safeSiteId(site_id)) throw Object.assign(new Error('site_id must be lowercase kebab-case'), { code: 'identity_invalid' });
  if (!text(business_name)) throw Object.assign(new Error('business_name is required'), { code: 'business_required' });
  if (!design_contract || design_contract.schema_version !== 1) throw Object.assign(new Error('design_contract v1 is required'), { code: 'design_contract_required' });
  const contractText = JSON.stringify(design_contract, null, 2);
  const manifest = {
    schema_version: REPO_SCAFFOLD_SCHEMA_VERSION,
    site_id,
    business_name,
    target,
    repository: { mode: repository.mode || 'create_or_existing', url: repository.url || null, branch: repository.branch || 'main' },
    design_contract_sha256: digest(design_contract),
    generated_by: 'site-studio-next',
  };
  const files = [
    { path: 'README.md', contents: `# ${business_name}\n\n${description}\n\nThis repository is materialized by Site Studio Next from a selected FAMtastic Designs packet.\n\n- Target: \`${target}\`\n- Design contract: [design.md](design.md)\n- Build manifest: [.famtastic/site-manifest.json](.famtastic/site-manifest.json)\n\nExternal deployment and DNS remain explicit, receipt-backed operations.\n` },
    { path: 'AGENTS.md', contents: `# Site operating contract\n\n- Preserve the approved design contract in \`design.md\`.\n- Do not replace approved tokens, typography, responsive rules, or assets without a versioned design revision.\n- Run the repository QA and parity gates before staging or production.\n- Keep customer data, credentials, and bearer links out of shared recipe records.\n` },
    { path: 'CLAUDE.md', contents: `# Build context\n\nThis site is owned by FAMtastic Designs and was bootstrapped by Site Studio Next. Read \`AGENTS.md\` and \`design.md\` before changing pages or components.\n` },
    { path: 'design.md', contents: `# ${business_name} design contract\n\nThis file is the human-readable companion to the machine contract. The machine contract hash is recorded in \`.famtastic/site-manifest.json\`.\n\n## Approved contract\n\n\`\`\`json\n${contractText}\n\`\`\`\n\nAdditions must use the approved component recipe and pass mobile, tablet, and desktop parity checks.\n` },
    { path: '.gitignore', contents: 'node_modules/\n.env\n.env.*\n!.env.example\ndist/\n.studio-next-data/\n.DS_Store\n*.log\n' },
    { path: '.famtastic/site-manifest.json', contents: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'src/.gitkeep', contents: '' },
  ];
  return { schema_version: REPO_SCAFFOLD_SCHEMA_VERSION, manifest, files };
}

