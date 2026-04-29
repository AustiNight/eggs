// ─── candidate-grader tests ───────────────────────────────────────────────────
//
// TDD coverage for gradeCandidates() — seven test scenarios covering the
// exact/substitute/wrong categories, brand-lock enforcement, cache hits,
// and mixed batches.
//
// All LLM calls are mocked via a ModelProvider stub. KV uses the in-memory
// stub pattern from size-resolver.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gradeCandidates } from './candidate-grader.js'
import type { GradeRequest } from './candidate-grader.js'
import type { ModelProvider, CompletionResult } from '../providers/index.js'

// ─── KV stub ─────────────────────────────────────────────────────────────────

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    get: vi.fn(async (key: string) => {
      const raw = store.get(key)
      return raw !== undefined ? raw : null
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
  } as unknown as KVNamespace
  return { kv, store }
}

// ─── Provider stub factory ────────────────────────────────────────────────────

function makeProvider(responseJson: Record<string, unknown>): ModelProvider {
  return {
    complete: vi.fn(async (): Promise<CompletionResult> => ({
      content: JSON.stringify(responseJson),
      model: 'claude-haiku-4-5',
      usage: { inputTokens: 50, outputTokens: 50 },
    })),
  }
}

// ─── Spec / candidate fixtures ────────────────────────────────────────────────

