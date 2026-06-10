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
  /** Stripe secret key — sk_test_… in dev, sk_live_… in prod. */
  STRIPE_SECRET_KEY: string
  /** Stripe Price id for the Pro subscription (price_…). Test-mode price in dev. */
  STRIPE_PRO_PRICE_ID: string
  /**
   * Feature flag for the shopping-plan v2 best-value path.
   * Set to 'true' to enable M8+ totals correction and best-basket selection.
   * Absence or any other value keeps the legacy behaviour.
   */
  SHOPPING_V2?: string
  /**
   * Instacart Developer Platform (IDP) API key.
   * Obtain at https://developers.instacart.com (self-serve, no approval needed).
   * When absent the "Shop this list on Instacart" button is silently skipped.
   */
  INSTACART_IDP_API_KEY?: string
  /** Serper.dev API key — Google Shopping/Places verticals. Absent → discovery pipeline skipped. */
  SERPER_API_KEY?: string
  /** Tavily API key — product-URL resolution. Absent → resolution leg skipped. */
  TAVILY_API_KEY?: string
  /** Firecrawl API key — bot-walled fetch fallback. Absent → direct fetch only. */
  FIRECRAWL_API_KEY?: string
}

// ─── PlanDiagnostics — backend counters surfaced on ShoppingPlan.meta (P3.1) ──

export interface PlanDiagnostics {
  ai: {
    /** true when pass-1 (research) threw or returned no result */
    pass1Failed: boolean
    /** true when pass-2 (format) threw or returned no result */
    pass2Failed: boolean
    /** total AI-store items across all stores (aiStorePlans.flatMap(s=>s.items).length) */
    candidateCount: number
    /** HEAD-validated proofUrls (validateUrls set size) */
    proofUrlsValidated: number
    /** proofUrls where verifyProductContent returned verified === true */
    proofUrlsContentVerified: number
    /** proofUrls where verifyProductContent returned verified === false */
    proofUrlsContentRejected: number
  }
  sizeResolver: {
    /** total items whose pricedSize was resolved by any tier */
    resolved: number
    /** count by resolution source */
    bySource: Record<'parseSize' | 'fdc' | 'off' | 'web_fetch' | 'web_search', number>
    /** items still null after all tiers (pricedSize remained null) */
    failed: number
  }
  grader: {
    /** number of specs that went through gradeCandidates */
    specsGraded: number
    /** total candidates across all graded specs */
    totalCandidates: number
    /** approximate cache hit count (conservative — 0 unless refactored further) */
    cacheHits: number
    /** items where alignmentGrade.category === 'wrong' after grading, before selectWinner */
    rejectedAsWrong: number
  }
  ontology: {
    /** sum of ontologyFallbackUsed across Kroger + Walmart */
    broaderTermsAttempted: number
    /** sum of ontologyFallbackSucceeded across Kroger + Walmart */
    broaderTermsSucceeded: number
  }
  discovery: {
    serperQueries: number
    tavilyQueries: number
    firecrawlScrapes: number
    /** items that reached provenance 'store_page_verified' */
    storeBound: number
    /** items that reached 'page_verified_unbound' */
    unbound: number
    /** items that reached 'shopping_index' */
    indexOnly: number
    /** items where discovery found nothing and the LLM result stood */
    fallbackLlm: number
  }
}

// ─── AlignmentGrade — LLM candidate grader output (P2.7) ─────────────────────

/**
 * Per-candidate grade from the LLM alignment grader.
 * 'exact'      — same product class, same key attributes. Score 90-100.
 * 'substitute' — same product class, one attribute differs. Score 50-89.
 * 'wrong'      — different product class or contradictory descriptor. Score 0-49.
 */
export interface AlignmentGrade {
  score: number                              // 0-100
  category: 'exact' | 'substitute' | 'wrong'
  reason: string                             // 1 sentence — surfaces in UI when 'substitute'
}

// ─── UserProfile — minimal shape consumed by selectWinner and plan route ─────

/**
 * Subset of DbUser fields needed for best-value selection and plan generation.
 * Satisfies by DbUser (all fields present) — no runtime conversion required.
 */
