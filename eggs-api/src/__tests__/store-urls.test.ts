import { describe, it, expect } from 'vitest'
import { getShopUrl, normalizeBanner, knownBanners } from '../integrations/store-urls.js'

describe('store-urls.getShopUrl', () => {
  it('returns the correct template for a known banner', () => {
    expect(getShopUrl('Tom Thumb', 'fresh basil'))
      .toBe('https://www.tomthumb.com/shop/search-results.html?q=fresh%20basil')
  })

  it('is case-insensitive and tolerant of extra whitespace', () => {
    expect(getShopUrl('  TARGET  ', 'eggs'))
      .toBe('https://www.target.com/s?searchTerm=eggs')
  })

  it('handles H-E-B variant spellings', () => {
    expect(getShopUrl('H-E-B', 'milk')).toContain('heb.com/search?q=milk')
    expect(getShopUrl('heb', 'milk')).toContain('heb.com/search?q=milk')
  })

  it("handles Trader Joe's apostrophe variants", () => {
    const curly = getShopUrl("Trader Joe's", 'peanut butter')
    const plain = getShopUrl('Trader Joes', 'peanut butter')
    expect(curly).toContain('traderjoes.com')
    expect(plain).toContain('traderjoes.com')
  })

  it('percent-encodes special characters', () => {
    const url = getShopUrl('Target', 'A&W root beer')
    expect(url).toContain('A%26W%20root%20beer')
  })

  it('falls back to a Google search URL for unknown banners', () => {
    const url = getShopUrl('Some Unknown Regional Grocer', 'milk')
    expect(url).toBe('https://www.google.com/search?q=Some%20Unknown%20Regional%20Grocer%20milk')
  })

  it('never returns an empty string', () => {
    expect(getShopUrl('', 'milk').length).toBeGreaterThan(0)
    expect(getShopUrl('Nobody', '').length).toBeGreaterThan(0)
  })
})

describe('store-urls.normalizeBanner', () => {
  it('lowercases and trims', () => {
    expect(normalizeBanner('  Target  ')).toBe('target')
  })
  it('collapses multiple whitespace', () => {
    expect(normalizeBanner('Tom    Thumb')).toBe('tom thumb')
  })
  it('strips commas and periods', () => {
    expect(normalizeBanner('Costco Wholesale, Inc.')).toBe('costco wholesale inc')
  })
})

describe('store-urls.knownBanners', () => {
  it('returns all registered banner keys', () => {
    const banners = knownBanners()
    expect(banners).toContain('target')
    expect(banners).toContain('walmart')
    expect(banners).toContain('tom thumb')
    expect(banners.length).toBeGreaterThan(20)
  })
})
