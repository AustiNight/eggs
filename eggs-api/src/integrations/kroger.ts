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

  /**
   * Get the best-available priced match for a single ingredient.
   *
   * Search cascade, applied PER INGREDIENT independently:
   *   1. If the ingredient has strippable unit/packaging noise, run the STRIPPED
   *      query first — "head garlic" → "garlic" avoids Boar's Head hummus
   *      poisoning the top hits via tokenization.
   *   2. If stripped returns no priced match (or stripping is a no-op), run
   *      the raw query as a fallback — "Chef's Bottle Olive Oil" legitimately
   *      contains "bottle" and is a correct match for "bottle olive oil".
   *   3. Cascade through locationIds[1..N] with both query variants.
   *
   * Returns the first priced match encountered along with the locationId where
   * it was actually found (for downstream UI and URL attribution).
   */
  async getPriceForIngredient(
    ingredientName: string,
    locationIds: string | string[]
  ): Promise<{
    sku: string
    name: string
    brand: string
    regularPrice: number
    promoPrice: number | null
    productUrl: string
    size: string
    matchedLocationId: string
  } | null> {
    const locations = Array.isArray(locationIds) ? locationIds : [locationIds]
    if (!locations.length) return null

    // Try stripped BEFORE raw. Stripped queries are generally more focused —
    // "head garlic" → "garlic" returns whole garlic bulbs; raw "head garlic"
    // returns Boar's Head garlic hummus. When stripping is a no-op (no noise
    // words present) we skip directly to the raw query.
    const stripped = stripUnitNoise(ingredientName)
    const queries = stripped && stripped !== ingredientName
      ? [stripped, ingredientName]
      : [ingredientName]

    for (const locationId of locations) {
      for (const query of queries) {
        const products = await this.searchProducts(query, locationId)
        if (!products.length) continue

        const priced = firstPriced(products)
        if (priced) {
          if (query !== ingredientName) {
            console.log(`[kroger] "${ingredientName}" → stripped "${query}" matched "${priced.description}" at ${locationId}`)
          } else if (locationId !== locations[0]) {
            console.log(`[kroger] "${ingredientName}" fell back to location ${locationId}`)
          }
          return {
            sku: priced.items![0]!.itemId,
            name: priced.description,
            brand: priced.brand,
            regularPrice: priced.items![0]!.price!.regular,
            promoPrice: priced.items![0]!.price!.promo ?? null,
            productUrl: `https://www.kroger.com/p/${priced.description.toLowerCase().replace(/\s+/g, '-')}/${priced.productId}`,
            size: priced.items![0]!.size,
            matchedLocationId: locationId
          }
        }
      }
    }

    console.log(`[kroger] no priced match for "${ingredientName}" across ${locations.length} location(s)`)
    return null
  }
}

function firstPriced(products: KrogerProduct[]): KrogerProduct | null {
  for (const p of products) {
    const item = p.items?.[0]
    if (item?.price?.regular) return p
  }
  return null
}

/**
 * Strip unit / packaging / quantity words from an ingredient query.
 * "1 head garlic" → "garlic"; "2 cans tomato paste" → "tomato paste".
 *
 * Does NOT strip semantic modifiers like "fresh" or "organic" — those change
 * the product the user is asking for. Only strips counts and container words.
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
    'dozen', 'dozens'
    // Intentionally NOT stripped: 'fresh', 'organic', 'whole' — these are
    // product-selecting modifiers, not packaging noise.
  ])
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0 && !/^\d/.test(w) && !noise.has(w))
    .join(' ')
    .trim()
}
