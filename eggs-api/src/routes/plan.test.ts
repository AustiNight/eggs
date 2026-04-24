/**
 * Integration test for the /api/price-plan endpoint
 *
 * Verifies that when a request body contains `resolvedClarifications`, the
 * composed search query (baseName + selectedOptions via buildSearchQuery) is
 * the value actually passed to KrogerClient.getPriceForIngredient — i.e. the
 * wiring in plan.ts:454-461 is exercised end-to-end through the route handler.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('../db/client.js', () => ({ getSupabase: vi.fn() }))
vi.mock('../integrations/kroger.js', () => {
  const mockGetPriceForIngredient = vi.fn()
  const mockFindNearbyLocations = vi.fn()
  function KrogerClient() {
    return {
      findNearbyLocations: mockFindNearbyLocations,
      getPriceForIngredient: mockGetPriceForIngredient,
    }
  }
  return { KrogerClient, mockGetPriceForIngredient, mockFindNearbyLocations }
})
vi.mock('../providers/index.js', () => ({
  getProvider: vi.fn(() => ({
    complete: vi.fn().mockResolvedValue({ content: 'Searched nearby stores.', citations: [] }),
  })),
}))

import { getSupabase } from '../db/client.js'
import * as krogerMod from '../integrations/kroger.js'
import plan from './plan.js'

// ── Shared test helpers ───────────────────────────────────────────────────────

const mockGetSupabase = vi.mocked(getSupabase)
// Reach into the mock module for the inner spy references
const { mockGetPriceForIngredient, mockFindNearbyLocations } =
  krogerMod as typeof krogerMod & {
    mockGetPriceForIngredient: ReturnType<typeof vi.fn>
    mockFindNearbyLocations: ReturnType<typeof vi.fn>
  }

/** Minimal mock ExecutionContext — Cloudflare-only API not available in Vitest. */
const MOCK_EXEC_CTX: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

/** Minimal Cloudflare Worker env bindings for the plan route. */
const BASE_ENV = {
  FREE_MONTHLY_LIMIT: '999',
  ANTHROPIC_API_KEY: 'test-key',
  CLERK_SECRET_KEY: 'test-clerk',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-svc',
  TAPESTRY_SERVICE_KEY: 'test-tapestry',
  KROGER_CLIENT_ID: 'kid',
  KROGER_CLIENT_SECRET: 'ksec',
  WALMART_CONSUMER_ID: '',
  WALMART_KEY_VERSION: '',
  WALMART_PRIVATE_KEY: '',
  WALMART_PUBLISHER_ID: '',
  STRIPE_WEBHOOK_SECRET: '',
  RATE_LIMIT_KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace,
  URL_CACHE: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace,
}

/** Mount plan route on a minimal Hono app (auth bypassed via service key). */
function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/', plan)
  return app
}

/** Headers that satisfy requireAuthOrServiceKey without Clerk. */
const SERVICE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Service-Key': 'test-tapestry',
  'X-On-Behalf-Of': 'user-test-123',
}

/** A full pro-user DbUser row returned by getSupabase().from('users')... */
const MOCK_PRO_USER = {
  id: 'user-test-123',
  email: 'test@example.com',
  display_name: 'Test User',
  default_location_lat: 32.78,
  default_location_lng: -96.8,
  default_location_label: 'Dallas, TX 75201',
  default_settings: {},
  avoid_stores: [],
  avoid_brands: [],
  ai_provider: null,
  subscription_tier: 'pro',
  subscription_status: 'active',
  subscription_period_end: null,
  stripe_customer_id: null,
  is_test_account: true,
  created_at: '2024-01-01T00:00:00Z',
}

/** Wire up the Supabase mock for a full plan-route request cycle. */
function mockDb() {
  mockGetSupabase.mockReturnValue({
    from: (table: string) => ({
      select: (_fields: string, _opts?: unknown) => ({
        eq: (_col: string, _val: unknown) => {
          if (table === 'users') {
            return {
              single: () => Promise.resolve({ data: MOCK_PRO_USER, error: null }),
            }
          }
          if (table === 'shopping_plans') {
            // enforceFreeLimit count query
            return {
              gte: () => Promise.resolve({ count: 0, error: null }),
            }
          }
          if (table === 'events') {
            return {
              gte: () => Promise.resolve({ count: 0, error: null }),
            }
          }
          return { single: () => Promise.resolve({ data: null, error: null }) }
        },
      }),
      insert: (_row: unknown) => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'plan-test-1' }, error: null }),
        }),
      }),
      update: (_vals: unknown) => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  } as ReturnType<typeof getSupabase>)
}

/** A fake Kroger location returned by findNearbyLocations. */
const FAKE_KROGER_LOCATION = {
  locationId: 'loc-1',
  name: 'Kroger #01234',
  address: {
    addressLine1: '123 Test St',
    city: 'Dallas',
    state: 'TX',
    zipCode: '75201',
  },
  distanceMiles: 0.5,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks()
})

describe('/api/price-plan — structured clarifications reach KrogerClient', () => {
  it('passes the buildSearchQuery-composed name to getPriceForIngredient when resolvedClarifications is present', async () => {
    mockDb()

    // Kroger returns one nearby location
    mockFindNearbyLocations.mockResolvedValue([FAKE_KROGER_LOCATION])

    // getPriceForIngredient returns a real-priced match for whatever query arrives
    mockGetPriceForIngredient.mockResolvedValue({
      sku: 'sku-001',
      name: 'Kroger Boneless Skinless Chicken Thighs',
      brand: 'Kroger',
      regularPrice: 5.49,
      promoPrice: null,
      productUrl: 'https://kroger.com/p/chicken-thighs',
      size: '2 lb',
    })

    const body = {
      ingredients: [
        {
          id: 'ing-1',
          name: 'chicken thighs',
          quantity: 2,
          unit: 'lb',
          category: 'protein',
          sources: [],
        },
      ],
      resolvedClarifications: {
        'ing-1': {
          baseName: 'chicken thighs',
          selectedOptions: ['Boneless', 'Skinless'],
        },
      },
      location: { lat: 32.78, lng: -96.8 },
      settings: {
        radiusMiles: 10,
        avoidStores: [],
        avoidBrands: [],
      },
    }

    const res = await makeApp().request(
      '/',
      {
        method: 'POST',
        headers: SERVICE_HEADERS,
        body: JSON.stringify(body),
      },
      BASE_ENV,
      MOCK_EXEC_CTX
    )

    // Route should succeed
    expect(res.status).toBe(200)

    // The key assertion: getPriceForIngredient must have been called with the
    // composed query — not with the raw ingredient name 'chicken thighs'.
    expect(mockGetPriceForIngredient).toHaveBeenCalled()
    const firstCallQuery = mockGetPriceForIngredient.mock.calls[0][0] as string
    expect(firstCallQuery).toBe('boneless skinless chicken thighs')
  })
})
