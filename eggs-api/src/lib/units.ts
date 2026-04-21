/**
 * Unit conversion utilities.
 *
 * All conversions funnel through SI base units:
 *   mass    → grams   (g)
 *   volume  → millilitres (ml)
 *   count   → units   (count)
 *
 * Cross-base conversions (e.g. oz → ml) always return null.
 * Multi-unit parse strings (e.g. "1 lb 4 oz") are normalized to the base unit.
 */

import type { CanonicalUnit } from '../types/index.js'

// Re-export so callers can import the type from here if they prefer.
export type { CanonicalUnit }

// ─── Conversion table ─────────────────────────────────────────────────────────

const TO_BASE: Record<CanonicalUnit, { base: 'g' | 'ml' | 'count'; factor: number }> = {
  g:      { base: 'g',     factor: 1 },
  kg:     { base: 'g',     factor: 1000 },
  oz:     { base: 'g',     factor: 28.3495 },
  lb:     { base: 'g',     factor: 453.592 },
  ml:     { base: 'ml',    factor: 1 },
  l:      { base: 'ml',    factor: 1000 },
  fl_oz:  { base: 'ml',    factor: 29.5735 },
  cup:    { base: 'ml',    factor: 236.588 },
  pt:     { base: 'ml',    factor: 473.176 },
  qt:     { base: 'ml',    factor: 946.353 },
  gal:    { base: 'ml',    factor: 3785.41 },
  each:   { base: 'count', factor: 1 },
  dozen:  { base: 'count', factor: 12 },
  bunch:  { base: 'count', factor: 1 },
  head:   { base: 'count', factor: 1 },
  clove:  { base: 'count', factor: 1 },
  pinch:  { base: 'count', factor: 1 },
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Maps every CanonicalUnit to its base dimension ('g', 'ml', or 'count').
 * Derived from TO_BASE — single source of truth, no duplication across adapters.
 */
export const BASE_DIMENSION: Record<CanonicalUnit, 'g' | 'ml' | 'count'> = Object.fromEntries(
  (Object.entries(TO_BASE) as Array<[CanonicalUnit, typeof TO_BASE[CanonicalUnit]]>).map(
    ([u, { base }]) => [u, base]
  )
) as Record<CanonicalUnit, 'g' | 'ml' | 'count'>

/**
 * Convert `qty` from one CanonicalUnit to another.
 * Returns null when the units have different base dimensions (cross-base).
 */
export function convert(qty: number, from: CanonicalUnit, to: CanonicalUnit): number | null {
  const fromEntry = TO_BASE[from]
  const toEntry = TO_BASE[to]
  if (fromEntry.base !== toEntry.base) return null
  return qty * (fromEntry.factor / toEntry.factor)
}

/**
 * Convert `qty` to the SI base for that unit's dimension.
 * Returns { qty: number; base: 'g' | 'ml' | 'count' }.
 */
export function toBase(
  qty: number,
  unit: CanonicalUnit,
): { qty: number; base: 'g' | 'ml' | 'count' } {
  const entry = TO_BASE[unit]
  return { qty: qty * entry.factor, base: entry.base }
}

/**
 * Compute price per base unit for a sized item.
 * Returns null if qty is zero or falsy (can't divide).
 */
export function pricePerBase(
  price: number,
  size: { qty: number; unit: CanonicalUnit },
): { pricePerBase: number; base: 'g' | 'ml' | 'count' } | null {
  if (!size.qty) return null
  const { qty: baseQty, base } = toBase(size.qty, size.unit)
  return { pricePerBase: price / baseQty, base }
}

// ─── parseSize internals ──────────────────────────────────────────────────────

/** Maps raw unit strings (from store data) to CanonicalUnit. */
const UNIT_ALIASES: Record<string, CanonicalUnit> = {
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
  // fluid ounces — handle "fl oz", "fl_oz", "floz"
  'fl oz': 'fl_oz', 'fl_oz': 'fl_oz', floz: 'fl_oz',
  'fluid oz': 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
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
  // dozen
  dozen: 'dozen', doz: 'dozen', dz: 'dozen',
  // produce/culinary
  bunch: 'bunch', head: 'head', clove: 'clove', cloves: 'clove', pinch: 'pinch',
}

/**
 * Parse a store-returned size string into a { quantity, unit } pair.
 *
 * Handles:
 *   "32 oz"          → { quantity: 32, unit: 'oz' }
 *   "1.5 kg"         → { quantity: 1.5, unit: 'kg' }
 *   "500 ml"         → { quantity: 500, unit: 'ml' }
 *   "2 fl oz"        → { quantity: 2, unit: 'fl_oz' }
 *   "half gallon"    → { quantity: 0.5, unit: 'gal' }
 *   "1 lb 4 oz"      → best-effort: collapses to grams { quantity: ~566.99, unit: 'g' }
 *
 * Returns null for unrecognized or unparseable strings.
 */
export function parseSize(raw: string): { quantity: number; unit: CanonicalUnit } | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null

  // ── "half <unit>" shorthand ────────────────────────────────────────────────
  const halfMatch = s.match(/^half\s+(\w+)$/)
  if (halfMatch) {
    const unit = UNIT_ALIASES[halfMatch[1]]
    if (unit) return { quantity: 0.5, unit }
  }

  // ── Multi-unit: "1 lb 4 oz" → collapse to base ────────────────────────────
  // Pattern: two consecutive `<number> <unit>` blocks, same base dimension.
  // Strategy: parse each segment, convert both to base, sum, emit the base unit.
  const multiMatch = s.match(
    /^(\d+(?:\.\d+)?)\s+(fl\s+oz|\w+)\s+(\d+(?:\.\d+)?)\s+(fl\s+oz|\w+)$/,
  )
  if (multiMatch) {
    const qty1 = parseFloat(multiMatch[1])
    const unit1 = UNIT_ALIASES[multiMatch[2].replace(/\s+/, ' ')]
    const qty2 = parseFloat(multiMatch[3])
    const unit2 = UNIT_ALIASES[multiMatch[4].replace(/\s+/, ' ')]
    if (unit1 && unit2) {
      const b1 = toBase(qty1, unit1)
      const b2 = toBase(qty2, unit2)
      if (b1.base === b2.base) {
        // 'count' multi-unit (e.g. "1 dozen 6 each") is not representable as
        // a CanonicalUnit because 'count' is not in the CanonicalUnit union.
        if (b1.base === 'count') return null
        const baseUnit: CanonicalUnit = b1.base === 'g' ? 'g' : 'ml'
        const totalBaseQty = b1.qty + b2.qty
        return { quantity: totalBaseQty, unit: baseUnit }
      }
    }
  }

  // ── Standard: "<number> <unit>" with optional space inside unit ──────────
  // Handle "fl oz" as a two-word unit token.
  const stdMatch = s.match(/^(\d+(?:\.\d+)?)\s*(fl\s+oz|fl_oz|\w+)$/)
  if (stdMatch) {
    const qty = parseFloat(stdMatch[1])
    const unitKey = stdMatch[2].replace(/\s+/, ' ').toLowerCase()
    const unit = UNIT_ALIASES[unitKey]
    if (unit) return { quantity: qty, unit }
  }

  return null
}
