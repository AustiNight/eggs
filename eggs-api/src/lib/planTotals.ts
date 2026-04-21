/**
 * Plan totals selector — M8
 *
 * computeBestBasketTotal() recomputes the correct plan total by running
 * selectWinner() per spec and summing only the winning item's lineTotal.
 * This replaces the legacy "sum every store's subtotal" bug that 4.5× inflated totals.
 *
 * Pure function — no side effects, no I/O.
 */

import type { ShoppingPlan, UserProfile } from '../types/index.js'
import type { ShoppableItemSpec } from '../types/spec.js'
import { selectWinner } from './bestValue.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tax rate matching plan.ts store-level calculations (8.25%). */
const TAX_RATE = 0.0825

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BestBasketTotals {
  /** Sum of winner lineTotals across all specs. */
  subtotal: number
  /** TAX_RATE % of subtotal, rounded to 2 decimals. */
  estimatedTax: number
  /** subtotal + estimatedTax, rounded to 2 decimals. */
  total: number
  /** Winning store name per spec, order-preserving. 'none' when no winner found. */
  winnerStoreNames: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Extract ShoppableItemSpecs from a plan.
 *
 * Strategy:
 *   1. If plan.meta.specs exists and is a non-empty array, use them (M6/M7+ plans).
 *   2. Otherwise, synthesize one minimal spec per unique ingredientId found across
 *      all store items. These synthetic specs have brandLocked: false, brand: null,
 *      unit: 'each', quantity: 1 — enough for selectWinner to price-shop without
 *      brand filtering.
 */
export function extractSpecs(plan: ShoppingPlan): ShoppableItemSpec[] {
  // Path 1: explicit specs from plan metadata
  if (
    plan.meta.specs &&
    Array.isArray(plan.meta.specs) &&
    plan.meta.specs.length > 0
  ) {
    return plan.meta.specs
  }

  // Path 2: synthesize from store items
  const seen = new Map<string, ShoppableItemSpec>()

  for (const store of plan.stores) {
    for (const item of store.items) {
      if (seen.has(item.ingredientId)) continue

      // Use ingredient name from the ingredients list if available
      const ingredient = plan.ingredients.find(i => i.id === item.ingredientId)
      const displayName = ingredient?.name ?? item.name

      seen.set(item.ingredientId, {
        id: item.ingredientId,
        sourceText: item.name,
        displayName,
        categoryPath: ['legacy'],
        brand: null,
        brandLocked: false,
        quantity: 1,
        unit: 'each',
        resolutionTrace: [],
        confidence: 'low',
      })
    }
  }

  return Array.from(seen.values())
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the best-basket total for a shopping plan.
 *
 * Algorithm:
 *   1. Extract (or synthesize) specs via extractSpecs().
 *   2. For each spec, run selectWinner() across plan.stores.
 *   3. Sum winner.item.lineTotal (0 when no winner found for a spec).
 *   4. Compute tax at TAX_RATE and round to 2 decimals.
 */
export function computeBestBasketTotal(
  plan: ShoppingPlan,
  user: UserProfile,
): BestBasketTotals {
  const specs = extractSpecs(plan)

  const winnerStoreNames: string[] = []
  let subtotalRaw = 0

  for (const spec of specs) {
    const result = selectWinner(spec, plan.stores, user)
    if (result.winner !== null) {
      subtotalRaw += result.winner.item.lineTotal
      winnerStoreNames.push(result.winner.storeName)
    } else {
      winnerStoreNames.push('none')
    }
  }

  const subtotal = round2(subtotalRaw)
  const estimatedTax = round2(subtotal * TAX_RATE)
  const total = round2(subtotal + estimatedTax)

  return { subtotal, estimatedTax, total, winnerStoreNames }
}
