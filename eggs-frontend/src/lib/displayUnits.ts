// Unit aliases — accept the same free-text variants the backend accepts
const UNIT_ALIASES: Record<string, { base: 'g' | 'ml' | 'count'; factor: number }> = {
  // mass
  g: { base: 'g', factor: 1 }, gram: { base: 'g', factor: 1 }, grams: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 }, kilogram: { base: 'g', factor: 1000 }, kilograms: { base: 'g', factor: 1000 },
  oz: { base: 'g', factor: 28.3495 }, ounce: { base: 'g', factor: 28.3495 }, ounces: { base: 'g', factor: 28.3495 },
  lb: { base: 'g', factor: 453.592 }, lbs: { base: 'g', factor: 453.592 }, pound: { base: 'g', factor: 453.592 }, pounds: { base: 'g', factor: 453.592 },
  // volume
  ml: { base: 'ml', factor: 1 }, milliliter: { base: 'ml', factor: 1 }, milliliters: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 }, liter: { base: 'ml', factor: 1000 }, liters: { base: 'ml', factor: 1000 },
  'fl oz': { base: 'ml', factor: 29.5735 }, 'fluid ounce': { base: 'ml', factor: 29.5735 },
  cup: { base: 'ml', factor: 236.588 }, cups: { base: 'ml', factor: 236.588 },
  pt: { base: 'ml', factor: 473.176 }, pint: { base: 'ml', factor: 473.176 }, pints: { base: 'ml', factor: 473.176 },
  qt: { base: 'ml', factor: 946.353 }, quart: { base: 'ml', factor: 946.353 }, quarts: { base: 'ml', factor: 946.353 },
  gal: { base: 'ml', factor: 3785.41 }, gallon: { base: 'ml', factor: 3785.41 }, gallons: { base: 'ml', factor: 3785.41 },
  // count
  unit: { base: 'count', factor: 1 }, units: { base: 'count', factor: 1 },
  each: { base: 'count', factor: 1 }, ea: { base: 'count', factor: 1 },
  ct: { base: 'count', factor: 1 }, count: { base: 'count', factor: 1 },
  dozen: { base: 'count', factor: 12 }, dozens: { base: 'count', factor: 12 },
  piece: { base: 'count', factor: 1 }, pieces: { base: 'count', factor: 1 },
}

function aliasOf(unit: string) {
  return UNIT_ALIASES[unit.trim().toLowerCase()] ?? null
}

/** Render a unit + qty as "1 lb" / "12 each" / "16 oz". Pluralization is light-touch. */
export function unitLabel(qty: number, unit: string): string {
  return `${qty} ${unit}`.trim()
}

/** Convert qty from one unit to another's base dimension; null if dimensions don't match. */
export function convertQuantity(value: number, fromUnit: string, toUnit: string): number | null {
  const f = aliasOf(fromUnit), t = aliasOf(toUnit)
  if (!f || !t || f.base !== t.base) return null
  return (value * f.factor) / t.factor
}

/** Number of packages needed to cover ingredient.quantity, given pricedSize. min 1. null on dimension mismatch. */
export function packagesNeeded(
  ingredient: { quantity: number; unit: string },
  pricedSize: { quantity: number; unit: string } | null
): number {
  if (!pricedSize) return 1
  const inPkgUnits = convertQuantity(ingredient.quantity, ingredient.unit, pricedSize.unit)
  if (inPkgUnits === null) return 1
  return Math.max(1, Math.ceil(inPkgUnits / pricedSize.quantity))
}

/** Format a per-base price as "$0.0044/g" / "$0.0009/mL" / "$0.42/each". */
export function formatPricePerBase(pricePerBase: number, unit: string): string {
  const a = aliasOf(unit)
  if (!a) return `$${pricePerBase.toFixed(4)}/${unit}`
  if (a.base === 'g') return `$${pricePerBase.toFixed(4)}/g`
  if (a.base === 'ml') return `$${pricePerBase.toFixed(4)}/mL`
  return `$${pricePerBase.toFixed(2)}/each`
}

/** Compose a comparison string when ingredient differs from package; null if identical or trivial. */
export function comparisonNote(
  ingredient: { quantity: number; unit: string },
  pricedSize: { quantity: number; unit: string } | null,
  packageCount: number
): string | null {
  if (!pricedSize) return null
  const totalInPkgUnits = packageCount * pricedSize.quantity
  const askedInPkgUnits = convertQuantity(ingredient.quantity, ingredient.unit, pricedSize.unit)
  if (askedInPkgUnits === null) {
    // dimension mismatch — say so explicitly
    return `You asked for ${unitLabel(ingredient.quantity, ingredient.unit)}; package contains ${unitLabel(pricedSize.quantity, pricedSize.unit)}.`
  }
  const diff = totalInPkgUnits - askedInPkgUnits
  // Trivial difference (within 5%) → no note.
  const ratio = Math.abs(diff) / askedInPkgUnits
  if (ratio < 0.05) return null
  if (diff > 0) {
    return `You asked for ${unitLabel(ingredient.quantity, ingredient.unit)} — package contains slightly more (${unitLabel(pricedSize.quantity, pricedSize.unit)} each).`
  }
  return `You asked for ${unitLabel(ingredient.quantity, ingredient.unit)} — buying ${packageCount} packages covers ${unitLabel(totalInPkgUnits, pricedSize.unit)}.`
}
