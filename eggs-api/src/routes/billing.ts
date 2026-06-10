import { Hono } from 'hono'
import type { HonoEnv, DbUser } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { getSupabase } from '../db/client.js'
import { makeStripe } from '../integrations/stripe.js'

const billing = new Hono<HonoEnv>()

function appUrlFrom(body: { appUrl?: string }, fallback = 'https://priceofeggs.online'): string {
  const u = body?.appUrl
  return typeof u === 'string' && /^https?:\/\//.test(u) ? u.replace(/\/$/, '') : fallback
}

billing.post('/checkout', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({})) as { appUrl?: string }
  const appUrl = appUrlFrom(body)
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).single()
  if (error || !user) return c.json({ error: 'user_not_found' }, 404)
  const u = user as DbUser

  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY)
  let customerId = u.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ email: u.email, metadata: { userId } })
    customerId = customer.id
    await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', userId)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: c.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/settings?billing=success`,
    cancel_url: `${appUrl}/settings?billing=cancelled`,
    allow_promotion_codes: true,
  })
  return c.json({ url: session.url })
})

billing.post('/portal', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({})) as { appUrl?: string }
  const appUrl = appUrlFrom(body)
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const { data: user } = await supabase.from('users').select('stripe_customer_id').eq('id', userId).single()
  const customerId = (user as { stripe_customer_id?: string } | null)?.stripe_customer_id
  if (!customerId) return c.json({ error: 'no_subscription' }, 400)
  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY)
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${appUrl}/settings` })
  return c.json({ url: session.url })
})

export default billing
