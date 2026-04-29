import { describe, it, expect } from 'vitest'
import { selectWinner } from './bestValue.js'
import type { Candidate, WinnerResult } from './bestValue.js'
import type { ShoppableItemSpec } from '../types/spec.js'
import type { StoreItem, StorePlan, UserProfile, AlignmentGrade } from '../types/index.js'

// ─── Test fixture helpers ─────────────────────────────────────────────────────

function makeSpec(overrides: Partial<ShoppableItemSpec> = {}): ShoppableItemSpec {
  return {
    id: 'item-1',
    sourceText: 'whole milk',
    displayName: 'whole milk',
    categoryPath: ['dairy', 'milk'],
    brand: null,
    brandLocked: false,
    quantity: 1,
    unit: 'l',
    resolutionTrace: [],
    confidence: 'high',
    ...overrides,
  }
}

function makeItem(overrides: Partial<StoreItem> & { ingredientId: string; name: string }): StoreItem {
  return {
    sku: undefined,
    quantity: 1,
    unit: '1 l',
    unitPrice: 3.99,
    lineTotal: 3.99,
    confidence: 'real',
    shopUrl: 'https://example.com',
    isLoyaltyPrice: false,
    notAvailable: false,
    pricedSize: null,
    ...overrides,
  }
}

function makeStore(
  overrides: Partial<StorePlan> & { storeName: string; items: StoreItem[] },
): StorePlan {
  return {
    storeBanner: overrides.storeName.toLowerCase(),
    storeType: 'physical',
    priceSource: 'kroger_api',
    subtotal: 0,
    estimatedTax: 0,
    grandTotal: 0,
    distanceMiles: 1.0,
    ...overrides,
  }
}

const noUser: UserProfile = { avoid_brands: [] }

// ─── Brand-locked tests ───────────────────────────────────────────────────────

describe('selectWinner — brand-locked: hit in one store', () => {
  it('returns the brand-matching candidate as winner', () => {
    const spec = makeSpec({ id: 'milk-1', brand: 'Organic Valley', brandLocked: true, unit: 'l' })

    const itemA = makeItem({ ingredientId: 'milk-1', name: 'Organic Valley Whole Milk', unit: '1 l', lineTotal: 5.99, unitPrice: 5.99 })
    const itemB = makeItem({ ingredientId: 'milk-1', name: 'Store Brand Whole Milk', unit: '1 l', lineTotal: 3.49, unitPrice: 3.49 })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [itemA] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.5, items: [itemB] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()
    expect(result.winner!.storeName).toBe('Kroger')
    expect(result.winner!.item.name).toContain('Organic Valley')
    expect(result.warning).toBeUndefined()
  })
})

describe('selectWinner — brand-locked: no brand hit anywhere', () => {
  it('returns winner null and empty eligibleCandidates', () => {
    const spec = makeSpec({ id: 'milk-1', brand: 'Horizon Organic', brandLocked: true, unit: 'l' })

    const itemA = makeItem({ ingredientId: 'milk-1', name: 'Generic Whole Milk', unit: '1 l', lineTotal: 3.99, unitPrice: 3.99 })
    const storeA = makeStore({ storeName: 'Kroger', items: [itemA] })

    const result = selectWinner(spec, [storeA], noUser)

    expect(result.winner).toBeNull()
    expect(result.eligibleCandidates).toHaveLength(0)
    expect(result.allCandidates).toHaveLength(1)
  })
})

describe('selectWinner — brand-locked conflict with avoid_brands', () => {
  it('still returns the brand-matched winner but emits avoid_brand_lock_conflict warning', () => {
    const spec = makeSpec({ id: 'milk-1', brand: 'Kroger', brandLocked: true, unit: 'l' })
    const user: UserProfile = { avoid_brands: ['Kroger'] }

    const item = makeItem({ ingredientId: 'milk-1', name: 'Kroger Whole Milk', unit: '1 l', lineTotal: 2.99, unitPrice: 2.99 })
    const store = makeStore({ storeName: 'Kroger', items: [item] })

    const result = selectWinner(spec, [store], user)

    expect(result.winner).not.toBeNull()
    expect(result.warning).toBe('avoid_brand_lock_conflict')
  })
})

// ─── Brand-unlocked / avoid_brands tests ─────────────────────────────────────

describe('selectWinner — avoid_brands excludes best-price candidate', () => {
  it('winner is the next-best candidate not on avoid list', () => {
    const spec = makeSpec({ id: 'juice-1', displayName: 'orange juice', unit: 'l' })
    const user: UserProfile = { avoid_brands: ['Tropicana'] }

    // Tropicana is cheapest but avoided
    const itemTropicana = makeItem({ ingredientId: 'juice-1', name: 'Tropicana Orange Juice', unit: '1 l', lineTotal: 2.99, unitPrice: 2.99 })
    // Simply Orange is more expensive but eligible
    const itemSimply = makeItem({ ingredientId: 'juice-1', name: 'Simply Orange Juice', unit: '1 l', lineTotal: 3.49, unitPrice: 3.49 })

    const store = makeStore({ storeName: 'Kroger', items: [itemTropicana, itemSimply] })

    const result = selectWinner(spec, [store], user)

    expect(result.winner).not.toBeNull()
    expect(result.winner!.item.name).toContain('Simply Orange')
    expect(result.warning).toBeUndefined()
  })
})

