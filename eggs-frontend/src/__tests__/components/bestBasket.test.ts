/**
 * M9 unit tests — pure helper logic for the best-basket UI.
 *
 * Tests cover:
 *   1. resolveWinner respects explicit override
 *   2. resolveWinner falls back to plan winner when no override
 *   3. resolveWinner returns null when plan has no winner and no override
 *   4. resolveWinner returns plan winner when key deleted (swap-back, Fix 2)
 *   5. computeDisplayedTotal sums overridden + non-overridden winners correctly
 *   6. computeDisplayedTotal handles null winners (no-match items) gracefully
 *   7. computeDisplayedTotal reflects swap-back to original winner (Fix 2)
 *
 * Helpers are imported from the real production module (Fix 8) — not mirrored.
 */
import { describe, it, expect } from 'vitest'
import type { WinnerResult, Candidate } from '../../types'
import { resolveWinner, computeDisplayedTotal, round2, TAX_RATE } from '../../lib/planTotalsView'

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

// ─── resolveWinner tests ──────────────────────────────────────────────────────

describe('resolveWinner', () => {
  it('returns the override candidate when an override exists for the spec', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const walmart = makeCandidate('Walmart', 3.49, 3.49)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger, [walmart])]
    const overrides: Record<string, Candidate> = { 'spec-1': walmart }

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBe(walmart)
  })

  it('returns the plan winner when no override exists', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger)]
    const overrides: Record<string, Candidate> = {}

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBe(kroger)
  })

  it('returns null when plan winner is null and no override exists', () => {
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', null)]
    const overrides: Record<string, Candidate> = {}

    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBeNull()
  })

  it('returns plan winner after key is deleted from overrides (swap-back, Fix 2)', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const walmart = makeCandidate('Walmart', 3.49, 3.49)
    const winners: WinnerResult[] = [makeWinnerResult('spec-1', kroger, [walmart])]

    // Simulate: user swapped to walmart, then swapped back to original (key deleted)
    const overrides: Record<string, Candidate> = {}
    // No key for 'spec-1' → falls back to plan winner
    const result = resolveWinner('spec-1', winners, overrides)
    expect(result).toBe(kroger)
  })
})

// ─── computeDisplayedTotal tests ─────────────────────────────────────────────

describe('computeDisplayedTotal', () => {
  it('sums all plan winners with tax when no overrides', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)    // milk
    const target = makeCandidate('Target', 5.49, 5.49)    // butter

    const winners: WinnerResult[] = [
      makeWinnerResult('spec-milk', kroger),
      makeWinnerResult('spec-butter', target)
    ]
    const overrides: Record<string, Candidate> = {}

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
    const overrides: Record<string, Candidate> = { 'spec-milk': walmart }

    const total = computeDisplayedTotal(winners, overrides)
    expect(total).toBe(round2(round2(3.49 + 5.49) * (1 + TAX_RATE)))
  })

  it('treats null winners as $0 contribution', () => {
    const kroger = makeCandidate('Kroger', 3.99, 3.99)
    const winners: WinnerResult[] = [
      makeWinnerResult('spec-milk', kroger),
      makeWinnerResult('spec-truffle', null)  // no match anywhere
    ]
    const overrides: Record<string, Candidate> = {}

    const total = computeDisplayedTotal(winners, overrides)
    expect(total).toBe(round2(round2(3.99) * (1 + TAX_RATE)))
  })

  it('reverts to original winner price after key deleted from overrides (swap-back, Fix 2)', () => {
    const kroger = makeCandidate('Kroger', 4.50, 4.50)
    const walmart = makeCandidate('Walmart', 3.49, 3.49)

    const winners: WinnerResult[] = [makeWinnerResult('spec-milk', kroger, [walmart])]

    // Overridden → Walmart
    const withOverride: Record<string, Candidate> = { 'spec-milk': walmart }
    const totalOverridden = computeDisplayedTotal(winners, withOverride)
    expect(totalOverridden).toBe(round2(round2(3.49) * (1 + TAX_RATE)))

    // Swap back → key deleted, original Kroger should be used
    const afterSwapBack: Record<string, Candidate> = {}
    const totalOriginal = computeDisplayedTotal(winners, afterSwapBack)
    expect(totalOriginal).toBe(round2(round2(4.50) * (1 + TAX_RATE)))
    expect(totalOriginal).toBeGreaterThan(totalOverridden)
  })
})
