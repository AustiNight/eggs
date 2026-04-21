// ─── specCache — three-layer ShoppableItemSpec cache (L1 + L2 active, L3 flagged off) ─
//
// L1: exact raw-string hash     (e.g. "2 lbs chicken" → spec)
// L2: normalized-string hash    (case-fold + whitespace collapse; e.g. "Chicken Breast"
//                                and "chicken breast" share the same L2 key)
// L3: embedding similarity      (Cloudflare Vectorize; gated behind ENABLE_L3_CACHE flag,
//                                NOT shipped in M6)
//
// Key format: spec:v1:{modelId}:(raw|norm):{sha256(input)}
// TTL: 30 days

import type { ShoppableItemSpec } from '../types/spec.js'
import type { KVLike } from './cacheKV.js'

const ONTOLOGY_VER = 'v1'                     // bump when GPC/OFF/FDC ontology materially changes
const TTL_SECONDS = 30 * 24 * 60 * 60        // 30 days per DESIGN.md §5
const CACHE_KEY_PREFIX = 'spec'

export interface SpecCacheOptions {
  ns: KVLike
  /** Model ID embedded in cache keys so that different models don't share resolutions. */
  modelId: string                              // e.g. 'claude-haiku-4-5'
}

export class SpecCache {
  constructor(private opts: SpecCacheOptions) {}

  /**
   * Try L1 (raw) then L2 (normalized) lookups.
   * Returns the cached spec or null.
   */
  async lookup(raw: string): Promise<ShoppableItemSpec | null> {
    // L1: exact raw match — fastest path, hit when the user types the exact same string
    const rawKey = await this._keyL1(raw)
    const l1 = await this.opts.ns.get(rawKey)
    if (l1 !== null) return JSON.parse(l1) as ShoppableItemSpec

    // L2: normalized match — catches casing/whitespace variants
    const normKey = await this._keyL2(raw)
    const l2 = await this.opts.ns.get(normKey)
    if (l2 !== null) return JSON.parse(l2) as ShoppableItemSpec

    return null
  }

  /**
   * Write under BOTH L1 and L2 keys so future lookups on either raw or
   * normalized form resolve to this spec.
   */
  async write(raw: string, spec: ShoppableItemSpec): Promise<void> {
    const [rawKey, normKey] = await Promise.all([this._keyL1(raw), this._keyL2(raw)])
    const value = JSON.stringify(spec)
    await Promise.all([
      this.opts.ns.put(rawKey, value, { expirationTtl: TTL_SECONDS }),
      this.opts.ns.put(normKey, value, { expirationTtl: TTL_SECONDS }),
    ])
  }

  /** Returns the L1 key for the given raw string (used in tests). */
  async _keyL1(raw: string): Promise<string> {
    return `${CACHE_KEY_PREFIX}:${ONTOLOGY_VER}:${this.opts.modelId}:raw:${await sha256(raw.trim())}`
  }

  /** Returns the L2 key for the given raw string (after normalization). Used in tests. */
  async _keyL2(raw: string): Promise<string> {
    const normalized = normalizeRaw(raw)
    return `${CACHE_KEY_PREFIX}:${ONTOLOGY_VER}:${this.opts.modelId}:norm:${await sha256(normalized)}`
  }
}

/**
 * Light normalization for L2 lookup. Catches what users often type differently:
 * lowercase, collapse whitespace, trim.
 *
 * Do NOT strip numbers — "2 lbs" vs "3 lbs" are different specs.
 * Do NOT strip punctuation aggressively — "fat-free milk" vs "fat free milk"
 * should both be captured but let L2 handle the merge.
 */
export function normalizeRaw(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