describe('selectWinner — all candidates on avoid_brands → all_avoided_fallback', () => {
  it('falls back to the cheapest avoided candidate and emits all_avoided_fallback warning', () => {
    const spec = makeSpec({ id: 'soda-1', displayName: 'cola soda', unit: 'ml' })
    const user: UserProfile = { avoid_brands: ['Coca Cola', 'Pepsi'] }

    // Use clearly differentiated prices so that pricePerBase difference exceeds
    // PRICE_BAND (0.005) and cheaper candidate wins deterministically.
    // Coke: $4.00/500ml = $0.008/ml, Pepsi: $1.00/500ml = $0.002/ml → |diff| = 0.006 > 0.005
    const itemCoke = makeItem({ ingredientId: 'soda-1', name: 'Coca Cola 500ml', unit: '500 ml', lineTotal: 4.00, unitPrice: 4.00 })
    const itemPepsi = makeItem({ ingredientId: 'soda-1', name: 'Pepsi 500ml', unit: '500 ml', lineTotal: 1.00, unitPrice: 1.00 })

    const store = makeStore({ storeName: 'Walmart', items: [itemCoke, itemPepsi] })

    const result = selectWinner(spec, [store], user)

    expect(result.winner).not.toBeNull()
    expect(result.warning).toBe('all_avoided_fallback')
    // Winner should be cheapest of the fallback set (Pepsi at lower pricePerBase)
    expect(result.winner!.item.name).toContain('Pepsi')
  })
})

// ─── Tie-breaking tests ───────────────────────────────────────────────────────

describe('selectWinner — tie on pricePerBase → nearest store wins', () => {
  it('picks the closer store when price per base is equal', () => {
    const spec = makeSpec({ id: 'oil-1', displayName: 'olive oil', unit: 'ml' })

    // Both stores: 500 ml for $5.00 → same pricePerBase
    const itemFar = makeItem({ ingredientId: 'oil-1', name: 'Olive Oil 500ml', unit: '500 ml', lineTotal: 5.00, unitPrice: 5.00 })
    const itemNear = makeItem({ ingredientId: 'oil-1', name: 'Olive Oil 500ml', unit: '500 ml', lineTotal: 5.00, unitPrice: 5.00 })

    const storeFar  = makeStore({ storeName: 'Walmart', distanceMiles: 5.0, items: [itemFar] })
    const storeNear = makeStore({ storeName: 'Kroger',  distanceMiles: 1.0, items: [itemNear] })

    const result = selectWinner(spec, [storeFar, storeNear], noUser)

    expect(result.winner!.storeName).toBe('Kroger')
  })
})

describe('selectWinner — tie on pricePerBase + same distance → alphabetical store name', () => {
  it('picks store whose name comes first alphabetically', () => {
    const spec = makeSpec({ id: 'rice-1', displayName: 'white rice', unit: 'g' })

    const itemA = makeItem({ ingredientId: 'rice-1', name: 'White Rice 1kg', unit: '1000 g', lineTotal: 2.00, unitPrice: 2.00 })
    const itemB = makeItem({ ingredientId: 'rice-1', name: 'White Rice 1kg', unit: '1000 g', lineTotal: 2.00, unitPrice: 2.00 })

    // Same distance, same price — alphabetically "Aldi" < "Walmart"
    const storeW = makeStore({ storeName: 'Walmart', distanceMiles: 2.0, items: [itemA] })
    const storeA = makeStore({ storeName: 'Aldi',    distanceMiles: 2.0, items: [itemB] })

    const result = selectWinner(spec, [storeW, storeA], noUser)

    expect(result.winner!.storeName).toBe('Aldi')
  })
})

// ─── Countable fallback tests ─────────────────────────────────────────────────

describe('selectWinner — unit mismatch with known countable → converted via typicalEachWeightG', () => {
  it('converts egg carton each count to grams and computes pricePerBase in g', () => {
    // spec.unit = 'g', store item unit = 'each' → egg is a known countable (50g/each)
    // 12 each (1 carton/dozen) at $3.00 → 12 * 50 = 600g → pricePerBase = 3.00/600 = 0.005
    const spec = makeSpec({
      id: 'egg-1',
      displayName: 'eggs',
      unit: 'g',
    })

    const item = makeItem({
      ingredientId: 'egg-1',
      name: 'Large Eggs',
      unit: '12 each',
      lineTotal: 3.00,
      unitPrice: 3.00,
    })

    const store = makeStore({ storeName: 'Kroger', items: [item] })
    const result = selectWinner(spec, [store], noUser)

    expect(result.winner).not.toBeNull()
    expect(result.winner!.pricePerBase).toBeCloseTo(3.00 / (12 * 50), 5)
    expect(result.winner!.excludeReason).toBeUndefined()
  })
})

