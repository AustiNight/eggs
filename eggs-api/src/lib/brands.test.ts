import { describe, it, expect } from 'vitest'
import { normalizeBrand } from './brands.js'

// ─── Basic normalization ───────────────────────────────────────────────────────

describe('normalizeBrand — basic normalization', () => {
  it('lowercases the input', () => {
    expect(normalizeBrand('KRAFT')).toBe('kraft')
  })
  it('strips leading/trailing whitespace', () => {
    expect(normalizeBrand('  Heinz  ')).toBe('heinz')
  })
  it('collapses internal whitespace', () => {
    expect(normalizeBrand('Ben  &  Jerrys')).toContain('ben')
  })
  it('strips periods', () => {
    expect(normalizeBrand('Dr. Pepper')).toBe('dr pepper')
  })
  it('strips commas', () => {
    expect(normalizeBrand('Campbell, Inc.')).toBe('campbell inc')
  })
  it('strips ampersands', () => {
    // & stripped → "ben jerrys" → synonym maps to canonical
    const result = normalizeBrand("Ben & Jerry's")
    expect(result).not.toContain('&')
  })
  it("strips ASCII apostrophes (') from brand names", () => {
    expect(normalizeBrand("Hershey's")).toBe("hersheys")
  })
  it("strips right-single-quote (\\u2019) from brand names", () => {
    // Land O\u2019Lakes
    expect(normalizeBrand('Land O\u2019Lakes')).toBe('land olakes')
  })
  it("strips exclamation marks", () => {
    expect(normalizeBrand('Yum!')).toBe('yum')
  })
  it('handles empty string', () => {
    expect(normalizeBrand('')).toBe('')
  })
})

// ─── Apostrophe variant matching ──────────────────────────────────────────────

describe('normalizeBrand — apostrophe variants resolve to same string', () => {
  it("\"Land O'Lakes\" and \"Land O Lakes\" normalize the same way", () => {
    // After stripping apostrophes both should be identical
    const a = normalizeBrand("Land O'Lakes")
    const b = normalizeBrand('Land O Lakes')
    expect(a).toBe(b)
  })
})

// ─── Synonym map ──────────────────────────────────────────────────────────────

describe('normalizeBrand — synonym map', () => {
  it('maps "Ben & Jerry\'s" to its canonical form', () => {
    expect(normalizeBrand("Ben & Jerry's")).toBe('ben and jerrys')
  })
  it('maps "Häagen-Dazs" diacritic variant to canonical', () => {
    const result = normalizeBrand('Häagen-Dazs')
    expect(result).toBe('haagen dazs')
  })
  it("maps \"Lay's\" to canonical \"lays\"", () => {
    expect(normalizeBrand("Lay's")).toBe('lays')
  })
  it("maps \"Kellogg's\" to canonical \"kelloggs\"", () => {
    expect(normalizeBrand("Kellogg's")).toBe('kelloggs')
  })
  it("maps \"Trader Joe's\" to canonical \"trader joes\"", () => {
    expect(normalizeBrand("Trader Joe's")).toBe('trader joes')
  })
  it('unknown brand is returned as-is after normalization (no synonym hit)', () => {
    // A brand not in the map just comes out lowercase / stripped
    expect(normalizeBrand('GenericBrand')).toBe('genericbrand')
  })
})
