// ─── cacheKV — generic typed KV-cache wrapper tests ───────────────────────────
//
// Uses an in-memory KVLike mock to avoid any Cloudflare / Miniflare dependencies.
// Tests the four required behaviors plus a happy-path round trip.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cacheKV } from './cacheKV.js'
import type { KVLike } from './cacheKV.js'

// ─── In-memory KVLike mock ────────────────────────────────────────────────────

interface MockEntry {
  value: string
  expiresAt: number  // ms epoch; Infinity = no TTL set
}

function makeMockKV(): KVLike & { _store: Map<string, MockEntry>; _now: () => number } {
  const store = new Map<string, MockEntry>()
  let nowMs = Date.now()

  return {
    _store: store,
    _now: () => nowMs,

    async get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt !== Infinity && nowMs >= entry.expiresAt) {
        store.delete(key)
        return null
      }
      if (options?.type === 'json') return JSON.parse(entry.value)
      return entry.value
    },

    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      const expiresAt = options?.expirationTtl
        ? nowMs + options.expirationTtl * 1000
        : Infinity
      store.set(key, { value, expiresAt })
    },

    // Test helper: advance the internal clock by `ms` milliseconds
    advanceTime(ms: number) {
      nowMs += ms
    },
  } as KVLike & { _store: Map<string, MockEntry>; _now: () => number; advanceTime: (ms: number) => void }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cacheKV — cache miss calls loader', () => {
  it('calls the loader when the key is not cached and returns its result', async () => {
    const ns = makeMockKV()
    const loader = vi.fn().mockResolvedValue({ msg: 'hello' })

    const fn = cacheKV({
      ns,
      ttlSeconds: 60,
      keyFn: (x: string) => `prefix:${x}`,
      loader,
    })

    const result = await fn('world')
    expect(result).toEqual({ msg: 'hello' })
    expect(loader).toHaveBeenCalledOnce()
    expect(loader).toHaveBeenCalledWith('world')
  })

  it('writes the loader result into the KV namespace after a miss', async () => {
    const ns = makeMockKV() as ReturnType<typeof makeMockKV>
    const loader = vi.fn().mockResolvedValue(42)

    const fn = cacheKV({
      ns,
      ttlSeconds: 300,
      keyFn: (n: number) => `num:${n}`,
      loader,
    })

    await fn(7)
    expect((ns as any)._store.has('num:7')).toBe(true)
  })
})

describe('cacheKV — cache hit skips loader', () => {
  it('returns cached value on second call without calling loader again', async () => {
    const ns = makeMockKV()
    const loader = vi.fn().mockResolvedValue({ value: 'cached' })

    const fn = cacheKV({
      ns,
      ttlSeconds: 3600,
      keyFn: (k: string) => `key:${k}`,
      loader,
    })

    const first = await fn('a')
    const second = await fn('a')

    expect(first).toEqual({ value: 'cached' })
    expect(second).toEqual({ value: 'cached' })
    // Loader should only have been called once — the second call is a cache hit
    expect(loader).toHaveBeenCalledOnce()
  })

  it('returns different cached values for different keys', async () => {
    const ns = makeMockKV()
    let callCount = 0
    const loader = vi.fn().mockImplementation(async (k: string) => {
      callCount++
      return { k, call: callCount }
    })

    const fn = cacheKV({
      ns,
      ttlSeconds: 3600,
      keyFn: (k: string) => `multi:${k}`,
      loader,
    })

    const r1 = await fn('x')
    const r2 = await fn('y')
    // Both should hit the loader (different keys)
    expect(loader).toHaveBeenCalledTimes(2)
    // Third call reuses cache for 'x'
    const r3 = await fn('x')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(r3).toEqual(r1)
    expect(r2).not.toEqual(r1)
  })
})

describe('cacheKV — TTL expiry triggers re-fetch', () => {
  it('calls loader again after the TTL window has elapsed', async () => {
    const ns = makeMockKV() as ReturnType<typeof makeMockKV> & { advanceTime: (ms: number) => void }
    let seq = 0
    const loader = vi.fn().mockImplementation(async () => ({ seq: ++seq }))

    const ttlSeconds = 10
    const fn = cacheKV({
      ns,
      ttlSeconds,
      keyFn: (_: string) => 'ttl-test',
      loader,
    })

    // First call — miss → loader
    const r1 = await fn('a')
    expect(r1).toEqual({ seq: 1 })
    expect(loader).toHaveBeenCalledOnce()

    // Advance time past TTL
    ;(ns as any).advanceTime((ttlSeconds + 1) * 1000)

    // Second call — TTL expired → should call loader again
    const r2 = await fn('a')
    expect(r2).toEqual({ seq: 2 })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does NOT call loader again before TTL expires', async () => {
    const ns = makeMockKV() as ReturnType<typeof makeMockKV> & { advanceTime: (ms: number) => void }
    const loader = vi.fn().mockResolvedValue({ val: 'fresh' })

    const ttlSeconds = 60
    const fn = cacheKV({
      ns,
      ttlSeconds,
      keyFn: (_: string) => 'still-fresh',
      loader,
    })

    await fn('x')
    // Advance time to just before expiry
    ;(ns as any).advanceTime((ttlSeconds - 1) * 1000)
    await fn('x')

    expect(loader).toHaveBeenCalledOnce()
  })
})

describe('cacheKV — loader failure does not poison cache', () => {
  it('propagates the error without writing to the cache', async () => {
    const ns = makeMockKV() as ReturnType<typeof makeMockKV>
    const loader = vi.fn().mockRejectedValue(new Error('upstream failure'))

    const fn = cacheKV({
      ns,
      ttlSeconds: 3600,
      keyFn: (k: string) => `fail:${k}`,
      loader,
    })

    await expect(fn('boom')).rejects.toThrow('upstream failure')
    // Nothing should be written into the cache
    expect((ns as any)._store.has('fail:boom')).toBe(false)
  })

  it('retries the loader on the next call after a prior failure', async () => {
    const ns = makeMockKV()
    let attempt = 0
    const loader = vi.fn().mockImplementation(async () => {
      attempt++
      if (attempt === 1) throw new Error('first attempt fails')
      return { attempt }
    })

    const fn = cacheKV({
      ns,
      ttlSeconds: 3600,
      keyFn: (_: string) => 'retry-key',
      loader,
    })

    await expect(fn('x')).rejects.toThrow('first attempt fails')
    const result = await fn('x')
    expect(result).toEqual({ attempt: 2 })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})

describe('cacheKV — happy-path round trip', () => {
  it('round-trips a complex nested object through JSON serialization', async () => {
    const ns = makeMockKV()
    const payload = {
      id: 'abc-123',
      scores: [1.5, 2.7, 3.14],
      meta: { active: true, tags: ['a', 'b'] },
      nullField: null,
    }
    const loader = vi.fn().mockResolvedValue(payload)

    const fn = cacheKV({
      ns,
      ttlSeconds: 100,
      keyFn: (id: string) => `obj:${id}`,
      loader,
    })

    const first = await fn('abc-123')
    const second = await fn('abc-123')

    expect(first).toEqual(payload)
    expect(second).toEqual(payload)
    expect(loader).toHaveBeenCalledOnce()
  })
})
