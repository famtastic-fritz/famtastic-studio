/**
 * Brand-voice gate: a deterministic compliance check on generated copy.
 *
 * Why this is deterministic and not a model: this gate is what makes a cheap
 * brain safe on a mechanical stage. The efficiency audit found every local model
 * reaching for "luxurious" in skincare copy for a business whose own brand voice
 * forbids exactly that word. A model judging another model's compliance would
 * share the failure. A regex does not.
 *
 * Its pass/fail is the FIRST machine-readable quality signal in DNA. Everything
 * recorded before it described what a run did, never whether the output was any
 * good, which meant telemetry could only ever recommend cheaper and faster.
 *
 * Forbidden terms come from two places:
 *  - `brand.forbidden_terms`: an explicit list, authoritative.
 *  - The prose of `brand.voice`, which research writes with its anti-patterns
 *    already quoted ("Never uses 'pamper', 'indulge', 'luxurious escape'").
 *    Mining those costs nothing and catches the common case.
 */

const ANTI_PATTERN_CUES = /(?:never uses?|never say|avoids?|avoid|no|not)\b[^.!?]*/gi;
const QUOTED = /['"‘’“”]([^'"‘’“”]{2,40})['"‘’“”]/g;

/**
 * extractForbiddenTerms(brand) -> string[]
 * Explicit list first, then terms quoted inside an anti-pattern clause in the
 * voice prose. Never guesses from unquoted prose: a word merely mentioned in a
 * voice description is not automatically banned.
 */
export function extractForbiddenTerms(brand) {
  const out = new Set();
  const explicit = Array.isArray(brand?.forbidden_terms) ? brand.forbidden_terms : [];
  for (const t of explicit) {
    if (typeof t === 'string' && t.trim()) out.add(t.trim().toLowerCase());
  }
  const voice = typeof brand?.voice === 'string' ? brand.voice : '';
  if (voice) {
    for (const clause of voice.match(ANTI_PATTERN_CUES) || []) {
      let m;
      QUOTED.lastIndex = 0;
      while ((m = QUOTED.exec(clause)) !== null) {
        const term = m[1].trim().toLowerCase();
        if (isPlausibleTerm(term)) out.add(term);
      }
    }
  }
  return [...out];
}

// Mining quoted spans out of prose picks up punctuation and half-sentences as
// well as real terms. A real run extracted `") rather than to abstract"` as a
// forbidden term. A term is plausible only if it is short, made of words, and
// carries no stray punctuation -- anything else is a parsing artifact and
// banning it would be worse than missing it.
function isPlausibleTerm(term) {
  if (!term || term.length < 2 || term.length > 40) return false;
  if (!/^[a-z0-9][a-z0-9 '\u2019-]*[a-z0-9]$/i.test(term)) return false;
  return term.split(/\s+/).length <= 4;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundaried so "luxurious" does not match inside an unrelated word, but a
 * multi-word term like "luxurious escape" still matches as a phrase. Stems are
 * NOT inferred: banning "luxurious" does not silently ban "luxury". If a brand
 * wants both, it lists both -- inventing bans is its own kind of dishonesty.
 */
function termRegex(term) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, 'i');
}

/**
 * checkBrandVoice({ copy, brand }) -> { passed, violations[], terms_checked, fields_checked }
 *
 * `copy` may be a string or an object/array of strings; every string value is
 * checked and the violation records where it was found, so an operator can go
 * straight to the offending field.
 */
export function checkBrandVoice({ copy, brand } = {}) {
  const terms = extractForbiddenTerms(brand);
  const violations = [];
  let fieldsChecked = 0;

  function walk(value, pathStr) {
    if (typeof value === 'string') {
      fieldsChecked += 1;
      for (const term of terms) {
        const re = termRegex(term);
        const m = value.match(re);
        if (m) {
          const idx = value.toLowerCase().indexOf(term);
          violations.push({
            term,
            where: pathStr || '(root)',
            context: value.slice(Math.max(0, idx - 40), idx + term.length + 40).trim(),
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${pathStr}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, pathStr ? `${pathStr}.${k}` : k);
    }
  }
  walk(copy, '');

  return {
    passed: violations.length === 0,
    violations,
    terms_checked: terms,
    fields_checked: fieldsChecked,
    // An empty term list means the brand declared no anti-patterns. That is a
    // vacuous pass and says so, rather than reading as a quality endorsement.
    vacuous: terms.length === 0,
  };
}
