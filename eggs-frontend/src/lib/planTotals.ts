// Inspired by M9's planTotalsView.ts. Keep imports minimal and types strict.
import type { ShoppingPlanRecord, ShoppingPlan } from '../types'

const TAX_RATE = 0.0825

/**
 * Returns the best-basket total for a historical plan.
 *
 * Priority:
 *   1. plan.best_basket_total column (post-M8 plans written with SHOPPING_V2 on).
 *   2. Client-side recompute from plan_data.stores — cheapest lineTotal per
 *      ingredientId (simplification: no brand filter or unit normalization).
 *   3. Last-resort: plan.plan_data.summary.total (the legacy bugged value)
 *      with console.warn.
 */
export function getPlanTotal(plan: ShoppingPlanRecord): number {
  // Path 1: column (may be null on legacy rows or when SHOPPING_V2 was off at write time)
  if (typeof plan.best_basket_total === 'number' && !isNaN(plan.best_basket_total)) {
    return plan.best_basket_total
  }

  // Path 2: recompute from stores
  const planData = plan.plan_data
  if (planData && planData.stores && Array.isArray(planData.stores)) {
    try {
      return recomputeTotalFromStores(planData)
    } catch (err) {
      console.warn('[getPlanTotal] recompute failed, falling back to legacy summary.total:', err)
    }
  }

  // Path 3: last-resort legacy fallback
  const legacyTotal = planData?.summary?.total
  if (typeof legacyTotal === 'number' && !isNaN(legacyTotal)) {
    console.warn('[getPlanTotal] using legacy summary.total — recompute unavailable')
    return legacyTotal
  }

  return 0
}

function recomputeTotalFromStores(plan: ShoppingPlan): number {
  const bestPerIngredient = new Map<string, number>()
  for (const store of plan.stores ?? []) {
    for (const item of store.items ?? []) {
      if (item.notAvailable) continue
      if (typeof item.lineTotal !== 'number' || isNaN(item.lineTotal)) continue
      const prev = bestPerIngredient.get(item.ingredientId) ?? Infinity
      if (item.lineTotal < prev) {
        bestPerIngredient.set(item.ingredientId, item.lineTotal)
      }
    }
  }
  const subtotal = Array.from(bestPerIngredient.values()).reduce((a, b) => a + b, 0)
  const total = subtotal * (1 + TAX_RATE)
  return Math.round(total * 100) / 100
}
