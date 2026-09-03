/**
 * The category list is presentation metadata, not GitHub data. It lives in
 * data/catalog-overrides.json and is fully editable. This module only supplies
 * a first guess for repositories that have no entry yet.
 */
export const DEFAULT_CATEGORIES = [
  'AAN',
  'Client Sites',
  'Automotive',
  '3D / Experimental',
  'Personal',
  'Archive',
];

const RULES = [
  [/aan|gta/i, 'AAN'],
  [/(test|lab|buro|concept|scrollcraft|dna|experiment|sandbox|proto)/i, '3D / Experimental'],
  [/(car|auto|motor|ferrari|bentley|cobra|leasing|dealer|exotic|lux|prestige|drive|vegas|mclaren|rolls)/i, 'Automotive'],
];

export function guessCategory(repo) {
  if (repo.archived) return 'Archive';
  const haystack = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
  for (const [pattern, category] of RULES) {
    if (pattern.test(haystack)) return category;
  }
  return 'Client Sites';
}
