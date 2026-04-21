import { Hono } from 'hono'
import type { HonoEnv, UserProfile } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { getSupabase } from '../db/client.js'
import { computeBestBasketTotal } from '../lib/planTotals.js'

const plans = new Hono<HonoEnv>()

// GET /api/plans — list user's standalone shopping plans (not linked to an event)
plans.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data } = await supabase
    .from('shopping_plans')
    .select('id, generated_at, plan_data, best_basket_total')
    .eq('user_id', userId)
    .is('event_id', null)
    .order('generated_at', { ascending: false })
    .limit(20)

  if (!data) return c.json({ plans: [] })

  // Lazy-recompute best_basket_total for legacy rows (null column) when flag is on.
  // We do NOT write back to the DB — recompute-at-read only (DESIGN.md §VI).
  const shoppingV2 = c.env.SHOPPING_V2 === 'true'

  // Load user profile once if we may need to recompute
  let userProfile: UserProfile | null = null
  if (shoppingV2) {
    const { data: user } = await supabase.from('users').select('avoid_brands').eq('id', userId).single()
    userProfile = { avoid_brands: user?.avoid_brands ?? [] }
  }

  // Synchronous lazy recompute across up to 20 rows (bounded by the .limit above).
  // computeBestBasketTotal is pure and typically O(specs × stores × items); with
  // MVP-sized plans (~3-10 specs, ~3-5 stores), this stays well inside Worker CPU budget.
  const plans = data.map((row) => {
    // Determine the best_basket_total to expose
    let bestBasketTotal: number | null = row.best_basket_total ?? null

    if (bestBasketTotal === null && shoppingV2 && userProfile) {
      // Legacy row — compute on the fly from stored plan_data
      try {
        const recomputed = computeBestBasketTotal(row.plan_data, userProfile)
        bestBasketTotal = recomputed.total
      } catch {
        // plan_data may be malformed — leave as null rather than crashing
      }
    }

    return {
      ...row,
      best_basket_total: bestBasketTotal,
    }
  })

  return c.json({ plans })
})

export default plans
