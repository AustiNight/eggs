// ─── size-resolver tests ────────────────────────────────────────────────────────
//
// TDD coverage for the five-tier resolveProductSize function.
// All network calls are mocked; KV uses the in-memory stub from kroger.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveProductSize } from './size-resolver.js'
import type { ModelProvider, CompletionResult } from '../providers/index.js'

// ─── KV stub (same pattern as kroger.test.ts:makeKvStub) ─────────────────────

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    get: vi.fn(async (key: string) => {
      const raw = store.get(key)
      return raw !== undefined ? raw : null
    }),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
  } as unknown as KVNamespace
  return { kv, store }
}

// ─── FDC client stub ──────────────────────────────────────────────────────────

function makeFdcStub(hits: Array<{
  packageWeight?: string | null
  servingSize?: number | null
  servingSizeUnit?: string | null
}> = []) {
  return {
    searchBrandedByName: vi.fn(async () => hits.map(h => ({
      fdcId: 1,
      description: 'test',
      brandOwner: null,
      brandName: null,
      gtinUpc: null,
      servingSize: h.servingSize ?? null,
      servingSizeUnit: h.servingSizeUnit ?? null,
      packageWeight: h.packageWeight ?? null,
      householdServingFullText: null,
      brandedFoodCategory: null,
    })))
  }
}

// ─── OFF client stub ──────────────────────────────────────────────────────────

function makeOffStub(quantity: string | null = null) {
  return {
    searchByName: vi.fn(async () => ({
      products: quantity !== null ? [{ quantity }] : [],
      total: quantity !== null ? 1 : 0,
      page: 1,
      pageSize: 5,
    }))
  }
}

// ─── LLM provider stub ────────────────────────────────────────────────────────

function makeLlmStub(responseText: string): ModelProvider {
  return {
    complete: vi.fn(async (): Promise<CompletionResult> => ({
      content: responseText,
      model: 'claude-haiku-4-5',
      usage: { inputTokens: 10, outputTokens: 10 },
    }))
  }
}

// ─── Shared env ───────────────────────────────────────────────────────────────