export interface UserProfile {
  avoid_brands: string[]
  /** Pre-filter stores before calling selectWinner. Consumed by plan.ts (M8+), not by selectWinner. */
  avoid_stores?: string[]
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
  /** Null for legacy plans written before M8. Computed at read time for those rows. */
  best_basket_total: number | null
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

export interface ClarifiedAttributes {
  baseName: string
  selectedOptions: string[]
}

export type PriceSource = 'kroger_api' | 'walmart_api' | 'ai_estimated'
export type Confidence = 'real' | 'estimated_with_source' | 'estimated'

// ─── Store-scoped price discovery (WS1) ──────────────────────────────────────

/** A concrete store from distance-bound discovery — never just a banner. */
export interface StoreIdentity {
  banner: string
  /** normalizeBanner(banner) — cache keys, binding/domain registry lookups */
  bannerNormalized: string
  storeName: string
  storeAddress?: string
  distanceMiles?: number
  /** Retailer-internal store id, when a locator adapter resolved it. */
  retailerStoreId?: string
}

/**
 * Price provenance — the honesty contract (spec WS1).
 * Item-level counterpart to StorePlan.priceSource; takes precedence for UI display when present.
 * 'api'                  — Kroger/Walmart API result.
 * 'store_page_verified'  — exact price verified on a product page fetched BOUND
 *                          to the chef's discovered store (binding assertion passed).
 * 'page_verified_unbound'— exact price verified on a product page, but the fetch
 *                          could not be store-bound. Display as "online price".
 * 'shopping_index'       — price from Serper Shopping index only; page verification
 *                          unavailable/failed. Display as "online price".
 * 'model_estimate'       — LLM guess, no source. Display de-emphasized.
 */
export type Provenance =
  | 'api'
  | 'store_page_verified'
  | 'page_verified_unbound'
  | 'shopping_index'
  | 'model_estimate'

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
  /**
   * LLM alignment grade — populated by candidate-grader (P2.7), consumed by
   * selectWinner (P2.8). Absent on legacy plans and items the grader skipped.
   */
  alignmentGrade?: AlignmentGrade
  /** WS1 honesty contract. Absent on legacy plans — UI falls back to `confidence`. */
  provenance?: Provenance
  /** Epoch ms when the price was last verified/fetched (also set from cache writes). */
  verifiedAt?: number
  /** retailerStoreId the binding assertion confirmed, when provenance==='store_page_verified'. */
  verifiedStoreId?: string
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
    /**
     * Resolved ShoppableItemSpecs — introduced in M6/M7, persisted in M8+.
     * Absent on legacy plans written before M8.
     */
    specs?: import('./spec.js').ShoppableItemSpec[]
    /**
     * Backend diagnostics — size resolver, grader, ontology, and AI pass counters.
     * Populated on P3.1+ plans. Absent on legacy plans.
     */
    diagnostics?: PlanDiagnostics
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
    /** P4.1: present when fewer stores were delivered than the user requested. */
    storeShortfall?: {
      requested: number
      delivered: number
      reason: 'no_additional_banners' | 'ai_pass1_failed' | 'ai_pass2_failed'
    }
  }
  /**
   * Best-value winners per item — computed server-side by selectWinner().
   * Populated in M9+ for SHOPPING_V2 plans. Absent on legacy plans.
   */
  winners?: import('../lib/bestValue.js').WinnerResult[]
  /**
   * Instacart Recipe Page URL for the full shopping list.
   * Present on M11+ plans when INSTACART_IDP_API_KEY is configured and the
   * IDP call succeeded. Absent otherwise — the button should not render.
   */
  instacartUrl?: string
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
  resolvedClarifications?: Record<string, ClarifiedAttributes>
  /**
   * Resolved ShoppableItemSpecs from /api/clarify, passed back by the frontend.
   * When present, used directly instead of re-synthesizing from store items.
   * Populated in M9+ by Plan.tsx / EventShop.tsx after the clarification step.
   */
  resolvedSpecs?: import('./spec.js').ShoppableItemSpec[]
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
