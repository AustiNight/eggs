/**
 * M5 — AI adapter pricedSize extension
 *
 * Tests the `validateAndNormalizeAiItems` pure helper extracted from
 * `searchNonApiStores`. We test the helper directly to avoid mocking the
 * Anthropic SDK.
 *
 * Design choices documented below:
 *   - Scenario 5 (invalid unit): pricedSize is nulled and confidence is
 *     downgraded to 'estimated' (same path as missing pricedSize). We do NOT
 *     throw — a single bad unit should not drop the entire item.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateAndNormalizeAiItems } from './plan.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Shared raw-item factory ───────────────────────────────────────────────────

function makeRawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ingredientId: 'ing-1',
    name: 'chicken breast',
    sku: '0001234',
    quantity: 2,
    unit: 'lb',
    unitPrice: 4.99,
    lineTotal: 9.98,
    confidence: 'real',
    shopUrl: 'https://example.com/product',
    proofUrl: 'https://www.wholefoods.com/products/chicken-breast',
    isLoyaltyPrice: false,
    nonMemberPrice: null,
    pricedSize: { quantity: 2.5, unit: 'lb' },
    ...overrides,
  }
}

// ── Scenario 1 ────────────────────────────────────────────────────────────────
// All items have valid pricedSize + confidence: 'real' → pricedSize preserved,
// confidence unchanged.

describe('validateAndNormalizeAiItems — scenario 1: real confidence with valid pricedSize', () => {
  it('preserves pricedSize and confidence unchanged', () => {
    const raw = [makeRawItem()]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.confidence).toBe('real')
    expect(item.pricedSize).toEqual({ quantity: 2.5, unit: 'lb' })
    expect(item.name).toBe('chicken breast')
    expect(item.unitPrice).toBe(4.99)
  })

  it('handles multiple items all with valid pricedSize', () => {
    const raw = [
      makeRawItem({ ingredientId: 'ing-1', name: 'chicken breast', pricedSize: { quantity: 2.5, unit: 'lb' }, confidence: 'real' }),
      makeRawItem({ ingredientId: 'ing-2', name: 'whole milk', unit: 'gal', pricedSize: { quantity: 1, unit: 'gal' }, confidence: 'real' }),
    ]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(2)
    expect(result[0].pricedSize).toEqual({ quantity: 2.5, unit: 'lb' })
    expect(result[0].confidence).toBe('real')
    expect(result[1].pricedSize).toEqual({ quantity: 1, unit: 'gal' })
    expect(result[1].confidence).toBe('real')
  })
})

// ── Scenario 2 ────────────────────────────────────────────────────────────────
// pricedSize: null + confidence: 'estimated' → null pricedSize preserved,
// confidence unchanged.

describe('validateAndNormalizeAiItems — scenario 2: estimated confidence with null pricedSize', () => {
  it('keeps pricedSize null and leaves confidence as estimated', () => {
    const raw = [makeRawItem({ pricedSize: null, confidence: 'estimated', proofUrl: null })]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.pricedSize).toBeNull()
    expect(item.confidence).toBe('estimated')
  })
})

// ── Scenario 3 ────────────────────────────────────────────────────────────────
// pricedSize: null + confidence: 'real' → downgraded to 'estimated', warning logged.

describe('validateAndNormalizeAiItems — scenario 3: real confidence with missing pricedSize → downgrade', () => {
  it('downgrades confidence to estimated and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const raw = [makeRawItem({ pricedSize: null, confidence: 'real' })]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.confidence).toBe('estimated')
    expect(item.pricedSize).toBeNull()

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/downgrading.*chicken breast.*real.*estimated/)
  })
})

// ── Scenario 4 ────────────────────────────────────────────────────────────────
// pricedSize: null + confidence: 'estimated_with_source' → downgraded to 'estimated'.

describe('validateAndNormalizeAiItems — scenario 4: estimated_with_source with null pricedSize → downgrade', () => {
  it('downgrades estimated_with_source to estimated when pricedSize is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const raw = [makeRawItem({ pricedSize: null, confidence: 'estimated_with_source' })]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.confidence).toBe('estimated')
    expect(item.pricedSize).toBeNull()

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/downgrading.*chicken breast.*estimated_with_source.*estimated/)
  })
})

// ── Scenario 5 ────────────────────────────────────────────────────────────────
// pricedSize present but unit is not a CanonicalUnit (e.g. 'invalid').
// Design choice: pricedSize is nulled (invalid unit = unknown size) and since
// pricedSize ends up null on a 'real' item, confidence is downgraded to
// 'estimated'. We do NOT throw — one bad unit should not kill the item.

describe('validateAndNormalizeAiItems — scenario 5: invalid pricedSize unit → null + downgrade', () => {
  it('nulls pricedSize and downgrades confidence for an unknown unit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const raw = [makeRawItem({ pricedSize: { quantity: 32, unit: 'invalid' }, confidence: 'real' })]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.pricedSize).toBeNull()
    expect(item.confidence).toBe('estimated')

    // Two warnings: one for unknown unit, one for confidence downgrade.
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[0][0]).toMatch(/unknown pricedSize\.unit.*invalid/)
    expect(warnSpy.mock.calls[1][0]).toMatch(/downgrading.*chicken breast.*real.*estimated/)
  })

  it('nulls pricedSize for unknown unit but leaves confidence alone when already estimated', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const raw = [makeRawItem({ pricedSize: { quantity: 32, unit: 'tbsp' }, confidence: 'estimated' })]
    const result = validateAndNormalizeAiItems(raw)

    const item = result[0]
    expect(item.pricedSize).toBeNull()
    // Already 'estimated' — no further downgrade, only the unit warning.
    expect(item.confidence).toBe('estimated')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/unknown pricedSize\.unit.*tbsp/)
  })
})

// ── Scenario 6 ────────────────────────────────────────────────────────────────
// Non-object elements (string, null, number) are skipped with a warning and
// filtered out; valid object items are returned normally.

describe('validateAndNormalizeAiItems — scenario 6: non-object items are skipped', () => {
  it('filters out non-object elements and logs a warning for each', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const raw = [makeRawItem(), 'not an object', null, 42]
    const result = validateAndNormalizeAiItems(raw)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('chicken breast')

    // One warning per non-object element (string, null, number = 3).
    expect(warnSpy).toHaveBeenCalledTimes(3)
    expect(warnSpy.mock.calls[0][0]).toMatch(/skipping non-object item/)
    expect(warnSpy.mock.calls[1][0]).toMatch(/skipping non-object item/)
    expect(warnSpy.mock.calls[2][0]).toMatch(/skipping non-object item/)
  })
})

// ── Additional edge cases ─────────────────────────────────────────────────────

describe('validateAndNormalizeAiItems — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(validateAndNormalizeAiItems([])).toEqual([])
  })

  it('accepts all canonical units without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const canonicalUnits = ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'cup', 'pt', 'qt', 'gal', 'each', 'dozen', 'bunch', 'head', 'clove', 'pinch'] as const

    for (const unit of canonicalUnits) {
      const raw = [makeRawItem({ pricedSize: { quantity: 1, unit }, confidence: 'real' })]
      const result = validateAndNormalizeAiItems(raw)
      expect(result[0].pricedSize?.unit).toBe(unit)
    }

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('passes through non-pricedSize fields unchanged', () => {
    const raw = [makeRawItem({
      pricedSize: { quantity: 64, unit: 'fl_oz' },
      confidence: 'estimated_with_source',
      sku: 'SKU-999',
      unitPrice: 3.49,
      lineTotal: 6.98,
      isLoyaltyPrice: true,
      nonMemberPrice: 4.29,
    })]
    const result = validateAndNormalizeAiItems(raw)
    const item = result[0]

    expect(item.sku).toBe('SKU-999')
    expect(item.unitPrice).toBe(3.49)
    expect(item.lineTotal).toBe(6.98)
    expect(item.isLoyaltyPrice).toBe(true)
    expect(item.nonMemberPrice).toBe(4.29)
    expect(item.pricedSize).toEqual({ quantity: 64, unit: 'fl_oz' })
    expect(item.confidence).toBe('estimated_with_source')
  })
})
