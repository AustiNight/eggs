import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyProductContent, verifyContentText } from './content-verifier'
import type { StoreIdentity } from '../types/index.js'

describe('verifyProductContent', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns verified:true when name tokens and price both appear in page text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Kroger Boneless Skinless Chicken Thighs — $4.99 / lb</body></html>',
    }))
    const result = await verifyProductContent('https://kroger.com/p/123', 'Boneless Skinless Chicken Thighs', 4.99)
    expect(result.verified).toBe(true)
  })

  it('returns verified:false when the page has the name but a different price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Chicken Thighs — $7.49 / lb</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/price/i)
  })

  it('returns verified:false when the page has the price but not the product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Sliced Turkey — $4.99</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/name|product/i)
  })

  it('returns verified:false when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }))
    const result = await verifyProductContent('https://ex.com/p', 'Anything', 1.00)
    expect(result.verified).toBe(false)
  })

  it('accepts $X.XX, X.XX, and X,XX price formats', async () => {
    const html = '<html><body>Product Foo — 4,99 €</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }))
    const result = await verifyProductContent('https://ex.com/p', 'Product Foo', 4.99)
    expect(result.verified).toBe(true)
  })

  it('treats fewer than 60% name-token coverage as a mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>thighs — $4.99</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Organic Free-Range Boneless Skinless Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
  })

  it('times out gracefully after short timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) => new Promise((_, reject) => {
      const signal = (opts as any)?.signal
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const result = await verifyProductContent('https://slow.example', 'x', 1, { timeoutMs: 50 })
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/timeout|abort/i)
  })
})

const STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023',
}

describe('verifyContentText', () => {
  const page = "You're shopping Plano H-E-B! Organic Chunk Chicken Breast 10 oz $4.98 each"

  it('verifies name+price on pre-fetched text without network', () => {
    const r = verifyContentText(page, 'Organic Chunk Chicken Breast', 4.98)
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(false) // no expectedStore passed
  })

  it('sets storeBound true when binding assertion passes', () => {
    const r = verifyContentText(page, 'Organic Chunk Chicken Breast', 4.98, { expectedStore: STORE })
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(true)
  })

  it('verified can be true while storeBound is false (wrong store)', () => {
    const wrong = "You're shopping Victoria H-E-B plus! Organic Chunk Chicken Breast 10 oz $4.98 each"
    const r = verifyContentText(wrong, 'Organic Chunk Chicken Breast', 4.98, { expectedStore: STORE })
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(false)
  })

  it('strips markdown link noise before matching', () => {
    const md = "[Skip](https://x.com)\n# Organic Chunk Chicken Breast\n\n$4.98 each($0.50 / oz)"
    expect(verifyContentText(md, 'Organic Chunk Chicken Breast', 4.98).verified).toBe(true)
  })

  it('fails with reason price_not_found when exact price missing', () => {
    const r = verifyContentText('Organic Chunk Chicken Breast $7.49', 'Organic Chunk Chicken Breast', 4.98)
    expect(r.verified).toBe(false)
    expect(r.reason).toBe('price_not_found')
  })
})
