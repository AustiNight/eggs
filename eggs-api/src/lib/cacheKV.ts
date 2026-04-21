// ─── cacheKV — generic typed KV-cache wrapper ─────────────────────────────────
//
// A thin, zero-dependency wrapper that adds typed caching on top of any
// Cloudflare KVNamespace-compatible interface.  Production callers pass
// `env.FDC_CACHE`, `env.ONTOLOGY_CACHE`, or `env.SPEC_CACHE` directly.
// Tests pass a simple in-memory mock that implements KVLike.
//
// Behavior:
//   1. Compute key = keyFn(...args).
//   2. ns.get(key) — returns a raw string or null (null = key absent / expired).
//      Any non-null string is a cache hit; we JSON.parse it ourselves so that
//      stored "null" (loader returned null, e.g. FDC 404) is correctly
//      distinguished from a missing key and does not re-hit the network.
//   3. Miss (raw === null) → call loader(...args).
//   4. Write result: ns.put(key, JSON.stringify(result), { expirationTtl }).
//   5. If loader throws → do NOT write to cache; propagate the error.

// ─── Public interface ─────────────────────────────────────────────────────────

/** Minimum interface any KV namespace must satisfy. Cloudflare's KVNamespace
 *  implements this, as does the in-memory mock used in tests.
 *
 *  Note: get(key) without options returns Promise<string | null>. This is the
 *  same contract as Cloudflare's real KVNamespace — raw-string mode is used so
 *  that stored "null" (a loader that returned null, e.g. FDC 404) is a cache
 *  hit, not a miss. */
export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface CacheKVOptions<Args extends readonly unknown[], T> {
  /** The KV namespace to use for cache reads/writes. */
  ns: KVLike
  /** How long to cache the result, in seconds. */
  ttlSeconds: number
  /** Derive the cache key from the call arguments. Must be stable and unique. */
  keyFn: (...args: Args) => string
  /** The upstream function to call on a cache miss. */
  loader: (...args: Args) => Promise<T>
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Returns a cached version of `opts.loader`.
 *
 * The returned function is a drop-in replacement for `loader` that
 * transparently checks the KV namespace before calling upstream.
 *
 * @example
 * const cachedSearch = cacheKV({
 *   ns: env.FDC_CACHE,
 *   ttlSeconds: 7 * 24 * 3600,
 *   keyFn: (name: string) => `fdc:v1:search:${name}`,
 *   loader: (name: string) => upstream.search(name),
 * })
 * const results = await cachedSearch('whole milk')
 */
export function cacheKV<Args extends readonly unknown[], T>(
  opts: CacheKVOptions<Args, T>
): (...args: Args) => Promise<T> {
  const { ns, ttlSeconds, keyFn, loader } = opts

  return async (...args: Args): Promise<T> => {
    const key = keyFn(...args)

    // ── Cache read ────────────────────────────────────────────────────────────
    // Use raw-string get so that stored "null" (loader returned null, e.g. FDC
    // 404) is correctly identified as a cache hit and not a missing key.
    // ns.get(key) returns null only when the key doesn't exist or has expired.
    const cached = await ns.get(key)
    if (cached !== null) {
      return JSON.parse(cached) as T
    }

    // ── Cache miss — call loader ───────────────────────────────────────────────
    // Any error from the loader propagates immediately; we never write on failure.
    const result = await loader(...args)

    // ── Write back ────────────────────────────────────────────────────────────
    await ns.put(key, JSON.stringify(result), { expirationTtl: ttlSeconds })

    return result
  }
}
