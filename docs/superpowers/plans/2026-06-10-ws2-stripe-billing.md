# WS2: Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A free user who hits their limit can upgrade to Pro via Stripe Checkout, manage/cancel via the customer portal, and have their tier flip automatically via a signature-verified, idempotent webhook — so the existing free-tier paywall stops being a dead end.

**Architecture:** A `stripe` client built for the Workers runtime (fetch HTTP client + `constructEventAsync`). Three routes under `/api/billing`: authenticated `POST /checkout` and `POST /portal`, and unauthenticated raw-body `POST /webhook` that verifies the Stripe signature and is the ONLY writer of subscription columns. Idempotency via `RATE_LIMIT_KV` keyed by Stripe event id. Frontend wires the existing stub upgrade buttons to redirect to Checkout, and adds a Settings billing section (plan, renewal, manage).

**Tech Stack:** Cloudflare Workers (Hono), `stripe` npm (Workers-compatible mode), Supabase, Vitest. Frontend: React, redirect-to-URL (no Stripe.js needed).

**Spec:** `docs/superpowers/specs/2026-06-09-public-readiness-design.md` (WS2 section).

**Repo facts (verified):**
- `users` already has `subscription_tier ('free'|'pro')`, `subscription_status`, `subscription_period_end`, `stripe_customer_id`, `is_test_account`. `users.id` = Clerk `payload.sub` (text PK). `email` not null.
- `requireAuth` (`middleware/auth.ts`) sets only `c.set('userId', payload.sub)` — email must come from the `users` row.
- `enforceFreeLimit` (`middleware/limits.ts`) returns 403 `{ error: 'free_limit_reached', limit, plans_used, events_used, message }`; the frontend keys on `error === 'free_limit_reached'`/status 403 (`Plan.tsx:146`, paywall at `Plan.tsx:229-270`).
- `Settings.tsx:99` upgrade button is `alert('Pro subscriptions coming soon!')` — the primary surface to wire.
- `STRIPE_WEBHOOK_SECRET` already in `Env`; `STRIPE_SECRET_KEY` and a price-id env are NOT. `stripe` npm NOT installed.
- Test `BASE_ENV` objects at `__tests__/limits.test.ts` and `routes/plan.test.ts` will need the new env fields or they fail typecheck.
- `requireAuth` route tests mock `@clerk/backend` `verifyToken` → `{ sub: 'user-123' }`.

