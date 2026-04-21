// Walmart Affiliate (IO) Product API client.
// Uses RSA-SHA256 request signing via the WebCrypto API (works in Cloudflare Workers).
//
// Headers (per https://walmart.io/apidocs/affiliates/additional-headers):
//   WM_CONSUMER.ID           — consumer UUID from walmart.io registration
//   WM_CONSUMER.INTIMESTAMP  — request time in ms since epoch
//   WM_SEC.KEY_VERSION       — key version assigned at registration (usually "1")
//   WM_SEC.AUTH_SIGNATURE    — base64(RSASSA-PKCS1-v1_5(SHA-256, canonicalString))
//
// Canonical string = the three non-signature headers sorted alphabetically by name,
// each rendered as "{headerName}:{headerValue}\n".
//
// The signed window is 180 seconds — we re-sign every request (no token caching).

import type { WalmartLocation, WalmartProduct } from '../types/index.js'
import type { StoreAdapter, StoreSearchInput, StoreSearchResult } from './StoreAdapter.js'
import { normalizeBrand } from '../lib/brands.js'
import { parseSize } from '../lib/units.js'
import { stripUnitNoise } from '../lib/queryStrip.js'

// Internal base-dimension table for unit-preference comparisons.
const BASE_DIMENSION: Record<string, 'g' | 'ml' | 'count'> = {
  g: 'g', kg: 'g', oz: 'g', lb: 'g',
  ml: 'ml', l: 'ml', fl_oz: 'ml', cup: 'ml', pt: 'ml', qt: 'ml', gal: 'ml',
  each: 'count', dozen: 'count', bunch: 'count', head: 'count', clove: 'count', pinch: 'count',
}

const DEFAULT_WALMART_BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2'

export class WalmartClient implements StoreAdapter {
  private cachedKey: CryptoKey | null = null
  private baseUrl: string

  constructor(
    private consumerId: string,
    private keyVersion: string,
    private privateKeyPem: string,
    private publisherId: string,
    /** Override base URL (for staging or future endpoint moves). Defaults to prod. */
    baseUrl?: string,
    /** Optional fetch override — used in tests to avoid real network calls. */
    private fetchImpl: typeof fetch = globalThis.fetch
  ) {
    this.baseUrl = (baseUrl?.trim() || DEFAULT_WALMART_BASE).replace(/\/$/, '')
  }

  // ── Key import ─────────────────────────────────────────────────────────────

