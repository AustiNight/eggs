/**
 * stripUnitNoise — extract ingredient query terms by removing unit/packaging
 * words and leading numeric tokens.
 *
 * "1 head garlic" → "garlic"
 * "2 cans tomato paste" → "tomato paste"
 * "organic chicken breast" → "organic chicken breast"  (no-op: no noise)
 *
 * Semantic modifiers like "fresh", "organic", "whole" are intentionally
 * preserved — they change the product the user is asking for.
 * Only counts and container words are stripped.
 */

const NOISE_WORDS = new Set([
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ozs', 'ounce', 'ounces',
  'can', 'cans', 'bottle', 'bottles',
  'jar', 'jars', 'head', 'heads', 'bunch', 'bunches',
  'loaf', 'loaves', 'bag', 'bags', 'box', 'boxes',
  'pack', 'packs', 'package', 'packages',
  'gallon', 'gallons', 'qt', 'quart', 'quarts',
  'pt', 'pint', 'pints', 'cup', 'cups',
  'tbsp', 'tablespoon', 'tsp', 'teaspoon',
  'dozen', 'dozens',
  'each', 'ea', 'piece', 'pieces', 'count', 'ct', 'item', 'items',
  // Intentionally NOT stripped: 'fresh', 'organic', 'whole' — these are
  // product-selecting modifiers, not packaging noise.
])

export function stripUnitNoise(raw: string): string {
  const tokens = raw.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const stripped = tokens.filter(w => !/^\d/.test(w) && !NOISE_WORDS.has(w))
  // Backoff: if full strip leaves < 2 meaningful tokens but the original had
  // ≥ 2 non-numeric tokens, preserve the noise word — it's load-bearing here
  // (e.g., "gallons milk", "loaf bread"). Strip only the leading numeric prefix.
  // Only applies when there are no numeric tokens — if a numeric was present,
  // the query is measurement-qualified and the full strip is intentional
  // (e.g., "1 head garlic" → "garlic", not "head garlic").
  const nonNumeric = tokens.filter(w => !/^\d/.test(w))
  const hasNumeric = nonNumeric.length < tokens.length
  if (!hasNumeric && stripped.length < 2 && nonNumeric.length >= 2) {
    return nonNumeric.join(' ').trim()
  }
  return stripped.join(' ').trim()
}