**Constraints:** UI additive only (extend Settings + the existing paywall, no redesign). Use **Stripe test mode** keys throughout; going live is a Jonathan-action checklist at the end. Webhook is the only subscription-column writer (PATCH /users/me must never accept those fields — it already doesn't).

---

### Task 1: Deps, env, types

**Files:**
- Modify: `eggs-api/package.json` (add `stripe`)
- Modify: `eggs-api/src/types/index.ts` (Env)
- Modify: `eggs-api/wrangler.toml` (secrets comment)
- Modify: `eggs-api/src/__tests__/limits.test.ts`, `eggs-api/src/routes/plan.test.ts` (BASE_ENV)
- Modify: `eggs-frontend/src/types.ts` (UserProfile)

- [ ] **Step 1: Install stripe**

Run: `cd eggs-api && pnpm add stripe` (repo uses pnpm-lock.yaml; if npm is the active lock, use `npm install stripe`). Verify it appears in `package.json` dependencies.

- [ ] **Step 2: Env type** — in `eggs-api/src/types/index.ts`, after the existing `STRIPE_WEBHOOK_SECRET: string` line add:

```ts
  /** Stripe secret key — sk_test_… in dev, sk_live_… in prod. */
  STRIPE_SECRET_KEY: string
  /** Stripe Price id for the Pro subscription (price_…). Test-mode price in dev. */
  STRIPE_PRO_PRICE_ID: string
```

- [ ] **Step 3: wrangler.toml** — extend the prod-secrets comment block: add `STRIPE_SECRET_KEY` to the secret list and add a `[vars]` note that `STRIPE_PRO_PRICE_ID` is a non-secret var (it can live in `[vars]` since a price id isn't sensitive). Actually add to `[vars]`:

```toml
[vars]
FREE_MONTHLY_LIMIT = "3"
SHOPPING_V2 = "true"
# STRIPE_PRO_PRICE_ID set per-env in [vars]; STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET via `wrangler secret put`
```
Leave the actual price-id value unset here (set at deploy). Add `STRIPE_PRO_PRICE_ID` to staging `[env.staging.vars]` too (placeholder comment).

- [ ] **Step 4: Fix test BASE_ENV** — `grep -rn "STRIPE_WEBHOOK_SECRET" eggs-api/src/**/*.test.ts eggs-api/src/__tests__`. In each BASE_ENV/env object that sets `STRIPE_WEBHOOK_SECRET: ''`, add `STRIPE_SECRET_KEY: ''` and `STRIPE_PRO_PRICE_ID: ''`. Run `npx tsc --noEmit` to confirm no missing-field errors.

- [ ] **Step 5: Frontend UserProfile** — in `eggs-frontend/src/types.ts`, add to the `UserProfile`/user type the fields the API already returns:

```ts
  subscription_period_end?: string | null
  stripe_customer_id?: string | null
```

- [ ] **Step 6: Verify + commit**

Run from `eggs-api`: `npx tsc --noEmit` (clean), `npx vitest run` (still green). From `eggs-frontend`: `npx tsc --noEmit`.
```bash
git add eggs-api/package.json eggs-api/pnpm-lock.yaml eggs-api/package-lock.json eggs-api/src/types/index.ts eggs-api/wrangler.toml eggs-api/src/__tests__/limits.test.ts eggs-api/src/routes/plan.test.ts eggs-frontend/src/types.ts
git commit -m "chore(billing): add stripe dep + STRIPE_SECRET_KEY/PRO_PRICE_ID env + UserProfile billing fields (WS2)"
```
(Only stage the lockfile that actually changed.)

---

### Task 2: Workers-compatible Stripe client

**Files:**
- Create: `eggs-api/src/integrations/stripe.ts`
- Test: `eggs-api/src/integrations/stripe.test.ts`

The `stripe` SDK's default Node HTTP client and synchronous `constructEvent` don't work on Workers. Wrap construction so the rest of the app gets a correctly-configured client, and expose a thin seam for testing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { makeStripe } from './stripe'

describe('makeStripe', () => {
  it('constructs a Stripe client with a fetch http client (Workers-safe)', () => {
    const s = makeStripe('sk_test_x')
    expect(s).toBeDefined()
    // The fetch-based client avoids Node http; constructEventAsync must exist.
    expect(typeof s.webhooks.constructEventAsync).toBe('function')
  })
})
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/integrations/stripe.test.ts`

- [ ] **Step 3: Implement**

```ts
// Stripe client factory for the Cloudflare Workers runtime.
// The default SDK uses Node's http + synchronous webhook crypto, both of which
// fail on Workers. We force the fetch HTTP client and callers must use the
// async webhook verifier (constructEventAsync).
import Stripe from 'stripe'

export function makeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient(),
  })
}
```
Note: pin `apiVersion` to whatever the installed `stripe` package's types expect — if tsc complains about the literal, use the version string the package exports or omit `apiVersion` to take the SDK default. Verify with `npx tsc --noEmit`.

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** — `git commit -m "feat(billing): Workers-compatible Stripe client factory"`

---

### Task 3: Checkout + Portal routes

**Files:**
- Create: `eggs-api/src/routes/billing.ts`
- Test: `eggs-api/src/routes/billing.test.ts`
- Modify: `eggs-api/src/index.ts` (mount)

Behavior:
- `POST /api/billing/checkout` (requireAuth): load the user row (need email + stripe_customer_id). If no `stripe_customer_id`, create a Stripe customer (email + `metadata.userId`) and persist the id. Create a Checkout Session (`mode: 'subscription'`, line item `STRIPE_PRO_PRICE_ID` ×1, `customer`, `client_reference_id: userId`, `success_url`/`cancel_url` from request body `appUrl` or env). Return `{ url }`.
- `POST /api/billing/portal` (requireAuth): require `stripe_customer_id` (404/400 if none), create a billing portal session (`return_url`), return `{ url }`.

- [ ] **Step 1: Write failing tests** — mock `@clerk/backend` verifyToken, mock `getSupabase`, mock `./integrations/stripe.js` `makeStripe` to return a fake with `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`.

```ts
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
    expect((await res.json()).url).toContain('checkout.stripe.com')
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
    expect((await res.json()).url).toContain('billing.stripe.com')
  })
  it('400 when user has no stripe customer', async () => {
    mockGetSupabase.mockReturnValue(supa(userRow({ stripe_customer_id: null })) as any)
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/portal', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{}' }, ENV)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `billing.ts`** (checkout + portal only; webhook added in Task 4):

