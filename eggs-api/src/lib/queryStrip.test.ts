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
