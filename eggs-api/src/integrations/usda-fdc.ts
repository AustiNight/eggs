// ─── UsdaFdcClient — USDA FoodData Central Branded Foods adapter ──────────────
//
// Wraps the FDC v1 REST API with KV caching (7-day TTL) and a 429 back-off
// helper.  Only the "Branded" data type is used; all other types are ignored.
//
// Rate limit: 1000 req/hr per IP.  On 429, wait 1 second and retry once.
// If still 429, throw a descriptive error.
//
// API docs: https://fdc.nal.usda.gov/api-guide.html
// Key registration: https://api.data.gov/signup/ (free, instant)

import { cacheKV } from '../lib/cacheKV.js'
import type { KVLike } from '../lib/cacheKV.js'

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single result from the FDC Branded Foods data set. */
export interface FdcBrandedHit {
  fdcId: number
  description: string
  brandOwner: string | null
  brandName: string | null
  gtinUpc: string | null
  servingSize: number | null
  /** Raw unit string from FDC — NOT canonicalized (may be 'ml', 'mL', 'g', etc.) */
  servingSizeUnit: string | null
  /** Raw package weight string from FDC, e.g. "32 OZ" */
  packageWeight: string | null
  householdServingFullText: string | null
  brandedFoodCategory: string | null
}

// ─── Constructor options ──────────────────────────────────────────────────────

export interface UsdaFdcClientOptions {
  /** USDA FDC API key — obtain free at https://api.data.gov/signup/ */
  apiKey: string
  /** KV namespace for caching responses (7-day TTL). Use env.FDC_CACHE. */
  cacheNs: KVLike
  /** Optional fetch override for testing; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Override the 429 retry delay in ms (defaults to RETRY_DELAY_MS = 1000). Set to 0 in tests. */
  sleepMs?: number
}

// ─── Internal FDC API response shapes ────────────────────────────────────────

interface FdcSearchResponse {
  foods?: FdcFoodItem[]
}

interface FdcFoodItem {
  fdcId?: number
  description?: string
  brandOwner?: string | null
  brandName?: string | null
  gtinUpc?: string | null
  servingSize?: number | null
  servingSizeUnit?: string | null
  packageWeight?: string | null
  householdServingFullText?: string | null
  brandedFoodCategory?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1'
const TTL_SECONDS = 7 * 24 * 60 * 60  // 7 days
const RETRY_DELAY_MS = 1_000
const DEFAULT_PAGE_SIZE = 25

// ─── Mapping helper ───────────────────────────────────────────────────────────

function mapFoodItem(item: FdcFoodItem): FdcBrandedHit {
  return {
    fdcId: item.fdcId ?? 0,
    description: item.description ?? '',
    brandOwner: item.brandOwner ?? null,
    brandName: item.brandName ?? null,
    gtinUpc: item.gtinUpc ?? null,
    servingSize: item.servingSize ?? null,
    servingSizeUnit: item.servingSizeUnit ?? null,
    packageWeight: item.packageWeight ?? null,
    householdServingFullText: item.householdServingFullText ?? null,
    brandedFoodCategory: item.brandedFoodCategory ?? null,
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class UsdaFdcClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly sleepMs: number
  private readonly searchCached: (name: string, pageSize: number) => Promise<FdcBrandedHit[]>
  private readonly foodCached: (fdcId: number) => Promise<FdcBrandedHit | null>

  constructor(opts: UsdaFdcClientOptions) {
    this.apiKey = opts.apiKey
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleepMs = opts.sleepMs ?? RETRY_DELAY_MS

    // ── Cached search ─────────────────────────────────────────────────────────
    this.searchCached = cacheKV({
      ns: opts.cacheNs,
      ttlSeconds: TTL_SECONDS,
      keyFn: (name: string, pageSize: number) =>
        `fdc:v1:search:${encodeURIComponent(name.toLowerCase())}:${pageSize}`,
      loader: (name: string, pageSize: number) =>
        this._fetchSearch(name, pageSize),
    })

    // ── Cached single-food lookup ─────────────────────────────────────────────
    this.foodCached = cacheKV({
      ns: opts.cacheNs,
      ttlSeconds: TTL_SECONDS,
      keyFn: (fdcId: number) => `fdc:v1:food:${fdcId}`,
      loader: (fdcId: number) => this._fetchFood(fdcId),
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Search the FDC Branded Foods data set by product name.
   * Results are KV-cached for 7 days.
   */
  async searchBrandedByName(
    name: string,
    opts?: { pageSize?: number }
  ): Promise<FdcBrandedHit[]> {
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
    return this.searchCached(name, pageSize)
  }

  /**
   * Fetch a single food item by its FDC identifier.
   * Returns null when the item does not exist (404) or has no FDC ID.
   * Result is KV-cached for 7 days.
   */
  async getByFdcId(fdcId: number): Promise<FdcBrandedHit | null> {
    return this.foodCached(fdcId)
  }

  // ─── Private fetch helpers ───────────────────────────────────────────────────

  private async _fetchSearch(name: string, pageSize: number): Promise<FdcBrandedHit[]> {
    const params = new URLSearchParams({
      query: name,
      dataType: 'Branded',
      pageSize: String(pageSize),
      api_key: this.apiKey,
    })
    const url = `${FDC_BASE}/foods/search?${params}`

    const res = await this._fetchWithRetry(url)
    if (!res.ok) {
      throw new Error(`FDC search failed for query "${name}" with status ${res.status}`)
    }
    const data = (await res.json()) as FdcSearchResponse
    return (data.foods ?? []).map(mapFoodItem)
  }

  private async _fetchFood(fdcId: number): Promise<FdcBrandedHit | null> {
    const url = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(this.apiKey)}`

    const res = await this._fetchWithRetry(url)
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`FDC getByFdcId(${fdcId}) failed with status ${res.status}`)
    }
    const data = (await res.json()) as FdcFoodItem
    return mapFoodItem(data)
  }

  /**
   * Issue a GET request, retrying once after a 1-second wait on 429.
   * If still 429 after retry, throws a descriptive error.
   * Non-429 errors are returned as-is for the caller to handle.
   */
  private async _fetchWithRetry(url: string): Promise<Response> {
    let res = await this.fetchImpl(url)

    if (res.status === 429) {
      // Wait sleepMs, then retry once (injectable for testing — defaults to RETRY_DELAY_MS = 1000)
      await new Promise<void>((resolve) => setTimeout(resolve, this.sleepMs))
      res = await this.fetchImpl(url)
    }

    if (res.status === 429) {
      throw new Error(
        `USDA FDC rate limit exceeded (429) after retry. ` +
        `Limit is 1000 requests/hr. Wait and try again, or implement exponential back-off.`
      )
    }

    return res
  }
}
