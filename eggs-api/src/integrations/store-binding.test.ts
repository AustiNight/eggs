import { describe, it, expect } from 'vitest'
import { getBindingRecipe, assertStoreBinding, bannerDomain } from './store-binding'
import type { StoreIdentity } from '../types/index.js'

const HEB_STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023', distanceMiles: 4.2, retailerStoreId: '790',
}

describe('bannerDomain', () => {
  it('maps known banners to their domains', () => {
    expect(bannerDomain('H-E-B')).toBe('heb.com')
    expect(bannerDomain('Tom Thumb')).toBe('tomthumb.com')
    expect(bannerDomain('Sprouts Farmers Market')).toBe('shop.sprouts.com')
    expect(bannerDomain('Whole Foods Market')).toBe('wholefoodsmarket.com')
  })
  it('returns null for unknown banners', () => {
    expect(bannerDomain('Bob Grocery')).toBeNull()
  })
})

describe('assertStoreBinding', () => {
  it('passes when the page store indicator mentions the expected store city/name token', () => {
    const page = "You're shopping Plano H‑E‑B!  Curbside available"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('fails when the indicator names a different store', () => {
    const page = "You're shopping Victoria H‑E‑B plus!"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('fails when no store indicator is present at all', () => {
    expect(assertStoreBinding('Just a product page. $4.98', HEB_STORE)).toBe(false)
  })
  it('matches on retailerStoreId appearing in page payload', () => {
    const page = 'data-store-id="790" Add to cart'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('does NOT false-positive on an unrelated number matching the store id', () => {
    const page = 'Only 790 left in stock!'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('matches "my store" indicator phrasing with city token', () => {
    const page = 'My Store: Plano #790\nWeekly ad'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('survives a store with no address (uses storeName tokens only)', () => {
    const noAddr: StoreIdentity = { banner: 'Target', bannerNormalized: 'target', storeName: 'Target Frisco North' }
    expect(assertStoreBinding("You're shopping Frisco North", noAddr)).toBe(true)
    expect(assertStoreBinding("You're shopping Dallas Central", noAddr)).toBe(false)
  })
})

describe('getBindingRecipe', () => {
  it('returns a recipe object for every known banner (none is acceptable)', () => {
    const r = getBindingRecipe('h-e-b')
    expect(r).toBeDefined()
    expect(['url', 'cookie', 'actions', 'none']).toContain(r.kind)
  })
  it('returns kind none for unknown banners', () => {
    expect(getBindingRecipe('bob grocery').kind).toBe('none')
  })
})
