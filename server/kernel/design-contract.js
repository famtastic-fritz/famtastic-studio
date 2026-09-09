/**
 * Versioned machine-readable design contract shared by FAMtastic and Studio
 * Next. `design.md` is the human doctrine; this bounded shape is the part a
 * later page, CMS edit, or rebuild is allowed to consume.
 */

export const DESIGN_CONTRACT_SCHEMA_VERSION = 1;

const TEXT_LIMIT = 240;
const LIST_LIMIT = 48;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanText(value) {
  return text(value) ? value.trim().slice(0, TEXT_LIMIT) : null;
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => text(item))
    .slice(0, LIST_LIMIT)
    .map((item) => item.trim().slice(0, TEXT_LIMIT));
}

function cleanStringMap(value, keys) {
  if (!isObject(value)) return {};
  const out = {};
  for (const key of keys) {
    const item = cleanText(value[key]);
    if (item) out[key] = item;
  }
  return out;
}

/**
 * Keep only the contract fields that are safe and meaningful at the build
 * boundary. This prevents research enrichment from silently deleting or
 * replacing the approved design recipe.
 */
export function sanitizeDesignContract(value) {
  if (!isObject(value)) return null;
  const out = {};
  const version = Number.isInteger(value.schema_version)
    ? value.schema_version
    : Number.isInteger(value.version) ? value.version : null;
  if (version !== null) out.schema_version = version;

  if (isObject(value.tokens)) {
    const tokens = cleanStringMap(value.tokens, ['bg', 'fg', 'accent', 'muted']);
    if (Object.keys(tokens).length) out.tokens = tokens;
  }
  if (isObject(value.typography)) {
    const typography = cleanStringMap(value.typography, ['body', 'headings', 'heading', 'font_family']);
    if (Object.keys(typography).length) out.typography = typography;
  }
  const recipe = cleanStringList(value.component_recipe);
  if (recipe.length) out.component_recipe = recipe;

  const layout = cleanStringMap(value.layout, ['max_width', 'gutter', 'grid', 'density', 'radius']);
  if (Object.keys(layout).length) out.layout = layout;
  const responsive = cleanStringMap(value.responsive, ['mobile', 'tablet', 'desktop']);
  if (Object.keys(responsive).length) out.responsive = responsive;

  if (isObject(value.asset_policy)) {
    const assetPolicy = {};
    for (const key of ['preserve', 'rights_safe_only', 'allow_new_assets']) {
      if (typeof value.asset_policy[key] === 'boolean') assetPolicy[key] = value.asset_policy[key];
    }
    const roles = cleanStringList(value.asset_policy.required_roles);
    if (roles.length) assetPolicy.required_roles = roles;
    if (Object.keys(assetPolicy).length) out.asset_policy = assetPolicy;
  }

  if (isObject(value.evolution)) {
    const evolution = {};
    for (const key of ['preserve_tokens', 'preserve_typography', 'additions_must_use_recipe', 'parity_required']) {
      if (typeof value.evolution[key] === 'boolean') evolution[key] = value.evolution[key];
    }
    if (Object.keys(evolution).length) out.evolution = evolution;
  }
  return Object.keys(out).length ? out : null;
}

function required(value, label, errors) {
  if (!text(value)) errors.push(`${label}: required`);
}

/**
 * Validate the fields needed for future page additions to remain on the
 * approved system. A selected build fails closed rather than inventing a
 * layout when this contract is incomplete.
 */
export function validateDesignContract(value, { prefix = 'brand.design_contract' } = {}) {
  const errors = [];
  const contract = value;
  if (!isObject(contract)) return [`${prefix}: required approved machine-readable design contract`];
  if (contract.schema_version !== DESIGN_CONTRACT_SCHEMA_VERSION) {
    errors.push(`${prefix}.schema_version: must equal ${DESIGN_CONTRACT_SCHEMA_VERSION}`);
  }
  if (!isObject(contract.tokens)) errors.push(`${prefix}.tokens: required`);
  else for (const key of ['bg', 'fg', 'accent', 'muted']) required(contract.tokens[key], `${prefix}.tokens.${key}`, errors);
  if (!isObject(contract.typography)) errors.push(`${prefix}.typography: required`);
  else required(contract.typography.body || contract.typography.font_family, `${prefix}.typography.body`, errors);
  if (!Array.isArray(contract.component_recipe) || contract.component_recipe.length === 0) {
    errors.push(`${prefix}.component_recipe: required non-empty list`);
  }
  if (!isObject(contract.layout)) errors.push(`${prefix}.layout: required`);
  else for (const key of ['max_width', 'gutter', 'grid']) required(contract.layout[key], `${prefix}.layout.${key}`, errors);
  if (!isObject(contract.responsive)) errors.push(`${prefix}.responsive: required`);
  else for (const key of ['mobile', 'tablet', 'desktop']) required(contract.responsive[key], `${prefix}.responsive.${key}`, errors);
  if (!isObject(contract.asset_policy)) errors.push(`${prefix}.asset_policy: required`);
  else {
    if (contract.asset_policy.preserve !== true) errors.push(`${prefix}.asset_policy.preserve: must be true`);
    if (contract.asset_policy.rights_safe_only !== true) errors.push(`${prefix}.asset_policy.rights_safe_only: must be true`);
  }
  if (!isObject(contract.evolution)) errors.push(`${prefix}.evolution: required`);
  else for (const key of ['preserve_tokens', 'preserve_typography', 'additions_must_use_recipe', 'parity_required']) {
    if (contract.evolution[key] !== true) errors.push(`${prefix}.evolution.${key}: must be true`);
  }
  return errors;
}

