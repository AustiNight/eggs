import { describe, it, expect } from 'vitest'
import { selectWinner } from './bestValue.js'
import type { Candidate, WinnerResult } from './bestValue.js'
import type { ShoppableItemSpec } from '../types/spec.js'
import type { StoreItem, StorePlan, UserProfile } from '../types/index.js'

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

    const itemCoke = makeItem({ ingredientId: 'soda-1', name: 'Coca Cola 500ml', unit: '500 ml', lineTotal: 1.99, unitPrice: 1.99 })
    const itemPepsi = makeItem({ ingredientId: 'soda-1', name: 'Pepsi 500ml', unit: '500 ml', lineTotal: 1.79, unitPrice: 1.79 })

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

describe('selectWinner — unit mismatch for non-countable item → excluded', () => {
  it('excludes the candidate with unit_mismatch when no countable entry exists', () => {
    // spec.unit = 'g' (mass), store item = each → item is "motor oil" — not a countable
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

    expect(result.winner).toBeNull()
    const candidate = result.allCandidates[0]
    expect(candidate.excludeReason).toBe('unit_mismatch')
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

describe('selectWinner — unparseable size string', () => {
  it('excludes candidate with size_unparseable when unit cannot be parsed', () => {
    const spec = makeSpec({ id: 'widget-1', unit: 'g' })

    const item = makeItem({ ingredientId: 'widget-1', name: 'Mystery Item', unit: 'one giant tub', lineTotal: 5.00 })
    const store = makeStore({ storeName: 'HEB', items: [item] })

    const result = selectWinner(spec, [store], noUser)

    expect(result.winner).toBeNull()
    expect(result.allCandidates[0].excludeReason).toBe('size_unparseable')
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
