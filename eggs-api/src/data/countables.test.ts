import { describe, it, expect } from 'vitest'
import { COUNTABLES } from './countables.js'
import type { CountableEntry } from './countables.js'

describe('countables structural integrity', () => {
  it('has at least 30 entries', () => {
    expect(COUNTABLES.length).toBeGreaterThanOrEqual(30)
  })

  it('has no duplicate canonicalNames', () => {
    const names = COUNTABLES.map(e => e.canonicalName)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('all typicalEachWeightG are positive numbers', () => {
    for (const entry of COUNTABLES) {
      expect(
        entry.typicalEachWeightG,
        `${entry.canonicalName} has non-positive weight`,
      ).toBeGreaterThan(0)
      expect(
        Number.isFinite(entry.typicalEachWeightG),
        `${entry.canonicalName} weight is not finite`,
      ).toBe(true)
    }
  })

  it('all canonicalNames are non-empty strings', () => {
    for (const entry of COUNTABLES) {
      expect(entry.canonicalName.trim().length).toBeGreaterThan(0)
    }
  })

  it('synonyms arrays contain no empty strings', () => {
    for (const entry of COUNTABLES) {
      for (const syn of entry.synonyms) {
        expect(
          syn.trim().length,
          `${entry.canonicalName} has empty synonym`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('no synonym appears as a canonicalName in another entry (no cross-entry collisions)', () => {
    const canonicals = new Set(COUNTABLES.map(e => e.canonicalName))
    for (const entry of COUNTABLES) {
      for (const syn of entry.synonyms) {
        // A synonym that matches another entry's canonical name would cause lookup ambiguity.
        // Allow a synonym matching the entry's own canonical name if needed.
        if (syn !== entry.canonicalName && canonicals.has(syn)) {
          throw new Error(
            `Synonym "${syn}" in "${entry.canonicalName}" collides with another entry's canonicalName`,
          )
        }
      }
    }
  })

  it('covers key expected entries', () => {
    const names = new Set(COUNTABLES.map(e => e.canonicalName))
    expect(names.has('egg')).toBe(true)
    expect(names.has('banana')).toBe(true)
    expect(names.has('apple')).toBe(true)
    expect(names.has('avocado')).toBe(true)
    expect(names.has('lemon')).toBe(true)
    expect(names.has('clove of garlic')).toBe(true)
    expect(names.has('head of lettuce')).toBe(true)
  })

  it('gpcBrickId when present is a non-empty string', () => {
    for (const entry of COUNTABLES) {
      if (entry.gpcBrickId !== undefined) {
        expect(entry.gpcBrickId.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
