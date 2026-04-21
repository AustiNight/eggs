// ─── UsdaFdcClient tests ──────────────────────────────────────────────────────
//
// All tests use a mocked `fetchImpl` — no real network calls.
// Mock responses match the FDC v1 API JSON shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UsdaFdcClient } from './usda-fdc.js'
import type { KVLike } from '../lib/cacheKV.js'

// ─── In-memory KV mock (same pattern as cacheKV.test.ts) ─────────────────────

function makeMockKV(): KVLike & { _store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    _store: store,
    async get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown> {
      const raw = store.get(key)
      if (raw === undefined) return null
      if (options?.type === 'json') return JSON.parse(raw)
      return raw
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value)
    },
  } as KVLike & { _store: Map<string, string> }
}

// ─── Realistic FDC API response fixtures ─────────────────────────────────────

const FDC_SEARCH_RESPONSE = {
  totalHits: 2,
  currentPage: 1,
  totalPages: 1,
  pageList: [1],
  foods: [
    {
      fdcId: 2346770,
      description: 'WHOLE MILK, VITAMIN D',
      dataType: 'Branded',
      brandOwner: 'Organic Valley',
      brandName: 'Organic Valley',
      gtinUpc: '093966002044',
      servingSize: 240,
      servingSizeUnit: 'ml',
      packageWeight: '64 OZ',
      householdServingFullText: '1 cup',
      brandedFoodCategory: 'Dairy',
      score: 950.1,
    },
    {
      fdcId: 2099999,
      description: 'WHOLE MILK',
      dataType: 'Branded',
      brandOwner: null,
      brandName: 'STORE BRAND',
      gtinUpc: null,
      servingSize: 240,
      servingSizeUnit: 'mL',
      packageWeight: null,
      householdServingFullText: null,
      brandedFoodCategory: 'Dairy',
      score: 840.5,
    },
  ],
}

const FDC_FOOD_RESPONSE = {
  fdcId: 2346770,
  description: 'WHOLE MILK, VITAMIN D',
  dataType: 'Branded',
  brandOwner: 'Organic Valley',
  brandName: 'Organic Valley',
  gtinUpc: '093966002044',
  servingSize: 240,
  servingSizeUnit: 'ml',
  packageWeight: '64 OZ',
  householdServingFullText: '1 cup',
  brandedFoodCategory: 'Dairy',
}

// A fixture with missing / null optional fields to test null-safe mapping
const FDC_FOOD_SPARSE = {
  fdcId: 1111111,
  description: 'SPARSE ITEM',
  dataType: 'Branded',
  // no brandOwner, no brandName, no gtinUpc, etc.
}

// ─── Helper: make a fetch mock that returns a given JSON body ─────────────────

function makeFetch(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }) as unknown as typeof fetch
}

// ─── searchBrandedByName ──────────────────────────────────────────────────────

describe('UsdaFdcClient.searchBrandedByName', () => {
  it('returns mapped FdcBrandedHit[] from the FDC search response', async () => {
    const fetchImpl = makeFetch(FDC_SEARCH_RESPONSE)
    const client = new UsdaFdcClient({
      apiKey: 'test-key',
      cacheNs: makeMockKV(),
      fetchImpl,
    })

    const hits = await client.searchBrandedByName('whole milk')
    expect(hits).toHaveLength(2)

    const first = hits[0]
    expect(first.fdcId).toBe(2346770)
    expect(first.description).toBe('WHOLE MILK, VITAMIN D')
    expect(first.brandOwner).toBe('Organic Valley')
    expect(first.brandName).toBe('Organic Valley')
    expect(first.gtinUpc).toBe('093966002044')
    expect(first.servingSize).toBe(240)
    expect(first.servingSizeUnit).toBe('ml')
    expect(first.packageWeight).toBe('64 OZ')
    expect(first.householdServingFullText).toBe('1 cup')
    expect(first.brandedFoodCategory).toBe('Dairy')
  })

  it('maps null fields to null (null-safe mapping)', async () => {
    const fetchImpl = makeFetch(FDC_SEARCH_RESPONSE)
    const client = new UsdaFdcClient({
      apiKey: 'test-key',
      cacheNs: makeMockKV(),
      fetchImpl,
    })

    const hits = await client.searchBrandedByName('whole milk')
    const second = hits[1]
    expect(second.brandOwner).toBeNull()
    expect(second.gtinUpc).toBeNull()
    expect(second.packageWeight).toBeNull()
    expect(second.householdServingFullText).toBeNull()
  })

  it('includes the api_key in the request URL', async () => {
    const fetchImpl = makeFetch(FDC_SEARCH_RESPONSE)
    const client = new UsdaFdcClient({
      apiKey: 'MY_SECRET_KEY',
      cacheNs: makeMockKV(),
      fetchImpl,
    })

    await client.searchBrandedByName('cheddar')
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('api_key=MY_SECRET_KEY')
  })

  it('encodes query=<term> in the URL and requests dataType=Branded', async () => {
    const fetchImpl = makeFetch(FDC_SEARCH_RESPONSE)
    const client = new UsdaFdcClient({
      apiKey: 'k',
      cacheNs: makeMockKV(),
      fetchImpl,
    })

    await client.searchBrandedByName('whole milk')
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('query=whole+milk')
    expect(calledUrl).toContain('dataType=Branded')
  })

  it('does NOT call fetch on the second call (cache hit)', async () => {
    const fetchImpl = makeFetch(FDC_SEARCH_RESPONSE)
    const ns = makeMockKV()
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: ns, fetchImpl })

    await client.searchBrandedByName('whole milk')
    await client.searchBrandedByName('whole milk')

    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('returns an empty array when the FDC returns no foods', async () => {
    const fetchImpl = makeFetch({ totalHits: 0, currentPage: 1, totalPages: 0, pageList: [], foods: [] })
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })

    const hits = await client.searchBrandedByName('xyzzy-no-match')
    expect(hits).toEqual([])
  })
})

