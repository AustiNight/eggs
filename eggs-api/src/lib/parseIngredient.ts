// Unified ingredient parser — backend twin (independent of eggs-frontend)
//
// Parses free-text ingredient strings into structured { name, quantity, unit, rawInput }.
// Canonical unit is 'each' for bare countables; mirrors the frontend twin's behaviour exactly.

export interface ParsedIngredient {
  name: string       // cleaned ingredient name (no leading qty, no trailing qty/unit, no comma)
  quantity: number   // 1 if no number found
  unit: string       // canonical unit string (e.g. 'lb', 'gal', 'each', 'head'); 'each' for bare countables
  rawInput: string   // verbatim user input
}

// ─── Unit alias map ────────────────────────────────────────────────────────────
// Maps free-text unit variants (including plurals) to canonical unit strings.
// Aligned with units.ts UNIT_ALIASES + extended produce/culinary units.

const UNIT_ALIAS: Record<string, string> = {
  // grams
  g: 'g', gram: 'g', grams: 'g',
  // kilograms
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  // ounces (weight)
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  // pounds
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  // millilitres
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  // litres
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  // cups
  cup: 'cup', cups: 'cup',
  // pints
  pt: 'pt', pint: 'pt', pints: 'pt',
  // quarts
  qt: 'qt', quart: 'qt', quarts: 'qt',
  // gallons
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  // count
  each: 'each', ea: 'each', unit: 'each', units: 'each', ct: 'each', count: 'each',
  piece: 'each', pieces: 'each',
  // dozen
  dozen: 'dozen', dozens: 'dozen', doz: 'dozen', dz: 'dozen',
  // produce/culinary (all in CanonicalUnit)
  bunch: 'bunch', bunches: 'bunch',
  head: 'head', heads: 'head',
  clove: 'clove', cloves: 'clove',
  pinch: 'pinch', pinches: 'pinch',
  // package/container types — not in CanonicalUnit, fall back to 'each'
  loaf: 'each', loaves: 'each',
  bag: 'each', bags: 'each',
  box: 'each', boxes: 'each',
  pack: 'each', packs: 'each',
  jar: 'each', jars: 'each',
  bottle: 'each', bottles: 'each',
  can: 'each', cans: 'each',
}

const ALL_UNIT_WORDS = Object.keys(UNIT_ALIAS).join('|')

// ─── Compiled regexes ─────────────────────────────────────────────────────────
// Priority order (first match wins):
//   1. Trailing parenthetical: "red seedless grapes (1 lb)"
//   2. Trailing comma + qty + unit: "lettuce, 2 heads"
//   3. Trailing qty + unit (no comma): "sliced smoked turkey breast 2 lbs"
//   4. Leading qty + unit + name: "2 gallons soy milk"
//   5. Leading qty + bare name: "2 lettuce"
//   6. Bare name fallback

// Pattern 1: trailing parenthetical — "name (qty unit)" or "name (qty)"
const TRAILING_PAREN = /^(.+?)\s*\((\d+(?:\.\d+)?)\s*([a-zA-Z][\w-]*)?\)\s*$/

// Pattern 2: trailing comma — "name, qty unit"
const TRAILING_COMMA = new RegExp(
  `^(.+?),\\s*(\\d+(?:\\.\\d+)?)\\s+(${ALL_UNIT_WORDS})\\s*$`,
  'i'
)

// Pattern 3: trailing bare — "name qty unit"
const TRAILING_BARE = new RegExp(
  `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+(${ALL_UNIT_WORDS})\\s*$`,
  'i'
)

// Pattern 4: leading qty + unit + name
const LEADING_UNIT = new RegExp(
  `^(\\d+(?:\\.\\d+)?)\\s+(${ALL_UNIT_WORDS})\\s+(.+)$`,
  'i'
)

// Pattern 5: leading qty + bare name
const LEADING_BARE = /^(\d+(?:\.\d+)?)\s+(.+)$/

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canonical(raw: string): string {
  return UNIT_ALIAS[raw.toLowerCase()] ?? raw.toLowerCase()
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseIngredient(input: string): ParsedIngredient {
  const rawInput = input
  const trimmed = input.trim()

  // Pattern 1: trailing parenthetical — highest priority
  const parenMatch = trimmed.match(TRAILING_PAREN)
  if (parenMatch) {
    const name = parenMatch[1].trim()
    const quantity = parseFloat(parenMatch[2])
    const unitRaw = parenMatch[3] ?? 'each'
    const unit = canonical(unitRaw)
    return { name, quantity, unit, rawInput }
  }

  // Pattern 2: trailing comma + qty + unit
  const commaMatch = trimmed.match(TRAILING_COMMA)
  if (commaMatch) {
    const name = commaMatch[1].trim()
    const quantity = parseFloat(commaMatch[2])
    const unit = canonical(commaMatch[3])
    return { name, quantity, unit, rawInput }
  }

  // Pattern 3: trailing qty + unit (no comma)
  const trailingBareMatch = trimmed.match(TRAILING_BARE)
  if (trailingBareMatch) {
    const name = trailingBareMatch[1].trim()
    const quantity = parseFloat(trailingBareMatch[2])
    const unit = canonical(trailingBareMatch[3])
    return { name, quantity, unit, rawInput }
  }

  // Pattern 4: leading qty + unit + name
  const leadingUnitMatch = trimmed.match(LEADING_UNIT)
  if (leadingUnitMatch) {
    const quantity = parseFloat(leadingUnitMatch[1])
    const unit = canonical(leadingUnitMatch[2])
    const name = leadingUnitMatch[3].trim()
    return { name, quantity, unit, rawInput }
  }

  // Pattern 5: leading qty + bare name (no unit)
  const leadingBareMatch = trimmed.match(LEADING_BARE)
  if (leadingBareMatch) {
    const quantity = parseFloat(leadingBareMatch[1])
    const name = leadingBareMatch[2].trim()
    return { name, quantity, unit: 'each', rawInput }
  }

  // Pattern 6: bare name fallback
  return { name: trimmed, quantity: 1, unit: 'each', rawInput }
}
