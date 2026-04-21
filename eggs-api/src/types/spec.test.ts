import { describe, it, expect } from 'vitest'
import { validateSpec, toInstacartLineItem } from './spec.js'
import type { ShoppableItemSpec } from './spec.js'

// ─── Shared valid fixture ─────────────────────────────────────────────────────

/** A fully valid brand-locked spec. */
const validBrandLocked: ShoppableItemSpec = {
  id: 'item-1',
  sourceText: 'Fairlife whole milk',
  displayName: 'whole milk',
  categoryPath: ['beverages', 'milk', 'whole-milk'],
  brand: 'Fairlife',
  brandLocked: true,
  quantity: 1,
  unit: 'gal',
  resolutionTrace: [
    { question: 'What type of milk?', options: ['whole', '2%', 'skim'], answer: 'whole', turnNumber: 1 },
  ],
  confidence: 'high',
}

/** A fully valid brand-unlocked (price-shop) spec. */
const validBrandUnlocked: ShoppableItemSpec = {
  id: 'item-2',
  sourceText: '2 lbs ground beef',
  displayName: 'ground beef',
  categoryPath: ['meat-poultry-seafood', 'beef'],
  brand: null,
  brandLocked: false,
  quantity: 2,
  unit: 'lb',
  resolutionTrace: [],
  confidence: 'medium',
}

// ─── Happy paths ──────────────────────────────────────────────────────────────

describe('validateSpec — happy paths', () => {
  it('accepts a fully valid brand-locked spec', () => {
    expect(() => validateSpec(validBrandLocked)).not.toThrow()
    const result = validateSpec(validBrandLocked)
    expect(result.id).toBe('item-1')
    expect(result.brand).toBe('Fairlife')
    expect(result.brandLocked).toBe(true)
  })

  it('accepts a fully valid brand-unlocked (null) spec', () => {
    expect(() => validateSpec(validBrandUnlocked)).not.toThrow()
    const result = validateSpec(validBrandUnlocked)
    expect(result.brand).toBeNull()
    expect(result.brandLocked).toBe(false)
  })

  it('accepts a spec with all optional fields present', () => {
    const withOptionals: ShoppableItemSpec = {
      ...validBrandLocked,
      usdaFdcId: 123456,
      offCategoryTag: 'en:whole-milks',
      upc: '012345678901',
      attributes: { fat_content: '3.25%', packaging: 'jug' },
    }
    expect(() => validateSpec(withOptionals)).not.toThrow()
    const result = validateSpec(withOptionals)
    expect(result.usdaFdcId).toBe(123456)
    expect(result.offCategoryTag).toBe('en:whole-milks')
    expect(result.upc).toBe('012345678901')
    expect(result.attributes).toEqual({ fat_content: '3.25%', packaging: 'jug' })
  })

  it('accepts confidence: "low" (forced finalize path)', () => {
    const lowConf: ShoppableItemSpec = {
      ...validBrandUnlocked,
      confidence: 'low',
      resolutionTrace: [
        { question: 'Q1?', options: ['a', 'b'], answer: 'a', turnNumber: 1 },
        { question: 'Q2?', options: ['c', 'd'], answer: 'c', turnNumber: 2 },
        { question: 'Q3?', options: ['e', 'f'], answer: 'e', turnNumber: 3 },
      ],
    }
    expect(() => validateSpec(lowConf)).not.toThrow()
    const result = validateSpec(lowConf)
    expect(result.confidence).toBe('low')
  })
})

// ─── Invariant 1: brand === null ⟺ brandLocked === false ─────────────────────

describe('validateSpec — invariant: brand ⟺ brandLocked', () => {
  it('rejects brand set to a string when brandLocked is false', () => {
    const bad = { ...validBrandLocked, brandLocked: false } // brand='Fairlife', brandLocked=false
    expect(() => validateSpec(bad)).toThrow()
  })

  it('rejects brand === null when brandLocked is true', () => {
    const bad = { ...validBrandUnlocked, brandLocked: true } // brand=null, brandLocked=true
    expect(() => validateSpec(bad)).toThrow()
  })
})