// ─── getByFdcId ───────────────────────────────────────────────────────────────

describe('UsdaFdcClient.getByFdcId', () => {
  it('returns a single FdcBrandedHit for a known fdcId', async () => {
    const fetchImpl = makeFetch(FDC_FOOD_RESPONSE)
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })

    const hit = await client.getByFdcId(2346770)
    expect(hit).not.toBeNull()
    expect(hit!.fdcId).toBe(2346770)
    expect(hit!.description).toBe('WHOLE MILK, VITAMIN D')
    expect(hit!.brandOwner).toBe('Organic Valley')
    expect(hit!.packageWeight).toBe('64 OZ')
  })

  it('returns null when the FDC returns 404', async () => {
    const fetchImpl = makeFetch({ error: 'Not found' }, 404)
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })

    const hit = await client.getByFdcId(9999999)
    expect(hit).toBeNull()
  })

  it('maps sparse/missing fields to null (null-safe)', async () => {
    const fetchImpl = makeFetch(FDC_FOOD_SPARSE)
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })

    const hit = await client.getByFdcId(1111111)
    expect(hit).not.toBeNull()
    expect(hit!.fdcId).toBe(1111111)
    expect(hit!.brandOwner).toBeNull()
    expect(hit!.brandName).toBeNull()
    expect(hit!.gtinUpc).toBeNull()
    expect(hit!.servingSize).toBeNull()
    expect(hit!.servingSizeUnit).toBeNull()
    expect(hit!.packageWeight).toBeNull()
    expect(hit!.householdServingFullText).toBeNull()
    expect(hit!.brandedFoodCategory).toBeNull()
  })

  it('does NOT call fetch on the second call with the same fdcId (cache hit)', async () => {
    const fetchImpl = makeFetch(FDC_FOOD_RESPONSE)
    const ns = makeMockKV()
    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: ns, fetchImpl })

    await client.getByFdcId(2346770)
    await client.getByFdcId(2346770)

    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('includes api_key in the getByFdcId URL', async () => {
    const fetchImpl = makeFetch(FDC_FOOD_RESPONSE)
    const client = new UsdaFdcClient({ apiKey: 'SECRET123', cacheNs: makeMockKV(), fetchImpl })

    await client.getByFdcId(2346770)
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('api_key=SECRET123')
    expect(calledUrl).toContain('/2346770')
  })
})

// ─── 429 retry behavior ───────────────────────────────────────────────────────

describe('UsdaFdcClient — 429 rate-limit handling', () => {
  it('retries once on 429 then succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return { ok: false, status: 429, json: async () => ({}), text: async () => '{}' }
      }
      return {
        ok: true, status: 200,
        json: async () => FDC_SEARCH_RESPONSE,
        text: async () => JSON.stringify(FDC_SEARCH_RESPONSE),
      }
    }) as unknown as typeof fetch

    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })
    const hits = await client.searchBrandedByName('milk')

    expect(hits).toHaveLength(2)
    expect(calls).toBe(2)
  })

  it('throws a descriptive error when still 429 after one retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({}), text: async () => '{}',
    }) as unknown as typeof fetch

    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })
    await expect(client.searchBrandedByName('milk')).rejects.toThrow(/429|rate.?limit/i)
  })

  it('does not retry more than once', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++
      return { ok: false, status: 429, json: async () => ({}), text: async () => '{}' }
    }) as unknown as typeof fetch

    const client = new UsdaFdcClient({ apiKey: 'k', cacheNs: makeMockKV(), fetchImpl })
    await expect(client.searchBrandedByName('milk')).rejects.toThrow()
    expect(calls).toBe(2)
  })
})
