import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn().mockResolvedValue({ sub: 'user-123' }) }))
vi.mock('../db/client.js', () => ({ getSupabase: vi.fn() }))
const fakeStripe = {
  customers: { create: vi.fn().mockResolvedValue({ id: 'cus_new' }) },
  checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s/test' }) } },
  billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/test' }) } },
}
vi.mock('../integrations/stripe.js', () => ({ makeStripe: vi.fn(() => fakeStripe) }))

import { Hono } from 'hono'
import billing from './billing'
import { getSupabase } from '../db/client.js'
const mockGetSupabase = vi.mocked(getSupabase)

const ENV = { CLERK_SECRET_KEY: 'x', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRO_PRICE_ID: 'price_pro', SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any

function userRow(over = {}) {
  return { id: 'user-123', email: 'chef@x.com', stripe_customer_id: null, subscription_tier: 'free', ...over }
}
function supa(row: any, updateSpy = vi.fn().mockResolvedValue({ error: null })) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }),
      update: (vals: any) => ({ eq: () => updateSpy(vals) }),
    }),
  }
}

describe('POST /checkout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a customer when none exists, persists id, returns checkout url', async () => {
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue(supa(userRow(), updateSpy) as any)
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/checkout', {
      method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify({ appUrl: 'https://priceofeggs.online' }),
    }, ENV)
    expect(res.status).toBe(200)
    expect((await res.json() as { url: string }).url).toContain('checkout.stripe.com')
    expect(fakeStripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'chef@x.com', metadata: { userId: 'user-123' } }))
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ stripe_customer_id: 'cus_new' }))
    expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription', customer: 'cus_new', client_reference_id: 'user-123',
    }))
  })

  it('reuses existing customer id', async () => {
    mockGetSupabase.mockReturnValue(supa(userRow({ stripe_customer_id: 'cus_existing' })) as any)
    const app = new Hono(); app.route('/', billing)
    await app.request('/checkout', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{}' }, ENV)
    expect(fakeStripe.customers.create).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_existing' }))
  })

  it('401 without auth', async () => {
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/checkout', { method: 'POST', body: '{}' }, ENV)
    expect(res.status).toBe(401)
  })
})

describe('POST /portal', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns portal url for a customer', async () => {
    mockGetSupabase.mockReturnValue(supa(userRow({ stripe_customer_id: 'cus_1' })) as any)
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/portal', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ appUrl: 'https://priceofeggs.online' }) }, ENV)
    expect(res.status).toBe(200)
    expect((await res.json() as { url: string }).url).toContain('billing.stripe.com')
  })
  it('400 when user has no stripe customer', async () => {
    mockGetSupabase.mockReturnValue(supa(userRow({ stripe_customer_id: null })) as any)
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/portal', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{}' }, ENV)
    expect(res.status).toBe(400)
  })
})
