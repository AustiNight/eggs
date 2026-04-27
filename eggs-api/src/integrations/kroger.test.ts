// ─── KrogerClient tests ────────────────────────────────────────────────────────
//
// All tests use a mocked fetchImpl — no real network calls.
// Mock responses match the Kroger Products v1 API JSON shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KrogerClient } from './kroger.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProduct(overrides: {
  productId?: string
  description?: string
  brand?: string
  price?: number
  size?: string
}) {
  return {
    productId: overrides.productId ?? 'prod-1',
    description: overrides.description ?? 'Test Product',
    brand: overrides.brand ?? 'Test Brand',
    items: [{
      itemId: `item-${overrides.productId ?? 'prod-1'}`,
      price: { regular: overrides.price ?? 3.99, promo: undefined },
      size: overrides.size ?? '16 oz',
      soldBy: 'UNIT',
    }],
    images: [],
  }
}

function makeTokenResponse() {
  return {
    access_token: 'fake-token',
    expires_in: 1800,
  }
}

function makeSearchResponse(products: ReturnType<typeof makeProduct>[]) {
  return { data: products }
}

// A fetch mock that responds to token + products requests
function makeFetchMock(
  productMap: Record<string, ReturnType<typeof makeProduct>[]>
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)

    // Token endpoint
    if (url.includes('/connect/oauth2/token')) {
      return new Response(JSON.stringify(makeTokenResponse()), { status: 200 })
    }

    // Products endpoint — extract query param to determine which fixture to return
    if (url.includes('/products')) {
      const u = new URL(url)
      const term = u.searchParams.get('filter.term') ?? ''
      const products = productMap[term] ?? []
      return new Response(JSON.stringify(makeSearchResponse(products)), { status: 200 })
    }

    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KrogerClient.search — brand filter', () => {
  it('(a) brand present and matches → returns the matching result', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Whole Milk', brand: "Organic Valley", price: 4.99, size: '64 oz' }),
      makeProduct({ productId: 'p2', description: 'Whole Milk Store Brand', brand: 'Kroger', price: 2.99, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.search({ name: 'whole milk', brand: 'Organic Valley', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.brand).toBe('Organic Valley')
    expect(result!.regularPrice).toBe(4.99)
  })

  it('(b) brand present but no result matches → returns null', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Whole Milk', brand: 'Kroger', price: 2.99, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.search({ name: 'whole milk', brand: 'Tillamook', locationIds: ['loc-1'] })
    expect(result).toBeNull()
  })

  it('(c) no brand provided → returns first priced result regardless of brand', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Whole Milk Store Brand', brand: 'Kroger', price: 2.99, size: '64 oz' }),
      makeProduct({ productId: 'p2', description: 'Whole Milk', brand: "Organic Valley", price: 4.99, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.search({ name: 'whole milk', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.regularPrice).toBe(2.99)
  })
})

describe('KrogerClient.search — unit preference', () => {
  it('(a) prefers results whose parsed size is in the same base dimension as input.unit', async () => {
    // Two products: one measured in ml (volume), one in oz (mass)
    const products = [
      makeProduct({ productId: 'p-vol', description: 'Olive Oil 500ml', brand: 'Generic', price: 5.99, size: '500 ml' }),
      makeProduct({ productId: 'p-mass', description: 'Olive Oil 16oz', brand: 'Generic', price: 6.49, size: '16 oz' }),
    ]
    // Requesting unit=fl_oz (volume) → should prefer the 500ml product
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'olive oil': products }))
    const result = await client.search({ name: 'olive oil', unit: 'fl_oz', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('item-p-vol')
  })

  it('(b) falls back to all results when no candidate matches the requested base dimension', async () => {
    // Only mass products; requested unit is volume (fl_oz) — no match → fall back to first priced
    const products = [
      makeProduct({ productId: 'p1', description: 'Olive Oil 16oz', brand: 'Generic', price: 5.99, size: '16 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'olive oil': products }))
    const result = await client.search({ name: 'olive oil', unit: 'fl_oz', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('item-p1')
  })
})

describe('KrogerClient.search — cascade integration', () => {
  it('stripped query matches and raw query is skipped', async () => {
    // "1 head garlic" → stripped "garlic" returns results; raw query should never fire
    const fetchMock = makeFetchMock({
      'garlic': [makeProduct({ productId: 'p-garlic', description: 'Garlic Bulb', brand: 'Generic', price: 0.99, size: '1 each' })],
      '1 head garlic': [], // raw query returns nothing
    })
    const client = new KrogerClient('id', 'secret', fetchMock)
    const result = await client.search({ name: '1 head garlic', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.name).toContain('Garlic')
    // token call + 1 product call (stripped only — raw skipped)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('raw fallback is used when stripped query returns no priced results', async () => {
    // "bottle olive oil" → stripped "olive oil" returns nothing; raw returns results
    const fetchMock = makeFetchMock({
      'olive oil': [],
      'bottle olive oil': [makeProduct({ productId: 'p-oil', description: "Chef's Bottle Olive Oil", brand: 'Generic', price: 7.99, size: '500 ml' })],
    })
    const client = new KrogerClient('id', 'secret', fetchMock)
    const result = await client.search({ name: 'bottle olive oil', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('item-p-oil')
    // token call + 2 product calls (stripped then raw)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('first-hit-only: stops iterating remaining locations once any has yielded candidates', async () => {
    // loc-1 returns a product; loc-2 must NOT be queried at all (subrequest savings).
    const queriedLocations: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/connect/oauth2/token')) {
        return new Response(JSON.stringify(makeTokenResponse()), { status: 200 })
      }
      if (url.includes('/products')) {
        const u = new URL(url)
        const locationId = u.searchParams.get('filter.locationId') ?? '?'
        queriedLocations.push(locationId)
        if (locationId === 'loc-1') {
          return new Response(JSON.stringify(makeSearchResponse([
            makeProduct({ productId: 'p1', description: 'Milk', brand: 'Kroger', price: 3.49, size: '64 oz' })
          ])), { status: 200 })
        }
        return new Response(JSON.stringify(makeSearchResponse([])), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    const client = new KrogerClient('id', 'secret', fetchMock)
    const result = await client.search({ name: 'milk', locationIds: ['loc-1', 'loc-2'] })
    expect(result).not.toBeNull()
    expect(result!.matchedLocationId).toBe('loc-1')
    expect(queriedLocations).toEqual(['loc-1'])
  })

  it('first-hit-only: falls through to loc-2 when loc-1 has zero priced matches', async () => {
    // Trimming to first-hit doesn't mean "primary only" — it means "first
    // location with results wins." When loc-1 is empty, we should still try loc-2.
    const queriedLocations: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/connect/oauth2/token')) {
        return new Response(JSON.stringify(makeTokenResponse()), { status: 200 })
      }
      if (url.includes('/products')) {
        const u = new URL(url)
        const locationId = u.searchParams.get('filter.locationId') ?? '?'
        queriedLocations.push(locationId)
        if (locationId === 'loc-2') {
          return new Response(JSON.stringify(makeSearchResponse([
            makeProduct({ productId: 'p1', description: 'Milk', brand: 'Kroger', price: 3.49, size: '64 oz' })
          ])), { status: 200 })
        }
        return new Response(JSON.stringify(makeSearchResponse([])), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    const client = new KrogerClient('id', 'secret', fetchMock)
    const result = await client.search({ name: 'milk', locationIds: ['loc-1', 'loc-2'] })
    expect(result).not.toBeNull()
    expect(result!.matchedLocationId).toBe('loc-2')
    expect(queriedLocations).toEqual(['loc-1', 'loc-2'])
  })
})

// Minimal in-memory KVNamespace stub for caching tests.
function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key)
      if (raw === undefined) return null
      return type === 'json' ? JSON.parse(raw) : raw
    }),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
  } as unknown as KVNamespace
  return { kv, store }
}

describe('KrogerClient — KV caching of token + locations', () => {
  it('reuses cached token across new client instances', async () => {
    const { kv } = makeKvStub()
    const fetchMock = makeFetchMock({ 'milk': [makeProduct({ productId: 'p1', description: 'Milk', price: 3.49 })] })
    const client1 = new KrogerClient('id', 'secret', fetchMock, kv)
    await client1.search({ name: 'milk', locationIds: ['loc-1'] })
    const tokenCallsAfterFirst = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => String(c[0]).includes('/connect/oauth2/token')).length
    expect(tokenCallsAfterFirst).toBe(1)

    // Second client (simulating a new request invocation) — should hit KV, not fetch a new token.
    const client2 = new KrogerClient('id', 'secret', fetchMock, kv)
    await client2.search({ name: 'milk', locationIds: ['loc-1'] })
    const tokenCallsAfterSecond = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => String(c[0]).includes('/connect/oauth2/token')).length
    expect(tokenCallsAfterSecond).toBe(1)
  })

  it('reuses cached locations for the same lat/lng/radius', async () => {
    const { kv } = makeKvStub()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/connect/oauth2/token')) {
        return new Response(JSON.stringify(makeTokenResponse()), { status: 200 })
      }
      if (url.includes('/locations')) {
        return new Response(JSON.stringify({ data: [{ locationId: 'loc-1', name: 'Kroger Foo', address: { addressLine1: '1 Main', city: 'X', state: 'TX' } }] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    const client1 = new KrogerClient('id', 'secret', fetchMock, kv)
    await client1.findNearbyLocations(32.7767, -96.7970, 10)
    const locCallsAfterFirst = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => String(c[0]).includes('/locations')).length
    expect(locCallsAfterFirst).toBe(1)

    const client2 = new KrogerClient('id', 'secret', fetchMock, kv)
    const result2 = await client2.findNearbyLocations(32.7767, -96.7970, 10)
    const locCallsAfterSecond = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => String(c[0]).includes('/locations')).length
    expect(locCallsAfterSecond).toBe(1)
    expect(result2).toHaveLength(1)
  })
})

describe('KrogerClient.search — empty-brand fallback (DESIGN.md §VI risk #5)', () => {
  it('returns a product whose brand field is empty when its name contains the target brand', async () => {
    const products = [
      // brand field is empty; product name contains the target brand "Fairlife"
      makeProduct({ productId: 'p1', description: 'Fairlife Whole Milk 52 fl oz', brand: '', price: 5.49, size: '52 fl oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.search({ name: 'whole milk', brand: 'Fairlife', locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.name).toContain('Fairlife')
  })

  it('excludes a product whose brand field is empty and name does not contain the target brand', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Great Value Whole Milk', brand: '', price: 2.99, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.search({ name: 'whole milk', brand: 'Fairlife', locationIds: ['loc-1'] })
    expect(result).toBeNull()
  })
})

describe('KrogerClient.search — synonym-map brand variants', () => {
  it('brand filter handles apostrophe vs no-apostrophe variants (Land O\'Lakes)', async () => {
    // Store returns brand "Land O Lakes" (no apostrophe)
    const products = [
      makeProduct({ productId: 'p1', description: 'Land O Lakes Butter', brand: 'Land O Lakes', price: 4.29, size: '16 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'butter': products, 'land o lakes butter': products }))
    // Caller passes brand with apostrophe — should match via synonym map
    const result = await client.search({ name: 'land o lakes butter', brand: "Land O'Lakes", locationIds: ['loc-1'] })
    expect(result).not.toBeNull()
    expect(result!.brand).toBe('Land O Lakes')
  })
})

describe('KrogerClient.getPriceForIngredient — legacy shim', () => {
  it('delegates to search and returns a compatible result shape', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Whole Milk', brand: 'Kroger', price: 2.99, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products, 'whole milk': products }))
    const result = await client.getPriceForIngredient('whole milk', 'loc-1')
    expect(result).not.toBeNull()
    expect(result!.regularPrice).toBe(2.99)
    expect(result!.matchedLocationId).toBe('loc-1')
  })

  it('accepts an array of locationIds as before', async () => {
    const products = [
      makeProduct({ productId: 'p1', description: 'Milk', brand: 'Kroger', price: 3.49, size: '64 oz' }),
    ]
    const client = new KrogerClient('id', 'secret', makeFetchMock({ 'milk': products }))
    const result = await client.getPriceForIngredient('milk', ['loc-1', 'loc-2'])
    expect(result).not.toBeNull()
    expect(result!.matchedLocationId).toBe('loc-1')
  })
})
