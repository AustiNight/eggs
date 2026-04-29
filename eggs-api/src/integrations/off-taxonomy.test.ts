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
    // Returns the raw stored string, or null when the key is absent.
    // Matches the KVLike contract: null = miss, any string = hit (caller parses).
    async get(key: string): Promise<string | null> {
      const raw = store.get(key)
      return raw !== undefined ? raw : null
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

// ─── broaderTerm ──────────────────────────────────────────────────────────────

// Fixture: search response for "steel cut oats" → product has "en:steel-cut-oats" as
// most-specific tag.  The taxonomy lookup for that tag returns parent "en:oats".
const OFF_SEARCH_STEEL_CUT_OATS = {
  products: [
    {
      code: '123456789012',
      product_name: 'Steel Cut Oats 28oz',
      brands: 'Bob\'s Red Mill',
      categories_tags: ['en:cereals-and-their-products', 'en:oat-products', 'en:steel-cut-oats'],
      labels_tags: [],
      countries_tags: ['en:united-states'],
      quantity: '28 oz',
      serving_size: null,
      image_url: null,
    },
  ],
}

const OFF_TAXONOMY_STEEL_CUT_OATS = {
  'en:steel-cut-oats': {
    name: { en: 'Steel cut oats' },
    parents: ['en:oats'],
  },
}

// Fixture: search for "whole kiwi" → most-specific tag is "en:kiwis", parent "en:fruits"
const OFF_SEARCH_WHOLE_KIWI = {
  products: [
    {
      code: '000000000001',
      product_name: 'Whole Kiwi',
      brands: '',
      categories_tags: ['en:fresh-foods', 'en:fruits', 'en:kiwis'],
      labels_tags: [],
      countries_tags: ['en:united-states'],
      quantity: null,
      serving_size: null,
      image_url: null,
    },
  ],
}

const OFF_TAXONOMY_KIWI = {
  'en:kiwis': {
    name: { en: 'Kiwis' },
    parents: ['en:fruits'],
  },
}

// Fixture: search for "X-Large Eggs" → most-specific tag "en:x-large-eggs", parent "en:eggs"
const OFF_SEARCH_XLARGE_EGGS = {
  products: [
    {
      code: '000000000002',
      product_name: 'Grade A X-Large Eggs 12ct',
      brands: 'Generic',
      categories_tags: ['en:eggs', 'en:x-large-eggs'],
      labels_tags: [],
      countries_tags: ['en:united-states'],
      quantity: '12',
      serving_size: null,
      image_url: null,
    },
  ],
}

const OFF_TAXONOMY_XLARGE_EGGS = {
  'en:x-large-eggs': {
    name: { en: 'X-Large eggs' },
    parents: ['en:eggs'],
  },
}

/** Build a fetch mock that routes search and taxonomy requests to different fixtures. */
function makeRoutedFetch(
  searchResponse: unknown,
  taxonomyResponse: unknown
): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    const body = url.includes('/search') ? searchResponse : taxonomyResponse
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  }) as unknown as typeof fetch
}

describe('OffTaxonomyClient.broaderTerm', () => {
  it('"steel cut oats" → "oats"', async () => {
    const fetchImpl = makeRoutedFetch(OFF_SEARCH_STEEL_CUT_OATS, OFF_TAXONOMY_STEEL_CUT_OATS)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('steel cut oats')
    expect(result).toBe('oats')
  })

  it('"whole kiwi" → "fruits" (parent of en:kiwis)', async () => {
    const fetchImpl = makeRoutedFetch(OFF_SEARCH_WHOLE_KIWI, OFF_TAXONOMY_KIWI)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('whole kiwi')
    expect(result).toBe('fruits')
  })

  it('"X-Large Eggs" → "eggs"', async () => {
    const fetchImpl = makeRoutedFetch(OFF_SEARCH_XLARGE_EGGS, OFF_TAXONOMY_XLARGE_EGGS)
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('X-Large Eggs')
    expect(result).toBe('eggs')
  })

  it('completely-novel-product-xyz → null (no products returned)', async () => {
    const fetchImpl = makeFetch({ products: [] })
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('completely-novel-product-xyz')
    expect(result).toBeNull()
  })

  it('caches null results with 1-hour TTL (negative cache)', async () => {
    const ns = makeMockKV()
    const fetchImpl = makeFetch({ products: [] })
    const client = new OffTaxonomyClient({ cacheNs: ns, fetchImpl })

    const result = await client.broaderTerm('completely-novel-product-xyz')
    expect(result).toBeNull()

    // KV should now contain the "null" sentinel for this key
    const cacheKey = 'broader:completely-novel-product-xyz'
    const stored = await ns.get(cacheKey)
    expect(stored).toBe('null')  // JSON.stringify(null) === 'null'
  })

  it('returns cached result immediately on second call (no extra fetch)', async () => {
    const fetchImpl = makeRoutedFetch(OFF_SEARCH_STEEL_CUT_OATS, OFF_TAXONOMY_STEEL_CUT_OATS)
    const ns = makeMockKV()
    const client = new OffTaxonomyClient({ cacheNs: ns, fetchImpl })

    const first = await client.broaderTerm('steel cut oats')
    expect(first).toBe('oats')

    const callCountAfterFirst = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length

    const second = await client.broaderTerm('steel cut oats')
    expect(second).toBe('oats')

    // No additional fetch calls after the first resolution
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterFirst)
  })

  it('returns null when product has no category tags', async () => {
    const fetchImpl = makeFetch({
      products: [
        {
          code: '000000000099',
          product_name: 'Mystery Food',
          brands: '',
          categories_tags: [],
          labels_tags: [],
          countries_tags: ['en:united-states'],
          quantity: null,
          serving_size: null,
          image_url: null,
        },
      ],
    })
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('mystery food')
    expect(result).toBeNull()
  })

  it('returns null when the most-specific tag has no parents (top-level category)', async () => {
    const fetchImpl = makeRoutedFetch(
      {
        products: [{
          code: '000000000003',
          product_name: 'Food',
          brands: '',
          categories_tags: ['en:foods'],
          labels_tags: [],
          countries_tags: ['en:united-states'],
          quantity: null,
          serving_size: null,
          image_url: null,
        }],
      },
      // Taxonomy has no parents for en:foods
      { 'en:foods': { name: { en: 'Foods' } } }
    )
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('food')
    expect(result).toBeNull()
  })

  it('returns null gracefully when network throws (no crash)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch
    const client = new OffTaxonomyClient({ cacheNs: makeMockKV(), fetchImpl })

    const result = await client.broaderTerm('anything')
    expect(result).toBeNull()
  })
})
