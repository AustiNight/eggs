import type { OFFProduct, OFFSearchResult } from '../types/index.js'

const OFF_BASE = 'https://world.openfoodfacts.org'
const USER_AGENT = 'EGGS/1.0 (priceofeggs.online)'

// Fields to request — keeps payloads small
const FIELDS = [
  'code',
  'product_name',
  'brands',
  'categories_tags',
  'nova_group',
  'nutriscore_grade',
  'ecoscore_grade',
  'allergens_tags',
  'ingredients_text',
  'nutriments',
  'image_url',
  'quantity',
  'serving_size'
].join(',')

function normalizeProduct(raw: Record<string, unknown>): OFFProduct {
  const nutriments = (raw.nutriments ?? {}) as Record<string, number>
  return {
    barcode: String(raw.code ?? ''),
    name: String(raw.product_name ?? ''),
    brand: String(raw.brands ?? ''),
    quantity: String(raw.quantity ?? ''),
    servingSize: String(raw.serving_size ?? ''),
    imageUrl: typeof raw.image_url === 'string' ? raw.image_url : undefined,
    categories: Array.isArray(raw.categories_tags) ? raw.categories_tags as string[] : [],
    allergens: Array.isArray(raw.allergens_tags) ? raw.allergens_tags as string[] : [],
    ingredientsText: typeof raw.ingredients_text === 'string' ? raw.ingredients_text : undefined,
    novaGroup: typeof raw.nova_group === 'number' ? raw.nova_group as 1 | 2 | 3 | 4 : undefined,
    nutriscoreGrade: typeof raw.nutriscore_grade === 'string' ? raw.nutriscore_grade as OFFProduct['nutriscoreGrade'] : undefined,
    ecoscoreGrade: typeof raw.ecoscore_grade === 'string' ? raw.ecoscore_grade as OFFProduct['ecoscoreGrade'] : undefined,
    nutriments: {
      energyKcal100g: nutriments['energy-kcal_100g'] ?? nutriments['energy_kcal_100g'],
      proteins100g: nutriments['proteins_100g'],
      carbohydrates100g: nutriments['carbohydrates_100g'],
      fat100g: nutriments['fat_100g'],
      fiber100g: nutriments['fiber_100g'],
      sugars100g: nutriments['sugars_100g'],
      salt100g: nutriments['salt_100g'],
      sodium100g: nutriments['sodium_100g']
    }
  }
}

export class OpenFoodFactsClient {
  /** Look up a single product by barcode (EAN/UPC). Returns null if not found. */
  async getByBarcode(barcode: string): Promise<OFFProduct | null> {
    const res = await fetch(
      `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`,
      { headers: { 'User-Agent': USER_AGENT } }
    )
    if (!res.ok) return null

    const data = await res.json() as { status: number; product?: Record<string, unknown> }
    if (data.status !== 1 || !data.product) return null

    return normalizeProduct(data.product)
  }

  /**
   * Search products by name/keyword.
   * OFF limits this to 10 req/min — use sparingly and never search-as-you-type.
   */
  async searchByName(query: string, page = 1, pageSize = 5): Promise<OFFSearchResult> {
    const params = new URLSearchParams({
      search_terms: query,
      fields: FIELDS,
      page_size: String(pageSize),
      page: String(page)
    })

    const res = await fetch(
      `${OFF_BASE}/api/v2/search?${params}`,
      { headers: { 'User-Agent': USER_AGENT } }
    )

    if (!res.ok) return { products: [], total: 0, page, pageSize }

    const data = await res.json() as {
      count?: number
      products?: Record<string, unknown>[]
    }

    return {
      products: (data.products ?? []).map(normalizeProduct),
      total: data.count ?? 0,
      page,
      pageSize
    }
  }
}