describe('selectWinner — unit mismatch: spec in count, candidate in mass → mass→count via typicalEachWeightG (Case B)', () => {
  it('countable fallback: spec in count, candidate in mass — mass→count conversion via typicalEachWeightG', () => {
    // Spec: user wants 1 dozen eggs (unit = 'dozen', base = 'count')
    const spec = makeSpec({
      id: 'eggs',
      displayName: 'egg',
      unit: 'dozen',
      quantity: 1,
    })

    // Store A sells eggs by the pound (parsed base = 'g')
    // 1 lb = 453.592 g. At 50g per egg, that's 453.592/50 = 9.0718 eggs.
    // pricePerBase (per each) = $4.50 / 9.0718 ≈ $0.4960 / each
    // pricedSize supplies the pre-converted grams so countableFallback receives qty in g.
    const storeA = makeStore({
      storeName: 'Store A',
      distanceMiles: 1.0,
      items: [
        makeItem({
          ingredientId: 'eggs',
          name: 'eggs by the pound',
          unit: '1 lb',
          lineTotal: 4.50,
          pricedSize: { quantity: 453.592, unit: 'g' },
        }),
      ],
    })

    // Store B sells by the dozen at $5.00
    const storeB = makeStore({
      storeName: 'Store B',
      distanceMiles: 1.0,
      items: [
        makeItem({ ingredientId: 'eggs', name: 'one dozen eggs', unit: '1 dozen', lineTotal: 5.00 }),
      ],
    })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    // pricePerBase is per-each (count base unit):
    // Store A: 453.592g / 50g per egg = 9.0718 each → $4.50 / 9.0718 ≈ $0.4960 / each
    // Store B: 1 dozen = 12 each → $5.00 / 12 ≈ $0.4167 / each
    // Winner: Store B (lower price per each)
    expect(result.winner?.storeName).toBe('Store B')
    expect(result.allCandidates).toHaveLength(2)

    // Verify Store A's candidate converted (not excluded)
    const storeACandidate = result.allCandidates.find((c) => c.storeName === 'Store A')
    expect(storeACandidate?.excludeReason).toBeUndefined()
    expect(storeACandidate?.pricePerBase).toBeGreaterThan(0.49)   // ~$0.4960 / each
    expect(storeACandidate?.pricePerBase).toBeLessThan(0.51)
  })
})

describe('selectWinner — countable Case A with non-base count unit (dozen) — Fix 1 regression guard', () => {
  it('correctly converts 1 dozen via toBase before multiplying by typicalEachWeightG', () => {
    // Spec: user wants X grams of egg (spec.unit = 'g', spec base = 'g')
    const spec = makeSpec({ id: 'eggs', displayName: 'egg', unit: 'g', quantity: 100 })

    // Store sells eggs by the dozen. typicalEachWeightG = 50 (per countables.ts).
    // Expected: 1 dozen = 12 eggs * 50 g = 600 g. $3.00 / 600g = $0.005 per gram.
    // Without the fix: 1 * 50 = 50 g. $3.00 / 50g = $0.06 per gram. (12x inflated.)
    const store = makeStore({
      storeName: 'Store A',
      distanceMiles: 1.0,
      items: [
        makeItem({
          ingredientId: 'eggs',
          name: 'one dozen eggs',
          unit: '1 dozen',
          lineTotal: 3.00,
          pricedSize: null,    // force parseSize path to exercise toBase conversion
        }),
      ],
    })

    const result = selectWinner(spec, [store], { avoid_brands: [] })
    expect(result.winner?.storeName).toBe('Store A')
    expect(result.winner?.pricePerBase).toBeGreaterThan(0.004)   // ~$0.005/g
    expect(result.winner?.pricePerBase).toBeLessThan(0.006)
  })
})

describe('selectWinner — countable Case B with natural lb unit (no pre-conversion) — Fix 1 regression guard', () => {
  it('correctly converts 1 lb via toBase to grams before dividing by typicalEachWeightG', () => {
    // Spec: user wants eggs by count (spec.unit = 'dozen', base = 'count')
    const spec = makeSpec({
      id: 'eggs',
      displayName: 'egg',
      unit: 'dozen',
      quantity: 1,
    })

    // Store sells eggs by the pound — natural unit, no pre-conversion in pricedSize.
    // 1 lb = 453.592 g. At 50g per egg → 453.592/50 = 9.0718 eggs.
    // pricePerBase (per each) = $4.50 / 9.0718 ≈ $0.4960 / each
    // Without the fix: 1 / 50 = 0.02 each → $4.50 / 0.02 = $225 / each. (~453x inflated.)
    const store = makeStore({
      storeName: 'Store A',
      distanceMiles: 1.0,
      items: [
        makeItem({
          ingredientId: 'eggs',
          name: 'eggs by the pound',
          unit: '1 lb',
          lineTotal: 4.50,
          pricedSize: null,    // force parseSize path to exercise toBase conversion
        }),
      ],
    })

    const result = selectWinner(spec, [store], { avoid_brands: [] })
    expect(result.winner?.storeName).toBe('Store A')
    expect(result.winner?.pricePerBase).toBeGreaterThan(0.49)   // ~$0.4960 / each
    expect(result.winner?.pricePerBase).toBeLessThan(0.51)
  })
})