  private async getSigningKey(): Promise<CryptoKey> {
    if (this.cachedKey) return this.cachedKey
    const der = pemToArrayBuffer(this.privateKeyPem)
    this.cachedKey = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return this.cachedKey
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  /** Builds the four WM_* auth headers for a single request. */
  async signHeaders(nowMs: number = Date.now()): Promise<Record<string, string>> {
    const headers = {
      'WM_CONSUMER.ID': this.consumerId,
      'WM_CONSUMER.INTIMESTAMP': String(nowMs),
      'WM_SEC.KEY_VERSION': this.keyVersion
    }
    const canonical = canonicalString(headers)
    const key = await this.getSigningKey()
    const sigBuf = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(canonical)
    )
    return {
      ...headers,
      'WM_SEC.AUTH_SIGNATURE': arrayBufferToBase64(sigBuf)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Search the Walmart catalog for a query string.
   * Walmart affiliate pricing is primarily national; zipCode is best-effort.
   */
  async searchProducts(query: string, zipCode?: string): Promise<WalmartProduct[]> {
    const url = new URL(`${this.baseUrl}/search`)
    url.searchParams.set('query', query)
    url.searchParams.set('publisherId', this.publisherId)
    url.searchParams.set('numItems', '5')
    if (zipCode) url.searchParams.set('zipCode', zipCode)

    const headers = await this.signHeaders()
    let res: Response
    try {
      res = await this.fetchImpl(url.toString(), { headers })
    } catch (err) {
      console.error('[walmart] searchProducts fetch threw:', err instanceof Error ? err.message : err)
      return []
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '<unreadable>')
      console.error('[walmart] searchProducts status', res.status, 'body:', errBody.slice(0, 500))
      return []
    }

    const data = await res.json().catch(() => null) as
      | { items?: WalmartProduct[] }
      | null
    return data?.items ?? []
  }

  /**
   * Look up specific item IDs (up to 20 at a time).
   * Kept for future UPC/GTIN-driven lookups; unused in the MVP search flow.
   */
  async getItems(itemIds: string[]): Promise<WalmartProduct[]> {
    if (itemIds.length === 0) return []
    const url = new URL(`${this.baseUrl}/items`)
    url.searchParams.set('ids', itemIds.slice(0, 20).join(','))
    url.searchParams.set('publisherId', this.publisherId)

    const headers = await this.signHeaders()
    let res: Response
    try {
      res = await this.fetchImpl(url.toString(), { headers })
    } catch {
      return []
    }
    if (!res.ok) return []
    const data = await res.json().catch(() => null) as
      | { items?: WalmartProduct[] }
      | null
    return data?.items ?? []
  }

  /**
   * Find the nearest Walmart store to a lat/lng (optional for future per-store pricing).
   * Walmart's affiliate /stores endpoint is undocumented in the current docs so this
   * gracefully returns an empty list if the endpoint is missing in production.
   */
  async findNearbyLocations(lat: number, lng: number): Promise<WalmartLocation[]> {
    const url = new URL(`${this.baseUrl}/stores`)
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('publisherId', this.publisherId)
    const headers = await this.signHeaders()
    let res: Response
    try {
      res = await this.fetchImpl(url.toString(), { headers })
    } catch {
      return []
    }
    if (!res.ok) return []
    const data = await res.json().catch(() => null) as
      | { stores?: WalmartLocation[] }
      | null
    return data?.stores ?? []
  }

  /**
   * StoreAdapter.search — structured product search with strip-and-retry cascade,
   * optional brand filter, and unit preference. Matches Kroger's search() behaviour.
   *
   * Cascade:
   *   1. Run stripped query first (unit/packaging noise removed).
   *   2. If stripped returns no priced candidates (or strip was a no-op), fall
   *      back to the raw query.
   *
   * Brand filter (exclusive): if input.brand is present, only return a result
   * whose normalizeBrand(result.brand) === normalizeBrand(input.brand). Return
   * null if nothing matches.
   *
   * Unit preference (soft): if input.unit is present, prefer results in the
   * same base dimension; fall back to all eligible if none match.
   */
  async search(input: StoreSearchInput): Promise<StoreSearchResult | null> {
    const { name, brand, unit, zipCode } = input

    const stripped = stripUnitNoise(name)
    const queries = stripped && stripped !== name
      ? [stripped, name]
      : [name]

    // Collect priced candidates across the cascade (stripped first, raw fallback).
    let candidates: WalmartProduct[] = []
    for (const query of queries) {
      const items = await this.searchProducts(query, zipCode)
      const priced = items.filter(item => {
        const regular = item.msrp ?? item.salePrice
        return typeof regular === 'number' && regular > 0 &&
          !!(item.productTrackingUrl || item.productUrl)
      })
      if (priced.length) {
        candidates = priced
        if (query !== name) {
          console.log(`[walmart] "${name}" → stripped "${query}" yielded ${priced.length} candidate(s)`)
        }
        break // Stripped pass succeeded — skip raw fallback
      }
    }

    if (!candidates.length) {
      console.log(`[walmart] no priced match for "${name}"`)
      return null
    }

    // ── Brand filter ──────────────────────────────────────────────────────────
    let eligible = candidates
    if (brand) {
      const normalizedInputBrand = normalizeBrand(brand)
      const brandMatches = candidates.filter(
        item => normalizeBrand(item.brandName ?? '') === normalizedInputBrand
      )
      if (!brandMatches.length) {
        console.log(`[walmart] brand-lock "${brand}" — no matching products for "${name}"`)
        return null
      }
      eligible = brandMatches
    }

    // ── Unit preference ───────────────────────────────────────────────────────
    if (unit) {
      const requestedBase = BASE_DIMENSION[unit]
      if (requestedBase) {
        const unitMatches = eligible.filter(item => {
          const parsed = parseSize(item.size ?? '')
          if (!parsed) return false
          return BASE_DIMENSION[parsed.unit] === requestedBase
        })
        if (unitMatches.length) {
          eligible = unitMatches
        }
        // If no unit matches, fall through (soft preference)
      }
    }

    // ── Map first eligible candidate to StoreSearchResult ────────────────────
    const best = eligible[0]!
    const regular = best.msrp ?? best.salePrice!
    const promo = best.salePrice !== undefined && best.salePrice < regular ? best.salePrice : null
    const productUrl = (best.productTrackingUrl || best.productUrl)!

    return {
      sku: String(best.itemId),
      name: best.name ?? name,
      brand: best.brandName ?? '',
      regularPrice: regular,
      promoPrice: promo,
      productUrl,
      size: best.size ?? ''
    }
  }

  /**
   * Legacy shim — kept for backward compatibility with existing callers.
   * Delegates to search(); callers may migrate to search() when ready.
   *
   * Returns a mapped pricing record for the first good hit or null if nothing found.
   */
  async getPriceForIngredient(
    ingredientName: string,
    zipCode?: string
  ): Promise<{
    sku: string
    name: string
    brand: string
    regularPrice: number
    promoPrice: number | null
    productUrl: string
    size: string
  } | null> {
    return this.search({ name: ingredientName, zipCode })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walmart's canonical string = the VALUES of the three non-signature headers,
 * emitted in alphabetical header-name order, each followed by '\n'.
 * Per walmart.io/apidocs/affiliates/additional-headers (Java sample):
 *   canonicalizedStrBuffer.append(val.toString().trim()).append("\n");
 * No header names are emitted.
 */
function canonicalString(headers: Record<string, string>): string {
  const sortedNames = Object.keys(headers).sort()
  return sortedNames.map(n => `${headers[n]}\n`).join('')
}

export function pemToArrayBuffer(pem: string): ArrayBuffer {
  const trimmed = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(trimmed)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf.buffer
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
