import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { enforceFreeLimit } from '../middleware/limits.js'

// Mock getSupabase so we control what Supabase returns
vi.mock('../db/client.js', () => ({ getSupabase: vi.fn() }))
import { getSupabase } from '../db/client.js'
const mockGetSupabase = vi.mocked(getSupabase)

/** Build a minimal Hono app wired with enforceFreeLimit */
function makeApp() {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => { c.set('userId', 'user-123'); await next() })
  app.use('*', enforceFreeLimit)
  app.post('/', c => c.json({ ok: true }))
  return app
}

const BASE_ENV = {
  FREE_MONTHLY_LIMIT: '3',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  RATE_LIMIT_KV: {} as KVNamespace,
  URL_CACHE: {} as KVNamespace,
  ANTHROPIC_API_KEY: '',
  CLERK_SECRET_KEY: '',
  KROGER_CLIENT_ID: '',
  KROGER_CLIENT_SECRET: '',
  WALMART_CONSUMER_ID: '',
  WALMART_KEY_VERSION: '',
  WALMART_PRIVATE_KEY: '',
  WALMART_PUBLISHER_ID: '',
  TAPESTRY_SERVICE_KEY: '',
  STRIPE_WEBHOOK_SECRET: ''
}

function mockDb(tier: 'free' | 'pro', plansCount: number, eventsCount: number) {
  mockGetSupabase.mockReturnValue({
    from: (table: string) => ({
      select: (fields: string, opts?: { count?: string; head?: boolean }) => ({
        eq: (_col: string, _val: unknown) => {
          if (fields === 'subscription_tier') {
            return { single: () => Promise.resolve({ data: { subscription_tier: tier } }) }
          }
          // count queries
          return {
            gte: () => Promise.resolve({
              count: table === 'shopping_plans' ? plansCount : eventsCount
            })
          }
        }
      })
    })
  } as ReturnType<typeof getSupabase>)
}

describe('enforceFreeLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through for pro users regardless of usage', async () => {
    mockDb('pro', 99, 99)
    const res = await makeApp().request('/', { method: 'POST' }, BASE_ENV)
    expect(res.status).toBe(200)
  })

  it('passes through for free users under the limit', async () => {
    mockDb('free', 1, 1)
    const res = await makeApp().request('/', { method: 'POST' }, BASE_ENV)
    expect(res.status).toBe(200)
  })

  it('blocks free users when plans hit the limit', async () => {
    mockDb('free', 3, 0)
    const res = await makeApp().request('/', { method: 'POST' }, BASE_ENV)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('free_limit_reached')
  })

  it('blocks free users when events hit the limit', async () => {
    mockDb('free', 0, 3)
    const res = await makeApp().request('/', { method: 'POST' }, BASE_ENV)
    expect(res.status).toBe(403)
  })

  it('includes usage counts in 403 response', async () => {
    mockDb('free', 3, 2)
    const res = await makeApp().request('/', { method: 'POST' }, BASE_ENV)
    const body = await res.json() as { limit: number; plans_used: number; events_used: number }
    expect(body.limit).toBe(3)
    expect(body.plans_used).toBe(3)
    expect(body.events_used).toBe(2)
  })
})
