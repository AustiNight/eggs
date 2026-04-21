import { describe, it, expect } from 'vitest'
import { convert, toBase, pricePerBase, parseSize, BASE_DIMENSION } from './units.js'
import type { CanonicalUnit } from '../types/index.js'

// ─── BASE_DIMENSION ───────────────────────────────────────────────────────────

describe('BASE_DIMENSION', () => {
  it('oz maps to "g" (mass)', () => {
    expect(BASE_DIMENSION.oz).toBe('g')
  })
  it('fl_oz maps to "ml" (volume)', () => {
    expect(BASE_DIMENSION.fl_oz).toBe('ml')
  })
  it('each maps to "count"', () => {
    expect(BASE_DIMENSION.each).toBe('count')
  })
})

// ─── convert() ────────────────────────────────────────────────────────────────

describe('convert — mass↔mass', () => {
  it('oz → g', () => {
    expect(convert(1, 'oz', 'g')).toBeCloseTo(28.3495, 3)
  })
  it('g → oz', () => {
    expect(convert(28.3495, 'g', 'oz')).toBeCloseTo(1, 3)
  })
  it('lb → g', () => {
    expect(convert(1, 'lb', 'g')).toBeCloseTo(453.592, 3)
  })
  it('g → lb', () => {
    expect(convert(453.592, 'g', 'lb')).toBeCloseTo(1, 3)
  })
  it('oz → lb', () => {
    expect(convert(16, 'oz', 'lb')).toBeCloseTo(1, 3)
  })
  it('kg → g', () => {
    expect(convert(1, 'kg', 'g')).toBeCloseTo(1000, 3)
  })
  it('g → kg round-trip', () => {
    const val = convert(500, 'g', 'kg')!
    expect(convert(val, 'kg', 'g')).toBeCloseTo(500, 3)
  })
})

describe('convert — volume↔volume', () => {
  it('fl_oz → ml', () => {
    expect(convert(1, 'fl_oz', 'ml')).toBeCloseTo(29.5735, 3)
  })
  it('ml → fl_oz', () => {
    expect(convert(29.5735, 'ml', 'fl_oz')).toBeCloseTo(1, 3)
  })
  it('gal → ml', () => {
    expect(convert(1, 'gal', 'ml')).toBeCloseTo(3785.41, 3)
  })
  it('ml → l', () => {
    expect(convert(1000, 'ml', 'l')).toBeCloseTo(1, 3)
  })
  it('cup → fl_oz', () => {
    // 1 cup = 236.588 ml; 1 fl_oz = 29.5735 ml → 8 fl_oz
    expect(convert(1, 'cup', 'fl_oz')).toBeCloseTo(8, 2)
  })
  it('qt → gal round-trip', () => {
    const val = convert(4, 'qt', 'gal')!
    expect(convert(val, 'gal', 'qt')).toBeCloseTo(4, 3)
  })
})

describe('convert — count↔count', () => {
  it('dozen → each', () => {
    expect(convert(1, 'dozen', 'each')).toBeCloseTo(12, 3)
  })
  it('each → dozen', () => {
    expect(convert(12, 'each', 'dozen')).toBeCloseTo(1, 3)
  })
})

describe('convert — unconvertible cross-base pairs return null', () => {
  it('mass → volume returns null', () => {
    expect(convert(1, 'oz', 'ml')).toBeNull()
  })
  it('volume → mass returns null', () => {
    expect(convert(1, 'fl_oz', 'g')).toBeNull()
  })
  it('mass → count returns null', () => {
    expect(convert(1, 'lb', 'each')).toBeNull()
  })
  it('count → mass returns null', () => {
    expect(convert(1, 'each', 'oz')).toBeNull()
  })
  it('volume → count returns null', () => {
    expect(convert(1, 'gal', 'dozen')).toBeNull()
  })
  it('count → volume returns null', () => {
    expect(convert(1, 'each', 'fl_oz')).toBeNull()
  })
})

// ─── toBase() ─────────────────────────────────────────────────────────────────

