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

// Webhook — unauthenticated; the Stripe signature IS the auth. Only writer of
// subscription_* columns. Idempotent via RATE_LIMIT_KV keyed on event id.
billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  if (!sig) return c.json({ error: 'missing_signature' }, 400)
  const raw = await c.req.text()
  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY)

  let event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, c.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.warn('[billing] webhook signature failed', err instanceof Error ? err.message : err)
    return c.json({ error: 'invalid_signature' }, 400)
  }

  // Idempotency: skip if we've already processed this event id.
  // Best-effort dedup: KV check-then-set isn't atomic, but the handler's writes are idempotent UPDATEs, so a rare double-delivery is harmless.
  const idemKey = `stripe_evt:${event.id}`
  const seen = await c.env.RATE_LIMIT_KV.get(idemKey)
  if (seen) return c.json({ received: true, duplicate: true })

  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as { client_reference_id?: string; customer?: string; subscription?: string }
        const userId = s.client_reference_id
        if (!userId || !s.subscription) {
          console.error('[billing] checkout.session.completed missing client_reference_id or subscription', { userId, subscription: s.subscription })
          break
        }
        const sub = await stripe.subscriptions.retrieve(s.subscription)
        // stripe@22 (2026-05-27.dahlia): current_period_end lives on the
        // subscription ITEM, not the top-level Subscription object.
        const periodEnd = sub.items.data[0]?.current_period_end
        await supabase.from('users').update({
          subscription_tier: 'pro',
          subscription_status: sub.status,
          subscription_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          stripe_customer_id: s.customer ?? null,
        }).eq('id', userId)
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object
        const periodEnd = sub.items.data[0]?.current_period_end
        // Pro access is retained during Stripe's dunning window (past_due) so a failed
        // card retry doesn't instantly lock a paying chef out; everything else
        // (paused/canceled/unpaid/incomplete) drops to free.
        const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])
        const tier = PRO_STATUSES.has(sub.status) ? 'pro' : 'free'
        await updateByCustomer(supabase, sub.customer, {
          subscription_tier: tier,
          subscription_status: sub.status,
          subscription_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        })
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await updateByCustomer(supabase, sub.customer, {
          subscription_tier: 'free',
          subscription_status: sub.status,
          subscription_period_end: null,
        })
        break
      }
      default:
        // ignore other event types
        break
    }
    // Mark processed (3-day TTL covers Stripe's retry window).
    await c.env.RATE_LIMIT_KV.put(idemKey, '1', { expirationTtl: 259200 })
    return c.json({ received: true })
  } catch (err) {
    console.error('[billing] webhook handler error', err instanceof Error ? err.message : err)
    // 500 so Stripe retries (do NOT mark processed).
    return c.json({ error: 'handler_error' }, 500)
  }
})

async function updateByCustomer(
  supabase: ReturnType<typeof getSupabase>,
  customerId: unknown,
  vals: Record<string, unknown>,
): Promise<void> {
  // Stripe types customer as string | Customer | DeletedCustomer; webhooks don't
  // expand by default, but if one ever arrives expanded, throw so the handler
  // 500s and Stripe retries rather than corrupting the lookup with "[object Object]".
  if (typeof customerId !== 'string') throw new Error(`unexpected expanded customer: ${JSON.stringify(customerId)}`)
  const { data } = await supabase.from('users').select('id').eq('stripe_customer_id', customerId).single()
  const id = (data as { id?: string } | null)?.id
  if (!id) {
    // Genuinely-untracked customer (e.g. manual dashboard sub) — retrying won't
    // help since no row will ever match. Accept the loss but make it visible.
    console.warn('[billing] no user for stripe_customer_id', customerId)
    return
  }
  await supabase.from('users').update(vals).eq('id', id)
}

export default billing
