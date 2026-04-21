/**
 * Best-value selector — M7
 *
 * selectWinner() reduces multi-store results to one winner per ShoppableItemSpec,
 * applying brand rules (brand-locked / avoid_brands), countable-fallback for
 * count↔mass unit mismatches, and deterministic tie-breaking.
 *
 * Pure function — no side effects, no I/O.
 */

import type { ShoppableItemSpec } from '../types/spec.js'
import type { StoreItem, StorePlan, UserProfile } from '../types/index.js'
import type { CanonicalUnit } from '../types/index.js'
import { parseSize, pricePerBase as computePricePerBase, BASE_DIMENSION, toBase } from './units.js'
import { matchesBrand, normalizeBrand } from './brands.js'
import { COUNTABLES } from '../data/countables.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const PPB_PRECISION = 10_000   // 4 decimal places for price-per-base comparisons

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Candidate {
  storeName: string
  storeBanner: string
  distanceMiles: number | undefined
  item: StoreItem
  parsedSize: { quantity: number; unit: CanonicalUnit } | null
  pricePerBase: number | null        // null means excluded
  excludeReason?: 'unit_mismatch' | 'size_unparseable' | 'not_available' | 'avoid_brand' | 'brand_mismatch'
}

export interface WinnerResult {
  spec: ShoppableItemSpec
  winner: Candidate | null           // null = no eligible candidates
  eligibleCandidates: Candidate[]    // for the swap selector
  allCandidates: Candidate[]         // for the per-store panels
  warning?: 'avoid_brand_lock_conflict' | 'all_avoided_fallback'
}

// ─── Module-internal helpers ──────────────────────────────────────────────────

/**
 * Lighter normalizer than `normalizeBrand`: lowercases + collapses whitespace.
 * Used only for COUNTABLES canonicalName / synonym matching where punctuation
 * is not expected in keys.
 *
 * Normalize a label for countable lookup: lowercase, trim, collapse whitespace.
 */
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Find a COUNTABLES entry matching spec.displayName via canonicalName or synonyms.
 */
function findCountable(displayName: string) {
  const needle = normalizeLabel(displayName)
  return (
    COUNTABLES.find(
      (e) =>
        normalizeLabel(e.canonicalName) === needle ||
        e.synonyms.some((syn) => normalizeLabel(syn) === needle),
    ) ?? null
  )
}

/**
 * Countable cross-base fallback for count↔mass mismatches.
 *
 * Returns pricePerBase in the spec's base dimension, or null when conversion
 * is not possible (unknown countable or non-count/mass dimensions).
 *
 * Cases:
 *   A) spec base = 'g', parsed base = 'count'  → each → grams
 *   B) spec base = 'count', parsed base = 'g'  → grams → each
 */
function countableFallback(
  spec: ShoppableItemSpec,
  parsed: { quantity: number; unit: CanonicalUnit },
  lineTotal: number,
): number | null {
  const specBase = BASE_DIMENSION[spec.unit]
  const parsedBase = BASE_DIMENSION[parsed.unit]

  // Only handle mass↔count cross-base mismatches
  if (!(specBase === 'g' && parsedBase === 'count') &&
      !(specBase === 'count' && parsedBase === 'g')) {
    return null
  }

  const entry = findCountable(spec.displayName)
  if (!entry) return null

  if (specBase === 'g' && parsedBase === 'count') {
    // each → grams: normalize parsed quantity to its base count first (e.g. 1 dozen → 12 each)
    const { qty: parsedEachCount } = toBase(parsed.quantity, parsed.unit)
    const totalGrams = parsedEachCount * entry.typicalEachWeightG
    if (totalGrams === 0) return null
    return lineTotal / totalGrams
  }

  // specBase === 'count' && parsedBase === 'g'
  // grams → each: normalize parsed quantity to its base grams first (e.g. 1 lb → 453.592 g)
  const { qty: parsedGrams } = toBase(parsed.quantity, parsed.unit)
  const eachCount = parsedGrams / entry.typicalEachWeightG
  if (eachCount === 0) return null
  return lineTotal / eachCount
}

/**
 * Build a Candidate for one (store, item) pair, resolving parsedSize and
 * computing pricePerBase (with countable fallback on mismatch).
 */
function buildCandidate(
  store: StorePlan,
  item: StoreItem,
  spec: ShoppableItemSpec,
): Candidate {
  const base = {
    storeName: store.storeName,
    storeBanner: store.storeBanner,
    distanceMiles: store.distanceMiles,
    item,
  }

  // Not available
  if (item.notAvailable === true) {
    return { ...base, parsedSize: null, pricePerBase: null, excludeReason: 'not_available' }
  }

  // Effective size: pricedSize (M5 AI field) wins when present, else parse item.unit
  const effectiveSize: { quantity: number; unit: CanonicalUnit } | null =
    item.pricedSize ?? parseSize(item.unit ?? '')

  if (!effectiveSize) {
    return { ...base, parsedSize: null, pricePerBase: null, excludeReason: 'size_unparseable' }
  }

  // Direct pricePerBase (same base dimension)
  const ppbResult = computePricePerBase(item.lineTotal, {
    qty: effectiveSize.quantity,
    unit: effectiveSize.unit,
  })

  if (ppbResult !== null) {
    const specBase = BASE_DIMENSION[spec.unit]
    if (ppbResult.base === specBase) {
      // Matching base — use directly
      return { ...base, parsedSize: effectiveSize, pricePerBase: ppbResult.pricePerBase }
    }

    // Base dimension mismatch — try countable fallback
    const fallbackPpb = countableFallback(spec, effectiveSize, item.lineTotal)
    if (fallbackPpb !== null) {
      return { ...base, parsedSize: effectiveSize, pricePerBase: fallbackPpb }
    }

    return { ...base, parsedSize: effectiveSize, pricePerBase: null, excludeReason: 'unit_mismatch' }
  }

  // computePricePerBase returned null — zero or missing quantity
  return { ...base, parsedSize: effectiveSize, pricePerBase: null, excludeReason: 'size_unparseable' }
}

