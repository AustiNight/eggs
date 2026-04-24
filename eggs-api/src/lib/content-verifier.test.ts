import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyProductContent } from './content-verifier'

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
