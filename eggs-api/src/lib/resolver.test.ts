// ─── resolver tests ───────────────────────────────────────────────────────────
//
// Tests the resolveItem two-tool loop + specCache integration + naiveParse.
// Uses in-memory mocks for the provider (ModelProvider) and the KV namespace.
// No real Anthropic API or Cloudflare KV calls are made.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveItem, naiveParse, preSearchCandidates } from './resolver.js'
import type { ResolveItemInput, ResolverDeps, SearchAdapter } from './resolver.js'
import { SpecCache } from './specCache.js'
import type { KVLike } from './cacheKV.js'
import type { ModelProvider, CompletionResult } from '../providers/index.js'
import type { ShoppableItemSpec } from '../types/spec.js'

// ─── In-memory KVLike mock ────────────────────────────────────────────────────

function makeMockKV(): KVLike {
  const store = new Map<string, string>()
  return {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value)
    },
  }
}

// ─── Provider mock helpers ────────────────────────────────────────────────────

function makeCompletionResult(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    content: '',
    model: 'claude-haiku-4-5',
    usage: { inputTokens: 10, outputTokens: 20 },
    ...overrides,
  }
}

/** Builds a mock provider that returns a finalize_item tool call. */
function makeFinalizeProvider(specInput: Partial<ShoppableItemSpec> = {}): ModelProvider {
  return {
    complete: vi.fn().mockResolvedValue(
      makeCompletionResult({
        stopReason: 'tool_use',
        toolCalls: [
          {
            id: 'tc-finalize',
            name: 'finalize_item',
            input: {
              id: specInput.id ?? 'test-id',
              sourceText: specInput.sourceText ?? 'whole milk',
              displayName: specInput.displayName ?? 'Whole Milk',
              categoryPath: specInput.categoryPath ?? ['beverages', 'milk'],
              brand: specInput.brand ?? null,
              brandLocked: specInput.brandLocked ?? false,
              quantity: specInput.quantity ?? 1,
              unit: specInput.unit ?? 'gal',
              confidence: specInput.confidence ?? 'high',
            },
          },
        ],
      })
    ),
  }
}

/** Builds a mock provider that returns an ask_clarification tool call. */
function makeAskProvider(itemId: string = 'test-id'): ModelProvider {
  return {
    complete: vi.fn().mockResolvedValue(
      makeCompletionResult({
        stopReason: 'tool_use',
        toolCalls: [
          {
            id: 'tc-ask',
            name: 'ask_clarification',
            input: {
              itemId,
              question: 'What fat percentage?',
              options: ['Whole (3.25%)', '2%', '1%', 'Skim'],
            },
          },
        ],
      })
    ),
  }
}

// ─── Shared spec factory ──────────────────────────────────────────────────────

function makeSpec(overrides: Partial<ShoppableItemSpec> = {}): ShoppableItemSpec {
  return {
    id: 'test-id',
    sourceText: 'whole milk',
    displayName: 'Whole Milk',
    categoryPath: ['beverages', 'milk', 'whole-milk'],
    brand: null,
    brandLocked: false,
    quantity: 1,
    unit: 'gal',
    resolutionTrace: [],
    confidence: 'high',
    ...overrides,
  }
}

// ─── Shared deps factory ──────────────────────────────────────────────────────

