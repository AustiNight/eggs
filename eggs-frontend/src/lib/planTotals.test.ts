import { describe, it, expect } from 'vitest'
import { getPlanTotal } from './planTotals'
import type { ShoppingPlanRecord } from '../types'

// Minimal fixture helpers — only include fields that getPlanTotal actually reads.
function makePlan(overrides: Partial<ShoppingPlanRecord> = {}): ShoppingPlanRecord {
  return {
    id: 'test-plan',
    generated_at: '2025-01-01T00:00:00Z',
    plan_data: {
      id: 'plan-data',
      generatedAt: '2025-01-01T00:00:00Z',
      meta: {
        location: { lat: 32, lng: -96 },
        storesQueried: [],
        modelUsed: 'test',
        budgetMode: 'calculate',
      },
      ingredients: [],
      stores: [],
      summary: { subtotal: 0, estimatedTax: 0, total: 0, realPriceCount: 0, estimatedPriceCount: 0 },
    },
    ...overrides,
  }
}

// ─── Test 1: Path 1 — best_basket_total column present ───────────────────────

describe('getPlanTotal', () => {
  it('returns best_basket_total directly when present (Path 1)', () => {
    const plan = makePlan({ best_basket_total: 42.50 })
    expect(getPlanTotal(plan)).toBe(42.50)
  })

  // ─── Test 2: Path 2 — recompute from stores when column is null ────────────

  it('recomputes cheapest-per-ingredient from stores when best_basket_total is null', () => {
    // Single store, two items: $10 and $5 → subtotal $15 × 1.0825 = $16.24
    const plan = makePlan({
      best_basket_total: null,
      plan_data: {
        ...makePlan().plan_data,
        stores: [
          {
            storeName: 'Kroger',
            storeBanner: 'Kroger',
            storeType: 'physical',
            priceSource: 'kroger_api',
            items: [
              { ingredientId: 'ing-1', name: 'Eggs', quantity: 1, unit: 'dozen', unitPrice: 10, lineTotal: 10, confidence: 'real', isLoyaltyPrice: false },
              { ingredientId: 'ing-2', name: 'Milk', quantity: 1, unit: 'gal', unitPrice: 5, lineTotal: 5, confidence: 'real', isLoyaltyPrice: false },
            ],
            subtotal: 15,
            estimatedTax: 1.24,
            grandTotal: 16.24,
          },
        ],
      },
    })
    // 15 × 1.0825 = 16.2375 → rounded to 16.24
    expect(getPlanTotal(plan)).toBeCloseTo(16.24, 2)
  })

  // ─── Test 3: Cross-store cheapest-per-ingredient selection ─────────────────

  it('picks cheapest per ingredient across multiple stores', () => {
    // ing-1: Store A $8, Store B $10 → pick $8
    // ing-2: Store A $6, Store B $4  → pick $4
    // ing-3: Store A $12, Store B $9 → pick $9
    // cheapest sum = $8 + $4 + $9 = $21 → $21 × 1.0825 = $22.73 (rounded)
    const plan = makePlan({
      best_basket_total: null,
      plan_data: {
        ...makePlan().plan_data,
        stores: [
          {
            storeName: 'Store A',
            storeBanner: 'Store A',
            storeType: 'physical',
            priceSource: 'kroger_api',
            items: [
              { ingredientId: 'ing-1', name: 'Item 1', quantity: 1, unit: 'ea', unitPrice: 8, lineTotal: 8, confidence: 'real', isLoyaltyPrice: false },
              { ingredientId: 'ing-2', name: 'Item 2', quantity: 1, unit: 'ea', unitPrice: 6, lineTotal: 6, confidence: 'real', isLoyaltyPrice: false },
              { ingredientId: 'ing-3', name: 'Item 3', quantity: 1, unit: 'ea', unitPrice: 12, lineTotal: 12, confidence: 'real', isLoyaltyPrice: false },
            ],
            subtotal: 26,
            estimatedTax: 0,
            grandTotal: 26,
          },
          {
            storeName: 'Store B',
            storeBanner: 'Store B',
            storeType: 'physical',
            priceSource: 'walmart_api',
            items: [
              { ingredientId: 'ing-1', name: 'Item 1', quantity: 1, unit: 'ea', unitPrice: 10, lineTotal: 10, confidence: 'real', isLoyaltyPrice: false },
              { ingredientId: 'ing-2', name: 'Item 2', quantity: 1, unit: 'ea', unitPrice: 4, lineTotal: 4, confidence: 'real', isLoyaltyPrice: false },
              { ingredientId: 'ing-3', name: 'Item 3', quantity: 1, unit: 'ea', unitPrice: 9, lineTotal: 9, confidence: 'real', isLoyaltyPrice: false },
            ],
            subtotal: 23,
            estimatedTax: 0,
            grandTotal: 23,
          },
        ],
      },
    })
    // $21 × 1.0825 = 22.7325 → 22.73
    expect(getPlanTotal(plan)).toBeCloseTo(22.73, 2)
  })

  // ─── Test 4: Empty stores array → returns 0 ────────────────────────────────

  it('returns 0 when best_basket_total is null and stores array is empty', () => {
    const plan = makePlan({
      best_basket_total: null,
      plan_data: {
        ...makePlan().plan_data,
        stores: [],
        summary: { subtotal: 0, estimatedTax: 0, total: 0, realPriceCount: 0, estimatedPriceCount: 0 },
      },
    })
    expect(getPlanTotal(plan)).toBe(0)
  })

  // ─── Test 5: plan_data undefined/missing stores → legacy fallback ──────────

  it('falls back to legacy summary.total when plan_data has no stores', () => {
    const plan = makePlan({
      best_basket_total: null,
      plan_data: {
        ...makePlan().plan_data,
        stores: undefined as unknown as never[],
        summary: { subtotal: 90, estimatedTax: 7.42, total: 55.99, realPriceCount: 3, estimatedPriceCount: 0 },
      },
    })
    expect(getPlanTotal(plan)).toBe(55.99)
  })

  // ─── Test 6: notAvailable items are excluded ────────────────────────────────

  it('excludes notAvailable items from per-ingredient search', () => {
    // ing-1: $10 notAvailable in Store A, $15 available in Store B → picks $15
    // ing-2: $5 available in Store A → picks $5
    // sum = $20 × 1.0825 = 21.65
    const plan = makePlan({
      best_basket_total: null,
      plan_data: {
        ...makePlan().plan_data,
        stores: [
          {
            storeName: 'Store A',
            storeBanner: 'Store A',
            storeType: 'physical',
            priceSource: 'kroger_api',
            items: [
              { ingredientId: 'ing-1', name: 'Item 1', quantity: 1, unit: 'ea', unitPrice: 10, lineTotal: 10, confidence: 'real', isLoyaltyPrice: false, notAvailable: true },
              { ingredientId: 'ing-2', name: 'Item 2', quantity: 1, unit: 'ea', unitPrice: 5, lineTotal: 5, confidence: 'real', isLoyaltyPrice: false },
            ],
            subtotal: 5,
            estimatedTax: 0,
            grandTotal: 5,
          },
          {
            storeName: 'Store B',
            storeBanner: 'Store B',
            storeType: 'physical',
            priceSource: 'walmart_api',
            items: [
              { ingredientId: 'ing-1', name: 'Item 1', quantity: 1, unit: 'ea', unitPrice: 15, lineTotal: 15, confidence: 'real', isLoyaltyPrice: false },
            ],
            subtotal: 15,
            estimatedTax: 0,
            grandTotal: 15,
          },
        ],
      },
    })
    // $20 × 1.0825 = 21.65
    expect(getPlanTotal(plan)).toBeCloseTo(21.65, 2)
  })
})
