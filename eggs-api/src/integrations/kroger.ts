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
      'filter.limit': '5'
    })
    const res = await fetch(`${KROGER_BASE}/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return []
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
    const products = await this.searchProducts(ingredientName, locationId)
    if (!products.length) return null

    const product = products[0]
    const item = product.items?.[0]
    if (!item?.price?.regular) return null

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
}
