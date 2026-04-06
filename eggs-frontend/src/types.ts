// Shared domain types — must stay in sync with eggs-api/src/types/index.ts

export type EventStatus = 'planning' | 'shopping' | 'reconcile_needed' | 'complete'
export type PriceSource = 'kroger_api' | 'walmart_api' | 'walgreens_api' | 'ai_estimated'
export type Confidence = 'real' | 'estimated_with_source' | 'estimated'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  default_location_lat: number | null
  default_location_lng: number | null
  default_location_label: string | null
  default_settings: Partial<PlanSettings>
  avoid_stores: string[]
  avoid_brands: string[]
  ai_provider: string | null
  subscription_tier: 'free' | 'pro'
  subscription_status: string
}

export interface EggsEvent {
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

export interface Dish {
  id: string
  event_id: string
  user_id: string
  name: string
  servings: number | null
  notes: string | null
  sort_order: number
  created_at: string
}

export interface IngredientLine {
  id: string
  name: string
  clarifiedName?: string
  quantity: number
  unit: string
  category: string
  sources: {
    dishId: string
    dishName: string
    quantity: number
    unit: string
    proportion: number
  }[]
}

export interface ClarificationRequest {
  itemId: string
  originalName: string
  question: string
  options: string[]
}

export interface PlanSettings {
  radiusMiles: number
  maxStores: number
  includeDelivery: boolean
  curbsideMaxMiles?: number
  avoidStores?: string[]
  avoidBrands?: string[]
}

export interface StoreItem {
  ingredientId: string
  name: string
  sku?: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
  confidence: Confidence
  productUrl?: string
  proofUrl?: string
  isLoyaltyPrice: boolean
  nonMemberPrice?: number
  notAvailable?: boolean
}

export interface ShoppingPlanRecord {
  id: string
  generated_at: string
  plan_data: ShoppingPlan
}

export interface StorePlan {
  storeName: string
  storeBanner: string
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

export interface ShoppingItem {
  id: string
  name: string
  quantity: number
  unit?: string
  clarifiedName?: string
  lastPurchased?: string
}


export interface ReconcileRecord {
  id: string
  event_id: string
  shopping_plan_id: string | null
  mode: 'receipt' | 'detailed'
  receipt_totals: { storeName: string; receiptTotal: number }[]
  actual_items: { storeItemId: string; actualPrice: number; actualQuantity: number; note?: string }[]
  summary: {
    estimatedTotal: number
    actualTotal: number
    variance: number
    variancePct: number
    perDishActual: { dish: string; actualCost: number; estimatedCost: number }[]
  } | null
  completed_at: string
}

export interface EventDetail {
  event: EggsEvent
  dishes: Dish[]
  ingredients: IngredientLine[]
  latestPlan: { id: string; generated_at: string; model_used: string | null; plan_data: ShoppingPlan } | null
}

// App flow state (for EventShop page)
export type ShopStatus =
  | 'idle'
  | 'scaling'
  | 'clarifying'
  | 'searching'
  | 'optimizing'
  | 'results'
  | 'error'
