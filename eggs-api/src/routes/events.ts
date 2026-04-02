import { Hono } from 'hono'
import type { HonoEnv, DbEvent } from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { enforceFreeLimit } from '../middleware/limits.js'

const events = new Hono<HonoEnv>()

// POST /api/events — create event [free limit applies]
events.post('/', requireAuth, enforceFreeLimit, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const body = await c.req.json<Partial<DbEvent>>()

  const { data, error } = await supabase
    .from('events')
    .insert({
      user_id: userId,
      name: body.name,
      client_name: body.client_name ?? null,
      event_date: body.event_date ?? null,
      headcount: body.headcount ?? 1,
      budget_mode: body.budget_mode ?? 'calculate',
      budget_ceiling: body.budget_ceiling ?? null,
      status: 'planning'
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

// GET /api/events — list user events, newest first
events.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const page = parseInt(c.req.query('page') ?? '1')
  const limit = 20
  const from = (page - 1) * limit

  const { data, error, count } = await supabase
    .from('events')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ events: data, total: count, page, limit })
})

// GET /api/events/:id — full event with dishes + ingredient pool
events.get('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const [eventRes, dishesRes, ingredientsRes, latestPlanRes] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).eq('user_id', userId).single(),
    supabase.from('dishes').select('*').eq('event_id', eventId).eq('user_id', userId).order('sort_order'),
    supabase.from('ingredient_pool').select('*').eq('event_id', eventId).eq('user_id', userId),
    supabase.from('shopping_plans').select('id, generated_at, model_used').eq('event_id', eventId).eq('user_id', userId).order('generated_at', { ascending: false }).limit(1)
  ])

  if (!eventRes.data) return c.json({ error: 'Not found' }, 404)

  return c.json({
    event: eventRes.data,
    dishes: dishesRes.data ?? [],
    ingredients: ingredientsRes.data ?? [],
    latestPlan: latestPlanRes.data?.[0] ?? null
  })
})

// PATCH /api/events/:id — update event or transition status
events.patch('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: existing } = await supabase.from('events').select('id').eq('id', eventId).eq('user_id', userId).single()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<Partial<DbEvent>>()
  const allowed = ['name', 'client_name', 'event_date', 'headcount', 'budget_mode', 'budget_ceiling', 'status']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = (body as Record<string, unknown>)[key]
  }

  const { data, error } = await supabase.from('events').update(update).eq('id', eventId).eq('user_id', userId).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// DELETE /api/events/:id — soft delete by marking status = 'complete' then hard delete
events.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { error } = await supabase.from('events').delete().eq('id', eventId).eq('user_id', userId)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ deleted: true })
})

// POST /api/events/:id/dishes — add dish
events.post('/:id/dishes', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: event } = await supabase.from('events').select('id').eq('id', eventId).eq('user_id', userId).single()
  if (!event) return c.json({ error: 'Event not found' }, 404)

  const body = await c.req.json<{ name: string; servings?: number; notes?: string }>()

  const { count } = await supabase.from('dishes').select('*', { count: 'exact', head: true }).eq('event_id', eventId)

  const { data, error } = await supabase
    .from('dishes')
    .insert({
      event_id: eventId,
      user_id: userId,
      name: body.name,
      servings: body.servings ?? null,
      notes: body.notes ?? null,
      sort_order: (count ?? 0)
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

// DELETE /api/events/:id/dishes/:dishId — remove dish
events.delete('/:id/dishes/:dishId', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const dishId = c.req.param('dishId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { error } = await supabase.from('dishes').delete().eq('id', dishId).eq('event_id', eventId).eq('user_id', userId)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ deleted: true })
})

// GET /api/events/:id/reconcile
events.get('/:id/reconcile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data, error } = await supabase.from('reconcile_records').select('*').eq('event_id', eventId).eq('user_id', userId).order('completed_at', { ascending: false }).limit(1).single()
  if (error || !data) return c.json({ error: 'Not found' }, 404)
  return c.json(data)
})

// POST /api/events/:id/reconcile — save reconcile record + update event status
events.post('/:id/reconcile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const eventId = c.req.param('id')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: event } = await supabase.from('events').select('*').eq('id', eventId).eq('user_id', userId).single()
  if (!event) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{
    shoppingPlanId: string
    mode: 'receipt' | 'detailed'
    receiptTotals?: { storeName: string; receiptTotal: number }[]
    actualItems?: { storeItemId: string; actualPrice: number; actualQuantity: number; note?: string }[]
  }>()

  // Compute summary
  let actualTotal = 0
  if (body.mode === 'receipt' && body.receiptTotals) {
    actualTotal = body.receiptTotals.reduce((sum, r) => sum + r.receiptTotal, 0)
  } else if (body.mode === 'detailed' && body.actualItems) {
    actualTotal = body.actualItems.reduce((sum, i) => sum + i.actualPrice * i.actualQuantity, 0)
  }

  // Get estimated total from shopping plan
  const { data: plan } = await supabase.from('shopping_plans').select('plan_data').eq('id', body.shoppingPlanId).eq('user_id', userId).single()
  const estimatedTotal = (plan?.plan_data as { summary?: { total?: number } })?.summary?.total ?? 0

  const variance = actualTotal - estimatedTotal
  const variancePct = estimatedTotal > 0 ? (variance / estimatedTotal) * 100 : 0

  const summary = {
    estimatedTotal,
    actualTotal,
    variance: Math.round(variance * 100) / 100,
    variancePct: Math.round(variancePct * 10) / 10,
    perDishActual: []
  }

  const { data: record, error } = await supabase
    .from('reconcile_records')
    .insert({
      event_id: eventId,
      shopping_plan_id: body.shoppingPlanId,
      user_id: userId,
      mode: body.mode,
      actual_items: body.actualItems ?? [],
      receipt_totals: body.receiptTotals ?? [],
      summary
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Transition event to complete
  await supabase.from('events').update({ status: 'complete' }).eq('id', eventId).eq('user_id', userId)

  return c.json({ record, summary }, 201)
})

export default events
