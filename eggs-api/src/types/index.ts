// ─── ShoppableItemSpec + validators + Instacart wire format (M2) ─────────────
export * from './spec.js'

// ─── Canonical unit type (shared across unit conversion, store adapters, specs) ─

export type CanonicalUnit =
  | 'g' | 'kg'                              // mass metric
  | 'ml' | 'l'                              // volume metric
  | 'oz' | 'lb'                             // mass US
  | 'fl_oz' | 'cup' | 'pt' | 'qt' | 'gal' // volume US
  | 'each' | 'dozen'                        // count
  | 'bunch' | 'head' | 'clove' | 'pinch'  // produce/culinary

// ─── Hono app env (used everywhere) ──────────────────────────────────────────

export type HonoEnv = {
  Bindings: Env
  Variables: { userId: string }
}

// ─── Env bindings ────────────────────────────────────────────────────────────

export interface Env {
  RATE_LIMIT_KV: KVNamespace
  /** Per-(banner,ingredient) resolved StoreItem cache with 24h TTL. */
  URL_CACHE: KVNamespace
  /** USDA FDC Branded Foods response cache. 7d TTL. (M3) */
  FDC_CACHE: KVNamespace
  /** Open Food Facts taxonomy graph cache. 7d TTL. (M3) */
  ONTOLOGY_CACHE: KVNamespace
  /** Resolved ShoppableItemSpec cache. 30d TTL. (M3/M6) */
  SPEC_CACHE: KVNamespace
  /** USDA FoodData Central API key — register free at https://api.data.gov/signup/ */
  FDC_API_KEY: string
  FREE_MONTHLY_LIMIT: string
  ANTHROPIC_API_KEY: string
  CLERK_SECRET_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  KROGER_CLIENT_ID: string
  KROGER_CLIENT_SECRET: string
  WALMART_CONSUMER_ID: string
  WALMART_KEY_VERSION: string
  WALMART_PRIVATE_KEY: string
  WALMART_PUBLISHER_ID: string
  /** Optional override for the Walmart Affiliate API base URL. Defaults to prod. */
  WALMART_BASE_URL?: string
  TAPESTRY_SERVICE_KEY: string
  STRIPE_WEBHOOK_SECRET: string
}

// ─── DB / User types ─────────────────────────────────────────────────────────

export interface DbUser {
  id: string
  email: string
  display_name: string | null
  default_location_lat: number | null
  default_location_lng: number | null
  default_location_label: string | null
  default_settings: Record<string, unknown>
  avoid_stores: string[]
  avoid_brands: string[]
  ai_provider: string | null
  subscription_tier: 'free' | 'pro'
  subscription_status: string
  subscription_period_end: string | null
  stripe_customer_id: string | null
  /** True for seeded automation/test accounts — exempt from Stripe/email side-effects. */
  is_test_account: boolean
  created_at: string
}

export interface DbEvent {
  id: string
  user_id: string
  name: string
  client_name: string | null
  event_date: string | null
  headcount: number
  budget_mode: 'calculate' | 'ceiling'
  budget_ceiling: number | null
  status: EventStatus
  created_at: string
  updated_at: string
}

export type EventStatus =
  | 'planning'
  | 'shopping'
  | 'reconcile_needed'
  | 'complete'

export interface DbDish {
  id: string
  event_id: string
  user_id: string
  name: string
  servings: number | null
  notes: string | null
  sort_order: number
  created_at: string
}

export interface DbIngredientPool {
  id: string
  event_id: string
  user_id: string
  name: string
  clarified_name: string | null
  quantity: number
  unit: string
  category: string
  sources: IngredientSource[]
  created_at: string
}

export interface DbShoppingPlan {
  id: string
  event_id: string | null
  user_id: string
  plan_data: ShoppingPlan
  model_used: string | null
  generated_at: string
}