function makeSpec(overrides: Partial<GradeRequest['spec']> = {}): GradeRequest['spec'] {
  return {
    id: 'spec-1',
    displayName: 'Whole Milk',
    brand: null,
    brandLocked: false,
    quantity: 1,
    unit: 'gal',
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<GradeRequest['candidates'][0]> = {}): GradeRequest['candidates'][0] {
  return {
    sku: 'sku-1',
    storeName: 'Kroger',
    name: 'Kroger Whole Milk Vitamin D',
    brand: 'Kroger',
    size: '1 gallon',
    unitPrice: 3.99,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('gradeCandidates', () => {
  // ── Test 1: Exact match ────────────────────────────────────────────────────
  it('1. exact match — whole milk candidate gets score >= 90 and category exact', async () => {
    const { kv } = makeKvStub()
    const provider = makeProvider({
      'sku-1': { score: 95, category: 'exact', reason: 'Same product class and brand.' },
    })
    const req: GradeRequest = {
      spec: makeSpec({ displayName: 'Whole Milk' }),
      candidates: [makeCandidate({ sku: 'sku-1', name: 'Kroger Whole Milk Vitamin D' })],
    }

    const grades = await gradeCandidates(req, provider, kv)

    expect(grades.get('sku-1')).toMatchObject({
      score: 95,
      category: 'exact',
    })
    expect(grades.get('sku-1')!.score).toBeGreaterThanOrEqual(90)
  })

  // ── Test 2: Substitute ─────────────────────────────────────────────────────
  it('2. substitute — Quaker Oats for steel cut oats gets category substitute with reason', async () => {
    const { kv } = makeKvStub()
    const provider = makeProvider({
      'sku-oats': {
        score: 65,
        category: 'substitute',
        reason: 'Different brand and slightly different cut, but equivalent oat product.',
      },
    })
    const req: GradeRequest = {
      spec: makeSpec({ displayName: '1 lb steel cut oats', quantity: 1, unit: 'lb' }),
      candidates: [
        makeCandidate({
          sku: 'sku-oats',
          name: 'Quaker Oats Old Fashioned',
          brand: 'Quaker',
          size: '1.25 lb cylinder',
          unitPrice: 4.29,
        }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)
    const grade = grades.get('sku-oats')!

    expect(grade.category).toBe('substitute')
    expect(grade.reason.length).toBeGreaterThan(0)
    expect(grade.score).toBeGreaterThanOrEqual(50)
    expect(grade.score).toBeLessThan(90)
  })

  // ── Test 3: Wrong — kiwi vs yogurt ────────────────────────────────────────
  it('3. wrong — yogurt candidate for kiwi spec gets category wrong', async () => {
    const { kv } = makeKvStub()
    const provider = makeProvider({
      'sku-yogurt': {
        score: 5,
        category: 'wrong',
        reason: 'Yogurt product, not the requested kiwi fruit.',
      },
    })
    const req: GradeRequest = {
      spec: makeSpec({ displayName: 'whole kiwi', unit: 'each' }),
      candidates: [
        makeCandidate({
          sku: 'sku-yogurt',
          name: 'Stonyfield Whole Milk Yogurt',
          brand: 'Stonyfield',
          size: '32 oz',
          unitPrice: 5.49,
        }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)
    expect(grades.get('sku-yogurt')!.category).toBe('wrong')
  })

  // ── Test 4: Wrong — seedless vs seeded grapes ─────────────────────────────
  it('4. wrong — seeded grapes for seedless grapes spec gets category wrong', async () => {
    const { kv } = makeKvStub()
    const provider = makeProvider({
      'sku-seeded': {
        score: 20,
        category: 'wrong',
        reason: 'Seeded red grapes returned, but seedless was requested.',
      },
    })
    const req: GradeRequest = {
      spec: makeSpec({ displayName: 'Red Seedless Grapes', unit: 'lb' }),
      candidates: [
        makeCandidate({
          sku: 'sku-seeded',
          name: 'Fresh Seeded Red Grapes',
          brand: '',
          size: '2 lb bag',
          unitPrice: 3.99,
        }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)
    expect(grades.get('sku-seeded')!.category).toBe('wrong')
  })

  // ── Test 5: Brand-lock — wrong brand should be wrong ──────────────────────
  it('5. brand-lock — Kroger brand for Fairlife brand-locked spec gets category wrong', async () => {
    const { kv } = makeKvStub()
    const provider = makeProvider({
      'sku-kroger-milk': {
        score: 10,
        category: 'wrong',
        reason: 'Brand mismatch: Kroger brand returned but Fairlife was brand-locked.',
      },
    })
    const req: GradeRequest = {
      spec: makeSpec({
        displayName: 'Fairlife Whole Milk',
        brand: 'Fairlife',
        brandLocked: true,
        unit: 'gal',
      }),
      candidates: [
        makeCandidate({
          sku: 'sku-kroger-milk',
          name: 'Kroger Whole Milk Vitamin D',
          brand: 'Kroger',
          size: '1 gallon',
          unitPrice: 3.99,
        }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)
    expect(grades.get('sku-kroger-milk')!.category).toBe('wrong')
  })

  // ── Test 6: Cache hit — previously graded candidates skip the LLM ─────────
  it('6. cache hit — previously graded SKU is returned without calling the LLM', async () => {
    const { kv, store } = makeKvStub()
    const cachedGrade = { score: 92, category: 'exact', reason: 'Same product.' }
    store.set('grade:spec-1:sku-cached', JSON.stringify(cachedGrade))

    const provider = makeProvider({}) // complete should NOT be called
    const completeSpy = vi.spyOn(provider, 'complete')

    const req: GradeRequest = {
      spec: makeSpec({ id: 'spec-1' }),
      candidates: [
        makeCandidate({ sku: 'sku-cached' }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)

    expect(completeSpy).not.toHaveBeenCalled()
    expect(grades.get('sku-cached')).toMatchObject(cachedGrade)
  })

  // ── Test 7: Mixed batch — LLM called only with uncached candidates ─────────
  it('7. mixed batch — LLM called only for uncached candidates, cached ones bypass it', async () => {
    const { kv, store } = makeKvStub()

    // Pre-populate cache for sku-A
    const cachedGradeA = { score: 95, category: 'exact', reason: 'Already cached.' }
    store.set('grade:spec-mixed:sku-A', JSON.stringify(cachedGradeA))

    // Provider returns grade only for sku-B
    const provider = makeProvider({
      'sku-B': { score: 60, category: 'substitute', reason: 'Similar product, different brand.' },
    })
    const completeSpy = vi.spyOn(provider, 'complete')

    const req: GradeRequest = {
      spec: makeSpec({ id: 'spec-mixed', displayName: 'Whole Milk' }),
      candidates: [
        makeCandidate({ sku: 'sku-A', name: 'Already Cached Product' }),
        makeCandidate({ sku: 'sku-B', name: 'Uncached Product', brand: 'Other Brand' }),
      ],
    }

    const grades = await gradeCandidates(req, provider, kv)

    // LLM should have been called exactly once (for the uncached subset only)
    expect(completeSpy).toHaveBeenCalledTimes(1)

    // Verify the LLM was called with only sku-B in the candidates list
    const callArgs = completeSpy.mock.calls[0][0]
    const userMessage = callArgs.messages[0].content
    expect(userMessage).toContain('sku-B')
    expect(userMessage).not.toContain('sku-A')

    // Both grades should be present in results
    expect(grades.get('sku-A')).toMatchObject(cachedGradeA)
    expect(grades.get('sku-B')).toMatchObject({ category: 'substitute', score: 60 })
  })
})
