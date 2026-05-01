import { describe, it, expect } from 'vitest'
import { convertQuantity, packagesNeeded, formatPricePerBase, comparisonNote, unitLabel } from './displayUnits'

describe('displayUnits', () => {
  // convertQuantity
  it('converts lb → oz', () => expect(convertQuantity(1, 'lb', 'oz')).toBeCloseTo(16, 3))
  it('converts kg → g', () => expect(convertQuantity(1, 'kg', 'g')).toBe(1000))
  it('returns null for cross-dimension', () => expect(convertQuantity(1, 'lb', 'fl oz')).toBeNull())
  it('returns null for unknown unit', () => expect(convertQuantity(1, 'foo', 'g')).toBeNull())

  // packagesNeeded
  it('1 lb spec, 1 lb package → 1', () => expect(packagesNeeded({ quantity: 1, unit: 'lb' }, { quantity: 1, unit: 'lb' })).toBe(1))
  it('2 lb spec, 1 lb package → 2', () => expect(packagesNeeded({ quantity: 2, unit: 'lb' }, { quantity: 1, unit: 'lb' })).toBe(2))
  it('5 lb spec, 1.25 lb cylinder → 4 (ceil 5/1.25)', () => expect(packagesNeeded({ quantity: 5, unit: 'lb' }, { quantity: 1.25, unit: 'lb' })).toBe(4))
  it('null pricedSize → 1', () => expect(packagesNeeded({ quantity: 1, unit: 'lb' }, null)).toBe(1))
  it('dimension mismatch → 1', () => expect(packagesNeeded({ quantity: 1, unit: 'count' }, { quantity: 1, unit: 'lb' })).toBe(1))

  // formatPricePerBase
  it('mass → $/g', () => expect(formatPricePerBase(0.0044, 'lb')).toBe('$0.0044/g'))
  it('volume → $/mL', () => expect(formatPricePerBase(0.0009, 'gallon')).toBe('$0.0009/mL'))
  it('count → $/each', () => expect(formatPricePerBase(0.42, 'each')).toBe('$0.42/each'))

  // comparisonNote
  it('identical → null', () => expect(comparisonNote({ quantity: 1, unit: 'lb' }, { quantity: 1, unit: 'lb' }, 1)).toBeNull())
  it('package contains slightly more → "slightly more" copy', () => {
    const note = comparisonNote({ quantity: 1, unit: 'lb' }, { quantity: 1.25, unit: 'lb' }, 1)
    expect(note).toMatch(/slightly more/)
  })
  it('multiple packages → "buying N packages" copy', () => {
    // 3 × 1.25 lb = 3.75 lb < 5 lb spec — undershoot triggers "buying N packages covers" copy
    const note = comparisonNote({ quantity: 5, unit: 'lb' }, { quantity: 1.25, unit: 'lb' }, 3)
    expect(note).not.toBeNull()
    expect(note!).toMatch(/3 packages/)
  })
  it('dimension mismatch → falls back to literal description', () => {
    const note = comparisonNote({ quantity: 1, unit: 'count' }, { quantity: 1, unit: 'lb' }, 1)
    expect(note).not.toBeNull()
    expect(note).toMatch(/package contains/)
  })

  // unitLabel
  it('formats qty + unit', () => expect(unitLabel(1.25, 'lb')).toBe('1.25 lb'))
})
