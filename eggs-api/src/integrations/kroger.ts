import type { KrogerProduct, KrogerLocation } from '../types/index.js'
import type { StoreAdapter, StoreSearchInput, StoreSearchResult } from './StoreAdapter.js'
import { matchesBrand } from '../lib/brands.js'
import { parseSize, BASE_DIMENSION } from '../lib/units.js'
import { stripUnitNoise } from '../lib/queryStrip.js'

const KROGER_BASE = 'https://api.kroger.com/v1'

export class KrogerClient implements StoreAdapter {
  private accessToken: string | null = null
  private tokenExpiry = 0

  constructor(
    private clientId: string,
    private clientSecret: string,
    /** Optional fetch override — used in tests to avoid real network calls.
     *  Arrow wrapper avoids "Illegal invocation" on Cloudflare Workers when
     *  the default unbound `globalThis.fetch` is called as a method. */
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const creds = btoa(`${this.clientId}:${this.clientSecret}`)
    const res = await this.fetchImpl(`${KROGER_BASE}/connect/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=product.compact'
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Kroger auth failed: ${err}`)
    }

    const data = await res.json() as {
      access_token: string
      expires_in: number
    }
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken
  }

  async searchProducts(query: string, locationId: string): Promise<KrogerProduct[]> {
    const token = await this.getToken()
    const params = new URLSearchParams({
      'filter.term': query,
      'filter.locationId': locationId,
      'filter.limit': '10'
    })
    const res = await this.fetchImpl(`${KROGER_BASE}/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      console.error('[kroger] searchProducts status', res.status, 'query:', query, 'body:', body.slice(0, 300))
      return []
    }
    const data = await res.json() as { data?: KrogerProduct[] }
    return data.data ?? []
  }

  async findNearbyLocations(
    lat: number,
    lng: number,
    radiusMiles: number
  ): Promise<KrogerLocation[]> {
    const token = await this.getToken()
    const params = new URLSearchParams({
      'filter.lat.near': String(lat),
      'filter.lon.near': String(lng),
      'filter.radiusInMiles': String(Math.min(radiusMiles, 100)),
      'filter.limit': '5'
    })
    const res = await this.fetchImpl(`${KROGER_BASE}/locations?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: KrogerLocation[] }
    return data.data ?? []
  }

  /**
   * StoreAdapter.search — structured product search with optional brand filter
   * and unit preference.
   *
   * Internal flow:
   *   1. Per-location cascade: stripped query first, then raw query (same as
   *      the legacy getPriceForIngredient), collecting ALL candidates across
   *      the cascade (not early-returning on the first priced hit).
   *   2. Brand filter (if input.brand) — only keep results whose
   *      normalizeBrand(result.brand) === normalizeBrand(input.brand).
   *      If zero matches: return null (brand-lock is exclusive).
   *   3. Unit preference (if input.unit) — prefer candidates in the same
   *      base dimension (mass/volume/count). Falls back to all eligible
   *      candidates if none match.
   *   4. Return first-priced from the final candidate set.
   */
  async search(input: StoreSearchInput): Promise<StoreSearchResult | null> {
    const { name, brand, unit, locationIds } = input
    const locations = locationIds ?? []
    if (!locations.length) return null

    const stripped = stripUnitNoise(name)
    const queries = stripped && stripped !== name
      ? [stripped, name]
      : [name]

    // Collect all candidates from the entire cascade (all locations × all queries).
    // We need to know the locationId each candidate came from.
    const candidates: Array<{ product: KrogerProduct; locationId: string; query: string }> = []

    for (const locationId of locations) {
      for (const query of queries) {
        const products = await this.searchProducts(query, locationId)
        const priced = products.filter(p => p.items?.[0]?.price?.regular)
        for (const p of priced) {
          candidates.push({ product: p, locationId, query })
        }
        // Stripped query succeeded for this location — skip the raw fallback.
        // Consistent with the original cascade: stripped wins when it yields results.
        if (priced.length > 0 && query === queries[0] && queries.length > 1) {
          break
        }
      }
    }

    if (!candidates.length) {
      console.log(`[kroger] no priced match for "${name}" across ${locations.length} location(s)`)
      return null
    }

    // ── Brand filter ─────────────────────────────────────────────────────────
    let eligible = candidates
    if (brand) {
      const brandFiltered = candidates.filter(
        c => matchesBrand({ brand: c.product.brand, name: c.product.description }, brand)
      )
      if (!brandFiltered.length) {
        console.log(`[kroger] brand-lock "${brand}" — no matching products for "${name}"`)
        return null
      }
      eligible = brandFiltered
    }

    // ── Unit preference ───────────────────────────────────────────────────────
    if (unit) {
      const requestedBase = BASE_DIMENSION[unit]
      if (requestedBase) {
        const unitMatches = eligible.filter(c => {
          const item = c.product.items?.[0]
          if (!item) return false
          const parsed = parseSize(item.size)
          if (!parsed) return false
          return BASE_DIMENSION[parsed.unit] === requestedBase
        })
        if (unitMatches.length) {
          eligible = unitMatches
        }
        // If no unit matches, fall through to all eligible candidates (soft preference)
      }
    }

    // ── Return first from eligible ────────────────────────────────────────────
    const best = eligible[0]!
    const priced = best.product
    const item = priced.items![0]!

    if (best.query !== name) {
      console.log(`[kroger] "${name}" → stripped "${best.query}" matched "${priced.description}" at ${best.locationId}`)
    } else if (best.locationId !== locations[0]) {
      console.log(`[kroger] "${name}" fell back to location ${best.locationId}`)
    }

    return {
      sku: item.itemId,
      name: priced.description,
      brand: priced.brand,
      regularPrice: item.price!.regular,
      promoPrice: item.price!.promo ?? null,
      productUrl: `https://www.kroger.com/p/${priced.description.toLowerCase().replace(/\s+/g, '-')}/${priced.productId}`,
      size: item.size,
      matchedLocationId: best.locationId
    }
  }

  /**
   * Legacy shim — kept for backward compatibility with existing callers.
   * Delegates to search(); callers may migrate to search() when ready.
   *
   * Get the best-available priced match for a single ingredient.
   */
  async getPriceForIngredient(
    ingredientName: string,
    locationIds: string | string[]
  ): Promise<StoreSearchResult | null> {
    const ids = Array.isArray(locationIds) ? locationIds : [locationIds]
    return this.search({ name: ingredientName, locationIds: ids })
  }
}