// ─── Invariant 2: quantity > 0 ───────────────────────────────────────────────

describe('validateSpec — invariant: quantity > 0', () => {
  it('rejects quantity === 0', () => {
    const bad = { ...validBrandLocked, quantity: 0 }
    expect(() => validateSpec(bad)).toThrow()
  })

  it('rejects quantity === -1', () => {
    const bad = { ...validBrandLocked, quantity: -1 }
    expect(() => validateSpec(bad)).toThrow()
  })
})

// ─── Invariant 3: unit ∈ CanonicalUnit ───────────────────────────────────────

describe('validateSpec — invariant: unit ∈ CanonicalUnit', () => {
  it('rejects unit === "ton" (not a CanonicalUnit)', () => {
    const bad = { ...validBrandLocked, unit: 'ton' }
    expect(() => validateSpec(bad)).toThrow()
  })
})

// ─── Invariant 4: resolutionTrace.length <= 3 ────────────────────────────────

describe('validateSpec — invariant: resolutionTrace.length <= 3', () => {
  it('rejects resolutionTrace with 4 entries', () => {
    const traceEntry = { question: 'Q?', options: ['a', 'b'], answer: 'a', turnNumber: 1 }
    const bad = {
      ...validBrandLocked,
      resolutionTrace: [traceEntry, traceEntry, traceEntry, traceEntry],
    }
    expect(() => validateSpec(bad)).toThrow()
  })

  it('accepts resolutionTrace with exactly 3 entries', () => {
    const traceEntry = { question: 'Q?', options: ['a', 'b'], answer: 'a', turnNumber: 1 }
    const ok = {
      ...validBrandLocked,
      resolutionTrace: [traceEntry, traceEntry, traceEntry],
    }
    expect(() => validateSpec(ok)).not.toThrow()
  })
})

// ─── Invariant 5: categoryPath.length >= 1 ───────────────────────────────────

describe('validateSpec — invariant: categoryPath.length >= 1', () => {
  it('rejects categoryPath === []', () => {
    const bad = { ...validBrandLocked, categoryPath: [] }
    expect(() => validateSpec(bad)).toThrow()
  })
})

// ─── toInstacartLineItem ──────────────────────────────────────────────────────

describe('toInstacartLineItem', () => {
  it('maps displayName to name, and includes upc when present', () => {
    const spec: ShoppableItemSpec = {
      ...validBrandLocked,
      upc: '012345678901',
    }
    const line = toInstacartLineItem(spec)
    expect(line.name).toBe('whole milk')
    expect(line.upc).toBe('012345678901')
  })

  it('omits upc when not present on spec', () => {
    const line = toInstacartLineItem(validBrandUnlocked)
    expect(line.upc).toBeUndefined()
  })

  it('omits display_text when sourceText === displayName', () => {
    const spec: ShoppableItemSpec = {
      ...validBrandLocked,
      sourceText: 'whole milk',
      displayName: 'whole milk',
    }
    const line = toInstacartLineItem(spec)
    expect(line.display_text).toBeUndefined()
  })

  it('includes display_text when sourceText !== displayName', () => {
    // validBrandLocked has sourceText='Fairlife whole milk', displayName='whole milk'
    const line = toInstacartLineItem(validBrandLocked)
    expect(line.display_text).toBe('Fairlife whole milk')
  })

  it('passes through unit as a single-element line_item_measurements array', () => {
    const line = toInstacartLineItem(validBrandLocked)
    expect(line.line_item_measurements).toHaveLength(1)
    expect(line.line_item_measurements[0]).toEqual({ quantity: 1, unit: 'gal' })
  })

  it('passes through fractional quantity correctly', () => {
    const spec: ShoppableItemSpec = { ...validBrandUnlocked, quantity: 0.5, unit: 'lb' }
    const line = toInstacartLineItem(spec)
    expect(line.line_item_measurements[0]).toEqual({ quantity: 0.5, unit: 'lb' })
  })
})
