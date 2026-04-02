import type { Context, Next } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { getSupabase } from '../db/client.js'

export const enforceFreeLimit = async (
  c: Context<HonoEnv>,
  next: Next
) => {
  const userId = c.get('userId') as string
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: user } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()

  if (user?.subscription_tier === 'pro') {
    await next()
    return
  }

  const limit = parseInt(c.env.FREE_MONTHLY_LIMIT ?? '3')
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString()

  const [plansResult, eventsResult] = await Promise.all([
    supabase
      .from('shopping_plans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('generated_at', monthStart),
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart)
  ])

  const plans = plansResult.count ?? 0
  const events = eventsResult.count ?? 0

  if (plans >= limit || events >= limit) {
    return c.json(
      {
        error: 'free_limit_reached',
        limit,
        plans_used: plans,
        events_used: events,
        message: `Free tier allows ${limit} events and ${limit} shopping plans per month. Upgrade to Pro for unlimited access.`
      },
      403
    )
  }

  await next()
}
