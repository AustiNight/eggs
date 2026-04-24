import type {
  UserProfile,
  EggsEvent,
  EventDetail,
  Dish,
  IngredientLine,
  ClarificationRequest,
  ClarifiedAttributes,
  ShoppingPlan,
  ShoppingPlanRecord,
  ShoppableItemSpecMirror,
  PlanSettings,
  ReconcileRecord
} from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

async function req<T>(
  path: string,
  options: RequestInit & { token: string }
): Promise<T> {
  const { token, ...rest } = options
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(rest.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new ApiError(res.status, body.error ?? body.message ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const syncUser = (token: string, email: string, displayName?: string) =>
  req<UserProfile>('/api/users/sync', {
    token,
    method: 'POST',
    body: JSON.stringify({ email, displayName })
  })

export const getMe = (token: string) =>
  req<UserProfile>('/api/users/me', { token, method: 'GET' })

export const updateMe = (token: string, updates: Partial<UserProfile>) =>
  req<UserProfile>('/api/users/me', {
    token,
    method: 'PATCH',
    body: JSON.stringify(updates)
  })

// ─── Events ───────────────────────────────────────────────────────────────────

export interface CreateEventInput {
  name: string
  client_name?: string
  event_date?: string
  headcount: number
  budget_mode?: 'calculate' | 'ceiling'
  budget_ceiling?: number
}

export const createEvent = (token: string, input: CreateEventInput) =>
  req<EggsEvent>('/api/events', {
    token,
    method: 'POST',
    body: JSON.stringify(input)
  })

export const listEvents = (token: string, page = 1) =>
  req<{ events: EggsEvent[]; total: number; page: number; limit: number }>(
    `/api/events?page=${page}`,
    { token, method: 'GET' }
  )

export const getEvent = (token: string, id: string) =>
  req<EventDetail>(`/api/events/${id}`, { token, method: 'GET' })

export const updateEvent = (token: string, id: string, updates: Partial<EggsEvent>) =>
  req<EggsEvent>(`/api/events/${id}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(updates)
  })

export const deleteEvent = (token: string, id: string) =>
  req<{ deleted: boolean }>(`/api/events/${id}`, { token, method: 'DELETE' })

export const addDish = (
  token: string,
  eventId: string,
  dish: { name: string; servings?: number; notes?: string }
) =>
  req<Dish>(`/api/events/${eventId}/dishes`, {
    token,
    method: 'POST',
    body: JSON.stringify(dish)
  })

export const removeDish = (token: string, eventId: string, dishId: string) =>
  req<{ deleted: boolean }>(`/api/events/${eventId}/dishes/${dishId}`, {
    token,
    method: 'DELETE'
  })

// ─── AI Pipeline ──────────────────────────────────────────────────────────────

export const scaleRecipes = (
  token: string,
  dishes: { id: string; name: string; servings: number }[],
  eventId?: string,
  storeToIngredientPool?: boolean
) =>
  req<{ ingredients: IngredientLine[]; modelUsed: string }>('/api/scale-recipes', {
    token,
    method: 'POST',
    body: JSON.stringify({ dishes, eventId, storeToIngredientPool })
  })

export const clarifyIngredients = (token: string, ingredients: IngredientLine[]) =>
  req<{
    clarifications: ClarificationRequest[] | null
    /**
     * Resolved specs for items that didn't need clarification.
     * Keyed by ingredientId. New in M6; absent on older API versions.
     */
    specs?: Record<string, ShoppableItemSpecMirror>
  }>('/api/clarify', {
    token,
    method: 'POST',
    body: JSON.stringify({ ingredients })
  })

export interface PricePlanInput {
  ingredients: IngredientLine[]
  resolvedClarifications?: Record<string, ClarifiedAttributes>
  /**
   * Resolved specs from /api/clarify, forwarded to /api/price-plan so the
   * server can persist them and compute best-basket winners accurately.
   * Populated in M9+ after the clarification step.
   */
  resolvedSpecs?: ShoppableItemSpecMirror[]
  location: { lat: number; lng: number }
  settings: PlanSettings
  budget?: { mode: 'ceiling' | 'calculate'; amount?: number }
  eventId?: string
  eventName?: string
  headcount?: number
}

export const generatePlan = (token: string, input: PricePlanInput) =>
  req<ShoppingPlan>('/api/price-plan', {
    token,
    method: 'POST',
    body: JSON.stringify(input)
  })

// ─── Shopping Plans ───────────────────────────────────────────────────────────

export const listShoppingPlans = (token: string) =>
  req<{ plans: ShoppingPlanRecord[] }>('/api/plans', { token, method: 'GET' })

// ─── Reconcile ────────────────────────────────────────────────────────────────

export const getReconcile = (token: string, eventId: string) =>
  req<ReconcileRecord>(`/api/events/${eventId}/reconcile`, { token, method: 'GET' })

export interface ReconcileInput {
  shoppingPlanId: string
  mode: 'receipt' | 'detailed'
  receiptTotals?: { storeName: string; receiptTotal: number }[]
  actualItems?: { storeItemId: string; actualPrice: number; actualQuantity: number; note?: string }[]
}

export const saveReconcile = (token: string, eventId: string, input: ReconcileInput) =>
  req<{ record: ReconcileRecord; summary: ReconcileRecord['summary'] }>(
    `/api/events/${eventId}/reconcile`,
    { token, method: 'POST', body: JSON.stringify(input) }
  )