function makeEnv() {
  const { kv: FDC_CACHE } = makeKvStub()
  const { kv: ONTOLOGY_CACHE } = makeKvStub()
  const { kv: URL_CACHE } = makeKvStub()
  return { FDC_CACHE, ONTOLOGY_CACHE, URL_CACHE }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveProductSize — tier 1: parseSize succeeds', () => {
  it('returns tier-1 result when size string is parseable, calls no other tier', async () => {
    const fdc = makeFdcStub()
    const off = makeOffStub()
    const llm = makeLlmStub('')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Whole Milk', brand: 'Kroger', size: '32 oz' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.quantity).toBe(32)
    expect(result!.unit).toBe('oz')
    expect(result!.source).toBe('parseSize')

    // No downstream tiers should be called
    expect(fdc.searchBrandedByName).not.toHaveBeenCalled()
    expect(off.searchByName).not.toHaveBeenCalled()
    expect((llm.complete as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

describe('resolveProductSize — tier 2: FDC succeeds', () => {
  it('returns FDC packageWeight when parseSize fails', async () => {
    const fdc = makeFdcStub([{ packageWeight: '32 OZ' }])
    const off = makeOffStub()
    const llm = makeLlmStub('')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Deli Thin Sliced Turkey', brand: 'Oscar Mayer', size: 'Family Size' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('fdc')
    expect(result!.unit).toBe('oz')
    expect(result!.quantity).toBe(32)

    expect(fdc.searchBrandedByName).toHaveBeenCalled()
    expect(off.searchByName).not.toHaveBeenCalled()
  })

  it('uses servingSize + servingSizeUnit when packageWeight is absent', async () => {
    const fdc = makeFdcStub([{ servingSize: 454, servingSizeUnit: 'g', packageWeight: null }])
    const off = makeOffStub()
    const llm = makeLlmStub('')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Ground Beef', brand: 'Generic', size: 'Not Parseable Size Label' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('fdc')
    expect(result!.unit).toBe('g')
    expect(result!.quantity).toBe(454)
  })
})

describe('resolveProductSize — tier 3: OFF succeeds', () => {
  it('returns OFF quantity when parseSize + FDC both fail', async () => {
    const fdc = makeFdcStub([]) // empty results
    const off = makeOffStub('500 g')
    const llm = makeLlmStub('')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Pasta Sauce', brand: 'Barilla', size: 'Grab-and-Go' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('off')
    expect(result!.unit).toBe('g')
    expect(result!.quantity).toBe(500)

    expect(fdc.searchBrandedByName).toHaveBeenCalled()
    expect(off.searchByName).toHaveBeenCalled()
    expect((llm.complete as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

describe('resolveProductSize — tier 4: web_fetch succeeds', () => {
  it('returns web_fetch result when first three tiers fail', async () => {
    const fdc = makeFdcStub([])
    const off = makeOffStub(null)
    const llm = makeLlmStub('{"quantity":16,"unit":"oz"}')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Mystery Snack', brand: 'Weird Co', size: 'Deli Counter', productUrl: 'https://example.com/product/123' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('web_fetch')
    expect(result!.quantity).toBe(16)
    expect(result!.unit).toBe('oz')

    const completeCalls = (llm.complete as ReturnType<typeof vi.fn>).mock.calls
    // Should have been called for web_fetch (not web_search)
    expect(completeCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('resolveProductSize — tier 5: web_search succeeds', () => {
  it('returns web_search result when all four prior tiers fail', async () => {
    const fdc = makeFdcStub([])
    const off = makeOffStub(null)

    let callCount = 0
    const llm: ModelProvider = {
      complete: vi.fn(async (): Promise<CompletionResult> => {
        callCount++
        // First call (web_fetch) returns unparseable, second (web_search) succeeds
        if (callCount === 1) {
          return { content: 'no size found', model: 'claude-haiku-4-5', usage: { inputTokens: 5, outputTokens: 5 } }
        }
        return { content: '{"quantity":12,"unit":"oz"}', model: 'claude-haiku-4-5', usage: { inputTokens: 5, outputTokens: 5 } }
      })
    }
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'Obscure Brand Chips', brand: 'NoBrand', size: 'Bag', productUrl: 'https://example.com/no-page' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('web_search')
    expect(result!.quantity).toBe(12)
    expect(result!.unit).toBe('oz')
    expect(callCount).toBe(2)
  })

  it('returns web_search result even without productUrl (skips tier 4)', async () => {
    const fdc = makeFdcStub([])
    const off = makeOffStub(null)
    const llm = makeLlmStub('{"quantity":8,"unit":"oz"}')
    const env = makeEnv()

    const result = await resolveProductSize(
      { name: 'No Url Product', brand: 'GenericBrand', size: 'Unknown Pkg' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.source).toBe('web_search')
    expect(result!.quantity).toBe(8)
  })
})

describe('resolveProductSize — all tiers fail → null', () => {
  it('returns null and does not throw when every tier fails', async () => {
    const fdc = makeFdcStub([])
    const off = makeOffStub(null)
    const llm = makeLlmStub('absolutely no size info here')
    const env = makeEnv()

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await resolveProductSize(
      { name: 'Unparseable Product', brand: 'MysteryBrand', size: 'N/A' },
      env,
      llm,
      fdc as never,
      off as never,
    )

    expect(result).toBeNull()
    // Should have logged a structured warning
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[size-resolver] all tiers failed'),
      expect.objectContaining({ name: 'Unparseable Product' })
    )

    consoleSpy.mockRestore()
  })
})

describe('resolveProductSize — KV cache hit skips tier', () => {
  it('returns cached FDC result without calling the FDC client', async () => {
    const fdc = makeFdcStub([{ packageWeight: '16 OZ' }]) // would succeed if called
    const off = makeOffStub(null)
    const llm = makeLlmStub('')
    const { kv: FDC_CACHE, store: fdcStore } = makeKvStub()
    const { kv: ONTOLOGY_CACHE } = makeKvStub()
    const { kv: URL_CACHE } = makeKvStub()

    // Pre-populate the FDC cache with a valid result
    const cachedValue = JSON.stringify({ quantity: 32, unit: 'oz', source: 'fdc' })
    fdcStore.set('fdc-size:oscar mayer:deli thin sliced turkey', cachedValue)

    const result = await resolveProductSize(
      { name: 'Deli Thin Sliced Turkey', brand: 'Oscar Mayer', size: 'Family Size' },
      { FDC_CACHE, ONTOLOGY_CACHE, URL_CACHE },
      llm,
      fdc as never,
      off as never,
    )

    expect(result).not.toBeNull()
    expect(result!.quantity).toBe(32)
    expect(result!.source).toBe('fdc')
    // FDC client should NOT have been called (cache hit)
    expect(fdc.searchBrandedByName).not.toHaveBeenCalled()
  })

  it('returns null immediately on negative cache (stored null)', async () => {
    const fdc = makeFdcStub([{ packageWeight: '16 OZ' }])
    const off = makeOffStub('500 g')
    const llm = makeLlmStub('{"quantity":8,"unit":"oz"}')
    const { kv: FDC_CACHE, store: fdcStore } = makeKvStub()
    const { kv: ONTOLOGY_CACHE, store: offStore } = makeKvStub()
    const { kv: URL_CACHE, store: urlStore } = makeKvStub()

    // Negative-cache all tiers
    fdcStore.set('fdc-size:mystery brand:mystery product', 'null')
    offStore.set('off-size:mystery brand:mystery product', 'null')
    urlStore.set('wsearch-size:mystery brand:mystery product', 'null')

    const result = await resolveProductSize(
      { name: 'Mystery Product', brand: 'Mystery Brand', size: 'Indecipherable Label' },
      { FDC_CACHE, ONTOLOGY_CACHE, URL_CACHE },
      llm,
      fdc as never,
      off as never,
    )

    expect(result).toBeNull()
    // No tier should have run
    expect(fdc.searchBrandedByName).not.toHaveBeenCalled()
    expect(off.searchByName).not.toHaveBeenCalled()
    expect((llm.complete as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})
