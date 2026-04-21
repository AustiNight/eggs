// ─── OffTaxonomyClient tests ──────────────────────────────────────────────────
//
// All tests use a mocked `fetchImpl` — no real network calls.
// Mock responses match the Open Food Facts v2 API JSON shape.

import { describe, it, expect, vi } from 'vitest'
import { OffTaxonomyClient } from './off-taxonomy.js'
import type { KVLike } from '../lib/cacheKV.js'

// ─── In-memory KV mock ────────────────────────────────────────────────────────

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

// ─── Realistic OFF taxonomy API response fixtures ─────────────────────────────

// OFF v2 taxonomy returns an object keyed by tag value
const OFF_TAXONOMY_RESPONSE = {
  'en:whole-milks': {
    name: { en: 'Whole milks', fr: 'Laits entiers' },
    synonyms: { en: ['whole milk', 'full-fat milk', 'full fat milk'] },
    parents: ['en:milks'],
    children: ['en:organic-whole-milks', 'en:uht-whole-milks'],
  },
}

// A taxonomy response with no parents, no children, no synonyms (edge case)
const OFF_TAXONOMY_SPARSE = {
  'en:xyzzy': {
    name: { en: 'Xyzzy' },
  },
}

const OFF_SEARCH_RESPONSE = {
  count: 2,
  page: 1,
  page_count: 1,
  products: [
    {
      code: '093966002044',
      product_name: 'Organic Valley Whole Milk',
      brands: 'Organic Valley',
      categories_tags: ['en:dairy-products', 'en:milks', 'en:whole-milks'],
      labels_tags: ['en:organic', 'en:usda-organic'],
      countries_tags: ['en:united-states'],
      quantity: '64 oz',
      serving_size: '1 cup (240 ml)',
      image_url: 'https://images.openfoodfacts.org/images/products/093/966/002/044/front_en.jpg',
    },
    {
      code: '041000000001',
      product_name: null,
      brands: 'Store Brand',
      categories_tags: ['en:dairy-products', 'en:milks'],
      labels_tags: [],
      countries_tags: ['en:united-states'],
      quantity: null,
      serving_size: null,
      image_url: null,
    },
  ],
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeFetch(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }) as unknown as typeof fetch
}

// ─── Taxonomy: getParents ─────────────────────────────────────────────────────

describe('OffTaxonomyClient.getParents', () => {
  it('returns parent tags for a known tag', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const parents = await client.getParents('en:whole-milks')
    expect(parents).toEqual(['en:milks'])
  })

  it('returns empty array when no parents are present', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_SPARSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const parents = await client.getParents('en:xyzzy')
    expect(parents).toEqual([])
  })

  it('returns empty array for an unknown tag (key not in response)', async () => {
    const fetchImpl = makeFetch({})
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const parents = await client.getParents('en:does-not-exist')
    expect(parents).toEqual([])
  })
})

// ─── Taxonomy: getChildren ────────────────────────────────────────────────────

describe('OffTaxonomyClient.getChildren', () => {
  it('returns child tags for a known tag', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const children = await client.getChildren('en:whole-milks')
    expect(children).toEqual(['en:organic-whole-milks', 'en:uht-whole-milks'])
  })

  it('returns empty array when no children are present', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_SPARSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const children = await client.getChildren('en:xyzzy')
    expect(children).toEqual([])
  })
})

// ─── Taxonomy: getSynonyms ────────────────────────────────────────────────────

describe('OffTaxonomyClient.getSynonyms', () => {
  it('returns English synonyms by default', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const synonyms = await client.getSynonyms('en:whole-milks')
    expect(synonyms).toEqual(['whole milk', 'full-fat milk', 'full fat milk'])
  })

  it('returns empty array when no synonyms for the requested language', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    // Request Italian synonyms — not in fixture
    const synonyms = await client.getSynonyms('en:whole-milks', 'it')
    expect(synonyms).toEqual([])
  })

  it('returns empty array when synonyms key is absent from the tag entry', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_SPARSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const synonyms = await client.getSynonyms('en:xyzzy')
    expect(synonyms).toEqual([])
  })
})

