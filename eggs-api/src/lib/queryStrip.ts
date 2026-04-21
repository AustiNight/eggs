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
  // Intentionally NOT stripped: 'fresh', 'organic', 'whole' — these are
  // product-selecting modifiers, not packaging noise.
])

export function stripUnitNoise(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0 && !/^\d/.test(w) && !NOISE_WORDS.has(w))
    .join(' ')
    .trim()
}
