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

const DEFAULT_WALMART_BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2'

export class WalmartClient {
  private cachedKey: CryptoKey | null = null
  private baseUrl: string

  constructor(
    private consumerId: string,
    private keyVersion: string,
    private privateKeyPem: string,
    private publisherId: string,
    /** Override base URL (for staging or future endpoint moves). Defaults to prod. */
    baseUrl?: string
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
      res = await fetch(url.toString(), { headers })
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
      res = await fetch(url.toString(), { headers })
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
      res = await fetch(url.toString(), { headers })
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
   * Top-level helper matching the KrogerClient shape.
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
    const items = await this.searchProducts(ingredientName, zipCode)
    for (const item of items) {
      const regular = item.msrp ?? item.salePrice
      if (typeof regular !== 'number' || regular <= 0) continue
      const promo = item.salePrice !== undefined && item.salePrice < regular ? item.salePrice : null
      const productUrl = item.productTrackingUrl || item.productUrl
      if (!productUrl) continue
      return {
        sku: String(item.itemId),
        name: item.name ?? ingredientName,
        brand: item.brandName ?? '',
        regularPrice: regular,
        promoPrice: promo,
        productUrl,
        size: item.size ?? ''
      }
    }
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function canonicalString(headers: Record<string, string>): string {
  const sortedNames = Object.keys(headers).sort()
  return sortedNames.map(n => `${n}:${headers[n]}\n`).join('')
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