// ─── Taxonomy: cache hit skips second fetch ───────────────────────────────────

describe('OffTaxonomyClient — taxonomy caching', () => {
  it('does not call fetch on the second taxonomy call for the same tag+lang', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const ns = makeMockKV()
    const client = new OffTaxonomyClient({ cacheNs: ns, fetchImpl })

    await client.getParents('en:whole-milks')
    await client.getParents('en:whole-milks')

    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('getChildren and getParents share the same cached taxonomy response', async () => {
    const fetchImpl = makeFetch(OFF_TAXONOMY_RESPONSE)
    const ns = makeMockKV()
    const client = new OffTaxonomyClient({ cacheNs: ns, fetchImpl })

    // Both methods derive from the same taxonomy fetch (same tag, same lang)
    await client.getParents('en:whole-milks')
    await client.getChildren('en:whole-milks')

    // Should have been fetched only once since they share a cache key
    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })
})

// ─── Product search ───────────────────────────────────────────────────────────

describe('OffTaxonomyClient.searchByText', () => {
  it('returns mapped OffProduct[] from the search response', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const products = await client.searchByText('whole milk')
    expect(products).toHaveLength(2)

    const first = products[0]
    expect(first.code).toBe('093966002044')
    expect(first.productName).toBe('Organic Valley Whole Milk')
    expect(first.brands).toBe('Organic Valley')
    expect(first.categoriesTags).toEqual(['en:dairy-products', 'en:milks', 'en:whole-milks'])
    expect(first.labelsTags).toEqual(['en:organic', 'en:usda-organic'])
    expect(first.countriesTags).toEqual(['en:united-states'])
    expect(first.quantity).toBe('64 oz')
    expect(first.servingSize).toBe('1 cup (240 ml)')
    expect(first.imageUrl).toContain('openfoodfacts.org')
  })

  it('maps null fields to null (null-safe mapping)', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const products = await client.searchByText('whole milk')
    const second = products[1]
    expect(second.productName).toBeNull()
    expect(second.quantity).toBeNull()
    expect(second.servingSize).toBeNull()
    expect(second.imageUrl).toBeNull()
  })

  it('sends countries_tags_en=united-states by default', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    await client.searchByText('whole milk')
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('countries_tags_en=united-states')
  })

  it('allows overriding the country filter', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    await client.searchByText('fromage', { country: 'france' })
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('countries_tags_en=france')
  })

  it('encodes search_terms in the URL', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    await client.searchByText('whole milk')
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('search_terms=whole+milk')
  })

  it('does not call fetch on the second identical search (cache hit)', async () => {
    const fetchImpl = makeFetch(OFF_SEARCH_RESPONSE)
    const ns = makeMockKV()
    const client = new OffTaxonomyClient({ cacheNs: ns, fetchImpl })

    await client.searchByText('whole milk')
    await client.searchByText('whole milk')

    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('returns empty array when products array is missing', async () => {
    const fetchImpl = makeFetch({ count: 0 })
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const results = await client.searchByText('nothing')
    expect(results).toEqual([])
  })
})

// ─── 429 behavior — does NOT retry ───────────────────────────────────────────

describe('OffTaxonomyClient — 429 does not retry', () => {
  it('throws immediately on 429 without a second fetch', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++
      return { ok: false, status: 429, json: async () => ({}), text: async () => '{}' }
    }) as unknown as typeof fetch

    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    await expect(client.searchByText('milk')).rejects.toThrow(/429|rate.?limit/i)
    // Must NOT have retried
    expect(calls).toBe(1)
  })

  it('throws immediately on 429 for taxonomy lookups', async () => {
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++
      return { ok: false, status: 429, json: async () => ({}), text: async () => '{}' }
    }) as unknown as typeof fetch

    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    await expect(client.getParents('en:milks')).rejects.toThrow(/429|rate.?limit/i)
    expect(calls).toBe(1)
  })
})
