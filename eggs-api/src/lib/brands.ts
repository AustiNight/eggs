/**
 * Brand name normalization.
 *
 * normalizeBrand() performs:
 *   1. Unicode NFD decomposition (strips diacritics)
 *   2. Lowercase
 *   3. Strip punctuation: . , ' " & ! \u2019 (right single quote) \u2018 (left single quote)
 *   4. Collapse whitespace
 *   5. Apply synonym map (known variant → canonical form)
 *
 * The synonym map is seeded from common US grocery brands (derived from
 * Open Food Facts brands_tags US country filter + common knowledge).
 * Variants listed here are post-normalization strings (already lowercased /
 * stripped of punctuation).
 */

// ─── Synonym map ──────────────────────────────────────────────────────────────

interface BrandSynonymEntry {
  canonical: string
  variants: string[]
}

/**
 * All strings in this table are in *post-normalization* form
 * (lowercase, no punctuation, collapsed whitespace).
 * The normalizeBrand function strips punctuation BEFORE looking up in this map.
 */
const BRAND_SYNONYMS: BrandSynonymEntry[] = [
  // Dairy
  { canonical: 'land olakes',       variants: ['land o lakes', 'land olakes', 'land o  lakes'] },
  { canonical: 'tillamook',         variants: [] },
  { canonical: 'daisy',             variants: ['daisy brand'] },
  { canonical: 'philadelphia',      variants: ['philly', 'philadelphia cream cheese'] },
  // Beverages
  { canonical: 'coca cola',         variants: ['coke', 'coca-cola', 'cocacola'] },
  { canonical: 'pepsi',             variants: ['pepsico'] },
  { canonical: 'dr pepper',         variants: ['dr. pepper', 'drpepper'] },
  { canonical: 'red bull',          variants: [] },
  { canonical: 'tropicana',         variants: [] },
  { canonical: 'minute maid',       variants: [] },
  // Snacks / candy
  { canonical: 'lays',              variants: ['lays chips'] },
  { canonical: 'frito lay',         variants: ['frito-lay', 'fritolay'] },
  { canonical: 'doritos',           variants: [] },
  { canonical: 'pringles',          variants: [] },
  { canonical: 'hersheys',          variants: ['hersheys chocolate', 'the hershey company'] },
  { canonical: 'reeses',            variants: ['reeses peanut butter cups'] },
  { canonical: 'm and ms',          variants: ['m&ms', 'mms'] },
  { canonical: 'snickers',          variants: [] },
  { canonical: 'kit kat',           variants: ['kit-kat', 'kitkat'] },
  // Ice cream
  { canonical: 'ben and jerrys',    variants: ['ben jerrys', 'ben  jerrys'] },
  { canonical: 'haagen dazs',       variants: ['häagen-dazs', 'haagendazs', 'haagen-dazs'] },
  { canonical: 'breyers',           variants: [] },
  // Condiments / sauces
  { canonical: 'heinz',             variants: ['h.j. heinz', 'hj heinz'] },
  { canonical: 'hunts',             variants: ["hunt's", 'hunts tomatoes'] },
  { canonical: 'hellmanns',         variants: ["hellman's", 'hellmanns mayo', 'best foods'] },
  // Breakfast / dry goods
  { canonical: 'kelloggs',          variants: ["kellogg's", 'kellogg company', 'kelloggs cereals'] },
  { canonical: 'general mills',     variants: [] },
  { canonical: 'quaker',            variants: ['quaker oats'] },
  { canonical: 'post',              variants: ['post consumer brands', 'post cereals'] },
  // Grocery store brands
  { canonical: 'trader joes',       variants: ["trader joe's", 'trader joe'] },
  { canonical: 'whole foods',       variants: ['whole foods market', '365 whole foods', '365'] },
  { canonical: 'kroger',            variants: ['kroger brand', 'the kroger co'] },
  // Personal care / cosmetics
  { canonical: 'loreal',            variants: ["l'oréal", 'loreal paris', "l'oreal"] },
  // Other common
  { canonical: 'campbells',         variants: ["campbell's", 'campbell soup'] },
  { canonical: 'progresso',         variants: [] },
  { canonical: 'del monte',         variants: [] },
  { canonical: 'dole',              variants: [] },
  { canonical: 'birds eye',         variants: ["bird's eye", 'birdseye'] },
  { canonical: 'green giant',       variants: ['greengiant'] },
  { canonical: 'kraft',             variants: ['kraft foods', 'kraft heinz'] },
  { canonical: 'oscar mayer',       variants: ['oscar meyer'] },
  { canonical: 'jimmy dean',        variants: [] },
  { canonical: 'tyson',             variants: ['tyson foods'] },
  { canonical: 'perdue',            variants: ['perdue farms'] },
]

// Build a flat lookup map: variant (already normalized) → canonical
const SYNONYM_MAP = new Map<string, string>()
for (const entry of BRAND_SYNONYMS) {
  SYNONYM_MAP.set(entry.canonical, entry.canonical) // self-maps
  for (const v of entry.variants) {
    SYNONYM_MAP.set(v, entry.canonical)
  }
}

// ─── Core strip/normalize helper ─────────────────────────────────────────────

/**
 * Apply the normalization pipeline (steps 1–4) WITHOUT synonym lookup.
 * Exposed for internal use; callers outside this module should use normalizeBrand().
 */
function _strip(raw: string): string {
  return raw
    // Step 1: NFD decomposition → removes combining diacritic marks (ü→u, é→e, etc.)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining marks
    // Step 2: lowercase
    .toLowerCase()
    // Step 3: strip punctuation  . , ' " & ! \u2019 \u2018 hyphen-between-words
    .replace(/[.,'"&!\u2018\u2019\u201c\u201d]/g, '')
    // Step 4: collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw brand string for comparison.
 *
 * Returns the canonical form if a synonym map entry is found,
 * otherwise returns the stripped/lowercased string.
 */
export function normalizeBrand(raw: string): string {
  const stripped = _strip(raw)
  return SYNONYM_MAP.get(stripped) ?? stripped
}