```ts
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
  const supabase = getSupabase(c.env)
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
  const supabase = getSupabase(c.env)
  const { data: user } = await supabase.from('users').select('stripe_customer_id').eq('id', userId).single()
  const customerId = (user as { stripe_customer_id?: string } | null)?.stripe_customer_id
  if (!customerId) return c.json({ error: 'no_subscription' }, 400)
  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY)
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${appUrl}/settings` })
  return c.json({ url: session.url })
})

export default billing
```

- [ ] **Step 4: Mount** in `eggs-api/src/index.ts` after the other `app.route(...)` lines: `app.route('/api/billing', billing)` and `import billing from './routes/billing.js'`.

- [ ] **Step 5: Run → PASS** (`npx vitest run src/routes/billing.test.ts`), full suite green, tsc clean. **Step 6: Commit** — `git commit -m "feat(billing): checkout + portal routes"`

---

### Task 4: Webhook (signature-verified, idempotent, the only subscription writer)

**Files:**
- Modify: `eggs-api/src/routes/billing.ts` (add `POST /webhook`)
- Test: `eggs-api/src/routes/billing.webhook.test.ts`

- [ ] **Step 1: Write failing tests** — mock `makeStripe` to return a fake whose `webhooks.constructEventAsync` returns a canned event; assert the Supabase `update` and idempotency KV.

```ts
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
  return { get: vi.fn(async (k: string) => store.get(k) ?? null), put: vi.fn(async (k: string, v: string) => { store.set(k, v) }) }
}
function env(over = {}) {
  return { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', RATE_LIMIT_KV: kv(), ...over } as any
}

describe('POST /webhook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checkout.session.completed → sets tier pro + customer id + period end; idempotent', async () => {
    cannedEvent = {
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user-123', customer: 'cus_1', subscription: 'sub_1' } },
    }
    fakeStripe.subscriptions.retrieve.mockResolvedValue({ status: 'active', current_period_end: 1893456000, items: { data: [{ price: { id: 'price_pro' } }] } })
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    mockGetSupabase.mockReturnValue({ from: () => ({ update: (v: any) => ({ eq: () => updateSpy(v) }) }) } as any)
    const e = env()
    const app = new Hono(); app.route('/', billing)
    const init = { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{"raw":true}' }
    const res1 = await app.request('/webhook', init, e)
    expect(res1.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ subscription_tier: 'pro', stripe_customer_id: 'cus_1', subscription_status: 'active' }))
    // second delivery of the same event id is a no-op
    updateSpy.mockClear()
    const res2 = await app.request('/webhook', init, e)
    expect(res2.status).toBe(200)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('customer.subscription.deleted → downgrades to free', async () => {
    cannedEvent = { id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } }
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    // resolve user by stripe_customer_id
    mockGetSupabase.mockReturnValue({ from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }) }) }),
      update: (v: any) => ({ eq: () => updateSpy(v) }),
    }) } as any)
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }, env())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ subscription_tier: 'free' }))
  })

  it('400 on signature verification failure', async () => {
    fakeStripe.webhooks.constructEventAsync.mockRejectedValueOnce(new Error('bad sig'))
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', headers: { 'stripe-signature': 'bad' }, body: '{}' }, env())
    expect(res.status).toBe(400)
  })

  it('400 when signature header missing', async () => {
    const app = new Hono(); app.route('/', billing)
    const res = await app.request('/webhook', { method: 'POST', body: '{}' }, env())
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add to `billing.ts` (note: no `requireAuth`; read raw text BEFORE any json parse; resolve user by `client_reference_id` for checkout or by `stripe_customer_id` for subscription events):

```ts
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
  const idemKey = `stripe_evt:${event.id}`
  const seen = await c.env.RATE_LIMIT_KV.get(idemKey)
  if (seen) return c.json({ received: true, duplicate: true })

  const supabase = getSupabase(c.env)
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as { client_reference_id?: string; customer?: string; subscription?: string }
        const userId = s.client_reference_id
        if (userId && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription)
          await supabase.from('users').update({
            subscription_tier: 'pro',
            subscription_status: sub.status,
            subscription_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            stripe_customer_id: s.customer ?? null,
          }).eq('id', userId)
        }
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as { customer: string; status: string; current_period_end: number }
        const tier = (sub.status === 'active' || sub.status === 'trialing') ? 'pro' : 'free'
        await updateByCustomer(supabase, sub.customer, {
          subscription_tier: tier,
          subscription_status: sub.status,
          subscription_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        })
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as { customer: string; status: string }
        await updateByCustomer(supabase, sub.customer, { subscription_tier: 'free', subscription_status: sub.status })
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
  customerId: string,
  vals: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase.from('users').select('id').eq('stripe_customer_id', customerId).single()
  const id = (data as { id?: string } | null)?.id
  if (id) await supabase.from('users').update(vals).eq('id', id)
}
```
Note on `current_period_end`: depending on the installed `stripe` types it may live on `sub.current_period_end` or `sub.items.data[0].current_period_end`. Verify against the SDK version and adjust; if tsc complains, cast narrowly. Keep the ISO-string conversion.

- [ ] **Step 4: Run → PASS**, full suite green, tsc clean. **Step 5: Commit** — `git commit -m "feat(billing): signature-verified idempotent Stripe webhook — sole subscription writer"`

---

### Task 5: Frontend — wire upgrade + portal (additive)

**Files:**
- Modify: `eggs-frontend/src/lib/api.ts` (billing methods)
- Modify: `eggs-frontend/src/pages/Settings.tsx` (real upgrade + manage + status)
- Modify: `eggs-frontend/src/pages/Plan.tsx` (paywall "Upgrade to Pro" handler)
- Test: `eggs-frontend/src/lib/api.billing.test.ts` (or extend existing api test)

**UI constraint: additive only.** Replace the two stub handlers (`Settings.tsx:99` alert, `Plan.tsx:270` button) with real redirects; add a Settings billing status block. No layout redesign.

- [ ] **Step 1: api client methods** — add to `eggs-frontend/src/lib/api.ts`:

```ts
export async function startCheckout(): Promise<void> {
  const { url } = await req<{ url: string }>('/api/billing/checkout', {
    method: 'POST', body: JSON.stringify({ appUrl: window.location.origin }),
  })
  if (url) window.location.href = url
}
export async function openBillingPortal(): Promise<void> {
  const { url } = await req<{ url: string }>('/api/billing/portal', {
    method: 'POST', body: JSON.stringify({ appUrl: window.location.origin }),
  })
  if (url) window.location.href = url
}
```
(Match the actual `req`/fetch-wrapper signature in api.ts — it injects the Clerk Bearer token. Mirror existing POST helpers.)

- [ ] **Step 2: Settings billing block** — replace the `alert('Pro subscriptions coming soon!')` handler. For a **free** user: "Upgrade to Pro" button → `startCheckout()`. For a **pro** user: show status (`subscription_status`, renewal date from `subscription_period_end`) and a "Manage subscription" button → `openBillingPortal()`. Read `?billing=success|cancelled` from the URL to show a one-line confirmation/notice (additive banner). Keep the existing tier badge.

- [ ] **Step 3: Plan.tsx paywall** — the existing "Upgrade to Pro" button in the limit-reached card (`Plan.tsx:270`) gets `onClick={startCheckout}` (with a loading state). No other change to the paywall.

- [ ] **Step 4: Tests** — unit-test the api methods (mock fetch, assert POST to the right path with appUrl and that `window.location.href` is set). Component-level: assert Settings renders "Manage subscription" for pro and "Upgrade to Pro" for free (mock the user/profile).

- [ ] **Step 5: Verify + commit** — `npx vitest run` (frontend green), `npx tsc --noEmit`. `git commit -m "feat(ui): wire Stripe checkout + customer portal into Settings and the plan paywall"`

---

### Task 6: TEST-COVERAGE + go-live checklist

**Files:**
- Modify: `TEST-COVERAGE.md`
- Create: `docs/superpowers/research/2026-06-stripe-go-live.md`

- [ ] **Step 1: TEST-COVERAGE.md** — new "WS2 — Stripe billing" section: makeStripe factory; checkout (new customer / reuse / 401); portal (url / 400 no-customer); webhook (checkout.completed→pro+idempotent; subscription.deleted→free; 400 bad/missing signature); frontend api methods + Settings/Plan wiring. Mark unit/component ✅; live E2E 📋.

- [ ] **Step 2: Go-live checklist doc** — the Jonathan-actions to flip billing on (these are NOT code; the code ships test-mode-ready):
  1. Stripe Dashboard (test mode) → create a **Product "E.G.G.S. Pro"** + recurring **Price** → copy the `price_…` id.
  2. Set worker vars/secrets: `STRIPE_PRO_PRICE_ID` (in `[vars]` or `wrangler secret put`), `STRIPE_SECRET_KEY` (`wrangler secret put`, test key first), and after creating the webhook endpoint, `STRIPE_WEBHOOK_SECRET`.
  3. Stripe Dashboard → Webhooks → add endpoint `https://eggs-api.jonathan-aulson.workers.dev/api/billing/webhook`, events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` → copy the signing secret (`whsec_…`) → `wrangler secret put STRIPE_WEBHOOK_SECRET`.
  4. Local test: `stripe listen --forward-to localhost:8787/api/billing/webhook` + `stripe trigger checkout.session.completed`.
  5. Test-card E2E (`4242 4242 4242 4242`) on priceofeggs.online → confirm tier flips via webhook → cancel via portal → reverts at period end.
  6. When validated, swap test keys for live (`sk_live_`, live price id, live webhook secret).

- [ ] **Step 3: Commit + push** — `git commit -m "docs(billing): WS2 coverage + Stripe go-live checklist"` && `git push`

---

## Self-Review

**Spec coverage:** checkout ✅(T3) · portal ✅(T3) · webhook signature+idempotent+sole-writer ✅(T4) · frontend upgrade/manage/paywall ✅(T5) · env/deps ✅(T1) · go-live steps ✅(T6). **Deferred/flagged:** live keys + Stripe dashboard setup are Jonathan-actions (T6 checklist) — code ships test-mode-ready. The `'team'` tier the frontend references stays out of scope (webhook only writes `'free'|'pro'`).

**Type consistency:** `makeStripe(secretKey)` defined T2, used T3/T4. `STRIPE_SECRET_KEY`/`STRIPE_PRO_PRICE_ID` added to Env T1, consumed T3. Webhook reads `RATE_LIMIT_KV` (existing binding) — no new namespace. Frontend `startCheckout`/`openBillingPortal` defined T5, used in Settings + Plan.

**Risk notes:** webhook `current_period_end` field location varies by SDK version — Task 4 calls this out to verify against the installed types. Webhook returns 500 (not 200) on handler error so Stripe retries and idempotency isn't prematurely set.
