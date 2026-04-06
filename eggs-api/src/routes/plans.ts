import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { getSupabase } from '../db/client.js'

const plans = new Hono<HonoEnv>()

// GET /api/plans — list user's standalone shopping plans (not linked to an event)
plans.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data } = await supabase
    .from('shopping_plans')
    .select('id, generated_at, plan_data')
    .eq('user_id', userId)
    .is('event_id', null)
    .order('generated_at', { ascending: false })
    .limit(20)

  return c.json({ plans: data ?? [] })
})

export default plans
