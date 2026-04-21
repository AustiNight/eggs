/**
 * plan.boundary.test.ts — boundary-validation tests for ShoppableItemSpecInput.
 *
 * Fix 1 from M9 review: validateSpecInput is the API boundary guard that prevents
 * a malformed resolvedSpecs payload (e.g. { unit: 'pineapple' }) from silently
 * producing $0 item contributions in selectWinner.
 */
import { describe, it, expect } from 'vitest'
import { validateSpecInput } from './spec.js'

// ─── Valid mirror fixture (all required fields) ───────────────────────────────

const validMirror = {
  id: 'spec-eggs',
  sourceText: 'eggs',
  displayName: 'Large Eggs',
  brand: null,
  brandLocked: false,
  quantity: 1,
  unit: 'dozen',
} as const

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('validateSpecInput — happy paths', () => {
  it('accepts a valid mirror with all required fields', () => {
    expect(() => validateSpecInput(validMirror)).not.toThrow()
    const result = validateSpecInput(validMirror)
    expect(result.id).toBe('spec-eggs')
    expect(result.unit).toBe('dozen')
    // Optional fields default correctly
    expect(result.sourceText).toBe('eggs')
    expect(result.categoryPath).toEqual([])
    expect(result.resolutionTrace).toEqual([])
    expect(result.confidence).toBe('medium')
  })

  it('accepts optional fields when present', () => {
    const withOptionals = {
      ...validMirror,
      usdaFdcId: 12345,
      upc: '012345678901',
      attributes: { fat_content: '3.25%' },
      categoryPath: ['produce', 'eggs'],
      confidence: 'high' as const,
    }
    expect(() => validateSpecInput(withOptionals)).not.toThrow()
    const result = validateSpecInput(withOptionals)
    expect(result.usdaFdcId).toBe(12345)
    expect(result.categoryPath).toEqual(['produce', 'eggs'])
    expect(result.confidence).toBe('high')
  })

  it('accepts brand-locked spec with a string brand', () => {
    const brandLocked = { ...validMirror, brand: 'Kirkland', brandLocked: true }
    expect(() => validateSpecInput(brandLocked)).not.toThrow()
    const result = validateSpecInput(brandLocked)
    expect(result.brand).toBe('Kirkland')
    expect(result.brandLocked).toBe(true)
  })
})

// ─── Missing required fields ──────────────────────────────────────────────────

describe('validateSpecInput — missing required fields', () => {
  it('throws when unit field is missing', () => {
    const bad = { ...validMirror, unit: undefined }
    expect(() => validateSpecInput(bad)).toThrow(/ShoppableItemSpecInput validation failed/)
  })

  it('throws when displayName field is missing', () => {
    const { displayName: _omit, ...bad } = validMirror as Record<string, unknown>
    expect(() => validateSpecInput(bad)).toThrow()
  })

  it('throws when id field is empty string', () => {
    const bad = { ...validMirror, id: '' }
    expect(() => validateSpecInput(bad)).toThrow()
  })
})

// ─── Invalid unit ─────────────────────────────────────────────────────────────

describe('validateSpecInput — invalid unit', () => {
  it('throws when unit is "pineapple" (not a CanonicalUnit)', () => {
    const bad = { ...validMirror, unit: 'pineapple' }
    expect(() => validateSpecInput(bad)).toThrow(/ShoppableItemSpecInput validation failed/)
    expect(() => validateSpecInput(bad)).toThrow(/unit/)
  })

  it('throws when unit is "ton" (not a CanonicalUnit)', () => {
    const bad = { ...validMirror, unit: 'ton' }
    expect(() => validateSpecInput(bad)).toThrow()
  })
})

// ─── Brand/brandLocked invariant ──────────────────────────────────────────────

describe('validateSpecInput — brand/brandLocked invariant', () => {
  it('throws when brand is null and brandLocked is true', () => {
    const bad = { ...validMirror, brand: null, brandLocked: true }
    expect(() => validateSpecInput(bad)).toThrow(/ShoppableItemSpecInput validation failed/)
    expect(() => validateSpecInput(bad)).toThrow(/brand/)
  })

  it('throws when brand is a string and brandLocked is false', () => {
    const bad = { ...validMirror, brand: 'Kirkland', brandLocked: false }
    expect(() => validateSpecInput(bad)).toThrow(/ShoppableItemSpecInput validation failed/)
    expect(() => validateSpecInput(bad)).toThrow(/brandLocked/)
  })
})

// ─── Quantity invariant ───────────────────────────────────────────────────────

describe('validateSpecInput — quantity invariant', () => {
  it('throws when quantity is 0', () => {
    const bad = { ...validMirror, quantity: 0 }
    expect(() => validateSpecInput(bad)).toThrow()
  })

  it('throws when quantity is negative', () => {
    const bad = { ...validMirror, quantity: -1 }
    expect(() => validateSpecInput(bad)).toThrow()
  })

  it('throws when quantity is Infinity', () => {
    const bad = { ...validMirror, quantity: Infinity }
    expect(() => validateSpecInput(bad)).toThrow()
  })
})
