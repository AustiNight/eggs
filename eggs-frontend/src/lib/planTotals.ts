// eggs-frontend/src/lib/planTotals.ts
// Client-side mirror of the server's best-basket total selector.

import type { ShoppingPlanRecord } from '../types'

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Recomputes the best-basket total from raw store data.
 *
 * For each unique ingredientId across all stores, picks the cheapest available
 * item's lineTotal. Sums them, adds 8.25% tax, rounds to 2 decimal places.
 *
 * This is a simplified client-side mirror of the server's computeBestBasketTotal.
 * It does cheapest-per-ingredient without brand filtering or unit normalization.
 * That is intentional — legacy plans are display-only, so an approximation suffices.
 */
function recomputeTotalFromStores(plan: ShoppingPlanRecord['plan_data']): number {
  const bestPerIngredient = new Map<string, number>()
  for (const store of plan.stores ?? []) {
    for (const item of store.items ?? []) {
      if (item.notAvailable) continue
      const prev = bestPerIngredient.get(item.ingredientId) ?? Infinity
      if (item.lineTotal < prev) {
        bestPerIngredient.set(item.ingredientId, item.lineTotal)
      }
    }
  }
  const subtotal = Array.from(bestPerIngredient.values()).reduce((a, b) => a + b, 0)
  const total = subtotal * 1.0825
  return Math.round(total * 100) / 100
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best-basket total for a historical plan row.
 *
 * Priority:
 *   1. `plan.best_basket_total` column (post-M8 plans, when server-side
 *      SHOPPING_V2 was on at write time).
 *   2. Recompute from `plan.plan_data.stores` via client-side mirror of
 *      the selectWinner / computeBestBasketTotal logic.
 *   3. If recompute fails (malformed/missing data), fall back to
 *      `plan.plan_data.summary.total` (the legacy bugged value) as a
 *      last-resort display value, with a console warning.
 */
export function getPlanTotal(plan: ShoppingPlanRecord): number {
  // Path 1 — prefer the server-computed column when available
  if (typeof plan.best_basket_total === 'number' && plan.best_basket_total >= 0) {
    return plan.best_basket_total
  }

  // Path 2 — recompute from stores when plan_data is present
  if (plan.plan_data?.stores) {
    return recomputeTotalFromStores(plan.plan_data)
  }

  // Path 3 — last-resort: use the legacy bugged summary.total
  const fallback = plan.plan_data?.summary?.total
  if (typeof fallback === 'number') {
    console.warn('[getPlanTotal] falling back to legacy summary.total for plan', plan.id)
    return fallback
  }

  return 0
}