describe('toBase()', () => {
  it('converts oz to grams', () => {
    const r = toBase(2, 'oz')
    expect(r.base).toBe('g')
    expect(r.qty).toBeCloseTo(56.699, 2)
  })
  it('converts gal to ml', () => {
    const r = toBase(1, 'gal')
    expect(r.base).toBe('ml')
    expect(r.qty).toBeCloseTo(3785.41, 1)
  })
  it('converts dozen to count', () => {
    const r = toBase(1, 'dozen')
    expect(r.base).toBe('count')
    expect(r.qty).toBeCloseTo(12, 3)
  })
  it('identity: g stays g', () => {
    const r = toBase(100, 'g')
    expect(r.base).toBe('g')
    expect(r.qty).toBe(100)
  })
})

// ─── pricePerBase() ───────────────────────────────────────────────────────────

describe('pricePerBase()', () => {
  it('computes price per gram for a mass item', () => {
    // $3.99 for 32 oz → pricePerGram = 3.99 / (32 * 28.3495) ≈ 0.004407
    const result = pricePerBase(3.99, { qty: 32, unit: 'oz' })
    expect(result).not.toBeNull()
    expect(result!.base).toBe('g')
    expect(result!.pricePerBase).toBeCloseTo(3.99 / (32 * 28.3495), 5)
  })
  it('computes price per ml for a volume item', () => {
    // $2.49 for 64 fl_oz
    const result = pricePerBase(2.49, { qty: 64, unit: 'fl_oz' })
    expect(result).not.toBeNull()
    expect(result!.base).toBe('ml')
    expect(result!.pricePerBase).toBeCloseTo(2.49 / (64 * 29.5735), 6)
  })
  it('returns null when qty is zero', () => {
    expect(pricePerBase(1.99, { qty: 0, unit: 'oz' })).toBeNull()
  })
})

// ─── parseSize() ──────────────────────────────────────────────────────────────

describe('parseSize()', () => {
  it('parses "32 oz"', () => {
    const r = parseSize('32 oz')
    expect(r).toEqual({ quantity: 32, unit: 'oz' })
  })
  it('parses "1 lb"', () => {
    const r = parseSize('1 lb')
    expect(r).toEqual({ quantity: 1, unit: 'lb' })
  })
  it('parses "500 ml"', () => {
    const r = parseSize('500 ml')
    expect(r).toEqual({ quantity: 500, unit: 'ml' })
  })
  it('parses "half gallon" → { quantity: 0.5, unit: "gal" }', () => {
    const r = parseSize('half gallon')
    expect(r).toEqual({ quantity: 0.5, unit: 'gal' })
  })
  it('parses "2 fl oz" (space in unit)', () => {
    const r = parseSize('2 fl oz')
    expect(r).toEqual({ quantity: 2, unit: 'fl_oz' })
  })
  it('parses "1.5 kg"', () => {
    const r = parseSize('1.5 kg')
    expect(r).toEqual({ quantity: 1.5, unit: 'kg' })
  })
  it('parses "1 dozen"', () => {
    const r = parseSize('1 dozen')
    expect(r).toEqual({ quantity: 1, unit: 'dozen' })
  })
  it('parses "2 each"', () => {
    const r = parseSize('2 each')
    expect(r).toEqual({ quantity: 2, unit: 'each' })
  })
  it('returns null for unrecognized input', () => {
    expect(parseSize('a bunch of stuff')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(parseSize('')).toBeNull()
  })
  // Multi-unit strings: best-effort — converts to base unit (grams)
  it('parses "1 lb 4 oz" → base grams as g quantity', () => {
    const r = parseSize('1 lb 4 oz')
    // 1 lb = 453.592g, 4 oz = 4 * 28.3495 = 113.398g → total ≈ 566.99g
    expect(r).not.toBeNull()
    expect(r!.unit).toBe('g')
    expect(r!.quantity).toBeCloseTo(566.99, 1)
  })
  it('returns null for count multi-unit "1 dozen 6 each" — count is not a CanonicalUnit', () => {
    expect(parseSize('1 dozen 6 each')).toBeNull()
  })
})
