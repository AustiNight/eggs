/**
 * planTotalsView — pure helpers for the best-basket UI total computation.
 *
 * Extracted from PlanResult.tsx so they can be unit-tested in isolation
 * (Fix 8 from M9 review: real test coverage instead of mirrored duplicates).
 */
import type { WinnerResult, Candidate } from '../types'

export const TAX_RATE = 0.0825

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Resolve which Candidate to display for a given spec.
 * Returns the override if one exists, else the plan winner, else null.
 */
export function resolveWinner(
  specId: string,
  winners: WinnerResult[],
  overrides: Record<string, Candidate>
): Candidate | null {
  if (specId in overrides) return overrides[specId]
  return winners.find(w => w.spec.id === specId)?.winner ?? null
}

/**
 * Compute the displayed total (subtotal + tax) from the current overrides
 * + plan winners. Matches the useMemo logic in BestBasketView.
 */
export function computeDisplayedTotal(
  winners: WinnerResult[],
  overrides: Record<string, Candidate>
): number {
  let sub = 0
  for (const wr of winners) {
    const specId = wr.spec.id
    const current = specId in overrides ? overrides[specId] : wr.winner
    sub += current?.item.lineTotal ?? 0
  }
  return round2(round2(sub) * (1 + TAX_RATE))
}