function makeDeps(provider: ModelProvider, kv?: KVLike): ResolverDeps {
  const ns = kv ?? makeMockKV()
  const specCache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
  return { provider, specCache }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveItem — cache hit', () => {
  it('returns cached spec and does NOT call provider', async () => {
    const provider = makeFinalizeProvider()
    const ns = makeMockKV()
    const specCache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const spec = makeSpec()

    // Pre-warm cache
    await specCache.write('whole milk', spec)

    const input: ResolveItemInput = { id: 'test-id', rawText: 'whole milk' }
    const result = await resolveItem(input, { provider, specCache })

    expect(result.kind).toBe('cached')
    if (result.kind === 'cached') {
      expect(result.spec.displayName).toBe('Whole Milk')
    }
    // Provider must NOT have been called
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})

describe('resolveItem — cache miss + provider finalizes', () => {
  it('returns finalized spec and writes to cache', async () => {
    const ns = makeMockKV()
    const specCache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const provider = makeFinalizeProvider({ displayName: 'Whole Milk', unit: 'gal' })

    const input: ResolveItemInput = { id: 'test-id', rawText: 'whole milk' }
    const result = await resolveItem(input, { provider, specCache })

    expect(result.kind).toBe('finalized')
    if (result.kind === 'finalized') {
      expect(result.spec.displayName).toBe('Whole Milk')
      expect(result.spec.unit).toBe('gal')
    }

    // Should now be in cache
    const cached = await specCache.lookup('whole milk')
    expect(cached).not.toBeNull()
    expect(cached?.displayName).toBe('Whole Milk')
  })

  it('calls provider exactly once on first-turn resolution', async () => {
    const provider = makeFinalizeProvider()
    const deps = makeDeps(provider)

    await resolveItem({ id: 'test-id', rawText: 'whole milk' }, deps)

    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})

describe('resolveItem — cache miss + provider asks clarification', () => {
  it('returns ask_clarification without writing to cache', async () => {
    const ns = makeMockKV()
    const specCache = new SpecCache({ ns, modelId: 'claude-haiku-4-5' })
    const provider = makeAskProvider('test-id')

    const input: ResolveItemInput = { id: 'test-id', rawText: 'milk' }
    const result = await resolveItem(input, { provider, specCache })

    expect(result.kind).toBe('ask_clarification')
    if (result.kind === 'ask_clarification') {
      expect(result.request.itemId).toBe('test-id')
      expect(result.request.question).toBe('What fat percentage?')
      expect(result.request.options).toContain('Whole (3.25%)')
    }

    // Cache should NOT be written on a clarification turn
    const cached = await specCache.lookup('milk')
    expect(cached).toBeNull()
  })
})

describe('resolveItem — turn cap enforcement', () => {
  it('forces finalize_item when priorTrace.length >= 3', async () => {
    const provider = makeFinalizeProvider({ displayName: 'Milk (auto-resolved)', confidence: 'low' })
    const deps = makeDeps(provider)

    const priorTrace = [
      { question: 'What fat %?', options: ['Whole', 'Skim'], answer: 'Whole', turnNumber: 1 },
      { question: 'Brand?', options: ['Organic Valley', 'Any'], answer: 'Any', turnNumber: 2 },
      { question: 'Size?', options: ['Half gallon', 'Gallon'], answer: 'Gallon', turnNumber: 3 },
    ]

    const input: ResolveItemInput = { id: 'test-id', rawText: 'milk', priorTrace }
    const result = await resolveItem(input, deps)

    // Must finalize, not ask
    expect(result.kind).toBe('finalized')

    // Provider was called with forced tool_choice = finalize_item
    const calls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    const params = calls[0][0] as { toolChoice?: { type: string; name?: string } }
    expect(params.toolChoice).toEqual({ type: 'tool', name: 'finalize_item' })
  })
})

describe('resolveItem — wall-clock timeout fallback', () => {
  it('returns naive-parse spec with confidence:low when provider times out', async () => {
    // Use a real very-short timeout + a provider that resolves just after it
    // to trigger the race condition without fake timers.
    // The provider sleeps 200ms; wallClockMs is 50ms → timeout wins.
    const slowProvider: ModelProvider = {
      complete: vi.fn().mockImplementation(
        () => new Promise<CompletionResult>((resolve) => {
          globalThis.setTimeout(() => resolve(makeCompletionResult()), 200)
        })
      ),
    }
    const deps = makeDeps(slowProvider)

    const result = await resolveItem(
      { id: 'test-id', rawText: '3 lbs ground beef' },
      { ...deps, wallClockMs: 50 }
    )

    expect(result.kind).toBe('finalized')
    if (result.kind === 'finalized') {
      expect(result.spec.confidence).toBe('low')
      expect(result.spec.categoryPath).toEqual(['uncategorized'])
    }
  }, 3000)

  it('returns naive-parse spec when provider throws', async () => {
    const failProvider: ModelProvider = {
      complete: vi.fn().mockRejectedValue(new Error('API unavailable')),
    }
    const deps = makeDeps(failProvider)

    const result = await resolveItem(
      { id: 'test-id', rawText: 'chicken stock' },
      { ...deps, wallClockMs: 5000 }
    )

    expect(result.kind).toBe('finalized')
    if (result.kind === 'finalized') {
      expect(result.spec.confidence).toBe('low')
    }
  })
})

describe('resolveItem — retrieval candidates in system prompt', () => {
  it('includes candidate products in the system prompt when provided', async () => {
    const provider = makeFinalizeProvider()
    const deps = makeDeps(provider)

    const candidates = [
      { brand: 'Organic Valley', name: 'Whole Milk', size: '1 gal' },
      { brand: 'Horizon', name: 'Organic Whole Milk', size: '0.5 gal' },
    ]

    await resolveItem(
      { id: 'test-id', rawText: 'whole milk', retrievalCandidates: candidates },
      deps
    )

    const calls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    const systemPrompt = (calls[0][0] as { system: string }).system

    expect(systemPrompt).toContain('Organic Valley')
    expect(systemPrompt).toContain('Horizon')
    expect(systemPrompt).toContain('Real product candidates')
  })

  it('does not include candidate block when retrievalCandidates is empty', async () => {
    const provider = makeFinalizeProvider()
    const deps = makeDeps(provider)

    await resolveItem(
      { id: 'test-id', rawText: 'whole milk', retrievalCandidates: [] },
      deps
    )

    const calls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls
    const systemPrompt = (calls[0][0] as { system: string }).system
    expect(systemPrompt).not.toContain('Real product candidates')
  })
})

describe('resolveItem — invalid finalize_item spec', () => {
  it('falls back to naive parse when validateSpec fails', async () => {
    // Provider returns a finalize_item with an invalid unit
    const badProvider: ModelProvider = {
      complete: vi.fn().mockResolvedValue(
        makeCompletionResult({
          stopReason: 'tool_use',
          toolCalls: [
            {
              id: 'tc-bad',
              name: 'finalize_item',
              input: {
                id: 'test-id',
                sourceText: 'milk',
                displayName: 'Milk',
                categoryPath: ['beverages'],
                brand: null,
                brandLocked: false,
                quantity: 1,
                unit: 'INVALID_UNIT',  // not in CANONICAL_UNITS
                confidence: 'high',
              },
            },
          ],
        })
      ),
    }
    const deps = makeDeps(badProvider)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await resolveItem({ id: 'test-id', rawText: 'milk' }, deps)

    expect(result.kind).toBe('finalized')
    if (result.kind === 'finalized') {
      // Naive fallback → confidence must be 'low'
      expect(result.spec.confidence).toBe('low')
    }
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ─── naiveParse tests ─────────────────────────────────────────────────────────

describe('naiveParse', () => {
  it('extracts numeric quantity from first token', () => {
    const spec = naiveParse('3 lbs ground beef', 'id-1')
    expect(spec.quantity).toBe(3)
    expect(spec.displayName).toBe('lbs ground beef')
  })

  it('defaults to quantity 1 when first token is not a number', () => {
    const spec = naiveParse('chicken breast', 'id-2')
    expect(spec.quantity).toBe(1)
    expect(spec.displayName).toBe('chicken breast')
  })

  it('always returns confidence:low, unit:each, brand:null', () => {
    const spec = naiveParse('whole milk', 'id-3')
    expect(spec.confidence).toBe('low')
    expect(spec.unit).toBe('each')
    expect(spec.brand).toBeNull()
    expect(spec.brandLocked).toBe(false)
  })

  it('sets categoryPath to ["uncategorized"]', () => {
    const spec = naiveParse('whatever', 'id-4')
    expect(spec.categoryPath).toEqual(['uncategorized'])
  })

  it('carries priorTrace through', () => {
    const trace = [{ question: 'Q?', options: ['A', 'B'], answer: 'A', turnNumber: 1 }]
    const spec = naiveParse('milk', 'id-5', trace)
    expect(spec.resolutionTrace).toEqual(trace)
  })
})

// ─── preSearchCandidates tests ────────────────────────────────────────────────

describe('preSearchCandidates', () => {
  it('returns empty array when no adapters are provided', async () => {
    const result = await preSearchCandidates('chicken', [])
    expect(result).toEqual([])
  })

  it('collects results from multiple adapters', async () => {
    const adapter1: SearchAdapter = {
      search: vi.fn().mockResolvedValue({ brand: 'Tyson', name: 'Chicken Breast', size: '2 lb' }),
    }
    const adapter2: SearchAdapter = {
      search: vi.fn().mockResolvedValue({ brand: 'Perdue', name: 'Chicken Breast', size: '3 lb' }),
    }
    const results = await preSearchCandidates('chicken', [adapter1, adapter2])
    expect(results).toHaveLength(2)
    expect(results.map(r => r.brand)).toContain('Tyson')
    expect(results.map(r => r.brand)).toContain('Perdue')
  })

  it('deduplicates by (brand, name)', async () => {
    const adapter1: SearchAdapter = {
      search: vi.fn().mockResolvedValue({ brand: 'Tyson', name: 'Chicken Breast', size: '2 lb' }),
    }
    const adapter2: SearchAdapter = {
      search: vi.fn().mockResolvedValue({ brand: 'Tyson', name: 'Chicken Breast', size: '2 lb' }),
    }
    const results = await preSearchCandidates('chicken', [adapter1, adapter2])
    expect(results).toHaveLength(1)
  })

  it('handles adapter returning null gracefully', async () => {
    const adapter: SearchAdapter = {
      search: vi.fn().mockResolvedValue(null),
    }
    const results = await preSearchCandidates('chicken', [adapter])
    expect(results).toEqual([])
  })

  it('handles adapter rejection gracefully', async () => {
    const badAdapter: SearchAdapter = {
      search: vi.fn().mockRejectedValue(new Error('network error')),
    }
    const goodAdapter: SearchAdapter = {
      search: vi.fn().mockResolvedValue({ brand: 'Tyson', name: 'Chicken Breast', size: '2 lb' }),
    }
    const results = await preSearchCandidates('chicken', [badAdapter, goodAdapter])
    expect(results).toHaveLength(1)
    expect(results[0].brand).toBe('Tyson')
  })
})
