/**
 * plan-narrative.ts
 *
 * Deterministic helpers that build the LLM prompt (and a fallback canned
 * string) for the shopping-plan narrative summary.
 *
 * Design goals:
 *  - The LLM is handed strict facts and cannot invent them.
 *  - Unmatched items are always named explicitly.
 *  - "100% confirmed" language is explicitly forbidden.
 *  - An occasional humor hint (pun OR lifestyle) fires only when the shopping
 *    list contains a trigger word — never by default.
 */

// ── Pun-target words ─────────────────────────────────────────────────────────

const PUN_TARGETS = new Set([
  'lettuce',
  'thyme',
  'flour',
  'leek',
  'mushroom',
  'mushrooms',
  'rosemary',
  'cumin',
  'sage',
  'mint',
  'whisk',
  'butter',
  'kale',
  'beet',
  'beets',
  'pear',
  'pears',
])

// ── Lifestyle-marker regexes ─────────────────────────────────────────────────

const LIFESTYLE_PATTERNS: RegExp[] = [
  /kombucha|kefir|kvass|sauerkraut|kimchi/i,
  /raw\s+(milk|honey|cheese)/i,
  /(hemp|chia|flax|spirulina|chlorella|maca|ashwagandha|ginseng|moringa)/i,
  /medicinal mushrooms/i,
  /colloidal silver/i,
]

// ── Public types ─────────────────────────────────────────────────────────────

export interface NarrativeFacts {
  /** Number of ingredients requested by the user */
  requested: number
  /** Number of ingredients that were matched across at least one store */
  matched: number
  /** Display names of ingredients with NO match in ANY store */
  unmatchedNames: string[]
  /** Per-store summary rows */
  stores: Array<{ name: string; source: string; subtotal: number }>
  /** Plan total (post-tax) */
  total: number
  /** Count of items with confirmed live prices */
  realCount: number
  /** Count of items with AI-estimated prices */
  estimatedCount: number
  /**
   * Lower-cased ingredient names used for humor detection.
   * Optional — omit to suppress humor hints entirely.
   */
  ingredientNames?: string[]
}

// ── detectHumorOpportunity ───────────────────────────────────────────────────

/**
 * Scans ingredient names for pun-targets or lifestyle markers.
 *
 * Returns:
 *  - `"pun"` when one or more ingredients is a pun-target word (takes priority).
 *  - `"lifestyle"` when the list contains a health/wellness lifestyle marker.
 *  - `"none"` otherwise.
 */
export function detectHumorOpportunity(
  ingredientNames: string[]
): 'pun' | 'lifestyle' | 'none' {
  // Check pun targets first (higher priority)
  for (const raw of ingredientNames) {
    const lower = raw.toLowerCase()
    // Test each individual word token against the pun-target set
    const tokens = lower.split(/\s+/)
    for (const token of tokens) {
      if (PUN_TARGETS.has(token)) return 'pun'
    }
  }

  // Check lifestyle markers
  const joinedLower = ingredientNames.join(' ').toLowerCase()

  // "organic" appearing 2+ times counts as a lifestyle marker
  const organicMatches = joinedLower.match(/\borganic\b/g)
  if (organicMatches && organicMatches.length >= 2) return 'lifestyle'

  for (const pattern of LIFESTYLE_PATTERNS) {
    if (pattern.test(joinedLower)) return 'lifestyle'
  }

  return 'none'
}

// ── buildNarrativePrompt ─────────────────────────────────────────────────────

/**
 * Builds the user-turn content for the LLM narrative call.
 * The system prompt should be:
 *   "You write concise, honest shopping plan summaries for a grocery price
 *    optimization tool."
 */
export function buildNarrativePrompt(facts: NarrativeFacts): string {
  const {
    requested,
    matched,
    unmatchedNames,
    stores,
    total,
    realCount,
    estimatedCount,
    ingredientNames,
  } = facts

  const storeLines = stores
    .map(s => `  - ${s.name} (${s.source}, subtotal $${s.subtotal.toFixed(2)})`)
    .join('\n')

  const unmatchedLine =
    unmatchedNames.length > 0
      ? `Unmatched items (could not find in any store): ${unmatchedNames.join(', ')}`
      : 'All requested items were matched in at least one store.'

  const humorHint =
    ingredientNames && ingredientNames.length > 0
      ? detectHumorOpportunity(ingredientNames)
      : 'none'

  let humorInstruction = ''
  if (humorHint === 'pun') {
    humorInstruction =
      '\nOptional tone hint: one or more ingredients on this list invites a gentle food pun or wordplay. ' +
      'If you can work one in naturally (never forced), feel free — but only once, and only if it fits.'
  } else if (humorHint === 'lifestyle') {
    humorInstruction =
      "\nOptional tone hint: this shopper's list has some free-spirit, wellness, or in-touch-with-nature " +
      'items. A single warm, non-judgmental nod to that lifestyle is welcome — think affectionate, never ' +
      'disparaging.'
  }

  return `You are the E.G.G.S. shopping agent. Write a 2–3 sentence summary of the shopping plan results below.

STRICT RULES — you MUST follow these exactly:
1. Never claim "100%" confirmed, verified, or accurate prices. You don't know that.
2. Always mention any unmatched items by name. Do not omit or gloss over them.
3. Use the exact numbers provided — do not round or invent.
4. Tone: warm, specific, honest.
5. Write only the summary paragraph — no preamble, no subject line.${humorInstruction}

Plan facts:
- Items requested: ${requested}
- Items matched: ${matched} of ${requested}
- ${unmatchedLine}
- Stores searched:
${storeLines}
- Total (with tax): $${total.toFixed(2)}
- Prices: ${realCount} live (verified from store APIs or validated URLs); ${estimatedCount} estimated by AI`
}

// ── fallbackNarrative ────────────────────────────────────────────────────────

/**
 * Canned fallback text used when the LLM call fails.
 * Never claims "100%"; always names unmatched items.
 */
export function fallbackNarrative(facts: NarrativeFacts): string {
  const { matched, requested, unmatchedNames, realCount, estimatedCount } = facts

  const matchLine =
    matched < requested
      ? `Matched ${matched} of ${requested} items across available stores.`
      : `All ${requested} requested items were found across available stores.`

  const unmatchedLine =
    unmatchedNames.length > 0
      ? ` No match was found for: ${unmatchedNames.join(', ')}.`
      : ''

  const pricesLine = `${realCount} live price${realCount !== 1 ? 's' : ''} from store APIs; ${estimatedCount} AI-estimated.`

  return `${matchLine}${unmatchedLine} ${pricesLine}`
}
