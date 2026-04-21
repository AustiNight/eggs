// ─── WalmartClient tests ───────────────────────────────────────────────────────
//
// All tests use a mocked fetchImpl — no real network calls.
// RSA signing is bypassed via vi.spyOn on signHeaders — tests focus on
// search logic (cascade, brand filter, unit preference), not cryptography.

import { describe, it, expect, vi } from 'vitest'
import { WalmartClient } from './walmart.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWalmartProduct(overrides: {
  itemId?: string | number
  name?: string
  brandName?: string
  msrp?: number
  salePrice?: number
  productTrackingUrl?: string
  size?: string
}) {
  return {
    itemId: overrides.itemId ?? 1001,
    name: overrides.name ?? 'Test Product',
    brandName: overrides.brandName ?? 'Test Brand',
    msrp: overrides.msrp ?? 4.99,
    salePrice: overrides.salePrice,
    productTrackingUrl: overrides.productTrackingUrl ?? `https://walmart.com/ip/test/${overrides.itemId ?? 1001}`,
    size: overrides.size ?? '16 oz',
  }
}

function makeSearchResponse(items: ReturnType<typeof makeWalmartProduct>[]) {
  return { items }
}

/**
 * Builds a fetch mock that dispatches by `query` URL param.
 * productMap key = query string, value = array of products returned.
 */
function makeFetchMock(
  productMap: Record<string, ReturnType<typeof makeWalmartProduct>[]>
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input))
    const query = url.searchParams.get('query') ?? ''
    const products = productMap[query] ?? []
    return new Response(JSON.stringify(makeSearchResponse(products)), { status: 200 })
  }) as unknown as typeof fetch
}

/**
 * Create a client with signing bypassed. The dummy PEM avoids a null check
 * inside the constructor; signHeaders is mocked before any search call.
 */
function makeClient(fetchMock: typeof fetch): WalmartClient {
  const client = new WalmartClient(
    'consumer-id',
    '1',
    '-----BEGIN PRIVATE KEY-----\nZHVtbXk=\n-----END PRIVATE KEY-----',
    'pub-id',
    'https://test.walmart.api',
    fetchMock
  )
  // Bypass RSA signing — tests are for search logic, not cryptography.
  vi.spyOn(client, 'signHeaders').mockResolvedValue({
    'WM_CONSUMER.ID': 'consumer-id',
    'WM_CONSUMER.INTIMESTAMP': '12345',
    'WM_SEC.KEY_VERSION': '1',
    'WM_SEC.AUTH_SIGNATURE': 'fake-sig',
  })
  return client
}

// ─── Brand filter tests ────────────────────────────────────────────────────────

describe('WalmartClient.search — brand filter', () => {
  it('(a) brand present and matches → returns matching result', async () => {
    const items = [
      makeWalmartProduct({ itemId: 1, name: 'Great Value Milk', brandName: 'Great Value', msrp: 2.99 }),
      makeWalmartProduct({ itemId: 2, name: 'Organic Valley Milk', brandName: 'Organic Valley', msrp: 5.49 }),
    ]
    const client = makeClient(makeFetchMock({ 'milk': items, 'whole milk': items }))
    const result = await client.search({ name: 'whole milk', brand: 'Organic Valley' })
    expect(result).not.toBeNull()
    expect(result!.brand).toBe('Organic Valley')
    expect(result!.regularPrice).toBe(5.49)
  })

  it('(b) brand present but no result matches → returns null', async () => {
    const items = [
      makeWalmartProduct({ itemId: 1, name: 'Great Value Milk', brandName: 'Great Value', msrp: 2.99 }),
    ]
    const client = makeClient(makeFetchMock({ 'milk': items, 'whole milk': items }))
    const result = await client.search({ name: 'whole milk', brand: 'Tillamook' })
    expect(result).toBeNull()
  })

  it('(c) no brand provided → returns first priced result regardless of brand', async () => {
    const items = [
      makeWalmartProduct({ itemId: 1, name: 'Great Value Milk', brandName: 'Great Value', msrp: 2.99 }),
      makeWalmartProduct({ itemId: 2, name: 'Organic Valley Milk', brandName: 'Organic Valley', msrp: 5.49 }),
    ]
    const client = makeClient(makeFetchMock({ 'milk': items, 'whole milk': items }))
    const result = await client.search({ name: 'whole milk' })
    expect(result).not.toBeNull()
    expect(result!.regularPrice).toBe(2.99)
  })
})

// ─── Unit preference tests ─────────────────────────────────────────────────────

