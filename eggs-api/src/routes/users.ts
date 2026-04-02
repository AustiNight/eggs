import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const users = new Hono<HonoEnv>()

// POST /api/users/sync — upsert user from Clerk JWT on first login
users.post('/sync', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const body = await c.req.json<{ email: string; displayName?: string }>()

  const { data, error } = await supabase
    .from('users')
    .upsert(
      { id: userId, email: body.email, display_name: body.displayName ?? null },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/users/me
users.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) return c.json({ error: 'Not found' }, 404)
  return c.json(data)
})

// PATCH /api/users/me — update profile / settings
users.patch('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const body = await c.req.json<Record<string, unknown>>()

  // Whitelist updatable fields
  const allowed = [
    'display_name',
    'default_location_lat',
    'default_location_lng',
    'default_location_label',
    'default_settings',
    'avoid_stores',
    'avoid_brands',
    'ai_provider'
  ]
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', userId)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

export default users
