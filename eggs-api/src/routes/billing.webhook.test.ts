import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../db/client.js', () => ({ getSupabase: vi.fn() }))
let cannedEvent: any
const fakeStripe = {
  webhooks: { constructEventAsync: vi.fn().mockImplementation(async () => cannedEvent) },
  subscriptions: { retrieve: vi.fn() },
}
vi.mock('../integrations/stripe.js', () => ({ makeStripe: vi.fn(() => fakeStripe) }))

import { Hono } from 'hono'
import billing from './billing'
import { getSupabase } from '../db/client.js'
const mockGetSupabase = vi.mocked(getSupabase)

function kv() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
  }
}
function env(over = {}) {
  return {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    SUPABASE_URL: 'x',
    SUPABASE_SERVICE_KEY: 'x',
    RATE_LIMIT_KV: kv(),
    ...over,
  } as any
}

describe('POST /webhook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checkout.session.completed → sets tier pro + customer id + period end; idempotent', async () => {
    cannedEvent = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user-123', customer: 'cus_1', subscription: 'sub_1' } },
    }
    // stripe@22: current_period_end lives on the subscription ITEM, not top-level.
    fakeStripe.subscriptions.retrieve.mockResolvedValue({
      status: 'active',
      items: { data: [{ current_period_end: 1893456000, price: { id: 'price_pro' } }] },
    })
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({ from: () => ({ update: (v: any) => ({ eq: () => updateSpy(v) }) }) } as any)
    const e = env()
    const app = new Hono()
    app.route('/', billing)
    const init = { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{"raw":true}' }
    const res1 = await app.request('/webhook', init, e)
    expect(res1.status).toBe(200)
    const body1 = (await res1.json()) as { received?: boolean; duplicate?: boolean }
    expect(body1.received).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_tier: 'pro', stripe_customer_id: 'cus_1', subscription_status: 'active' }),
    )
    // second delivery of the same event id is a no-op
    updateSpy.mockClear()
    const res2 = await app.request('/webhook', init, e)
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { received?: boolean; duplicate?: boolean }
    expect(body2.duplicate).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('customer.subscription.deleted → downgrades to free', async () => {
    cannedEvent = {
      id: 'evt_2',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    // resolve user by stripe_customer_id
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ subscription_tier: 'free' }))
  })

  it('customer.subscription.updated status active → tier pro + period end via updateByCustomer', async () => {
    cannedEvent = {
      id: 'evt_upd_active',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ current_period_end: 1893456000 }] } } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_tier: 'pro',
        subscription_period_end: new Date(1893456000 * 1000).toISOString(),
      }),
    )
  })

  it('customer.subscription.updated status past_due → tier pro (grace)', async () => {
    cannedEvent = {
      id: 'evt_upd_pastdue',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', items: { data: [{ current_period_end: 1893456000 }] } } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ subscription_tier: 'pro' }))
  })

  it('customer.subscription.updated status canceled → tier free', async () => {
    cannedEvent = {
      id: 'evt_upd_canceled',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [{ current_period_end: 1893456000 }] } } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ subscription_tier: 'free' }))
  })

  it('customer.subscription.deleted → clears subscription_period_end (null)', async () => {
    cannedEvent = {
      id: 'evt_del_clear',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_tier: 'free', subscription_period_end: null }),
    )
  })

  it('checkout.session.completed missing client_reference_id → no update, still 200, idempotency key set', async () => {
    cannedEvent = {
      id: 'evt_checkout_missing',
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({ from: () => ({ update: (v: any) => ({ eq: () => updateSpy(v) }) }) } as any)
    const e = env()
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, e)
    expect(res.status).toBe(200)
    expect(updateSpy).not.toHaveBeenCalled()
    // idempotency key still recorded so retries short-circuit
    expect(e.RATE_LIMIT_KV.put).toHaveBeenCalledWith('stripe_evt:evt_checkout_missing', '1', expect.anything())
  })

  it('updateByCustomer no-match (select returns null) → no update, still 200', async () => {
    cannedEvent = {
      id: 'evt_del_nomatch',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_untracked', status: 'canceled' } },
    }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('handler DB error → 500 AND idempotency key NOT written; retry still attempts processing', async () => {
    cannedEvent = {
      id: 'evt_db_error',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    }
    const selectSingle = vi.fn(() => Promise.resolve({ data: { id: 'user-123' }, error: null }))
    const updateSpy = vi.fn((_v: any) => {
      throw new Error('db down')
    })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: selectSingle }) }),
        update: (v: any) => ({ eq: () => updateSpy(v) }),
      }),
    } as any)
    const e = env()
    const app = new Hono()
    app.route('/', billing)
    const init = { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }
    const res = await app.request('/webhook', init, e)
    expect(res.status).toBe(500)
    expect(e.RATE_LIMIT_KV.put).not.toHaveBeenCalled()
    // second delivery is NOT short-circuited — it reaches the handler again
    selectSingle.mockClear()
    const res2 = await app.request('/webhook', init, e)
    expect(res2.status).toBe(500)
    expect(selectSingle).toHaveBeenCalled()
  })

  it('400 on signature verification failure', async () => {
    fakeStripe.webhooks.constructEventAsync.mockRejectedValueOnce(new Error('bad sig'))
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'bad' }, body: '{}' }, env())
    expect(res.status).toBe(400)
  })

  it('400 when signature header missing', async () => {
    const app = new Hono()
    app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', body: '{}' }, env())
    expect(res.status).toBe(400)
  })
})
