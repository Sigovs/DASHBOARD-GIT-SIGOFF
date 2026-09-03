/**
 * Repository name -> human display title.
 *
 * This is the automatic fallback. Anything it gets wrong is meant to be fixed
 * once, by hand, in data/catalog-overrides.json — not by adding special cases
 * here. Keep the rules general.
 */

/** Tokens that stay upper-case because they are names, not words. */
export const ACRONYMS = new Set([
  'AAN', 'CMC', 'GD', 'GTA', 'VIP', 'BHCC', 'GM', 'FC', 'NFI', 'WSMW', 'TBTW',
  'RR', 'VB', 'SF', 'NY', 'LA', 'UK', 'USA', 'LLC', 'UI', 'UX', 'CTA', 'SEO',
  'AMG', 'BMW', 'MB', 'GT', 'GTS', 'SUV', 'EV', 'CRM', 'CMS', 'API', 'PDF',
]);

/** Shorthand that reads badly when merely capitalised. */
export const EXPANSIONS = new Map(Object.entries({
  UPD: 'Update',
  UPDS: 'Updates',
  PPREVIEW: 'Preview',
  PREV: 'Preview',
  WEBSITE: 'Website',
  DEV: 'Dev',
  DOCS: 'Docs',
  CONFIG: 'Config',
}));

/** Small words that stay lower-case unless they open or close the title. */
const MINOR = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

const SEPARATORS = /[_\-.+\s]+/g;
const TRIM_JUNK = /^[_\-.\s]+|[_\-.\s]+$/g;

/**
 * Split a letter/digit run into two tokens, but only where it reads as a word
 * followed by a number ("concept4" -> "Concept 4"). Short all-caps stems like
 * "GD2" or "K2" are left alone because they are names.
 */
function splitLetterDigit(token) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(token);
  if (!m) return [token];
  const [, letters, digits] = m;
  const isShortName = letters.length <= 3 && letters === letters.toUpperCase();
  if (isShortName) return [token];
  return [letters, digits];
}

function castToken(token, { isEdge }) {
  const upper = token.toUpperCase();

  if (EXPANSIONS.has(upper)) return EXPANSIONS.get(upper);
  if (ACRONYMS.has(upper)) return upper;

  // Pure numbers ("2026", "360", "4") pass through untouched.
  if (/^\d+$/.test(token)) return token;

  // Short designations that carry a digit are names: GD2, K2, S4, 911.
  if (/^[A-Z0-9]{1,4}$/.test(token) && /\d/.test(token)) return upper;

  // Already a proper name with its own casing: McMurtry, iBuy, DriveMAX.
  if (/^[A-Z][a-z]+[A-Z]/.test(token) || /^[a-z][A-Z]/.test(token)) return token;

  if (!isEdge && MINOR.has(token.toLowerCase())) return token.toLowerCase();

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * "Wes_Financial_Auto" -> "Wes Financial Auto"
 * "cmc_concept4"       -> "CMC Concept 4"
 * "AAN_MASTER_2026"    -> "AAN Master 2026"
 * "-Exotic-Motorsports-of-Oklahoma" -> "Exotic Motorsports of Oklahoma"
 */
export function titleFromRepoName(name) {
  const cleaned = String(name || '').replace(TRIM_JUNK, '');
  if (!cleaned) return String(name || '');

  const tokens = cleaned
    .split(SEPARATORS)
    .filter(Boolean)
    .flatMap(splitLetterDigit);

  if (!tokens.length) return cleaned;

  return tokens
    .map((token, i) => castToken(token, { isEdge: i === 0 || i === tokens.length - 1 }))
    .join(' ');
}

/**
 * A subtitle derived strictly from words already present in the repo name, so
 * it never invents a claim about what the project is. Returns null when the
 * name says nothing useful.
 */
const SUBTITLE_RULES = [
  [/\bp?preview\b/i, 'Preview build'],
  [/\bconcept\d*\b/i, 'Concept'],
  [/\b(lab|tests?)\b/i, 'Lab / test'],
  [/\bmaster\b/i, 'Master build'],
  [/\bportal\b/i, 'Portal'],
  [/\bsetup\b/i, 'Setup'],
  [/\b(upd|update)\b/i, 'Site update'],
  [/\bfinal\b/i, 'Final build'],
  [/\bdev\b/i, 'Development build'],
  [/\bredesign\b/i, 'Redesign'],
  [/\breview\b/i, 'Review build'],
];

export function subtitleFromRepoName(name) {
  const spaced = String(name || '').replace(SEPARATORS, ' ');
  for (const [pattern, label] of SUBTITLE_RULES) {
    if (pattern.test(spaced)) return label;
  }
  return null;
}

/** Two-letter mark for the generated placeholder. */
export function initialsFromTitle(title, repoName = '') {
  const words = String(title || repoName)
    .replace(SEPARATORS, ' ')
    .split(' ')
    .filter((w) => /[A-Za-z0-9]/.test(w));

  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
