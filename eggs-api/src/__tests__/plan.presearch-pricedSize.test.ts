// Contract tests for the Kroger/Walmart → StoreItem.pricedSize integration.
// The actual assembly sites in plan.ts (searchKroger + searchWalmart "found"
// branches) call parseSize(storeReturnedSize) ?? null. These tests pin the
// behaviour of parseSize on representative store-returned size strings so
// the integration can rely on the contract.

import { describe, it, expect } from 'vitest'
import { parseSize } from '../lib/units.js'

describe('Kroger/Walmart size → pricedSize integration contract', () => {
  it('parseSize("32 oz") returns a structurally valid pricedSize', () => {
    const p = parseSize('32 oz')
    expect(p).not.toBeNull()
    expect(p!.quantity).toBe(32)
    expect(p!.unit).toBe('oz')
  })

  it('parseSize("1 gal") returns a valid pricedSize', () => {
    const p = parseSize('1 gal')
    expect(p).not.toBeNull()
    expect(p!.quantity).toBe(1)
    expect(p!.unit).toBe('gal')
  })

  it('parseSize("") returns null — caller must keep pricedSize: null', () => {
    expect(parseSize('')).toBeNull()
  })

  it('parseSize("some garbage") returns null', () => {
    expect(parseSize('some garbage')).toBeNull()
  })
})