describe('WalmartClient.search — unit preference', () => {
  it('(a) prefers results in the same base dimension as input.unit', async () => {
    // input.unit = fl_oz (volume) → should prefer the 500ml item over the 16oz (mass) item
    const items = [
      makeWalmartProduct({ itemId: 1, name: 'Olive Oil 16oz', brandName: 'Generic', msrp: 5.99, size: '16 oz' }),
      makeWalmartProduct({ itemId: 2, name: 'Olive Oil 500ml', brandName: 'Generic', msrp: 6.49, size: '500 ml' }),
    ]
    const client = makeClient(makeFetchMock({ 'olive oil': items }))
    const result = await client.search({ name: 'olive oil', unit: 'fl_oz' })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('2')
  })

  it('(b) falls back to all results when no candidate matches the requested base', async () => {
    // Only mass-measured products; requested unit fl_oz (volume)
    const items = [
      makeWalmartProduct({ itemId: 1, name: 'Olive Oil 16oz', brandName: 'Generic', msrp: 5.99, size: '16 oz' }),
    ]
    const client = makeClient(makeFetchMock({ 'olive oil': items }))
    const result = await client.search({ name: 'olive oil', unit: 'fl_oz' })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('1')
  })
})

// ─── Cascade tests ────────────────────────────────────────────────────────────

describe('WalmartClient.search — strip-and-retry cascade', () => {
  it('uses stripped query first when it returns results', async () => {
    // "1 head garlic" → stripped "garlic" returns a result; raw never called
    const items = [
      makeWalmartProduct({ itemId: 99, name: 'Garlic Bulb', brandName: 'Generic', msrp: 0.78 }),
    ]
    const fetchMock = makeFetchMock({ 'garlic': items })
    const client = makeClient(fetchMock)
    const result = await client.search({ name: '1 head garlic' })
    expect(result).not.toBeNull()
    expect(result!.name).toContain('Garlic')
    // Only 1 fetch — stripped query succeeded, raw skipped
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to raw query when stripped returns nothing', async () => {
    // "bottle olive oil" → stripped "olive oil" returns nothing; raw returns a hit
    const oilProduct = makeWalmartProduct({ itemId: 55, name: "Chef's Bottle Olive Oil", brandName: 'Generic', msrp: 7.99 })
    const fetchMock = makeFetchMock({
      'olive oil': [],                    // stripped — empty
      'bottle olive oil': [oilProduct],   // raw — has results
    })
    const client = makeClient(fetchMock)
    const result = await client.search({ name: 'bottle olive oil' })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('55')
    // 2 fetches — stripped (no results) then raw
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ─── Empty-brand fallback tests (DESIGN.md §VI risk #5) ───────────────────────

describe('WalmartClient.search — empty-brand fallback', () => {
  it('returns a product whose brandName is empty when its name contains the target brand', async () => {
    const items = [
      // brandName is empty; product name contains "Fairlife"
      makeWalmartProduct({ itemId: 77, name: 'Fairlife Whole Milk 52 fl oz', brandName: '', msrp: 5.49 }),
    ]
    const client = makeClient(makeFetchMock({ 'whole milk': items, 'milk': items }))
    const result = await client.search({ name: 'whole milk', brand: 'Fairlife' })
    expect(result).not.toBeNull()
    expect(result!.name).toContain('Fairlife')
  })

  it('excludes a product whose brandName is empty and name does not contain the target brand', async () => {
    const items = [
      makeWalmartProduct({ itemId: 88, name: 'Great Value Whole Milk', brandName: '', msrp: 2.99 }),
    ]
    const client = makeClient(makeFetchMock({ 'whole milk': items, 'milk': items }))
    const result = await client.search({ name: 'whole milk', brand: 'Fairlife' })
    expect(result).toBeNull()
  })
})

// ─── Legacy shim tests ────────────────────────────────────────────────────────

describe('WalmartClient.getPriceForIngredient — legacy shim', () => {
  it('delegates to search and returns a compatible result shape', async () => {
    const items = [
      makeWalmartProduct({ itemId: 42, name: 'Whole Milk', brandName: 'Great Value', msrp: 2.99 }),
    ]
    const client = makeClient(makeFetchMock({ 'milk': items, 'whole milk': items }))
    const result = await client.getPriceForIngredient('whole milk', '75201')
    expect(result).not.toBeNull()
    expect(result!.regularPrice).toBe(2.99)
    expect(result!.brand).toBe('Great Value')
  })

  it('delegates to search with name+zipCode — fetch URL contains the zip', async () => {
    const items = [
      makeWalmartProduct({ itemId: 99, name: 'Whole Milk', brandName: 'Great Value', msrp: 3.49 }),
    ]
    // Capture actual fetch calls to verify the zipCode is forwarded
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const query = url.searchParams.get('query') ?? ''
      const products = query === 'milk' ? items : []
      return new Response(JSON.stringify({ items: products }), { status: 200 })
    }) as unknown as typeof fetch
    const client = makeClient(fetchMock)
    const result = await client.getPriceForIngredient('milk', '12345')
    expect(result).not.toBeNull()
    expect(result!.regularPrice).toBe(3.49)
    // Verify the zip code was forwarded in the fetch URL
    const calledUrl = new URL(String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0]))
    expect(calledUrl.searchParams.get('zipCode')).toBe('12345')
  })
})
