import { describe, it, expect } from 'vitest'
import { computeBestBasketTotal, extractSpecs } from './planTotals.js'
import type { ShoppingPlan, StorePlan, StoreItem, UserProfile } from '../types/index.js'

// ─── Fixture helpers (mirrored from bestValue.test.ts §2.5) ──────────────────

const noUser: UserProfile = { avoid_brands: [] }

function makeItem(
  overrides: Partial<StoreItem> & { ingredientId: string; name: string }
): StoreItem {
  return {
    sku: undefined,
    quantity: 1,
    unit: '1 dozen',
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
  overrides: Partial<StorePlan> & { storeName: string; items: StoreItem[] }
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

// ─── §2.5 three-item × four-store fixture ────────────────────────────────────
//
// Item setup (same as bestValue.test.ts):
//   eggs:     Kroger $4.50, Walmart $4.00, HEB $3.80, Aldi $3.50  → Winner: Aldi
//   chicken:  Kroger $8.99, Walmart $9.50, HEB $7.99, Aldi $10.00 → Winner: HEB
//   spinach:  Kroger $2.50, Walmart $2.75, HEB $2.25, Aldi $2.60  → Winner: HEB
//
// Best basket:          Aldi $3.50 + HEB $7.99 + HEB $2.25  = $13.74
// Legacy buggy sum:     (4.50+4.00+3.80+3.50) + (8.99+9.50+7.99+10.00) + (2.50+2.75+2.25+2.60) = $62.38
// Tax (8.25%):          $13.74 * 0.0825 = ~$1.134 → round2 = $1.13
// Total with tax:       $13.74 + $1.13 = $14.87

const kroger = makeStore({
  storeName: 'Kroger',
  distanceMiles: 1.0,
  items: [
    makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen',   unit: '1 dozen', lineTotal: 4.50, unitPrice: 4.50 }),
    makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb',    lineTotal: 8.99, unitPrice: 4.495 }),
    makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz',  unit: '16 oz',   lineTotal: 2.50, unitPrice: 2.50 }),
  ],
})

const walmart = makeStore({
  storeName: 'Walmart',
  distanceMiles: 1.5,
  items: [
    makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen',   unit: '1 dozen', lineTotal: 4.00, unitPrice: 4.00 }),
    makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb',    lineTotal: 9.50, unitPrice: 4.75 }),
    makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz',  unit: '16 oz',   lineTotal: 2.75, unitPrice: 2.75 }),
  ],
})

const heb = makeStore({
  storeName: 'HEB',
  distanceMiles: 0.8,
  items: [
    makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen',   unit: '1 dozen', lineTotal: 3.80, unitPrice: 3.80 }),
    makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb',    lineTotal: 7.99, unitPrice: 3.995 }),
    makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz',  unit: '16 oz',   lineTotal: 2.25, unitPrice: 2.25 }),
  ],
})

const aldi = makeStore({
  storeName: 'Aldi',
  distanceMiles: 2.0,
  items: [
    makeItem({ ingredientId: 'eggs-spec',    name: 'Large Eggs 1 Dozen',   unit: '1 dozen', lineTotal: 3.50, unitPrice: 3.50 }),
    makeItem({ ingredientId: 'chicken-spec', name: 'Chicken Breast 2 lb', unit: '2 lb',    lineTotal: 10.00, unitPrice: 5.00 }),
    makeItem({ ingredientId: 'spinach-spec', name: 'Baby Spinach 16 oz',  unit: '16 oz',   lineTotal: 2.60, unitPrice: 2.60 }),
  ],
})

// A plan that has explicit specs (M6/M7 plans)
const planWithSpecs: ShoppingPlan = {
  id: 'plan-1',
  generatedAt: new Date().toISOString(),
  meta: {
    location: { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX 75201' },
    storesQueried: [],
    modelUsed: 'test',
    budgetMode: 'calculate',
    specs: [
      {
        id: 'eggs-spec',
        sourceText: 'eggs',
        displayName: 'eggs',
        categoryPath: ['produce', 'eggs'],
        brand: null,
        brandLocked: false,
        quantity: 1,
        unit: 'dozen',
        resolutionTrace: [],
        confidence: 'high',
      },
      {
        id: 'chicken-spec',
        sourceText: 'chicken breast',
        displayName: 'chicken breast',
        categoryPath: ['meat', 'poultry'],
        brand: null,
        brandLocked: false,
        quantity: 2,
        unit: 'lb',
        resolutionTrace: [],
        confidence: 'high',
      },
      {
        id: 'spinach-spec',
        sourceText: 'baby spinach',
        displayName: 'baby spinach',
        categoryPath: ['produce', 'greens'],
        brand: null,
        brandLocked: false,
        quantity: 16,
        unit: 'oz',
        resolutionTrace: [],
        confidence: 'high',
      },
    ],
  },
  ingredients: [
    { id: 'eggs-spec',    name: 'eggs',          quantity: 1, unit: 'dozen', category: 'produce',  sources: [] },
    { id: 'chicken-spec', name: 'chicken breast', quantity: 2, unit: 'lb',    category: 'meat',     sources: [] },
    { id: 'spinach-spec', name: 'baby spinach',   quantity: 16, unit: 'oz',   category: 'produce',  sources: [] },
  ],
  stores: [kroger, walmart, heb, aldi],
  summary: {
    subtotal: 62.38,
    estimatedTax: 5.15,
    total: 67.53,   // <- buggy legacy total
    realPriceCount: 12,
    estimatedPriceCount: 0,
  },
}

// A legacy plan WITHOUT meta.specs — simulate old format
const planLegacy: ShoppingPlan = {
  id: 'plan-legacy',
  generatedAt: new Date().toISOString(),
  meta: {
    location: { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX 75201' },
    storesQueried: [],
    modelUsed: 'test',
    budgetMode: 'calculate',
    // no specs field
  },
  ingredients: [
    { id: 'eggs-spec',    name: 'eggs',          quantity: 1,  unit: 'dozen', category: 'produce', sources: [] },
    { id: 'chicken-spec', name: 'chicken breast', quantity: 2, unit: 'lb',    category: 'meat',    sources: [] },
    { id: 'spinach-spec', name: 'baby spinach',   quantity: 16, unit: 'oz',   category: 'produce', sources: [] },
  ],
  stores: [kroger, walmart, heb, aldi],
  summary: {
    subtotal: 62.38,
    estimatedTax: 5.15,
    total: 67.53,   // <- buggy legacy total
    realPriceCount: 12,
    estimatedPriceCount: 0,
  },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeBestBasketTotal — three-item × four-store fixture with specs', () => {
  it('M8 regression guard: returns best-basket subtotal ~$13.74, NOT the buggy ~$62.38', () => {
    const result = computeBestBasketTotal(planWithSpecs, noUser)

    // Best basket: Aldi eggs $3.50 + HEB chicken $7.99 + HEB spinach $2.25
    expect(result.subtotal).toBeCloseTo(13.74, 2)

    // Assert that the legacy plan.summary.total is materially different
    expect(Math.abs(planWithSpecs.summary.total - result.total)).toBeGreaterThan(40)
  })

  it('total is subtotal + estimatedTax, rounded to 2 decimals', () => {
    const result = computeBestBasketTotal(planWithSpecs, noUser)
    const expectedTotal = Math.round((result.subtotal + result.estimatedTax) * 100) / 100
    expect(result.total).toBe(expectedTotal)
  })

  it('estimatedTax is 8.25% of the best-basket subtotal', () => {
    const result = computeBestBasketTotal(planWithSpecs, noUser)
    const expectedTax = Math.round(result.subtotal * 0.0825 * 100) / 100
    expect(result.estimatedTax).toBeCloseTo(expectedTax, 2)
  })

  it('winnerStoreNames lists one store name per ingredient', () => {
    const result = computeBestBasketTotal(planWithSpecs, noUser)
    // 3 specs → 3 entries
    expect(result.winnerStoreNames).toHaveLength(3)
    // The winning stores for our fixture are Aldi, HEB, HEB
    expect(result.winnerStoreNames).toContain('Aldi')
    expect(result.winnerStoreNames.filter(n => n === 'HEB')).toHaveLength(2)
  })
})

describe('computeBestBasketTotal — legacy plan without meta.specs', () => {
  it('synthesizes specs from store items and returns a sensible best-basket total', () => {
    const result = computeBestBasketTotal(planLegacy, noUser)

    // Should still compute something — same best-basket logic applies
    // Synthesized specs use 'each' unit; all candidates use unit '1 dozen' / '2 lb' / '16 oz'
    // These will be size-parsed and compared. At minimum the function returns a non-NaN total.
    expect(result.total).not.toBeNaN()
    expect(result.subtotal).toBeGreaterThan(0)

    // The recomputed total should be less than the buggy summary total
    expect(result.total).toBeLessThan(planLegacy.summary.total)
  })

  it('extractSpecs returns one spec per unique ingredientId from store items', () => {
    const specs = extractSpecs(planLegacy)
    // 3 unique ingredient IDs: eggs-spec, chicken-spec, spinach-spec
    expect(specs).toHaveLength(3)
    const ids = specs.map(s => s.id)
    expect(ids).toContain('eggs-spec')
    expect(ids).toContain('chicken-spec')
    expect(ids).toContain('spinach-spec')
  })

  it('extractSpecs synthesized specs have brandLocked:false, brand:null, unit:each', () => {
    const specs = extractSpecs(planLegacy)
    for (const spec of specs) {
      expect(spec.brandLocked).toBe(false)
      expect(spec.brand).toBeNull()
      expect(spec.unit).toBe('each')
      expect(spec.confidence).toBe('low')
      expect(spec.categoryPath).toEqual(['legacy'])
    }
  })
})

describe('computeBestBasketTotal — extractSpecs uses plan.meta.specs when present', () => {
  it('uses explicit specs from plan.meta.specs rather than synthesizing', () => {
    const specs = extractSpecs(planWithSpecs)
    // Should have 3 specs matching the explicit meta.specs
    expect(specs).toHaveLength(3)
    // Explicit specs use real units, not 'each'
    const units = specs.map(s => s.unit)
    expect(units).not.toContain('each')  // e.g. 'dozen', 'lb', 'oz' are the real units
    expect(units).toContain('dozen')
    expect(units).toContain('lb')
    expect(units).toContain('oz')
  })
})

describe('computeBestBasketTotal — estimatedTax invariant', () => {
  it('estimatedTax preserves the 8.25% rate used in plan.ts store-level calculations', () => {
    // This test guards against inadvertently changing the tax rate from what plan.ts uses
    const TAX_RATE = 0.0825
    const result = computeBestBasketTotal(planWithSpecs, noUser)
    expect(result.estimatedTax).toBeCloseTo(result.subtotal * TAX_RATE, 2)
  })
})