describe('selectWinner — unit mismatch for non-countable item → ranked low with fallback, not excluded', () => {
  it('keeps the candidate with unit_mismatch using synthetic fallback pricePerBase (P1.4 contract)', () => {
    // spec.unit = 'g' (mass), store item = each → item is "motor oil" — not a countable.
    // Old behavior: winner === null (candidate silently dropped).
    // New behavior: candidate survives with synthetic pricePerBase, winner is non-null.
    const spec = makeSpec({
      id: 'oil-1',
      displayName: 'motor oil',
      unit: 'g',
    })

    const item = makeItem({
      ingredientId: 'oil-1',
      name: 'Motor Oil',
      unit: '1 each',
      lineTotal: 8.99,
      unitPrice: 8.99,
    })

    const store = makeStore({ storeName: 'Walmart', items: [item] })
    const result = selectWinner(spec, [store], noUser)

    // Candidate is NOT dropped — winner is non-null under new P1.4 contract
    expect(result.winner).not.toBeNull()
    const candidate = result.allCandidates[0]
    // Diagnostic still preserved
    expect(candidate.excludeReason).toBe('unit_mismatch')
    // Synthetic fallback pricePerBase is non-null
    expect(candidate.pricePerBase).not.toBeNull()
    expect(candidate.pricePerBase).toBe(8.99 * 1000)
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('selectWinner — empty stores list', () => {
  it('returns winner null with empty candidate arrays', () => {
    const spec = makeSpec()
    const result = selectWinner(spec, [], noUser)

    expect(result.winner).toBeNull()
    expect(result.eligibleCandidates).toHaveLength(0)
    expect(result.allCandidates).toHaveLength(0)
  })
})

describe('selectWinner — item missing from all stores', () => {
  it('returns winner null when no store has an item with matching ingredientId', () => {
    const spec = makeSpec({ id: 'rare-item' })

    const item = makeItem({ ingredientId: 'different-item', name: 'Unrelated Product', unit: '1 l', lineTotal: 2.00 })
    const store = makeStore({ storeName: 'HEB', items: [item] })

    const result = selectWinner(spec, [store], noUser)

    expect(result.winner).toBeNull()
    expect(result.allCandidates).toHaveLength(0)
  })
})

describe('selectWinner — notAvailable items filtered out', () => {
  it('excludes notAvailable items and picks from available ones', () => {
    const spec = makeSpec({ id: 'butter-1', displayName: 'butter', unit: 'g' })

    const unavailable = makeItem({ ingredientId: 'butter-1', name: 'Butter 454g', unit: '454 g', lineTotal: 3.49, unitPrice: 3.49, notAvailable: true })
    const available   = makeItem({ ingredientId: 'butter-1', name: 'Butter 454g', unit: '454 g', lineTotal: 4.99, unitPrice: 4.99, notAvailable: false })

    const store = makeStore({ storeName: 'Kroger', items: [unavailable, available] })
    const result = selectWinner(spec, [store], noUser)

    expect(result.winner).not.toBeNull()
    expect(result.winner!.item.lineTotal).toBe(4.99)
    expect(result.allCandidates[0].excludeReason).toBe('not_available')
  })
})

describe('selectWinner — unparseable size string → ranked low with fallback, not excluded', () => {
  it('keeps candidate with size_unparseable using synthetic fallback pricePerBase (P1.4 contract)', () => {
    // Old behavior: winner === null (candidate silently dropped).
    // New behavior: candidate survives with synthetic pricePerBase, winner is non-null.
    const spec = makeSpec({ id: 'widget-1', unit: 'g' })

    const item = makeItem({ ingredientId: 'widget-1', name: 'Mystery Item', unit: 'one giant tub', lineTotal: 5.00 })
    const store = makeStore({ storeName: 'HEB', items: [item] })

    const result = selectWinner(spec, [store], noUser)

    // Candidate is NOT dropped — winner is non-null under new P1.4 contract
    expect(result.winner).not.toBeNull()
    const candidate = result.allCandidates[0]
    // Diagnostic still preserved
    expect(candidate.excludeReason).toBe('size_unparseable')
    // Synthetic fallback pricePerBase is non-null
    expect(candidate.pricePerBase).not.toBeNull()
    expect(candidate.pricePerBase).toBe(5.00 * 1000)
  })
})

// ─── §2.5 Three-item × four-store acceptance test ────────────────────────────
//
// 3 items × 4 stores = 12 StoreItem results.
// Winners are specific stores per item.
// Best basket total = sum of 3 winners' lineTotals.
// This is DIFFERENT from sum-of-all-results — regression guard against the
// old summing bug (summing all 12 lineTotals instead of the 3 winners).
//
// Item setup:
//   eggs:     Kroger $4.50, Walmart $4.00, HEB $3.80, Aldi $3.50  → Winner: Aldi
//   chicken:  Kroger $8.99, Walmart $9.50, HEB $7.99, Aldi $10.00 → Winner: HEB
//   spinach:  Kroger $2.50, Walmart $2.75, HEB $2.25, Aldi $2.60  → Winner: HEB
//
// Best basket total: 3.50 + 7.99 + 2.25 = $13.74
// Sum-of-all-results (the bug): 4.50+4.00+3.80+3.50 + 8.99+9.50+7.99+10.00 + 2.50+2.75+2.25+2.60 = $62.38
// Discrepancy: $62.38 - $13.74 = $48.64 (4.5× overcount)

describe('§2.5 three-item × four-store acceptance test', () => {
  // Store distances (miles)
  const KROGER_DIST  = 1.0
  const WALMART_DIST = 1.5
  const HEB_DIST     = 0.8
  const ALDI_DIST    = 2.0

  // ── Specs ──────────────────────────────────────────────────────────────────
  const eggsSpec = makeSpec({
    id: 'eggs-spec',
    displayName: 'eggs',
    unit: 'dozen',
  })

  const chickenSpec = makeSpec({
    id: 'chicken-spec',
    displayName: 'chicken breast',
    unit: 'lb',
  })

  const spinachSpec = makeSpec({
    id: 'spinach-spec',
    displayName: 'baby spinach',
    unit: 'oz',
  })

  // ── Stores with 3 items each ───────────────────────────────────────────────
  const kroger = makeStore({
    storeName: 'Kroger',
    distanceMiles: KROGER_DIST,
    items: [
      makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen', unit: '1 dozen', lineTotal: 4.50, unitPrice: 4.50 }),
      makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb', lineTotal: 8.99, unitPrice: 4.495 }),
      makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz', unit: '16 oz', lineTotal: 2.50, unitPrice: 2.50 }),
    ],
  })

  const walmart = makeStore({
    storeName: 'Walmart',
    distanceMiles: WALMART_DIST,
    items: [
      makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen', unit: '1 dozen', lineTotal: 4.00, unitPrice: 4.00 }),
      makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb', lineTotal: 9.50, unitPrice: 4.75 }),
      makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz', unit: '16 oz', lineTotal: 2.75, unitPrice: 2.75 }),
    ],
  })

  const heb = makeStore({
    storeName: 'HEB',
    distanceMiles: HEB_DIST,
    items: [
      makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen', unit: '1 dozen', lineTotal: 3.80, unitPrice: 3.80 }),
      makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb', lineTotal: 7.99, unitPrice: 3.995 }),
      makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz', unit: '16 oz', lineTotal: 2.25, unitPrice: 2.25 }),
    ],
  })

  const aldi = makeStore({
    storeName: 'Aldi',
    distanceMiles: ALDI_DIST,
    items: [
      makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen', unit: '1 dozen', lineTotal: 3.50, unitPrice: 3.50 }),
      makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb', lineTotal: 10.00, unitPrice: 5.00 }),
      makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz', unit: '16 oz', lineTotal: 2.60, unitPrice: 2.60 }),
    ],
  })

  const allStores = [kroger, walmart, heb, aldi]

  it('eggs winner is Aldi (cheapest per dozen)', () => {
    const result = selectWinner(eggsSpec, allStores, noUser)
    expect(result.winner).not.toBeNull()
    expect(result.winner!.storeName).toBe('Aldi')
  })

  it('chicken winner is HEB (cheapest per lb)', () => {
    const result = selectWinner(chickenSpec, allStores, noUser)
    expect(result.winner).not.toBeNull()
    expect(result.winner!.storeName).toBe('HEB')
  })

  it('spinach winner is HEB (cheapest per oz)', () => {
    const result = selectWinner(spinachSpec, allStores, noUser)
    expect(result.winner).not.toBeNull()
    expect(result.winner!.storeName).toBe('HEB')
  })

  it('allCandidates has exactly 4 entries per item (one per store)', () => {
    expect(selectWinner(eggsSpec,   allStores, noUser).allCandidates).toHaveLength(4)
    expect(selectWinner(chickenSpec, allStores, noUser).allCandidates).toHaveLength(4)
    expect(selectWinner(spinachSpec, allStores, noUser).allCandidates).toHaveLength(4)
  })

  it('best basket total equals sum of three winners — not sum of all 12 items', () => {
    const winners: WinnerResult[] = [
      selectWinner(eggsSpec,   allStores, noUser),
      selectWinner(chickenSpec, allStores, noUser),
      selectWinner(spinachSpec, allStores, noUser),
    ]

    // All winners must be found
    for (const w of winners) {
      expect(w.winner).not.toBeNull()
    }

    const bestBasketTotal = winners.reduce((sum, w) => sum + w.winner!.item.lineTotal, 0)
    const sumOfAllResults = allStores
      .flatMap((s) => s.items)
      .reduce((sum, item) => sum + item.lineTotal, 0)

    // Best basket: Aldi eggs $3.50 + HEB chicken $7.99 + HEB spinach $2.25 = $13.74
    expect(bestBasketTotal).toBeCloseTo(13.74, 2)

    // Sum of all 12 results: $62.38
    expect(sumOfAllResults).toBeCloseTo(62.38, 2)

    // The two numbers are NOT equal — this guards against the summing bug
    expect(Math.abs(bestBasketTotal - sumOfAllResults)).toBeGreaterThan(40)
  })

  it('regression guard: buggy sum (all 12 items) exceeds best basket by ~$48.64', () => {
    const winners: WinnerResult[] = [
      selectWinner(eggsSpec,   allStores, noUser),
      selectWinner(chickenSpec, allStores, noUser),
      selectWinner(spinachSpec, allStores, noUser),
    ]

    const bestBasket = winners.reduce((sum, w) => sum + w.winner!.item.lineTotal, 0)
    const buggySum   = allStores.flatMap((s) => s.items).reduce((sum, i) => sum + i.lineTotal, 0)

    expect(buggySum - bestBasket).toBeCloseTo(48.64, 2)
  })
})

describe('selectWinner — eligibleCandidates excludes the winner (alternatives only)', () => {
  it('eligibleCandidates excludes the winner (alternatives only)', () => {
    const spec = makeSpec({ id: 'milk-1', displayName: 'whole milk', unit: 'l' })

    // Two priced candidates so there is a winner + at least one alternative
    const itemA = makeItem({ ingredientId: 'milk-1', name: 'Store Brand Whole Milk', unit: '1 l', lineTotal: 2.99, unitPrice: 2.99 })
    const itemB = makeItem({ ingredientId: 'milk-1', name: 'Organic Valley Whole Milk', unit: '1 l', lineTotal: 5.99, unitPrice: 5.99 })

    const storeA = makeStore({ storeName: 'Aldi',   distanceMiles: 1.0, items: [itemA] })
    const storeB = makeStore({ storeName: 'Kroger', distanceMiles: 1.5, items: [itemB] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()

    // allCandidates must contain the winner
    expect(result.allCandidates.some((c) => c === result.winner)).toBe(true)

    // eligibleCandidates must NOT contain the winner
    expect(result.eligibleCandidates.some((c) => c === result.winner)).toBe(false)

    // eligibleCandidates has exactly 1 entry (the other candidate)
    expect(result.eligibleCandidates).toHaveLength(1)
    expect(result.eligibleCandidates[0].storeName).toBe('Kroger')
  })
})

describe('selectWinner regression — winners populate when candidates exist', () => {
  it('returns a non-null winner when any store has a candidate for the spec', () => {
    const spec = makeSpec({ id: 's1', displayName: 'chicken thighs', unit: 'lb' })
    const item = makeItem({
      ingredientId: 's1',
      name: 'Kroger Boneless Skinless Chicken Thighs',
      unit: '2 lb',
      lineTotal: 9.98,
      unitPrice: 4.99,
      pricedSize: { quantity: 2, unit: 'lb' },
    })
    const store = makeStore({ storeName: 'Kroger', items: [item] })

    const result = selectWinner(spec, [store], noUser)

    expect(result.winner).not.toBeNull()
    expect(result.winner?.item.name).toContain('Chicken Thighs')
    expect(result.winner?.storeName).toBe('Kroger')
    // Single candidate becomes the winner; no alternatives remain
    expect(result.eligibleCandidates).toHaveLength(0)
  })
})

// ─── P1.4: no-silent-drop fallback tests ──────────────────────────────────────

describe('selectWinner — size_unparseable candidates rank low instead of being dropped', () => {
  it('candidates with size_unparseable are not silently dropped — they rank but rank below confident candidates', () => {
    // spec: 1 lb of grapes
    // Two candidates: confident ($2.00/lb, parsedSize OK) and unparseable ($1.50, "Family Size")
    // Expectation: BOTH appear in allCandidates, winner is non-null (confident candidate)
    const spec = makeSpec({ id: 'grapes-1', displayName: 'grapes', unit: 'lb' })

    const confidentItem = makeItem({
      ingredientId: 'grapes-1',
      name: 'Grapes 2 lb bag',
      unit: '2 lb',
      lineTotal: 4.00,
      unitPrice: 2.00,
    })
    const unparseableItem = makeItem({
      ingredientId: 'grapes-1',
      name: 'Grapes Family Size',
      unit: 'Family Size',    // parseSize returns null for this
      lineTotal: 3.00,
      unitPrice: 3.00,
    })

    const confidentStore = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [confidentItem] })
    const unparseableStore = makeStore({ storeName: 'Walmart', distanceMiles: 1.5, items: [unparseableItem] })

    const result = selectWinner(spec, [confidentStore, unparseableStore], noUser)

    // Critical: winner is non-null (the bug caused winner to be null)
    expect(result.winner).not.toBeNull()
    // The confident candidate wins (lower effective pricePerBase)
    expect(result.winner!.storeName).toBe('Kroger')
    // Both candidates present in allCandidates
    expect(result.allCandidates).toHaveLength(2)
    // The unparseable candidate still has size_unparseable diagnostic
    const unparseable = result.allCandidates.find((c) => c.storeName === 'Walmart')
    expect(unparseable).toBeDefined()
    expect(unparseable!.excludeReason).toBe('size_unparseable')
    // But it is NOT excluded — pricePerBase is non-null (synthetic fallback)
    expect(unparseable!.pricePerBase).not.toBeNull()
    // And its pricePerBase is larger than the confident one (ranks below)
    expect(unparseable!.pricePerBase!).toBeGreaterThan(result.winner!.pricePerBase!)
  })
})

describe('selectWinner — unit_mismatch candidates rank low instead of being dropped', () => {
  it('candidates with unit_mismatch are not silently dropped', () => {
    // spec wants mass (g), candidate has count (each) for a non-countable item → unit_mismatch
    // The candidate should survive with fallback pricePerBase, not be excluded
    const spec = makeSpec({ id: 'oil-1', displayName: 'motor oil', unit: 'g' })

    const mismatchItem = makeItem({
      ingredientId: 'oil-1',
      name: 'Motor Oil',
      unit: '1 each',
      lineTotal: 8.99,
      unitPrice: 8.99,
    })

    const store = makeStore({ storeName: 'Walmart', distanceMiles: 1.0, items: [mismatchItem] })
    const result = selectWinner(spec, [store], noUser)

    // Critical: winner is non-null (was null before the fix)
    expect(result.winner).not.toBeNull()
    expect(result.allCandidates).toHaveLength(1)
    const candidate = result.allCandidates[0]
    // Diagnostic preserved
    expect(candidate.excludeReason).toBe('unit_mismatch')
    // But pricePerBase is non-null (synthetic fallback) — candidate was NOT dropped
    expect(candidate.pricePerBase).not.toBeNull()
  })
})

describe('selectWinner — all candidates size_unparseable → winner is cheapest by raw unitPrice', () => {
  it('when ALL candidates are size_unparseable, selectWinner still returns a winner (the cheapest by raw lineTotal)', () => {
    // 2 candidates, both "Family Size"; one $5, one $7. Winner should be the $5 one.
    const spec = makeSpec({ id: 'grapes-2', displayName: 'grapes', unit: 'lb' })

    const cheaper = makeItem({
      ingredientId: 'grapes-2',
      name: 'Grapes Family Pack',
      unit: 'Family Size',
      lineTotal: 5.00,
      unitPrice: 5.00,
    })
    const pricier = makeItem({
      ingredientId: 'grapes-2',
      name: 'Grapes Club Pack',
      unit: 'Deli Thin Sliced',   // also unparseable
      lineTotal: 7.00,
      unitPrice: 7.00,
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [cheaper] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.0, items: [pricier] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    // Both candidates should be present and eligible
    expect(result.winner).not.toBeNull()
    expect(result.allCandidates).toHaveLength(2)
    // The cheaper one ($5 lineTotal → lower synthetic pricePerBase) wins
    expect(result.winner!.storeName).toBe('Kroger')
    expect(result.winner!.item.lineTotal).toBe(5.00)
  })
})

// ─── P2.8: Grade-aware ranking tests ─────────────────────────────────────────

function makeGrade(overrides: Partial<AlignmentGrade> = {}): AlignmentGrade {
  return {
    score: 90,
    category: 'exact',
    reason: 'exact match',
    ...overrides,
  }
}

describe('P2.8 — wrong-category candidate is excluded from winner + eligibleCandidates', () => {
  it('wrong candidate appears in allCandidates with excludeReason wrong_product but is not winner nor eligible', () => {
    const spec = makeSpec({ id: 'milk-p28', displayName: 'whole milk', unit: 'l' })

    const wrongItem = makeItem({
      ingredientId: 'milk-p28',
      name: 'Almond Milk',
      unit: '1 l',
      lineTotal: 3.99,
      alignmentGrade: makeGrade({ score: 20, category: 'wrong', reason: 'plant-based, not dairy' }),
    })
    const rightItem = makeItem({
      ingredientId: 'milk-p28',
      name: 'Whole Milk',
      unit: '1 l',
      lineTotal: 4.49,
      alignmentGrade: makeGrade({ score: 95, category: 'exact', reason: 'exact match' }),
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [wrongItem] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.5, items: [rightItem] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    // Winner is the right item, not the wrong one
    expect(result.winner).not.toBeNull()
    expect(result.winner!.item.name).toContain('Whole Milk')

    // Wrong candidate is in allCandidates with excludeReason
    const wrongCandidate = result.allCandidates.find(c => c.item.name === 'Almond Milk')
    expect(wrongCandidate).toBeDefined()
    expect(wrongCandidate!.excludeReason).toBe('wrong_product')

    // Wrong candidate is NOT in eligibleCandidates
    expect(result.eligibleCandidates.some(c => c.item.name === 'Almond Milk')).toBe(false)
  })
})

describe('P2.8 — exact grade wins over cheaper substitute', () => {
  it('exact (score 95, $5/lb) beats substitute (score 70, $3/lb)', () => {
    const spec = makeSpec({ id: 'flour-p28', displayName: 'all-purpose flour', unit: 'lb' })

    const exactItem = makeItem({
      ingredientId: 'flour-p28',
      name: 'All-Purpose Flour 5 lb',
      unit: '5 lb',
      lineTotal: 25.00,   // $5/lb
      alignmentGrade: makeGrade({ score: 95, category: 'exact', reason: 'exact match' }),
    })
    const substituteItem = makeItem({
      ingredientId: 'flour-p28',
      name: 'Bread Flour 5 lb',
      unit: '5 lb',
      lineTotal: 15.00,   // $3/lb
      alignmentGrade: makeGrade({ score: 70, category: 'substitute', reason: 'bread flour instead of all-purpose' }),
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [exactItem] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.0, items: [substituteItem] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()
    // Exact wins despite being 67% more expensive
    expect(result.winner!.item.name).toContain('All-Purpose')
    expect(result.winner!.storeName).toBe('Kroger')
  })
})

describe('P2.8 — within ±5 score band, cheaper wins', () => {
  it('two exact candidates within 5-point band: cheapest pricePerBase wins', () => {
    const spec = makeSpec({ id: 'sugar-p28', displayName: 'granulated sugar', unit: 'lb' })

    // Both 'exact', scores 95 and 92 — within ±5 band, so price decides.
    // Use 1 lb units so pricePerBase = lineTotal / 453.592g.
    // pricierExact: $5.00/lb → ~$0.01102/g
    // cheaperExact: $2.00/lb → ~$0.00441/g
    // |diff| ≈ 0.0066 > PRICE_BAND (0.005), so cheaper wins.
    const pricierExact = makeItem({
      ingredientId: 'sugar-p28',
      name: 'C&H Granulated Sugar 1 lb',
      unit: '1 lb',
      lineTotal: 5.00,   // $5/lb → ~$0.01102/g
      alignmentGrade: makeGrade({ score: 95, category: 'exact', reason: 'exact match' }),
    })
    const cheaperExact = makeItem({
      ingredientId: 'sugar-p28',
      name: 'Store Brand Granulated Sugar 1 lb',
      unit: '1 lb',
      lineTotal: 2.00,   // $2/lb → ~$0.00441/g
      alignmentGrade: makeGrade({ score: 92, category: 'exact', reason: 'exact match, store brand' }),
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [pricierExact] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.0, items: [cheaperExact] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()
    // Cheaper wins because scores within ±5 band and price difference exceeds PRICE_BAND
    expect(result.winner!.storeName).toBe('Walmart')
    expect(result.winner!.item.name).toContain('Store Brand')
  })
})

describe('P2.8 — all candidates wrong → winner null, eligibleCandidates empty', () => {
  it('when every candidate is category wrong, winner is null and eligibleCandidates is empty', () => {
    const spec = makeSpec({ id: 'butter-p28', displayName: 'unsalted butter', unit: 'lb' })

    const wrong1 = makeItem({
      ingredientId: 'butter-p28',
      name: 'Margarine Spread',
      unit: '1 lb',
      lineTotal: 2.99,
      alignmentGrade: makeGrade({ score: 15, category: 'wrong', reason: 'margarine not butter' }),
    })
    const wrong2 = makeItem({
      ingredientId: 'butter-p28',
      name: 'Coconut Oil',
      unit: '1 lb',
      lineTotal: 5.99,
      alignmentGrade: makeGrade({ score: 10, category: 'wrong', reason: 'coconut oil not butter' }),
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [wrong1] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.5, items: [wrong2] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).toBeNull()
    expect(result.eligibleCandidates).toHaveLength(0)
    // Both still in allCandidates with wrong_product reason
    expect(result.allCandidates).toHaveLength(2)
    expect(result.allCandidates.every(c => c.excludeReason === 'wrong_product')).toBe(true)
  })
})

describe('P2.8 — no grades attached: falls back to pricePerBase ranking (legacy behavior)', () => {
  it('when no alignmentGrade is set, ranking is purely by pricePerBase ascending', () => {
    const spec = makeSpec({ id: 'cream-p28', displayName: 'heavy cream', unit: 'ml' })

    // No alignmentGrade on either item → treat as score:50 ungraded → price decides.
    // Use 100ml units so pricePerBase = lineTotal / 100ml.
    // expensive: $5.00/100ml → $0.05/ml
    // cheap:     $1.00/100ml → $0.01/ml
    // |diff| = 0.04/ml > PRICE_BAND (0.005), so cheaper wins.
    const expensive = makeItem({
      ingredientId: 'cream-p28',
      name: 'Heavy Cream 100ml',
      unit: '100 ml',
      lineTotal: 5.00,   // $0.05/ml
    })
    const cheap = makeItem({
      ingredientId: 'cream-p28',
      name: 'Heavy Cream 100ml',
      unit: '100 ml',
      lineTotal: 1.00,   // $0.01/ml
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [expensive] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.0, items: [cheap] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()
    // No grades → same ungraded score → cheaper wins (price difference exceeds PRICE_BAND)
    expect(result.winner!.storeName).toBe('Walmart')
    expect(result.winner!.item.lineTotal).toBe(1.00)
  })
})

describe('P2.8 — eligibleCandidates excludes winner (P1.2 contract still holds)', () => {
  it('eligibleCandidates never contains the winner, even with grades attached', () => {
    const spec = makeSpec({ id: 'oil-p28', displayName: 'olive oil', unit: 'ml' })

    const itemA = makeItem({
      ingredientId: 'oil-p28',
      name: 'Extra Virgin Olive Oil 500ml',
      unit: '500 ml',
      lineTotal: 8.00,
      alignmentGrade: makeGrade({ score: 95, category: 'exact', reason: 'exact match' }),
    })
    const itemB = makeItem({
      ingredientId: 'oil-p28',
      name: 'Pure Olive Oil 500ml',
      unit: '500 ml',
      lineTotal: 6.00,
      alignmentGrade: makeGrade({ score: 70, category: 'substitute', reason: 'pure not EVOO' }),
    })

    const storeA = makeStore({ storeName: 'Aldi', distanceMiles: 1.0, items: [itemA] })
    const storeB = makeStore({ storeName: 'Kroger', distanceMiles: 1.5, items: [itemB] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    expect(result.winner).not.toBeNull()
    // allCandidates must contain the winner
    expect(result.allCandidates.some(c => c === result.winner)).toBe(true)
    // eligibleCandidates must NOT contain the winner
    expect(result.eligibleCandidates.some(c => c === result.winner)).toBe(false)
    // eligibleCandidates has exactly 1 entry
    expect(result.eligibleCandidates).toHaveLength(1)
  })
})

describe('P2.8 — unparseable-size candidates with grades: wrong_product excludes, others survive (P1.4 + P2.8 coexistence)', () => {
  it('a wrong-graded unparseable candidate is excluded; an ungraded unparseable survives with fallback pricePerBase', () => {
    const spec = makeSpec({ id: 'cheese-p28', displayName: 'cheddar cheese', unit: 'lb' })

    // Candidate with unparseable size AND wrong grade — excluded via wrong_product
    const wrongUnparseable = makeItem({
      ingredientId: 'cheese-p28',
      name: 'Vegan Cheese Substitute',
      unit: 'one mystery pack',     // unparseable
      lineTotal: 6.00,
      alignmentGrade: makeGrade({ score: 5, category: 'wrong', reason: 'vegan substitute is not cheddar' }),
    })

    // Candidate with unparseable size and NO grade — survives with fallback PPB (P1.4)
    const ungradedUnparseable = makeItem({
      ingredientId: 'cheese-p28',
      name: 'Cheddar Block Family Size',
      unit: 'Family Size',          // unparseable
      lineTotal: 8.00,
      // no alignmentGrade → treated as ungraded fallback
    })

    const storeA = makeStore({ storeName: 'Kroger', distanceMiles: 1.0, items: [wrongUnparseable] })
    const storeB = makeStore({ storeName: 'Walmart', distanceMiles: 1.5, items: [ungradedUnparseable] })

    const result = selectWinner(spec, [storeA, storeB], noUser)

    // Winner must be non-null (the ungraded unparseable survives)
    expect(result.winner).not.toBeNull()
    expect(result.winner!.storeName).toBe('Walmart')

    // Wrong candidate is excluded with wrong_product reason
    const wrongCand = result.allCandidates.find(c => c.storeName === 'Kroger')
    expect(wrongCand).toBeDefined()
    expect(wrongCand!.excludeReason).toBe('wrong_product')

    // Ungraded unparseable is NOT excluded — has synthetic fallback pricePerBase
    const ungradedCand = result.allCandidates.find(c => c.storeName === 'Walmart')
    expect(ungradedCand).toBeDefined()
    expect(ungradedCand!.excludeReason).toBe('size_unparseable')
    expect(ungradedCand!.pricePerBase).not.toBeNull()
  })
})