/**
 * Check whether a store item's name matches a brand.
 * StoreItem has no dedicated brand field, so we pass brand: '' which triggers
 * the empty-brand fallback in matchesBrand() — it searches the product name.
 */
function itemMatchesBrand(item: StoreItem, brand: string): boolean {
  return matchesBrand({ brand: '', name: item.name }, brand)
}

/**
 * Check whether a store item's name contains any of the avoided brands.
 */
function itemIsAvoided(item: StoreItem, normalizedAvoidBrands: string[]): boolean {
  if (normalizedAvoidBrands.length === 0) return false
  const nameNorm = normalizeBrand(item.name)
  return normalizedAvoidBrands.some((avoided) => nameNorm.includes(avoided))
}

/**
 * Sort eligible candidates by:
 *   1. Lowest pricePerBase (4-decimal precision)
 *   2. Nearest store (distanceMiles, Infinity when absent)
 *   3. Alphabetical storeName (case-insensitive, trimmed)
 */
function tieBreakSort(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aPpb = Math.round(a.pricePerBase! * PPB_PRECISION) / PPB_PRECISION
    const bPpb = Math.round(b.pricePerBase! * PPB_PRECISION) / PPB_PRECISION
    if (aPpb !== bPpb) return aPpb - bPpb

    const aDist = a.distanceMiles ?? Infinity
    const bDist = b.distanceMiles ?? Infinity
    if (aDist !== bDist) return aDist - bDist

    return a.storeName.toLowerCase().trim().localeCompare(b.storeName.toLowerCase().trim())
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Select the best-value candidate for a single ShoppableItemSpec across all
 * store results, applying brand rules (brand-locked / avoid_brands),
 * countable-fallback for count↔mass mismatches, and deterministic tie-breaking.
 */
export function selectWinner(
  spec: ShoppableItemSpec,
  storeResults: StorePlan[],
  user: UserProfile,
): WinnerResult {
  // ── Step 1: Build all candidates from every store ─────────────────────────
  const allCandidates: Candidate[] = []
  for (const store of storeResults) {
    for (const item of store.items) {
      if (item.ingredientId === spec.id) {
        allCandidates.push(buildCandidate(store, item, spec))
      }
    }
  }

  // Candidates with a valid pricePerBase (not excluded by size/availability)
  const pricedCandidates = allCandidates.filter((c) => c.pricePerBase !== null)

  // ── Step 2: Apply brand rules ─────────────────────────────────────────────
  const normalizedAvoidBrands = (user.avoid_brands ?? []).map(normalizeBrand)

  let eligibleCandidates: Candidate[]
  let warning: WinnerResult['warning']

  if (spec.brandLocked && spec.brand !== null) {
    // Brand-locked: filter to only candidates whose name matches spec.brand
    const brandMatched = pricedCandidates.filter((c) => itemMatchesBrand(c.item, spec.brand!))

    // Mark non-matching priced candidates as brand_mismatch.
    // Note: mutates candidates in-place. allCandidates and pricedCandidates share
    // the same object references, so exclusion reasons propagate to both — which is
    // what the UI per-store panels need.
    for (const c of allCandidates) {
      if (c.pricePerBase !== null && !brandMatched.includes(c)) {
        c.excludeReason = 'brand_mismatch'
        c.pricePerBase = null
      }
    }

    if (brandMatched.length === 0) {
      return { spec, winner: null, eligibleCandidates: [], allCandidates }
    }

    // Conflict check: locked brand is also on avoid list
    if (normalizedAvoidBrands.includes(normalizeBrand(spec.brand!))) {
      warning = 'avoid_brand_lock_conflict'
    }

    eligibleCandidates = brandMatched
  } else {
    // Not brand-locked: exclude avoid_brands candidates
    const eligible: Candidate[] = []
    const avoided: Candidate[] = []

    for (const c of pricedCandidates) {
      if (itemIsAvoided(c.item, normalizedAvoidBrands)) {
        avoided.push(c)
      } else {
        eligible.push(c)
      }
    }

    if (eligible.length === 0 && avoided.length > 0) {
      // All candidates excluded by avoid_brands — relax filter, emit warning
      warning = 'all_avoided_fallback'
      eligibleCandidates = avoided
      // Do NOT mark them as avoid_brand — they're eligible under fallback
    } else {
      // Mark the avoided candidates as excluded
      for (const c of avoided) {
        c.excludeReason = 'avoid_brand'
        c.pricePerBase = null
      }
      eligibleCandidates = eligible
    }
  }

  if (eligibleCandidates.length === 0) {
    return { spec, winner: null, eligibleCandidates: [], allCandidates }
  }

  // ── Step 3: Tie-break and pick winner ─────────────────────────────────────
  const sorted = tieBreakSort(eligibleCandidates)
  const winner = sorted[0]

  const result: WinnerResult = {
    spec,
    winner,
    eligibleCandidates: sorted,
    allCandidates,
  }
  if (warning !== undefined) result.warning = warning

  return result
}
