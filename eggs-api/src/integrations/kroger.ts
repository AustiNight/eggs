import type { KrogerProduct, KrogerLocation } from '../types/index.js'

const KROGER_BASE = 'https://api.kroger.com/v1'

export class KrogerClient {
  private accessToken: string | null = null
  private tokenExpiry = 0

  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const creds = btoa(`${this.clientId}:${this.clientSecret}`)
    const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
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
    const res = await fetch(`${KROGER_BASE}/products?${params}`, {
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
    const res = await fetch(`${KROGER_BASE}/locations?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: KrogerLocation[] }
    return data.data ?? []
  }

  /** Get store-specific price for a single product query. Returns best match or null. */
  async getPriceForIngredient(
    ingredientName: string,
    locationId: string
  ): Promise<{
    sku: string
    name: string
    brand: string
    regularPrice: number
    promoPrice: number | null
    productUrl: string
    size: string
  } | null> {
    // Kroger's /products endpoint matches literally against description + brand.
    // "lbs ground beef" matches fewer things than "ground beef". Try raw first,
    // then retry with unit-noise stripped if raw returns nothing.
    let products = await this.searchProducts(ingredientName, locationId)
    if (!products.length) {
      const stripped = stripUnitNoise(ingredientName)
      if (stripped && stripped !== ingredientName) {
        products = await this.searchProducts(stripped, locationId)
        if (products.length) {
          console.log(`[kroger] "${ingredientName}" → 0 matches; "${stripped}" → ${products.length} matches`)
        }
      }
      if (!products.length) {
        console.log(`[kroger] no matches for "${ingredientName}"`)
        return null
      }
    }

    // Scan all results for the first one with a priced item at this location.
    // Previously we only checked products[0]; if the top hit lacked price data
    // we'd return null despite results 2-10 potentially being viable.
    for (const product of products) {
      const item = product.items?.[0]
      if (!item?.price?.regular) continue
      return {
        sku: item.itemId,
        name: product.description,
        brand: product.brand,
        regularPrice: item.price.regular,
        promoPrice: item.price.promo ?? null,
        productUrl: `https://www.kroger.com/p/${product.description.toLowerCase().replace(/\s+/g, '-')}/${product.productId}`,
        size: item.size
      }
    }

    console.log(`[kroger] "${ingredientName}" — ${products.length} results but none had a price at locationId=${locationId}`)
    return null
  }
}

/**
 * Strip common unit / packaging / quantity words from an ingredient query.
 * "1 head garlic" → "garlic"; "2 cans tomato paste" → "tomato paste".
 * Leaves the core product name. Used as a fallback when literal query fails.
 */
function stripUnitNoise(raw: string): string {
  const noise = new Set([
    'lb', 'lbs', 'pound', 'pounds',
    'oz', 'ozs', 'ounce', 'ounces',
    'can', 'cans', 'bottle', 'bottles',
    'jar', 'jars', 'head', 'heads', 'bunch', 'bunches',
    'loaf', 'loaves', 'bag', 'bags', 'box', 'boxes',
    'pack', 'packs', 'package', 'packages',
    'gallon', 'gallons', 'qt', 'quart', 'quarts',
    'pt', 'pint', 'pints', 'cup', 'cups',
    'tbsp', 'tablespoon', 'tsp', 'teaspoon',
    'dozen', 'dozens', 'fresh', 'organic'
  ])
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0 && !/^\d/.test(w) && !noise.has(w))
    .join(' ')
    .trim()
}
