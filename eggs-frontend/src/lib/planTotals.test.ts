// eggs-frontend/src/lib/planTotals.test.ts

import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPlanTotal } from './planTotals'
import type { ShoppingPlanRecord } from '../types'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<ShoppingPlanRecord> = {}): ShoppingPlanRecord {
  return {
    id: 'plan-test',
    generated_at: '2025-01-01T00:00:00Z',
    best_basket_total: null,
    plan_data: {
      id: 'plan-test',
      generatedAt: '2025-01-01T00:00:00Z',
      meta: {
        location: { lat: 32.77, lng: -96.79 },
        storesQueried: [],
        modelUsed: 'test',
        budgetMode: 'calculate'
      },
      ingredients: [],
      stores: [],
      summary: {
        subtotal: 0,
        estimatedTax: 0,
        total: 0,
        realPriceCount: 0,
        estimatedPriceCount: 0
      }
    },
    ...overrides
  }
}

function makeItem(ingredientId: string, lineTotal: number, notAvailable = false) {
  return {
    ingredientId,
    name: `Item for ${ingredientId}`,
    quantity: 1,
    unit: 'each',
    unitPrice: lineTotal,
    lineTotal,
    confidence: 'real' as const,
    shopUrl: 'https://example.com/product',
    isLoyaltyPrice: false,
    notAvailable
  }
}

function makeStore(name: string, items: ReturnType<typeof makeItem>[]) {
  const subtotal = items.filter(i => !i.notAvailable).reduce((s, i) => s + i.lineTotal, 0)
  return {
    storeName: name,
    storeBanner: name,
    storeType: 'physical' as const,
    priceSource: 'kroger_api' as const,
    items,
    subtotal,
    estimatedTax: subtotal * 0.0825,
    grandTotal: subtotal * 1.0825
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('getPlanTotal', () => {

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Case 1 — Path 1: server column is present and non-null → use it directly
  it('returns best_basket_total column when present (Path 1)', () => {
    const plan = makeRecord({ best_basket_total: 42.50 })
    expect(getPlanTotal(plan)).toBe(42.50)
  })

  // Case 2 — Path 2: null column, valid stores → recompute cheapest-per-ingredient
  it('recomputes from stores when best_basket_total is null (Path 2)', () => {
    // Single store, two ingredients
    // ing-a: $10.00, ing-b: $5.00 → subtotal = $15, total = $15 * 1.0825 = $16.24
    const plan = makeRecord({
      best_basket_total: null,
      plan_data: {
        ...makeRecord().plan_data,
        stores: [
          makeStore('Kroger', [
            makeItem('ing-a', 10.00),
            makeItem('ing-b', 5.00)
          ])
        ]
      }
    })
    const expected = Math.round(15 * 1.0825 * 100) / 100 // 16.24
    expect(getPlanTotal(plan)).toBe(expected)
  })

  // Case 3 — Path 2: cross-store cheapest-per-ingredient logic
  // 3 ingredients across 2 stores; store A cheaper on ing-1, ing-2; store B cheaper on ing-3
  it('picks cheapest per ingredient across multiple stores (Path 2)', () => {
    // Store A: ing-1=$5, ing-2=$3, ing-3=$8
    // Store B: ing-1=$7, ing-2=$4, ing-3=$2
    // Cheapest: ing-1=$5, ing-2=$3, ing-3=$2 → subtotal=$10, total=$10*1.0825=10.83
    const plan = makeRecord({
      best_basket_total: null,
      plan_data: {
        ...makeRecord().plan_data,
        stores: [
          makeStore('StoreA', [
            makeItem('ing-1', 5.00),
            makeItem('ing-2', 3.00),
            makeItem('ing-3', 8.00)
          ]),
          makeStore('StoreB', [
            makeItem('ing-1', 7.00),
            makeItem('ing-2', 4.00),
            makeItem('ing-3', 2.00)
          ])
        ]
      }
    })
    const expected = Math.round(10 * 1.0825 * 100) / 100 // 10.83
    expect(getPlanTotal(plan)).toBe(expected)
  })

  // Case 4 — Path 2: empty stores array → returns 0
  it('returns 0 when stores array is empty (Path 2 edge case)', () => {
    const plan = makeRecord({
      best_basket_total: null,
      plan_data: {
        ...makeRecord().plan_data,
        stores: []
      }
    })
    expect(getPlanTotal(plan)).toBe(0)
  })

  // Case 5 — Path 3: no stores and no best_basket_total → falls back to summary.total
  it('falls back to summary.total when plan_data has no stores (Path 3)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plan = makeRecord({
      best_basket_total: null,
      plan_data: {
        ...makeRecord().plan_data,
        stores: undefined as any,
        summary: {
          subtotal: 30,
          estimatedTax: 2.48,
          total: 32.48,
          realPriceCount: 2,
          estimatedPriceCount: 0
        }
      }
    })
    expect(getPlanTotal(plan)).toBe(32.48)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to legacy summary.total'),
      expect.any(String)
    )
  })

  // Case 6 — notAvailable items must be excluded from the per-ingredient search
  it('excludes notAvailable items from recompute (Path 2)', () => {
    // ing-a available at $10, notAvailable at $2 (should be ignored)
    // Only $10 counts → subtotal=$10, total=$10*1.0825=10.83
    const plan = makeRecord({
      best_basket_total: null,
      plan_data: {
        ...makeRecord().plan_data,
        stores: [
          makeStore('StoreA', [makeItem('ing-a', 10.00, false)]),
          makeStore('StoreB', [makeItem('ing-a', 2.00, true)])
        ]
      }
    })
    // StoreB's notAvailable item should be ignored — ing-a only has $10 available
    const expected = Math.round(10 * 1.0825 * 100) / 100 // 10.83
    expect(getPlanTotal(plan)).toBe(expected)
  })

})
