# E.G.G.S. — Claude Code Handoff Document

**Product:** The Price of E.G.G.S. (Explore, Gather, Group, Save)
**Author:** Jonathan Aulson
**Date:** April 2026
**Status:** Ready for implementation

---

## 1. Product Summary

E.G.G.S. is an AI-powered grocery planning and price optimization tool for private event
chefs and caterers. A chef inputs their menu and headcount; E.G.G.S. scales recipes to
a consolidated ingredient list, finds real prices via the Kroger API, and produces a
multi-store shopping plan. After shopping, chefs reconcile actual spend against the
estimate to build billing-ready cost reports.

**Design partner and first user:** Margaret (Jon's fiancée), a private event chef in Dallas TX.

---

## 2. Locked Decisions

### 2.1 Architecture

| Layer | Decision |
|-------|----------|
| Frontend | React 18 + TypeScript + Vite (existing codebase, extend in place) |
| Styling | Tailwind CSS (existing) |
| Hosting — Frontend | Cloudflare Pages |
| Hosting — Backend | Cloudflare Workers (Hono framework) |
| Database | Supabase Postgres |
| Auth | Clerk (hosted UI, JWT, social login) |
| Payments | Stripe (via Clerk integration) |
| AI — Primary | Anthropic claude-haiku-4-5 |
| AI — Secondary | OpenAI gpt-4o-mini (BYOK path) |
| Price data | Kroger API (primary, real SKUs + real URLs) |
| Price fallback | Anthropic web search tool — labeled "Estimated" + "Source ↗" link when found |
| Session storage | Supabase (replaces localStorage entirely) |
| Rate limiting | Cloudflare KV (same pattern as Xtract) |

### 2.2 Monorepo Structure

```
/eggs
  /eggs-api          — Hono Worker (independent deployable service)
    src/
      index.ts       — app entry, route registration
      routes/
        events.ts
        dishes.ts
        scale.ts
        clarify.ts
        plan.ts
        products.ts
        reconcile.ts
        users.ts
      providers/
        anthropic.ts
        openai.ts
        index.ts     — getProvider() factory
      integrations/
        kroger.ts
      middleware/
        auth.ts      — Clerk JWT validation
        limits.ts    — free tier enforcement
        ratelimit.ts — KV-backed rate limiting
      types/
        index.ts     — full shared type tree
      db/
        client.ts    — Supabase client
        schema.sql   — full schema (source of truth)
    wrangler.toml
    package.json

  /eggs-frontend     — React app (Cloudflare Pages)
    src/
      components/
      pages/
        Dashboard.tsx
        EventNew.tsx
        EventDetail.tsx
        EventShop.tsx        — existing clarify+plan+results flow, adapted
        EventReconcile.tsx
        Settings.tsx
        SignIn.tsx
        SignUp.tsx
        Onboarding.tsx
      hooks/
      lib/
        api.ts       — all fetch calls to eggs-api
      App.tsx
      main.tsx
    vite.config.ts
    package.json
```

### 2.3 Deployment

```
eggs-api  → workers.dev subdomain or custom domain (e.g. api.eggs.app)
eggs-frontend → Cloudflare Pages (e.g. eggs.app)
```

Both deploy via `wrangler` / `wrangler pages`. Zero server cost at rest.

---

## 3. Auth & Security

### 3.1 Clerk Setup

- Hosted sign-in and sign-up UI (no custom auth screens to build)
- Social login: Google + Apple enabled
- After first sign-up: redirect to `/onboarding` (collect location + default preferences)
- After subsequent logins: redirect to `/dashboard`
- **All routes except `/sign-in` and `/sign-up` are protected**

### 3.2 Route Guard (Frontend)

```tsx
// src/components/ProtectedRoute.tsx
import { useAuth } from '@clerk/clerk-react'
import { Navigate } from 'react-router-dom'

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return <LoadingScreen />
  if (!isSignedIn) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

// src/App.tsx routes
<Routes>
  <Route path="/sign-in/*" element={<SignInPage />} />
  <Route path="/sign-up/*" element={<SignUpPage />} />
  <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
  <Route path="/*" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
</Routes>
```

### 3.3 Worker Auth Middleware

```typescript
// middleware/auth.ts
import { createClerkClient } from '@clerk/backend'
import type { Context, Next } from 'hono'

export const requireAuth = async (c: Context, next: Next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY })
    const session = await clerk.verifyToken(token)
    c.set('userId', session.sub)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}

// Tapestry service-to-service bypass
export const requireAuthOrServiceKey = async (c: Context, next: Next) => {
  const serviceKey = c.req.header('X-Service-Key')
  if (serviceKey && serviceKey === c.env.TAPESTRY_SERVICE_KEY) {
    const onBehalfOf = c.req.header('X-On-Behalf-Of')
    if (!onBehalfOf) return c.json({ error: 'X-On-Behalf-Of required' }, 400)
    c.set('userId', onBehalfOf)
    await next()
    return
  }
  await requireAuth(c, next)
}
```

**Every Supabase query filters by userId — no exceptions:**

```typescript
const userId = c.get('userId')

const { data } = await supabase
  .from('events')
  .select('*')
  .eq('user_id', userId)   // ownership enforced at query level
  .eq('id', eventId)
  .single()

// Treat missing record and wrong-owner record identically
if (!data) return c.json({ error: 'Not found' }, 404)
```

---

## 4. Database Schema

```sql
-- Run in Supabase SQL editor

create table users (
  id text primary key,                    -- Clerk userId e.g. "user_2abc123"
  email text not null,
  display_name text,
  default_location_lat numeric,
  default_location_lng numeric,
  default_location_label text,
  default_settings jsonb default '{}',    -- radius, max_stores, curbside, delivery
  avoid_stores text[] default '{}',
  avoid_brands text[] default '{}',
  ai_provider text,                       -- "anthropic" | "openai" | null
  subscription_tier text not null default 'free',  -- "free" | "pro"
  subscription_status text default 'active',        -- "active" | "past_due" | "canceled"
  subscription_period_end timestamptz,
  stripe_customer_id text,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  name text not null,
  client_name text,
  event_date date,
  headcount integer,
  budget_mode text not null default 'calculate',  -- "ceiling" | "calculate"
  budget_ceiling numeric,
  status text not null default 'planning',
    -- "planning" | "shopping" | "reconcile_needed" | "complete"
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table dishes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  servings integer,           -- null = use event headcount
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table ingredient_pool (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  clarified_name text,
  quantity numeric not null,
  unit text not null,
  category text,
  -- [{dish_id, dish_name, quantity, unit, proportion}]
  sources jsonb not null default '[]',
  created_at timestamptz default now()
);

create table shopping_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,  -- null = quick plan, no event
  user_id text not null references users(id) on delete cascade,
  plan_data jsonb not null,   -- full ShoppingPlan response (see type tree)
  model_used text,
  generated_at timestamptz default now()
);

create table reconcile_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  shopping_plan_id uuid references shopping_plans(id) on delete set null,
  user_id text not null references users(id) on delete cascade,
  mode text not null,                 -- "receipt" | "detailed"
  actual_items jsonb default '[]',    -- detailed mode: [{store_item_id, actual_price, actual_qty, note}]
  receipt_totals jsonb default '[]',  -- receipt mode: [{store_name, receipt_total}]
  summary jsonb,                      -- computed: {estimated_total, actual_total, variance, variance_pct, per_dish_actual[]}
  completed_at timestamptz default now()
);

-- Indexes
create index on events(user_id);
create index on events(user_id, created_at desc);
create index on dishes(event_id);
create index on dishes(user_id);
create index on ingredient_pool(event_id);
create index on ingredient_pool(user_id);
create index on shopping_plans(user_id);
create index on shopping_plans(user_id, generated_at desc);
create index on shopping_plans(event_id);
create index on reconcile_records(event_id);
create index on reconcile_records(user_id);

-- Updated_at trigger for events
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger events_updated_at
  before update on events
  for each row execute function update_updated_at();
```

---

## 5. Free Tier Enforcement

**Rule:** Free users are limited to **3 events per month AND 3 shopping plans per month,
whichever limit is hit first.**

The limit is configurable via Cloudflare Worker environment variable — no deploy required
to change it.

```toml
# wrangler.toml
[vars]
FREE_MONTHLY_LIMIT = "3"
```

```typescript
// middleware/limits.ts
export const enforceFreeLimit = async (c: Context, next: Next) => {
  const userId = c.get('userId')
  const user = await getUser(userId)

  if (user.subscription_tier === 'pro') {
    await next()
    return
  }

  const limit = parseInt(c.env.FREE_MONTHLY_LIMIT)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [{ count: plansCount }, { count: eventsCount }] = await Promise.all([
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

  const plans = plansCount ?? 0
  const events = eventsCount ?? 0

  if (plans >= limit || events >= limit) {
    return c.json({
      error: 'free_limit_reached',
      limit,
      plans_used: plans,
      events_used: events,
      message: `Free tier allows ${limit} events and ${limit} shopping plans per month. Upgrade to Pro for unlimited access.`
    }, 403)
  }

  await next()
}
```

Apply `enforceFreeLimit` to:
- `POST /api/events` (create event)
- `POST /api/price-plan` (generate shopping plan)

---

## 6. Provider Abstraction (AI)

```typescript
// providers/index.ts
interface CompletionParams {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  jsonMode?: boolean
}

interface CompletionResult {
  content: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

interface ModelProvider {
  complete(params: CompletionParams): Promise<CompletionResult>
}

// providers/anthropic.ts
class AnthropicProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: params.maxTokens ?? 4096,
        system: params.system,
        messages: params.messages
      })
    })
    const data = await response.json() as any
    return {
      content: data.content[0].text,
      model: data.model,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
    }
  }
}

// providers/openai.ts
class OpenAIProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: params.maxTokens ?? 4096,
        response_format: params.jsonMode ? { type: 'json_object' } : undefined,
        messages: [
          { role: 'system', content: params.system },
          ...params.messages
        ]
      })
    })
    const data = await response.json() as any
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
    }
  }
}

// providers/index.ts — factory
export function getProvider(c: Context): ModelProvider {
  // BYOK: user passes key in header (Pro tier only)
  const byokKey = c.req.header('X-AI-Key')
  const byokProvider = c.req.header('X-AI-Provider')

  if (byokKey && byokProvider === 'openai') return new OpenAIProvider(byokKey)
  if (byokKey && byokProvider === 'anthropic') return new AnthropicProvider(byokKey)

  // Platform default: Anthropic Haiku
  return new AnthropicProvider(c.env.ANTHROPIC_API_KEY)
}
```

**BYOK is a Pro-only feature.** Add a middleware check before using the header:

```typescript
if (byokKey && user.subscription_tier === 'free') {
  return c.json({ error: 'BYOK requires Pro subscription' }, 403)
}
```

---

## 7. API Routes

### 7.1 Full Route Map

```
POST   /api/users/sync              — upsert user from Clerk JWT on first login
GET    /api/users/me                — get current user profile + settings

POST   /api/events                  — create event [free limit applies]
GET    /api/events                  — list user's events (paginated)
GET    /api/events/:id              — get single event with dishes + ingredient pool
PATCH  /api/events/:id              — update event details or status
DELETE /api/events/:id              — soft delete

POST   /api/events/:id/dishes       — add dish to event
DELETE /api/events/:id/dishes/:dishId — remove dish

POST   /api/scale-recipes           — scale dishes to ingredient pool (AI)
POST   /api/clarify                 — clarify ambiguous ingredients (AI)
POST   /api/price-plan              — generate shopping plan (AI + Kroger) [free limit applies]
GET    /api/products/search         — search Kroger product catalog

POST   /api/events/:id/reconcile    — save reconcile record
GET    /api/events/:id/reconcile    — get reconcile record for event

GET    /health                      — no auth, returns 200
```

### 7.2 Key Request/Response Types

```typescript
// POST /api/scale-recipes
interface ScaleRecipesRequest {
  dishes: { id: string; name: string; servings: number }[]
}
interface ScaleRecipesResponse {
  ingredients: IngredientLine[]
}

// POST /api/clarify
interface ClarifyRequest {
  ingredients: IngredientLine[]
}
interface ClarifyResponse {
  clarifications: ClarificationRequest[] | null  // null = nothing ambiguous
}

// POST /api/price-plan — callable by both frontend and Tapestry
interface PricePlanRequest {
  ingredients: IngredientLine[]
  resolvedClarifications?: Record<string, string>
  location: { lat: number; lng: number }
  settings: {
    radiusMiles: number
    maxStores: number
    includeDelivery: boolean
    curbsideMaxMiles?: number
    avoidStores?: string[]
    avoidBrands?: string[]
  }
  budget?: {
    mode: 'ceiling' | 'calculate'
    amount?: number            // only when mode = "ceiling"
  }
  eventId?: string             // links plan to event in history
  eventName?: string           // echoed back in plan meta
  headcount?: number
  // BYOK passed via headers X-AI-Provider + X-AI-Key, not body
}

// ShoppingPlan — the contract shared between frontend and Tapestry
interface ShoppingPlan {
  id: string
  generatedAt: string
  meta: {
    eventId?: string
    eventName?: string
    headcount?: number
    location: { lat: number; lng: number; label?: string }
    storesQueried: { name: string; source: PriceSource }[]
    modelUsed: string
    budgetMode: 'ceiling' | 'calculate'
    budgetCeiling?: number
    budgetExceeded?: boolean   // true when ceiling mode and plan exceeds it
  }
  ingredients: IngredientLine[]
  stores: StorePlan[]
  summary: {
    subtotal: number
    estimatedTax: number
    total: number
    estimatedSavings?: number
    realPriceCount: number     // items from Kroger API
    estimatedPriceCount: number // items from AI fallback
  }
}

interface StorePlan {
  storeName: string
  storeBanner: string
  storeAddress?: string
  distanceMiles?: number
  storeType: 'physical' | 'delivery' | 'curbside'
  priceSource: PriceSource
  items: StoreItem[]
  subtotal: number
  estimatedTax: number
  grandTotal: number
}

interface StoreItem {
  ingredientId: string         // links back to ingredients[]
  name: string
  sku?: string                 // real SKU when from Kroger API
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
  confidence: 'real' | 'estimated_with_source' | 'estimated'
  productUrl?: string          // only when confidence = "real"
  proofUrl?: string            // when "real": product page. when "estimated_with_source": where AI looked
  isLoyaltyPrice: boolean
  nonMemberPrice?: number
}

type PriceSource = 'kroger_api' | 'ai_estimated'

interface IngredientLine {
  id: string
  name: string
  clarifiedName?: string
  quantity: number
  unit: string
  category: string
  sources: {                   // which dishes contributed to this line
    dishId: string
    dishName: string
    quantity: number
    unit: string
    proportion: number         // 0-1, share of total quantity from this dish
  }[]
}

interface ClarificationRequest {
  itemId: string
  originalName: string
  question: string
  options: string[]
}

// POST /api/events/:id/reconcile
interface ReconcileRequest {
  shoppingPlanId: string
  mode: 'receipt' | 'detailed'
  receiptTotals?: { storeName: string; receiptTotal: number }[]
  actualItems?: {
    storeItemId: string
    actualPrice: number
    actualQuantity: number
    note?: string
  }[]
}

interface ReconcileSummary {
  estimatedTotal: number
  actualTotal: number
  variance: number
  variancePct: number
  perDishActual: { dish: string; actualCost: number; estimatedCost: number }[]
}
```

---

## 8. Kroger API Integration

```typescript
// integrations/kroger.ts

const KROGER_BASE = 'https://api.kroger.com/v1'

class KrogerClient {
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }
    const creds = btoa(`${this.clientId}:${this.clientSecret}`)
    const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=product.compact'
    })
    const data = await res.json() as any
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken!
  }

  async searchProducts(query: string, locationId: string): Promise<KrogerProduct[]> {
    const token = await this.getToken()
    const params = new URLSearchParams({
      'filter.term': query,
      'filter.locationId': locationId,
      'filter.limit': '5'
    })
    const res = await fetch(`${KROGER_BASE}/products?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json() as any
    return data.data ?? []
  }

  async findNearbyLocations(lat: number, lng: number, radiusMiles: number): Promise<KrogerLocation[]> {
    const token = await this.getToken()
    const params = new URLSearchParams({
      'filter.lat.near': String(lat),
      'filter.lon.near': String(lng),
      'filter.radiusInMiles': String(radiusMiles),
      'filter.limit': '5'
    })
    const res = await fetch(`${KROGER_BASE}/locations?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json() as any
    return data.data ?? []
  }
}

interface KrogerProduct {
  productId: string
  description: string
  brand: string
  items: {
    itemId: string
    price?: { regular: number; promo?: number }
    size: string
    soldBy: string
  }[]
  images: { perspective: string; sizes: { size: string; url: string }[] }[]
}

interface KrogerLocation {
  locationId: string
  name: string
  address: { addressLine1: string; city: string; state: string; zipCode: string }
  geolocation: { latitude: number; longitude: number }
  hours: any
}
```

**Store coverage for Dallas TX (Margaret's market):**

| Store | Source | Real links? | Notes |
|-------|--------|-------------|-------|
| Kroger | Kroger API | Yes | |
| Tom Thumb | Kroger API | Yes | Tom Thumb is a Kroger banner in TX |
| Aldi | AI web search | Source link only | No public API |
| HEB | AI web search | Source link only | No public API, blocks scraping |
| Fiesta Mart | AI web search | Source link only | No public API |
| Whole Foods | AI web search | Source link only | Amazon-owned, no standalone API |
| Central Market | AI web search | Source link only | HEB subsidiary |

**Source badge rule:**

Three confidence tiers, not two:

```typescript
type Confidence = 'real' | 'estimated_with_source' | 'estimated'
```

- `real` — from Kroger API. Green badge. Full `productUrl` + `proofUrl`. "Shop Link" button renders.
- `estimated_with_source` — AI found a source URL. Yellow badge. No Shop Link. "Source ↗" button renders (links to where the AI looked). Chef uses it to verify manually.
- `estimated` — AI found a price but no verifiable source URL. Yellow badge. No buttons. "AI Estimated" pill only.

**AI fallback prompt rules (enforce strictly):**

```
For each item priced via web search, you MUST include:
- proofUrl: the exact URL of the real page where you found this price.
  This must be a page you actually retrieved and read — not a search results
  page, not a homepage, not a fabricated URL.
- If you retrieved a real page but cannot confirm the exact price from it,
  set confidence to "estimated" and omit proofUrl.
- If you found no real source at all, set confidence to "estimated" and
  omit proofUrl entirely.
- NEVER fabricate a URL. An honest "estimated" with no link is always
  better than a made-up proof link.
```

The Anthropic web search tool returns cited source URLs reliably. Use it for the AI
fallback path — do not use Gemini grounding, which produced fabricated URLs in the
prototype.

---

## 9. Wrangler Config

```toml
# eggs-api/wrangler.toml
name = "eggs-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
FREE_MONTHLY_LIMIT = "3"

# Secrets — set via: wrangler secret put SECRET_NAME
# ANTHROPIC_API_KEY
# CLERK_SECRET_KEY
# SUPABASE_URL
# SUPABASE_SERVICE_KEY
# KROGER_CLIENT_ID
# KROGER_CLIENT_SECRET
# TAPESTRY_SERVICE_KEY
# STRIPE_WEBHOOK_SECRET
```

---

## 10. UI Screens & Design

### 10.1 Design Continuity Rules

The existing UI (dark navy, yellow/gold accents, terminal-style loading screen) must be
preserved exactly. All new screens match:

- Background: `#0d1117` (main) / `#161b22` (cards)
- Accent: `#f59e0b` (yellow/gold) — primary actions and highlights only
- Text: white primary, `#8b949e` secondary
- Cards: `rounded-xl`, subtle border `#30363d`
- Form inputs: dark fill, subtle border, gold focus ring
- Status pills: gold = needs action, green = complete, gray = draft/empty
- Font: existing font stack (preserve whatever is in the current codebase)
- Mobile-first — all new screens stack vertically

### 10.2 Route Map

```
/                   → redirect: /dashboard (authed) | /sign-in (unauthed)
/sign-in            → Clerk hosted UI
/sign-up            → Clerk hosted UI
/onboarding         → post-signup: collect location + preferences [protected]
/dashboard          → home, event list, usage meter [protected]
/events/new         → create event + menu builder [protected]
/events/:id         → event detail + status [protected]
/events/:id/shop    → clarify → loading → results (existing flow, adapted) [protected]
/events/:id/reconcile → post-shop reconcile [protected]
/plan               → quick plan, no event (existing flow) [protected]
/settings           → user profile + preferences [protected]
```

### 10.3 Dashboard (`/dashboard`)

Three zones:

**Zone 1 — Usage meter (free users only)**
```
2 of 3 events used this month  [████████░░]
2 of 3 plans used this month   [████████░░]
[Upgrade to Pro — unlimited everything]
```
Hidden for Pro users.

**Zone 2 — Upcoming events**
Event cards showing: name, date, headcount, dish count, status pill, estimated total,
primary action button. Status values: "Draft", "Needs Plan", "Plan Ready", "Shopping",
"Reconcile Needed", "Complete".

**Zone 3 — Past events**
Compact list: name, date, actual vs estimated total (once reconciled). "See all" link.

Primary CTA: `[+ New Event]` top right. Secondary: `[Quick Plan]` for users who want
to skip event creation.

### 10.4 Event Creation (`/events/new`)

Single scrollable page, not a multi-step wizard:

**Section 1 — Event Details**
- Name (text, required)
- Client name (text, optional)
- Date (date picker, optional)
- Headcount (number, required)
- Budget toggle: "Calculate my cost" (default) vs "I have a ceiling" with amount input

**Section 2 — Menu**
- Add dish: plain text input (just type the dish name, AI handles scaling)
- Each dish card shows: name, servings override (default = event headcount), remove button
- "+ Add another dish" link below last dish

**Section 3 — Shopping Preferences**
- Location (default from user profile, editable)
- Search radius slider (1-50 mi)
- Max stores slider (1-5)
- Include delivery toggle
- Curbside max distance (only shown when delivery is off)
- Avoid stores / avoid brands (from user profile, editable per event)

**Primary CTA:** `[Generate Shopping Plan →]` — triggers the full pipeline

### 10.5 Event Detail (`/events/:id`)

Header: event name, date, headcount, budget info, options menu (edit, delete)
Status banner: current status pill + summary line ("3 dishes · 24 ingredients · $847 est.")

Actions block:
- "Plan Ready" state: `[View Shopping Plan]` + `[Regenerate Plan]`
- "Needs Plan" state: `[Generate Shopping Plan]`
- "Shopping" state: `[Mark Shopping Complete]`
- "Reconcile Needed" state: `[Begin Reconcile]`
- "Complete" state: `[View Report]` + `[Export PDF]` (Pro)

Menu summary: per-dish estimated cost breakdown
Ingredient pool: consolidated list with dish source annotations, collapsible

### 10.6 Clarification, Loading, Results Screens

**These screens are kept exactly as-is from the existing prototype with two changes:**

1. Loading screen status messages become event-aware:
   "Building plan for [Event Name]..." instead of generic copy

2. Results screen adds a source badge per line item:
   - `Kroger API` badge (green) + "Shop Link" button when `confidence === "real"`
   - `AI Estimated` badge (yellow) + "Source ↗" button when `confidence === "estimated_with_source"`
   - `AI Estimated` badge (yellow) no buttons when `confidence === "estimated"`
   - Proof button only renders when `proofUrl` exists

### 10.7 Reconcile Screen (`/events/:id/reconcile`)

Mode toggle at top: `[Receipt Totals]` (default, faster) vs `[Line by Line]` (detailed, Pro)

**Receipt Totals mode:**
One card per store from the shopping plan. Each card shows:
- Store name
- Estimated total
- "Actual: [ $ _______ ]" input

**Line by Line mode (Pro only):**
Grouped by store. Each item row shows estimated price with an actual price input field.

**Live summary panel** (updates as user types):
- Estimated total
- Actual total
- Variance (amount + percentage, colored red/green)
- Per-dish breakdown (Pro): actual cost per dish using `sources[]` proportions

CTAs: `[Save & Complete Event]` + `[Export Report PDF]` (Pro)

### 10.8 Onboarding Screen (`/onboarding`)

Shown once after first sign-up. Collects:
- Display name
- City / default address (used as default location for all plans)
- Default search radius
- Default max stores
- Any stores to avoid

On submit: write to `users` table, redirect to `/dashboard`.

---

## 11. Monetization

```
FREE TIER (forever)
  3 events per month
  3 shopping plans per month
  (whichever limit is hit first blocks both)
  Full AI pipeline on all
  Real Kroger prices
  Receipt-mode reconcile only
  Platform AI key (Anthropic Haiku)
  No BYOK

PRO TIER ($19/month or $179/year)
  Unlimited events
  Unlimited shopping plans
  Line-by-line reconcile
  Per-dish cost breakdown in reconcile
  Event history + variance trends
  Budget ceiling mode
  BYOK (Anthropic or OpenAI key)
  CSV/PDF export of plans and reports
  Priority support
```

Stripe handles subscription lifecycle. Clerk's Stripe integration handles the webhook
and keeps `subscription_tier` in sync on the `users` table.

---

## 12. Tapestry Integration

Tapestry calls the EGGS API as a service client on behalf of a specific user.

**Headers required:**
```
X-Service-Key: <TAPESTRY_SERVICE_KEY>   — proves caller is Tapestry
X-On-Behalf-Of: user_2abc123            — which user's data to operate on
```

Tapestry has access to the full `/api/price-plan` endpoint and receives the same
`ShoppingPlan` response the frontend receives. Tapestry is responsible for ensuring
the `userId` it passes belongs to a user who has authorized it.

All other resource endpoints (events, dishes, reconcile) are also available to Tapestry
via the same service key pattern.

---

## 13. Items Discarded from Prototype

These exist in the current codebase and must be removed or disabled:

| Item | Action |
|------|--------|
| `gemini-3-pro-preview` model call | Replace with Anthropic Haiku via provider abstraction |
| Gemini as primary price source | Demote to labeled fallback only |
| `automationAction` field on `StoreItemPrice` | Remove from type and prompts |
| Client-side API key (`VITE_GEMINI_API_KEY`) | Move all AI calls to Worker |
| Mocked auth (any email/password) | Replace with Clerk |
| localStorage persistence | Replace with Supabase via Worker |
| "Smart Grocery Savings" headline | Replace with chef-focused copy |
| Hardcoded NYC coordinates as default | Replace with user profile location |
| Flat item-list as primary input | Replace with event/menu builder as home |

---

## 14. Environment Variables

### eggs-api Worker secrets (set via `wrangler secret put`)
```
ANTHROPIC_API_KEY
CLERK_SECRET_KEY
SUPABASE_URL
SUPABASE_SERVICE_KEY
KROGER_CLIENT_ID
KROGER_CLIENT_SECRET
TAPESTRY_SERVICE_KEY
STRIPE_WEBHOOK_SECRET
```

### eggs-api wrangler.toml vars (not secret)
```
FREE_MONTHLY_LIMIT = "3"
```

### eggs-frontend .env
```
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_API_BASE_URL=https://eggs-api.workers.dev
```

---

## 15. Implementation Order

Work through these in order. Each phase is independently deployable.

**Phase 1 — Infrastructure (nothing else works without this)**
1. Create Hono Worker scaffold with health endpoint
2. Set up Supabase project, run schema.sql
3. Configure Clerk application (Google + Apple social login)
4. Wire Clerk JWT validation middleware into Worker
5. `POST /api/users/sync` — upsert user on first login
6. Deploy Worker to workers.dev, verify auth flow end-to-end

**Phase 2 — Kroger Integration**
1. Register Kroger API developer account, obtain client credentials
2. Implement `KrogerClient` with token caching
3. `GET /api/products/search` endpoint
4. Test product search for common ingredients in Dallas TX

**Phase 3 — AI Pipeline**
1. Implement provider abstraction (Anthropic + OpenAI)
2. `POST /api/scale-recipes` — dish list to ingredient pool with shared pool merge
3. `POST /api/clarify` — ambiguous ingredient detection
4. `POST /api/price-plan` — full plan generation using Kroger API + AI fallback
5. Apply free tier limits middleware to plan generation

**Phase 4 — Event & Dish CRUD**
1. `POST /api/events`, `GET /api/events`, `GET /api/events/:id`, `PATCH /api/events/:id`
2. `POST /api/events/:id/dishes`, `DELETE /api/events/:id/dishes/:dishId`
3. Apply free tier limits middleware to event creation
4. Wire ingredient pool storage after scale-recipes call

**Phase 5 — Reconcile**
1. `POST /api/events/:id/reconcile` with summary computation
2. `GET /api/events/:id/reconcile`
3. Event status transitions (planning → shopping → reconcile_needed → complete)

**Phase 6 — Stripe**
1. Configure Stripe products (monthly + annual Pro)
2. Implement Stripe webhook handler in Worker
3. Sync subscription status to `users` table on webhook events
4. Gate BYOK and Pro features behind subscription check

**Phase 7 — Frontend**
1. Install and configure Clerk React SDK
2. Implement `ProtectedRoute` and route map
3. Build `Onboarding` screen (location + preferences collection)
4. Build `Dashboard` with event list + usage meter
5. Build `EventNew` (event creation + menu builder)
6. Build `EventDetail`
7. Adapt existing clarify + loading + results screens to new backend
8. Add source badges to results screen (Kroger API vs AI Estimated)
9. Build `EventReconcile`
10. Build `Settings`
11. Wire Stripe upgrade flow (redirect to Stripe hosted checkout)

---

## 16. Open Questions (Resolve Before Phase 3)

1. **Margaret's stores:** Which stores does she actually use for events? If none are Kroger
   banner stores, Kroger API first may not solve her immediate problem. Validate before
   committing to Kroger as the anchor integration.

2. **Walmart API:** Availability for free public use is unconfirmed. Research during Phase 1
   while Kroger is being set up. Do not block on it.

3. **Actual-vs-estimated tracking mode default:** Confirm with Margaret whether she prefers
   receipt totals (faster, per store) or line-by-line (slower, more accurate for billing).
   This affects which reconcile mode to default to in the UI.

4. **PDF export library:** For the Pro reconcile report export, identify a Cloudflare Workers
   compatible PDF generation approach before Phase 6. `@react-pdf/renderer` runs client-side
   and may be the cleanest option.
