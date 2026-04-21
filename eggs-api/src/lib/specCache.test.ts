// ─── specCache tests ──────────────────────────────────────────────────────────
//
// Tests L1/L2 cache lookup and write behavior using an in-memory KVLike mock.
// No real Cloudflare KV or network calls are made.

import { describe, it, expect, beforeEach } from 'vitest'
import { SpecCache, normalizeRaw } from './specCache.js'
import type { KVLike } from './cacheKV.js'
import type { ShoppableItemSpec } from '../types/spec.js'

// ─── In-memory KVLike mock ────────────────────────────────────────────────────

function makeMockKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value)
    },
  }
}

// ─── Minimal valid ShoppableItemSpec factory ──────────────────────────────────

function makeSpec(overrides: Partial<ShoppableItemSpec> = {}): ShoppableItemSpec {
  return {
    id: 'test-id',
    sourceText: '2 lbs chicken',
    displayName: 'Chicken Breast',
    categoryPath: ['proteins', 'poultry', 'chicken-breast'],
    brand: null,
    brandLocked: false,
    quantity: 2,
    unit: 'lb',
    resolutionTrace: [],
    confidence: 'high',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SpecCache — L1 hit', () => {
  it('returns the cached spec on exact raw string match without hitting L2', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec({ sourceText: '2 lbs chicken' })

    await cache.write('2 lbs chicken', spec)

    // Overwrite the L2 key with garbage to confirm we never read it
    const l2Key = await cache._keyL2('2 lbs chicken')
    ns.store.set(l2Key, '"not-the-spec"')

    const result = await cache.lookup('2 lbs chicken')
    expect(result).not.toBeNull()
    expect(result?.displayName).toBe('Chicken Breast')
    // L1 is the exact match — should NOT have fallen through to garbled L2
    expect(result).toEqual(spec)
  })
})

describe('SpecCache — L1 miss + L2 hit', () => {
  it('resolves via L2 when raw string differs only in casing', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec({ sourceText: 'Chicken Breast', displayName: 'Chicken Breast' })

    // Write with title-case raw string
    await cache.write('Chicken Breast', spec)

    // Lookup with all-lowercase — L1 should miss, L2 should hit
    // (normalizeRaw("chicken breast") === normalizeRaw("Chicken Breast"))
    const result = await cache.lookup('chicken breast')
    expect(result).not.toBeNull()
    expect(result?.displayName).toBe('Chicken Breast')
  })

  it('resolves via L2 when raw string has extra whitespace', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec({ sourceText: 'whole milk' })

    await cache.write('whole milk', spec)

    // "whole  milk" (double-space) normalizes to "whole milk" → L2 hit
    const result = await cache.lookup('whole  milk')
    expect(result).not.toBeNull()
    expect(result?.sourceText).toBe('whole milk')
  })
})

describe('SpecCache — L1 miss + L2 miss', () => {
  it('returns null when the item has never been cached', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })

    const result = await cache.lookup('cucumber')
    expect(result).toBeNull()
  })

  it('returns null for a different item even when other items are cached', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    await cache.write('whole milk', makeSpec({ displayName: 'Whole Milk' }))

    const result = await cache.lookup('skim milk')
    expect(result).toBeNull()
  })
})

describe('SpecCache — write puts under both L1 and L2 keys', () => {
  it('stores entries under both raw and normalized keys', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec({ sourceText: 'Foo Bar' })

    await cache.write('Foo Bar', spec)

    const l1Key = await cache._keyL1('Foo Bar')
    const l2Key = await cache._keyL2('Foo Bar')

    expect(ns.store.has(l1Key)).toBe(true)
    expect(ns.store.has(l2Key)).toBe(true)
  })

  it('L1 key for "Foo Bar" and L2 key for "foo bar" exist after write("Foo Bar", spec)', async () => {
    const ns = makeMockKV()
    const cache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec({ sourceText: 'Foo Bar' })

    await cache.write('Foo Bar', spec)

    // L1 uses the trimmed raw string; L2 uses normalizeRaw("Foo Bar") = "foo bar"
    const l1Key = await cache._keyL1('Foo Bar')
    const l2KeyForLower = await cache._keyL2('foo bar')

    // L2 key for "foo bar" should match L2 key for "Foo Bar" (both normalize to "foo bar")
    const l2KeyForOrig = await cache._keyL2('Foo Bar')
    expect(l2KeyForLower).toBe(l2KeyForOrig)

    expect(ns.store.has(l1Key)).toBe(true)
    expect(ns.store.has(l2KeyForLower)).toBe(true)
  })
})

describe('SpecCache — key format', () => {
  it('L1 key starts with spec:v1:{modelId}:raw:', async () => {
    const cache = new SpecCache({ ns: makeMockKV(), modelId: 'claude-haiku-4-5' })
    const key = await cache._keyL1('whole milk')
    expect(key).toMatch(/^spec:v1:claude-haiku-4-5:raw:[0-9a-f]{64}$/)
  })

  it('L2 key starts with spec:v1:{modelId}:norm:', async () => {
    const cache = new SpecCache({ ns: makeMockKV(), modelId: 'claude-haiku-4-5' })
    const key = await cache._keyL2('Whole Milk')
    expect(key).toMatch(/^spec:v1:claude-haiku-4-5:norm:[0-9a-f]{64}$/)
  })

  it('different modelIds produce different keys for the same raw string', async () => {
    const cache1 = new SpecCache({ ns: makeMockKV(), modelId: 'claude-haiku-4-5' })
    const cache2 = new SpecCache({ ns: makeMockKV(), modelId: 'claude-sonnet-4-6' })
    const k1 = await cache1._keyL1('whole milk')
    const k2 = await cache2._keyL1('whole milk')
    expect(k1).not.toBe(k2)
  })
})

describe('normalizeRaw', () => {
  it('lowercases and trims', () => {
    expect(normalizeRaw('  Chicken Breast  ')).toBe('chicken breast')
  })

  it('collapses multiple spaces to one', () => {
    expect(normalizeRaw('whole   milk')).toBe('whole milk')
  })

  it('preserves numbers', () => {
    expect(normalizeRaw('2 lbs chicken')).toBe('2 lbs chicken')
    expect(normalizeRaw('3 lbs chicken')).not.toBe(normalizeRaw('2 lbs chicken'))
  })
})