export interface DbReconcileRecord {
  id: string
  event_id: string
  shopping_plan_id: string | null
  user_id: string
  mode: 'receipt' | 'detailed'
  actual_items: ActualItem[]
  receipt_totals: ReceiptTotal[]
  summary: ReconcileSummary | null
  completed_at: string
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface IngredientLine {
  id: string
  name: string
  clarifiedName?: string
  quantity: number
  unit: string
  category: string
  sources: IngredientSource[]
}

export interface IngredientSource {
  dishId: string
  dishName: string
  quantity: number
  unit: string
  proportion: number
}

export interface ClarificationRequest {
  itemId: string
  originalName: string
  question: string
  options: string[]
}

export type PriceSource = 'kroger_api' | 'walmart_api' | 'ai_estimated'
export type Confidence = 'real' | 'estimated_with_source' | 'estimated'

export interface StoreItem {
  ingredientId: string
  name: string
  sku?: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
  confidence: Confidence
  /**
   * REQUIRED — always a valid clickable URL. For direct-API stores this is the
   * real product page. For AI-sourced items it's the verified product page when
   * retrieval + HEAD-validation succeed, otherwise a deterministic search-landing
   * URL at the retailer's own site (see integrations/store-urls.ts).
   */
  shopUrl: string
  /** Present only when the retrieved URL was cross-referenced against citations AND HEAD-resolved. */
  proofUrl?: string
  /** @deprecated Mirrors `proofUrl` when present; kept for backward compat with stored plans. */
  productUrl?: string
  isLoyaltyPrice: boolean
  nonMemberPrice?: number
  /** True when this store doesn't carry the item — included to keep schema uniform across stores */
  notAvailable?: boolean
  /**
   * The actual package size the AI adapter priced.
   *
   * For AI-sourced items (priceSource='ai_estimated'): non-null when confidence
   * is 'real' or 'estimated_with_source'; null when confidence is 'estimated'
   * (pure guess). The `validateAndNormalizeAiItems` helper enforces this at
   * parse time, downgrading confidence when pricedSize is missing.
   *
   * For direct-API sources (Kroger, Walmart): always null today. May be
   * populated in a future milestone that parses the store-returned `size`
   * string and maps it to canonical units.
   */
  pricedSize: { quantity: number; unit: CanonicalUnit } | null
}

export interface StorePlan {
  storeName: string
  storeBanner: string
  /** Normalized lowercase banner key used for URL templating and cache keys. */
  storeBannerNormalized?: string
  storeAddress?: string
  distanceMiles?: number
  storeType: 'physical' | 'delivery' | 'curbside'
  priceSource: PriceSource
  items: StoreItem[]
  subtotal: number
  estimatedTax: number
  grandTotal: number
}

export interface ShoppingPlan {
  id: string
  generatedAt: string
  meta: {
    eventId?: string
    eventName?: string
    headcount?: number
    location: { lat: number; lng: number; label?: string }
    storesQueried: { name: string; source: PriceSource }[]
    modelUsed: string
    budgetMode: 'ceiling' | 'calculate'
    budgetCeiling?: number
    budgetExceeded?: boolean
  }
  ingredients: IngredientLine[]
  stores: StorePlan[]
  summary: {
    subtotal: number
    estimatedTax: number
    total: number
    estimatedSavings?: number
    realPriceCount: number
    estimatedPriceCount: number
    narrative?: string
  }
}

// ─── Request / Response types ─────────────────────────────────────────────────

export interface PlanSettings {
  radiusMiles: number
  maxStores: number
  includeDelivery: boolean
  curbsideMaxMiles?: number
  avoidStores?: string[]
  avoidBrands?: string[]
}

export interface PricePlanRequest {
  ingredients: IngredientLine[]
  resolvedClarifications?: Record<string, string>
  location: { lat: number; lng: number }
  settings: PlanSettings
  budget?: { mode: 'ceiling' | 'calculate'; amount?: number }
  eventId?: string
  eventName?: string
  headcount?: number
}

export interface ReconcileRequest {
  shoppingPlanId: string
  mode: 'receipt' | 'detailed'
  receiptTotals?: ReceiptTotal[]
  actualItems?: ActualItem[]
}

export interface ReceiptTotal {
  storeName: string
  receiptTotal: number
}

export interface ActualItem {
  storeItemId: string
  actualPrice: number
  actualQuantity: number
  note?: string
}

export interface ReconcileSummary {
  estimatedTotal: number
  actualTotal: number
  variance: number
  variancePct: number
  perDishActual: { dish: string; actualCost: number; estimatedCost: number }[]
}

// ─── Open Food Facts types ────────────────────────────────────────────────────

export interface OFFProduct {
  barcode: string
  name: string
  brand: string
  quantity: string
  servingSize: string
  imageUrl?: string
  categories: string[]
  allergens: string[]
  ingredientsText?: string
  /** NOVA processing level: 1 = unprocessed, 4 = ultra-processed */
  novaGroup?: 1 | 2 | 3 | 4
  /** Nutri-Score grade a–e (a is best) */
  nutriscoreGrade?: 'a' | 'b' | 'c' | 'd' | 'e'
  /** Eco-Score grade a–e (a is best) */
  ecoscoreGrade?: 'a' | 'b' | 'c' | 'd' | 'e'
  nutriments: {
    energyKcal100g?: number
    proteins100g?: number
    carbohydrates100g?: number
    fat100g?: number
    fiber100g?: number
    sugars100g?: number
    salt100g?: number
    sodium100g?: number
  }
}

export interface OFFSearchResult {
  products: OFFProduct[]
  total: number
  page: number
  pageSize: number
}

// ─── Kroger types ─────────────────────────────────────────────────────────────

export interface KrogerProduct {
  productId: string
  description: string
  brand: string
  items: {
    itemId: string
    price?: { regular: number; promo?: number }
    size: string
    soldBy: string
  }[]
  images: { perspective: string; sizes: { size: string; url: string }[] }[]
}

export interface KrogerLocation {
  locationId: string
  name: string
  address: {
    addressLine1: string
    city: string
    state: string
    zipCode: string
  }
  geolocation: { latitude: number; longitude: number }
}

// ─── Walmart types ────────────────────────────────────────────────────────────

export interface WalmartProduct {
  itemId: string | number
  name?: string
  brandName?: string
  msrp?: number
  salePrice?: number
  productUrl?: string
  productTrackingUrl?: string
  size?: string
  thumbnailImage?: string
  largeImage?: string
  categoryPath?: string
  gtin?: string
  upc?: string
}

export interface WalmartLocation {
  storeId: string | number
  name: string
  streetAddress?: string
  city?: string
  stateProvCode?: string
  zip?: string
  latitude?: number
  longitude?: number
}
