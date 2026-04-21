/**
 * M9 unit tests — pure helper logic for the best-basket UI.
 *
 * Tests cover:
 *   1. resolveWinner respects explicit override
 *   2. resolveWinner falls back to plan winner when no override
 *   3. resolveWinner returns null when plan has no winner and no override
 *   4. computeDisplayedTotal sums overridden + non-overridden winners correctly
 *   5. computeDisplayedTotal handles null winners (no-match items) gracefully
 */
import { describe, it, expect } from 'vitest'
import type { WinnerResult, Candidate } from '../../types'

// ─── Pure helpers (mirrors PlanResult.tsx logic) ──────────────────────────────
// Extracted as pure functions here for isolated testing.

const TAX_RATE = 0.0825

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Resolve which Candidate to display for a given spec.
 * Mirrors PlanResult.tsx `resolveWinner` inline logic.
 */
function resolveWinner(
  specId: string,
  winners: WinnerResult[],
  overrides: Record<string, Candidate | null>
): Candidate | null {
  if (specId in overrides) return overrides[specId]
  return winners.find(w => w.spec.id === specId)?.winner ?? null
}

/**
 * Compute the displayed total from current overrides + plan winners.
 * Mirrors PlanResult.tsx `displayedTotal` useMemo logic.
 */
function computeDisplayedTotal(
  winners: WinnerResult[],
  overrides: Record<string, Candidate | null>
): number {
  let sub = 0
  for (const wr of winners) {
    const specId = wr.spec.id
    const current = specId in overrides ? overrides[specId] : wr.winner
    sub += current?.item.lineTotal ?? 0
  }
  return round2(round2(sub) * (1 + TAX_RATE))
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidate(storeName: string, lineTotal: number, unitPrice: number): Candidate {
  return {
    storeName,
    storeBanner: storeName,
    distanceMiles: 1.2,
    item: {
      ingredientId: 'ing-1',
      name: 'Whole Milk 1gal',
      quantity: 1,
      unit: 'gal',
      unitPrice,
      lineTotal,
      confidence: 'real',
      shopUrl: `https://${storeName.toLowerCase()}.com/product/1`,
      isLoyaltyPrice: false,
      pricedSize: null
    },
    parsedSize: { quantity: 1, unit: 'gal' },
    pricePerBase: unitPrice / 3785.41
  }
}

function makeWinnerResult(specId: string, winner: Candidate | null, eligibleCandidates: Candidate[] = []): WinnerResult {
  return {
    spec: {
      id: specId,
      sourceText: 'whole milk',
      displayName: 'Whole Milk',
      brand: null,
      brandLocked: false,
      quantity: 1,
      unit: 'gal'
    },
    winner,
    eligibleCandidates,
    allCandidates: winner ? [winner, ...eligibleCandidates] : eligibleCandidates
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveWinner', () => {
  it('returns the override candidate when an override exists for the spec', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const walmart = makeCandidate('Walmart', 3.49, 3.49)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger, [walmart])]
    const overrides: Record<string, Candidate | null> = { 'spec-1': walmart }

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBe(walmart)
  })

  it('returns the plan winner when no override exists', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger)]
    const overrides: Record<string, Candidate | null> = {}

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBe(kroger)
  })

  it('returns null when plan winner is null and no override exists', () => {
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', null)]
    const overrides: Record<string, Candidate | null> = {}

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBeNull()
  })

  it('returns null when override is explicitly null (user cleared winner)', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger)]
    const overrides: Record<string, Candidate | null> = { 'spec-1': null }

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBeNull()
  })
})

describe('computeDisplayedTotal', () => {
  it('sums all plan winners with tax when no overrides', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)    // milk
    const target = makeCandidate('Target', 5.49, 5.49)    // butter

    const winners: WinnerResult[] = [
      makeWinnerResult('spec-milk', kroger),
      makeWinnerResult('spec-butter', target)
    ]
    const overrides: Record<string, Candidate | null> = {}

    const total = computeDisplayedTotal(winners, overrides)
    // subtotal = 3.99 + 5.49 = 9.48; tax = 9.48 * 0.0825 = 0.7821 → 0.78; total = 10.26
    expect(total).toBe(round2(round2(3.99 + 5.49) * (1 + TAX_RATE)))
  })

  it('uses overridden candidate instead of plan winner', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const walmart = makeCandidate('Walmart', 3.49, 3.49)
    const target = makeCandidate('Target', 5.49, 5.49)

    const winners: WinnerResult[] = [
      makeWinnerResult('spec-milk', kroger, [walmart]),
      makeWinnerResult('spec-butter', target)
    ]
    // User swaps milk to Walmart
    const overrides: Record<string, Candidate | null> = { 'spec-milk': walmart }

    const total = computeDisplayedTotal(winners, overrides)
    expect(total).toBe(round2(round2(3.49 + 5.49) * (1 + TAX_RATE)))
  })

  it('treats null winners as $0 contribution', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const winners: WinnerResult[] = [
      makeWinnerResult('spec-milk', kroger),
      makeWinnerResult('spec-truffle', null)  // no match anywhere
    ]
    const overrides: Record<string, Candidate | null> = {}

    const total = computeDisplayedTotal(winners, overrides)
    expect(total).toBe(round2(round2(3.99) * (1 + TAX_RATE)))
  })
})
