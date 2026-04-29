// ─── stripUnitNoise tests ──────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { stripUnitNoise } from './queryStrip.js'

describe('stripUnitNoise', () => {
  it('strips leading count + unit container words', () => {
    expect(stripUnitNoise('1 head garlic')).toBe('garlic')
  })

  it('strips plural container words', () => {
    expect(stripUnitNoise('2 cans tomato paste')).toBe('tomato paste')
  })

  it('strips weight units', () => {
    expect(stripUnitNoise('16 oz chicken breast')).toBe('chicken breast')
  })

  it('is a no-op when no noise words are present', () => {
    expect(stripUnitNoise('organic chicken breast')).toBe('organic chicken breast')
  })

  it('preserves semantic modifiers like "fresh" and "organic"', () => {
    expect(stripUnitNoise('fresh organic spinach')).toBe('fresh organic spinach')
  })

  it('strips volume units', () => {
    expect(stripUnitNoise('1 gallon whole milk')).toBe('whole milk')
  })

  it('lowercases the result', () => {
    expect(stripUnitNoise('2 Bags Baby Carrots')).toBe('baby carrots')
  })
})

describe('stripUnitNoise — packaging-noise expansion', () => {
  it('"each" / "ea" / "count" / "ct" / "piece(s)" / "item(s)" are stripped', () => {
    expect(stripUnitNoise('X-Large Eggs each')).toBe('x-large eggs')
    expect(stripUnitNoise('eggs 12 ea')).toBe('eggs')
    expect(stripUnitNoise('beverage 6 count')).toBe('beverage')
    expect(stripUnitNoise('napkins 100 ct')).toBe('napkins')
    expect(stripUnitNoise('apples 4 pieces')).toBe('apples')
    expect(stripUnitNoise('napkins 50 items')).toBe('napkins')
  })
})

describe('stripUnitNoise — backoff when stripping over-shrinks', () => {
  it('"gallons milk" — preserves "gallons" because stripping leaves only one token', () => {
    expect(stripUnitNoise('gallons milk')).toBe('gallons milk')
  })

  it('"1 gallon whole milk" — strips numeric and "gallon" because 2+ tokens remain', () => {
    expect(stripUnitNoise('1 gallon whole milk')).toBe('whole milk')
  })

  it('"loaf bread" — preserves "loaf" because stripping leaves only "bread"', () => {
    expect(stripUnitNoise('loaf bread')).toBe('loaf bread')
  })

  it('"2 lbs ground beef" — strips numeric and "lbs" because 2 tokens remain', () => {
    expect(stripUnitNoise('2 lbs ground beef')).toBe('ground beef')
  })
})

describe('stripUnitNoise — preserves descriptors', () => {
  it('preserves fresh / organic / whole (existing contract)', () => {
    expect(stripUnitNoise('fresh organic whole milk')).toBe('fresh organic whole milk')
  })
})
