import { describe, it, expect, vi } from 'vitest'
import { discoverPrice } from './price-discovery'
import type { StoreIdentity } from '../types/index.js'

const STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023', retailerStoreId: '790',
}

const CANDIDATE = { title: 'H-E-B Organics Chunk Chicken Breast 10 oz', price: 4.98, merchant: 'H-E-B' }
const PRODUCT_URL = 'https://www.heb.com/product-detail/x/1748922'
const BOUND_PAGE = "You're shopping Plano H-E-B! H-E-B Organics Chunk Chicken Breast 10 oz $4.98 each"
const UNBOUND_PAGE = "You're shopping Victoria H-E-B plus! H-E-B Organics Chunk Chicken Breast 10 oz $4.98 each"

function deps(overrides: Record<string, unknown> = {}) {
  return {
    serper: { shopping: vi.fn().mockResolvedValue([CANDIDATE]) },
    tavily: { search: vi.fn().mockResolvedValue([{ url: PRODUCT_URL, title: CANDIDATE.title, content: '', score: 0.8 }]) },
    firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: BOUND_PAGE, statusCode: 200, sourceUrl: PRODUCT_URL }) },
    directFetch: vi.fn().mockResolvedValue(null), // default: direct fetch bot-walled
    counters: { serperQueries: 0, tavilyQueries: 0, firecrawlScrapes: 0, storeBound: 0, unbound: 0, indexOnly: 0, fallbackLlm: 0 },
    ...overrides,
  } as any
}

describe('discoverPrice', () => {
  it('returns store_page_verified when binding assertion passes', async () => {
    const d = deps()
    const out = await discoverPrice('chicken breast', STORE, 'Dallas, Texas, United States', d)
    expect(out).toMatchObject({
      unitPrice: 4.98,
      productUrl: PRODUCT_URL,
      provenance: 'store_page_verified',
      verifiedStoreId: '790',
    })
    expect(d.counters.storeBound).toBe(1)
    expect(d.counters.serperQueries).toBe(1)
    expect(d.counters.tavilyQueries).toBe(1)
  })

  it('caps at page_verified_unbound when page shows a different store', async () => {
    const d = deps({ firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: UNBOUND_PAGE, statusCode: 200, sourceUrl: PRODUCT_URL }) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('page_verified_unbound')
    expect(out?.verifiedStoreId).toBeUndefined()
    expect(d.counters.unbound).toBe(1)
  })

  it('prefers direct fetch when it returns verifiable content (no firecrawl spend)', async () => {
    const d = deps({ directFetch: vi.fn().mockResolvedValue(BOUND_PAGE) })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('store_page_verified')
    expect(d.firecrawl.scrape).not.toHaveBeenCalled()
    expect(d.counters.firecrawlScrapes).toBe(0)
  })

  it('returns shopping_index when URL resolution fails', async () => {
    const d = deps({ tavily: { search: vi.fn().mockResolvedValue([]) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out).toMatchObject({ unitPrice: 4.98, provenance: 'shopping_index', productUrl: null })
    expect(d.counters.indexOnly).toBe(1)
  })

  it('returns shopping_index when tavily dep is absent (no key configured)', async () => {
    const d = deps({ tavily: undefined })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('shopping_index')
  })

  it('returns shopping_index when fetched page fails exact-price verification', async () => {
    const wrongPrice = "You're shopping Plano H-E-B! H-E-B Organics Chunk Chicken Breast 10 oz $7.49"
    const d = deps({ firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: wrongPrice, statusCode: 200, sourceUrl: PRODUCT_URL }) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('shopping_index')
  })

  it('returns shopping_index when both fetch paths fail', async () => {
    const d = deps({ firecrawl: { scrape: vi.fn().mockResolvedValue(null) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('shopping_index')
  })

  it('returns null when serper has no candidates for the banner', async () => {
    const d = deps({ serper: { shopping: vi.fn().mockResolvedValue([{ ...CANDIDATE, merchant: 'Kroger' }]) } })
    expect(await discoverPrice('chicken breast', STORE, 'Dallas', d)).toBeNull()
  })

  it('returns null when all serper candidates lack prices', async () => {
    const d = deps({ serper: { shopping: vi.fn().mockResolvedValue([{ ...CANDIDATE, price: null }]) } })
    expect(await discoverPrice('chicken breast', STORE, 'Dallas', d)).toBeNull()
  })

  it('returns null when serper is undefined (no key configured)', async () => {
    const d = deps({ serper: undefined })
    expect(await discoverPrice('chicken breast', STORE, 'Dallas', d)).toBeNull()
  })

  it('prefers product-detail URLs over category/search URLs from tavily results', async () => {
    const d = deps({
      tavily: { search: vi.fn().mockResolvedValue([
        { url: 'https://www.heb.com/category/chicken/490110', title: 'Chicken', content: '', score: 0.9 },
        { url: PRODUCT_URL, title: CANDIDATE.title, content: '', score: 0.8 },
      ]) },
    })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.productUrl).toBe(PRODUCT_URL)
  })

  it('applies cookie binding recipe headers to direct fetch when available', async () => {
    // getBindingRecipe currently returns none for all banners; this test injects a recipe via deps.recipeOverride
    const directFetch = vi.fn().mockResolvedValue(BOUND_PAGE)
    const d = deps({
      directFetch,
      recipeOverride: { kind: 'cookie', buildCookie: (id: string) => `CURR_STORE=${id}` },
    })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('store_page_verified')
    expect(directFetch).toHaveBeenCalledWith(PRODUCT_URL, { Cookie: 'CURR_STORE=790' })
  })
})
