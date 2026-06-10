# WS1: Store-Bound Verifiable Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every price shown for a non-API store is either verified against a product page fetched *bound to the chef's actual discovered store*, or honestly labeled — no confident prices with search-landing links, ever.

**Architecture:** New discovery pipeline (Serper Shopping → Tavily URL resolution → store-bound fetch with Firecrawl fallback → exact-price + name + store-binding verification) wrapped around the existing Anthropic two-pass, which becomes the fallback. Binding correctness is enforced by an on-page assertion, never by trusting a recipe. Provenance flows through StoreItem to additive UI labels.

**Tech Stack:** Cloudflare Workers (Hono), TypeScript, Vitest, Serper.dev REST, Tavily REST, Firecrawl v2 REST, existing Anthropic provider.

**Spec:** `docs/superpowers/specs/2026-06-09-public-readiness-design.md`

**Constraints:**
- UI changes are **additive only** — extend `ConfidenceBadge`/`ItemRow`, never restructure. No component removal/redesign without a mockup approved by Jonathan.
- Wire `confidence` enum values stay `'real' | 'estimated_with_source' | 'estimated'` (stored plans must not break). New honesty semantics ride on the new `provenance` field.
- All new integrations degrade gracefully when their env key is absent (existing pipeline keeps working).
- Repo conventions: `.js` suffix on relative imports, class clients with injected `fetchImpl: typeof fetch = (i, n) => fetch(i, n)`, tests colocated as `*.test.ts`, run via `npx vitest run <path>` from `eggs-api/`.

---

### Task 1: Types + env plumbing

**Files:**
- Modify: `eggs-api/src/types/index.ts` (Env ~line 23-62, PlanDiagnostics ~line 66-105, StoreItem ~line 257-299)
- Modify: `eggs-api/wrangler.toml` (secrets comment block)

- [ ] **Step 1: Add env keys to `Env`** — in `types/index.ts` after `INSTACART_IDP_API_KEY?: string`:

```ts
  /** Serper.dev API key — Google Shopping/Places verticals. Absent → discovery pipeline skipped. */
  SERPER_API_KEY?: string
  /** Tavily API key — product-URL resolution. Absent → resolution leg skipped. */
  TAVILY_API_KEY?: string
  /** Firecrawl API key — bot-walled fetch fallback. Absent → direct fetch only. */
  FIRECRAWL_API_KEY?: string
```

- [ ] **Step 2: Add `StoreIdentity` + `Provenance` types** — in `types/index.ts` directly above `export interface StoreItem`:

```ts
// ─── Store-scoped price discovery (WS1) ──────────────────────────────────────

/** A concrete store from distance-bound discovery — never just a banner. */
export interface StoreIdentity {
  banner: string
  /** normalizeBanner(banner) — cache keys, binding/domain registry lookups */
  bannerNormalized: string
  storeName: string
  storeAddress?: string
  distanceMiles?: number
  /** Retailer-internal store id, when a locator adapter resolved it. */
  retailerStoreId?: string
}

/**
 * Price provenance — the honesty contract (spec WS1).
 * 'api'                  — Kroger/Walmart API result.
 * 'store_page_verified'  — exact price verified on a product page fetched BOUND
 *                          to the chef's discovered store (binding assertion passed).
 * 'page_verified_unbound'— exact price verified on a product page, but the fetch
 *                          could not be store-bound. Display as "online price".
 * 'shopping_index'       — price from Serper Shopping index only; page verification
 *                          unavailable/failed. Display as "online price".
 * 'model_estimate'       — LLM guess, no source. Display de-emphasized.
 */
export type Provenance =
  | 'api'
  | 'store_page_verified'
  | 'page_verified_unbound'
  | 'shopping_index'
  | 'model_estimate'
```

- [ ] **Step 3: Extend `StoreItem`** — add after `alignmentGrade?: AlignmentGrade`:

```ts
  /** WS1 honesty contract. Absent on legacy plans — UI falls back to `confidence`. */
  provenance?: Provenance
  /** Epoch ms when the price was last verified/fetched (also set from cache writes). */
  verifiedAt?: number
  /** retailerStoreId the binding assertion confirmed, when provenance==='store_page_verified'. */
  verifiedStoreId?: string
```

- [ ] **Step 4: Extend `PlanDiagnostics`** — add a `discovery` section after `ai`:

```ts
  discovery: {
    serperQueries: number
    tavilyQueries: number
    firecrawlScrapes: number
    /** items that reached provenance 'store_page_verified' */
    storeBound: number
    /** items that reached 'page_verified_unbound' */
    unbound: number
    /** items that reached 'shopping_index' */
    indexOnly: number
    /** items where discovery found nothing and the LLM result stood */
    fallbackLlm: number
  }
```

- [ ] **Step 5: Fix all diagnostics initializers** — `grep -n "sizeResolver: {" eggs-api/src/routes/plan.ts` to find the `PlanDiagnostics` literal(s); add to each:

```ts
    discovery: { serperQueries: 0, tavilyQueries: 0, firecrawlScrapes: 0, storeBound: 0, unbound: 0, indexOnly: 0, fallbackLlm: 0 },
```

- [ ] **Step 6: wrangler.toml secrets comment** — extend the existing comment list:

```toml
# Prod secrets — set via: wrangler secret put <NAME>
# ... existing ...
# SERPER_API_KEY, TAVILY_API_KEY, FIRECRAWL_API_KEY
```

- [ ] **Step 7: Typecheck + existing tests still green**

Run from `eggs-api/`: `npx tsc --noEmit && npx vitest run`
Expected: PASS (type additions are optional fields; nothing breaks)

- [ ] **Step 8: Commit**

```bash
git add eggs-api/src/types/index.ts eggs-api/wrangler.toml eggs-api/src/routes/plan.ts
git commit -m "feat(types): StoreIdentity + Provenance + discovery diagnostics + new env keys (WS1)"
```

---

### Task 2: Serper Shopping client

**Files:**
- Create: `eggs-api/src/integrations/serper.ts`
- Test: `eggs-api/src/integrations/serper.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { SerperClient } from './serper'

const SHOPPING_RESPONSE = {
  shopping: [
    { title: 'H-E-B Organics Fresh Boneless Skinless Chicken Breast lb', price: '$6.74', source: 'H-E-B', link: 'https://www.google.com/search?ibp=oshop&q=x' },
    { title: 'Tyson Chicken Breast', price: '$5.99', source: 'Target', link: 'https://www.google.com/...' },
    { title: 'No-price item', source: 'H-E-B' },
  ],
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as typeof fetch
}

describe('SerperClient.shopping', () => {
  it('returns candidates with parsed numeric prices', async () => {
    const fetchImpl = mockFetch(SHOPPING_RESPONSE)
    const client = new SerperClient('key', fetchImpl)
    const out = await client.shopping('organic chicken breast H-E-B', 'Dallas, Texas, United States')
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ title: expect.stringContaining('Chicken Breast'), price: 6.74, merchant: 'H-E-B' })
    expect(out[2].price).toBeNull()
  })

  it('sends query, location and API key header', async () => {
    const fetchImpl = mockFetch(SHOPPING_RESPONSE)
    const client = new SerperClient('key-123', fetchImpl)
    await client.shopping('eggs', 'Dallas, Texas, United States')
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://google.serper.dev/shopping')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('key-123')
    expect(JSON.parse(init.body as string)).toMatchObject({ q: 'eggs', location: 'Dallas, Texas, United States' })
  })

  it('returns [] on non-2xx and on thrown fetch', async () => {
    expect(await new SerperClient('k', mockFetch({}, false, 429)).shopping('x')).toEqual([])
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new SerperClient('k', boom).shopping('x')).toEqual([])
  })

  it('filterByMerchant matches banner loosely (case/punctuation-insensitive)', async () => {
    const client = new SerperClient('k', mockFetch(SHOPPING_RESPONSE))
    const all = await client.shopping('x')
    const heb = SerperClient.filterByMerchant(all, 'H-E-B')
    expect(heb).toHaveLength(2)
    expect(SerperClient.filterByMerchant(all, 'heb')).toHaveLength(2)
    expect(SerperClient.filterByMerchant(all, 'Target')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/integrations/serper.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
// Serper.dev Google Shopping client (WS1 discovery leg).
// Index prices are candidates ONLY — never store-trusted (spec: honesty rules).
import { normalizeBanner } from './store-urls.js'

export interface ShoppingCandidate {
  title: string
  /** Parsed numeric price, null when Serper returned none. */
  price: number | null
  merchant: string
  /** Google Shopping redirect — NOT a merchant product page. Kept for diagnostics only. */
  link?: string
}

export class SerperClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  async shopping(query: string, locationLabel?: string): Promise<ShoppingCandidate[]> {
    try {
      const res = await this.fetchImpl('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, ...(locationLabel ? { location: locationLabel } : {}), num: 10 }),
      })
      if (!res.ok) {
        console.warn('[serper] shopping non-ok', res.status)
        return []
      }
      const data = (await res.json()) as { shopping?: Array<{ title?: string; price?: string; source?: string; link?: string }> }
      return (data.shopping ?? []).map(r => ({
        title: r.title ?? '',
        price: parsePrice(r.price),
        merchant: r.source ?? '',
        link: r.link,
      }))
    } catch (err) {
      console.warn('[serper] shopping threw', err instanceof Error ? err.message : err)
      return []
    }
  }

  /** Loose banner match: normalized-banner token containment either way. */
  static filterByMerchant(candidates: ShoppingCandidate[], banner: string): ShoppingCandidate[] {
    const want = normalizeBanner(banner).replace(/[^a-z0-9]/g, '')
    return candidates.filter(c => {
      const got = normalizeBanner(c.merchant).replace(/[^a-z0-9]/g, '')
      return got.length > 0 && (got.includes(want) || want.includes(got))
    })
  }
}

function parsePrice(text?: string): number | null {
  if (!text) return null
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  return m ? Number(m[1]) : null
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/integrations/serper.test.ts` → PASS

- [ ] **Step 5: Commit** — `git add eggs-api/src/integrations/serper.* && git commit -m "feat(discovery): Serper Shopping client — index prices as candidates only"`

---

### Task 3: Tavily client (product-URL resolution)

**Files:**
- Create: `eggs-api/src/integrations/tavily.ts`
- Test: `eggs-api/src/integrations/tavily.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { TavilyClient } from './tavily'

const SEARCH_RESPONSE = {
  results: [
    { url: 'https://www.heb.com/product-detail/x/1748922', title: 'H-E-B Organics Chunk Chicken', content: '10 oz. $4.98 each', score: 0.76 },
    { url: 'https://www.heb.com/category/chicken/490110', title: 'Chicken - Shop H-E-B', content: 'category page', score: 0.7 },
  ],
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json }) as unknown as typeof fetch
}

describe('TavilyClient.search', () => {
  it('returns url/title/content results', async () => {
    const client = new TavilyClient('tvly-x', mockFetch(SEARCH_RESPONSE))
    const out = await client.search('H-E-B Organics chicken', { includeDomains: ['heb.com'], maxResults: 5 })
    expect(out).toHaveLength(2)
    expect(out[0].url).toContain('product-detail')
  })

  it('sends bearer auth, include_domains and max_results', async () => {
    const f = mockFetch(SEARCH_RESPONSE)
    await new TavilyClient('tvly-x', f).search('q', { includeDomains: ['heb.com'], maxResults: 5 })
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-x')
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', include_domains: ['heb.com'], max_results: 5 })
  })

  it('returns [] on error / non-2xx', async () => {
    expect(await new TavilyClient('k', mockFetch({}, false, 429)).search('x', {})).toEqual([])
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new TavilyClient('k', boom).search('x', {})).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/integrations/tavily.test.ts` → FAIL

- [ ] **Step 3: Implement**

```ts
// Tavily search client (WS1 resolution leg) — finds merchant product-page URLs
// for a Serper shopping candidate, scoped to the banner's domain.
export interface TavilyResult {
  url: string
  title: string
  content: string
}

export interface TavilySearchOptions {
  includeDomains?: string[]
  maxResults?: number
}

export class TavilyClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  async search(query: string, opts: TavilySearchOptions = {}): Promise<TavilyResult[]> {
    try {
      const res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: opts.maxResults ?? 5,
          ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
        }),
      })
      if (!res.ok) {
        console.warn('[tavily] search non-ok', res.status)
        return []
      }
      const data = (await res.json()) as { results?: Array<{ url?: string; title?: string; content?: string }> }
      return (data.results ?? [])
        .filter(r => typeof r.url === 'string')
        .map(r => ({ url: r.url as string, title: r.title ?? '', content: r.content ?? '' }))
    } catch (err) {
      console.warn('[tavily] search threw', err instanceof Error ? err.message : err)
      return []
    }
  }
}
```

- [ ] **Step 4: Run tests** — PASS. **Step 5: Commit** — `git commit -m "feat(discovery): Tavily client — domain-scoped product-URL resolution"`

---

### Task 4: Firecrawl client (store-bindable fetch fallback)

**Files:**
- Create: `eggs-api/src/integrations/firecrawl.ts`
- Test: `eggs-api/src/integrations/firecrawl.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { FirecrawlClient } from './firecrawl'

const SCRAPE_RESPONSE = {
  success: true,
  data: {
    markdown: '# H-E-B Organics Chicken\n\n$4.98 each($0.50 / oz)\n\nYou\'re shopping Victoria H‑E‑B plus!',
    metadata: { statusCode: 200, sourceURL: 'https://www.heb.com/product-detail/x/1', proxyUsed: 'basic' },
  },
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json }) as unknown as typeof fetch
}

describe('FirecrawlClient.scrape', () => {
  it('returns markdown + statusCode on success', async () => {
    const client = new FirecrawlClient('fc-x', mockFetch(SCRAPE_RESPONSE))
    const out = await client.scrape('https://www.heb.com/product-detail/x/1')
    expect(out?.markdown).toContain('$4.98')
    expect(out?.statusCode).toBe(200)
  })

  it('passes headers, actions, and timeout through', async () => {
    const f = mockFetch(SCRAPE_RESPONSE)
    await new FirecrawlClient('fc-x', f).scrape('https://x.com/p', {
      headers: { Cookie: 'store=42' },
      actions: [{ type: 'wait', milliseconds: 500 }],
      timeoutMs: 9000,
    })
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
    const body = JSON.parse(init.body as string)
    expect(body.headers).toEqual({ Cookie: 'store=42' })
    expect(body.actions).toEqual([{ type: 'wait', milliseconds: 500 }])
    expect(body.timeout).toBe(9000)
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer fc-x')
  })

  it('returns null on API error, non-2xx page, and thrown fetch', async () => {
    expect(await new FirecrawlClient('k', mockFetch({ success: false }, true)).scrape('https://x.com')).toBeNull()
    const errPage = { success: true, data: { markdown: 'Page Not Found', metadata: { statusCode: 404, sourceURL: 'https://x.com' } } }
    expect(await new FirecrawlClient('k', mockFetch(errPage)).scrape('https://x.com')).toBeNull()
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new FirecrawlClient('k', boom).scrape('https://x.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL. **Step 3: Implement**

```ts
// Firecrawl v2 scrape client (WS1 verification-fetch fallback).
// Used when direct Worker fetch hits a bot wall, or a binding recipe needs
// cookies/actions. Smoke-tested 2026-06-09: H-E-B product page on basic proxy.
export type FirecrawlAction =
  | { type: 'wait'; milliseconds: number }
  | { type: 'click'; selector: string }
  | { type: 'write'; text: string }
  | { type: 'press'; key: string }
  | { type: 'executeJavascript'; script: string }

export interface ScrapeOptions {
  headers?: Record<string, string>
  actions?: FirecrawlAction[]
  timeoutMs?: number
}

export interface ScrapeResult {
  markdown: string
  statusCode: number
  sourceUrl: string
}

export class FirecrawlClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  /** Returns null on any failure — caller treats null as "couldn't fetch". */
  async scrape(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult | null> {
    try {
      const res = await this.fetchImpl('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          proxy: 'auto',
          timeout: opts.timeoutMs ?? 9000,
          ...(opts.headers ? { headers: opts.headers } : {}),
          ...(opts.actions?.length ? { actions: opts.actions } : {}),
        }),
      })
      if (!res.ok) {
        console.warn('[firecrawl] scrape non-ok', res.status)
        return null
      }
      const data = (await res.json()) as {
        success?: boolean
        data?: { markdown?: string; metadata?: { statusCode?: number; sourceURL?: string } }
      }
      if (!data.success || !data.data?.markdown) return null
      const statusCode = data.data.metadata?.statusCode ?? 0
      if (statusCode < 200 || statusCode >= 300) return null
      return {
        markdown: data.data.markdown,
        statusCode,
        sourceUrl: data.data.metadata?.sourceURL ?? url,
      }
    } catch (err) {
      console.warn('[firecrawl] scrape threw', err instanceof Error ? err.message : err)
      return null
    }
  }
}
```

- [ ] **Step 4: Run tests** — PASS. **Step 5: Commit** — `git commit -m "feat(discovery): Firecrawl scrape client with cookie/actions binding support"`

---

### Task 5: Store-binding registry + assertion

**Files:**
- Create: `eggs-api/src/integrations/store-binding.ts`
- Test: `eggs-api/src/integrations/store-binding.test.ts`

The registry ships with every banner at `{ kind: 'none' }` except H-E-B's indicator (validated in the 2026-06-09 smoke test: H-E-B renders "You're shopping {store}"). The **assertion is the guarantee**; recipes only raise yield. Task 7 (spike) fills in recipes per banner.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { getBindingRecipe, assertStoreBinding, bannerDomain } from './store-binding'
import type { StoreIdentity } from '../types/index.js'

const HEB_STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023', distanceMiles: 4.2, retailerStoreId: '790',
}

describe('bannerDomain', () => {
  it('maps known banners to their domains', () => {
    expect(bannerDomain('H-E-B')).toBe('heb.com')
    expect(bannerDomain('Tom Thumb')).toBe('tomthumb.com')
    expect(bannerDomain('Sprouts Farmers Market')).toBe('shop.sprouts.com')
  })
  it('returns null for unknown banners', () => {
    expect(bannerDomain('Bob Grocery')).toBeNull()
  })
})

describe('assertStoreBinding', () => {
  it('passes when the page store indicator mentions the expected store city/name token', () => {
    const page = "You're shopping Plano H‑E‑B!  Curbside available"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('fails when the indicator names a different store', () => {
    const page = "You're shopping Victoria H‑E‑B plus!"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('fails when no store indicator is present at all', () => {
    expect(assertStoreBinding('Just a product page. $4.98', HEB_STORE)).toBe(false)
  })
  it('matches on retailerStoreId appearing in page payload', () => {
    const page = 'data-store-id="790" Add to cart'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
})

describe('getBindingRecipe', () => {
  it('returns a recipe object for every known banner (none is acceptable)', () => {
    const r = getBindingRecipe('h-e-b')
    expect(r).toBeDefined()
    expect(['url', 'cookie', 'actions', 'none']).toContain(r.kind)
  })
  it('returns kind none for unknown banners', () => {
    expect(getBindingRecipe('bob grocery').kind).toBe('none')
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL. **Step 3: Implement**

```ts
// Store-binding registry (WS1). A "binding recipe" scopes a product-page fetch
// to a concrete store. Recipes are NEVER trusted: assertStoreBinding() must
// confirm the rendered page is actually bound to the expected store before an
// item may carry provenance 'store_page_verified'.
//
// Recipes start at 'none' for most banners — the Sprint-0 spike
// (scripts/spike-store-binding.ts → docs/superpowers/research/) promotes
// banners as their recipes are validated. A 'none' recipe just means lower
// yield (items cap at 'page_verified_unbound'); it can never cause a wrong
// "verified" label.
import type { StoreIdentity } from '../types/index.js'
import type { FirecrawlAction } from './firecrawl.js'

export type BindingRecipe =
  | { kind: 'url'; buildUrl: (productUrl: string, storeId: string) => string }
  | { kind: 'cookie'; buildCookie: (storeId: string) => string }
  | { kind: 'actions'; buildActions: (store: StoreIdentity) => FirecrawlAction[] }
  | { kind: 'none' }

/** Banner domain registry — Tavily include_domains scoping. Keys are normalizeBanner() output. */
const DOMAINS: Record<string, string> = {
  'h-e-b': 'heb.com',
  'heb': 'heb.com',
  'central market': 'centralmarket.com',
  'target': 'target.com',
  'costco': 'costco.com',
  'tom thumb': 'tomthumb.com',
  'albertsons': 'albertsons.com',
  'safeway': 'safeway.com',
  'vons': 'vons.com',
  'sprouts': 'shop.sprouts.com',
  'sprouts farmers market': 'shop.sprouts.com',
  'whole foods': 'wholefoodsmarket.com',
  'whole foods market': 'wholefoodsmarket.com',
  'aldi': 'aldi.us',
  "trader joe's": 'traderjoes.com',
  'trader joes': 'traderjoes.com',
  'publix': 'publix.com',
  'fiesta mart': 'fiestamart.com',
  'meijer': 'meijer.com',
  'wegmans': 'shop.wegmans.com',
}

export function bannerDomain(banner: string): string | null {
  const key = banner.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim()
  return DOMAINS[key] ?? null
}

/**
 * Per-banner binding recipes. Spike-validated entries only — everything else
 * stays 'none'. DO NOT add a recipe without an assertStoreBinding-passing
 * probe run recorded in docs/superpowers/research/.
 */
const RECIPES: Record<string, BindingRecipe> = {
  // H-E-B renders "You're shopping {store}" (validated 2026-06-09 smoke test).
  // Recipe TBD by spike (Task 7) — until then fetches are unbound but the
  // indicator lets assertStoreBinding reject wrong-store pages.
}

export function getBindingRecipe(bannerNormalized: string): BindingRecipe {
  return RECIPES[bannerNormalized] ?? { kind: 'none' }
}

const STOP_TOKENS = new Set(['the', 'and', 'h-e-b', 'heb', 'store', 'market', 'plus'])

/**
 * Confirm the fetched page is bound to the expected store.
 * Two independent signals, either passes:
 *  1. A store-indicator phrase ("you're shopping …", "my store…", "your store…")
 *     whose captured store label shares a distinctive token (city or store-name
 *     word) with the expected StoreIdentity.
 *  2. The retailerStoreId appears as a store id attribute in the page payload.
 * A page with an indicator naming a DIFFERENT store always fails.
 */
export function assertStoreBinding(pageText: string, store: StoreIdentity): boolean {
  const text = pageText.toLowerCase()

  if (store.retailerStoreId) {
    const id = store.retailerStoreId
    if (new RegExp(`store[-_]?id["'=:\\s]+["']?${id}\\b`).test(text)) return true
  }

  const indicator = text.match(/(?:you'?re shopping|my store:?|your store:?)\s+([^!\n.]{2,60})/)
  if (!indicator) return false

  const label = indicator[1]
  const expectTokens = `${store.storeName} ${store.storeAddress ?? ''}`
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(t => t.length > 2 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t) && !/^tx|al|ca|fl|ny$/.test(t))
  return expectTokens.some(t => label.includes(t))
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/integrations/store-binding.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(discovery): store-binding registry + on-page binding assertion"`

---

### Task 6: content-verifier refactor — verify pre-fetched text + binding

**Files:**
- Modify: `eggs-api/src/lib/content-verifier.ts`
- Test: `eggs-api/src/lib/content-verifier.test.ts` (extend — do not delete existing tests)

- [ ] **Step 1: Write the failing tests** (append to existing describe blocks)

```ts
import { verifyContentText } from './content-verifier'
import type { StoreIdentity } from '../types/index.js'

const STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023',
}

describe('verifyContentText', () => {
  const page = "You're shopping Plano H-E-B! Organic Chunk Chicken Breast 10 oz $4.98 each"

  it('verifies name+price on pre-fetched text without network', () => {
    const r = verifyContentText(page, 'Organic Chunk Chicken Breast', 4.98)
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(false) // no expectedStore passed
  })

  it('sets storeBound true when binding assertion passes', () => {
    const r = verifyContentText(page, 'Organic Chunk Chicken Breast', 4.98, { expectedStore: STORE })
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(true)
  })

  it('verified can be true while storeBound is false (wrong store)', () => {
    const wrong = "You're shopping Victoria H-E-B plus! Organic Chunk Chicken Breast 10 oz $4.98 each"
    const r = verifyContentText(wrong, 'Organic Chunk Chicken Breast', 4.98, { expectedStore: STORE })
    expect(r.verified).toBe(true)
    expect(r.storeBound).toBe(false)
  })

  it('strips markdown link noise before matching', () => {
    const md = "[Skip](https://x.com)\n# Organic Chunk Chicken Breast\n\n$4.98 each($0.50 / oz)"
    expect(verifyContentText(md, 'Organic Chunk Chicken Breast', 4.98).verified).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL (`verifyContentText` not exported)

- [ ] **Step 3: Implement** — refactor `content-verifier.ts`: extract the pure check from `verifyProductContent`, add binding. Keep `verifyProductContent` behavior identical (existing tests must stay green).

```ts
import type { StoreIdentity } from '../types/index.js'
import { assertStoreBinding } from '../integrations/store-binding.js'

export interface VerifyResult {
  verified: boolean
  /** true only when expectedStore was provided AND the binding assertion passed */
  storeBound: boolean
  reason?: string
}

export interface VerifyTextOptions {
  minNameCoverage?: number
  expectedStore?: StoreIdentity
}

// ... STOP_WORDS, priceAppears, nameCoverage unchanged ...

/** Normalize HTML or markdown into plain lowercase text for matching. */
function extractText(content: string): string {
  const noScripts = content.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return noScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // markdown links → label
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Pure verification against pre-fetched page content (HTML or markdown). */
export function verifyContentText(
  content: string,
  productName: string,
  price: number,
  opts: VerifyTextOptions = {},
): VerifyResult {
  const minCoverage = opts.minNameCoverage ?? 0.6
  const text = extractText(content)

  const coverage = nameCoverage(text, productName)
  if (coverage < minCoverage) return { verified: false, storeBound: false, reason: `name_coverage_${coverage.toFixed(2)}` }
  if (!priceAppears(text, price)) return { verified: false, storeBound: false, reason: 'price_not_found' }

  const storeBound = opts.expectedStore ? assertStoreBinding(content, opts.expectedStore) : false
  return { verified: true, storeBound }
}

/** Network wrapper — unchanged external behavior; existing callers/tests intact. */
export async function verifyProductContent(
  url: string,
  productName: string,
  price: number,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 6000
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; EggsBot/1.0)' },
    })
    if (!res.ok) return { verified: false, storeBound: false, reason: `http_${res.status}` }
    const html = await res.text()
    return verifyContentText(html, productName, price, { minNameCoverage: opts.minNameCoverage })
  } catch (err: any) {
    if (err?.name === 'AbortError') return { verified: false, storeBound: false, reason: 'timeout' }
    return { verified: false, storeBound: false, reason: `fetch_error_${err?.message ?? 'unknown'}` }
  } finally {
    clearTimeout(t)
  }
}
```

Note: `VerifyResult` gains a required `storeBound` field — `grep -rn "verifyProductContent\|VerifyResult" eggs-api/src` and confirm callers only read `.verified`/`.reason` (plan.ts:846-849 does). Fix any others.

- [ ] **Step 4: Run full lib tests** — `npx vitest run src/lib/` → PASS (old + new)
- [ ] **Step 5: Commit** — `git commit -m "feat(verify): pure text verifier + store-binding check in content-verifier"`

---

### Task 7: Sprint-0 spike — binding recipes per priority banner

**Files:**
- Create: `eggs-api/scripts/spike-store-binding.ts`
- Create: `docs/superpowers/research/2026-06-store-binding-findings.md` (output)
- Modify: `eggs-api/src/integrations/store-binding.ts` (RECIPES + locator findings)

This is research, not TDD. The probe harness IS the deliverable; recipe data follows evidence.

- [ ] **Step 1: Write the probe script**

```ts
/**
 * Store-binding spike (WS1 Sprint 0).
 * For each priority banner: fetch a real product page via Firecrawl, dump the
 * store indicator the page renders, then probe binding levers (cookie header /
 * zip-set actions) and re-check the indicator.
 *
 * Run from eggs-api/:  npx tsx scripts/spike-store-binding.ts
 * Reads FIRECRAWL_API_KEY from .dev.vars. Writes findings JSON to stdout —
 * paste conclusions into docs/superpowers/research/2026-06-store-binding-findings.md
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const devVars = readFileSync(resolve(import.meta.dirname, '../.dev.vars'), 'utf8')
const FIRECRAWL_KEY = devVars.match(/^FIRECRAWL_API_KEY=(.+)$/m)?.[1]?.trim()
if (!FIRECRAWL_KEY) throw new Error('FIRECRAWL_API_KEY missing from .dev.vars')

interface Probe {
  banner: string
  productUrl: string
  /** regexes that capture the page's store indicator */
  indicators: RegExp[]
  /** binding levers to try after the baseline fetch */
  levers: Array<{ name: string; headers?: Record<string, string>; actions?: unknown[] }>
}

// Product URLs: pick any in-stock staple from the banner's site by hand before running.
const PROBES: Probe[] = [
  {
    banner: 'h-e-b',
    productUrl: 'https://www.heb.com/product-detail/h-e-b-organics-premium-chunk-chicken-breast-in-water/1748922',
    indicators: [/you'?re shopping ([^!\n]{2,60})/i],
    levers: [
      { name: 'cookie:CURR_SESSION_STORE', headers: { Cookie: 'CURR_SESSION_STORE=92' } },
      {
        name: 'actions:zip-entry',
        actions: [
          { type: 'click', selector: '[data-qe-id="storeLocation"], [aria-label*="store" i]' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'write', text: '75023' },
          { type: 'press', key: 'Enter' },
          { type: 'wait', milliseconds: 2500 },
        ],
      },
    ],
  },
  {
    banner: 'tom thumb',
    productUrl: 'https://www.tomthumb.com/shop/product-details.970555.html',
    indicators: [/(?:my store|your store)[:\s]+([^\n]{2,60})/i, /store(?:Id|_id)["'=:\s]+["']?(\d{3,5})/i],
    levers: [{ name: 'cookie:abs-store', headers: { Cookie: 'SWY_SHOP_STORE=177' } }],
  },
  {
    banner: 'target',
    productUrl: 'https://www.target.com/p/good-38-gather-boneless-skinless-chicken-breasts/-/A-13473044',
    indicators: [/(?:pick ?up at|ready within .* at)\s+([^\n]{2,40})/i, /"store_id":"(\d+)"/],
    levers: [{ name: 'cookie:visitorZip', headers: { Cookie: 'GuestLocation=75023|33.03,-96.7|TX|US' } }],
  },
  {
    banner: 'sprouts',
    productUrl: 'https://shop.sprouts.com/product/53842',
    indicators: [/(?:shopping at|your store)[:\s]+([^\n]{2,60})/i],
    levers: [],
  },
  {
    banner: 'aldi',
    productUrl: 'https://new.aldi.us/product/simply-nature-organic-chicken-breasts-0000000000004498',
    indicators: [/(?:selected store|your store)[:\s]+([^\n]{2,60})/i],
    levers: [],
  },
]

async function scrape(url: string, extra: Record<string, unknown> = {}) {
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: false, timeout: 30000, ...extra }),
  })
  const data = (await res.json()) as any
  return { md: data?.data?.markdown ?? '', status: data?.data?.metadata?.statusCode ?? 0 }
}

function findIndicators(md: string, probe: Probe): string[] {
  return probe.indicators.map(rx => md.match(rx)?.[0] ?? '(no match)')
}

for (const probe of PROBES) {
  console.log(`\n━━━ ${probe.banner} ━━━`)
  const base = await scrape(probe.productUrl)
  console.log(`baseline status=${base.status} indicators=`, findIndicators(base.md, probe))
  for (const lever of probe.levers) {
    const out = await scrape(probe.productUrl, {
      ...(lever.headers ? { headers: lever.headers } : {}),
      ...(lever.actions ? { actions: lever.actions } : {}),
    })
    console.log(`lever=${lever.name} status=${out.status} indicators=`, findIndicators(out.md, probe))
  }
}
```

- [ ] **Step 2: Sanity-check probe product URLs by hand** — for each PROBES entry, open the banner's site, find a real in-stock staple product, replace the URL. (The Tom Thumb/Target/Sprouts/Aldi URLs above are educated guesses — verify each before burning credits.)

- [ ] **Step 3: Run the probe** — `npx tsx scripts/spike-store-binding.ts` (budget: ≤40 Firecrawl credits). For each banner record: does a store indicator render? which lever changed it? what cookie/action is needed? does the page expose a store id?

- [ ] **Step 4: Write findings** to `docs/superpowers/research/2026-06-store-binding-findings.md` — one section per banner: baseline indicator, working lever (exact cookie/actions), store-locator endpoint found (check the site's network calls for a JSON locator, e.g. heb.com store-locator API), verdict: `recipe ready` / `needs /interact` / `unbindable for now`.

- [ ] **Step 5: Promote validated recipes** into `RECIPES` in `store-binding.ts` — for each banner with a working lever, add the exact recipe, e.g. (shape only — use the spike's validated cookie name/value format):

```ts
  'h-e-b': {
    kind: 'cookie',
    buildCookie: (storeId: string) => `CURR_SESSION_STORE=${storeId}`,
  },
```

Add one unit test per promoted recipe to `store-binding.test.ts` asserting `getBindingRecipe('<banner>')` returns the expected kind and the built cookie/actions include the store id:

```ts
  it('h-e-b recipe builds a store cookie', () => {
    const r = getBindingRecipe('h-e-b')
    expect(r.kind).toBe('cookie')
    if (r.kind === 'cookie') expect(r.buildCookie('790')).toContain('790')
  })
```

- [ ] **Step 6: Run tests + commit**

```bash
npx vitest run src/integrations/store-binding.test.ts
git add eggs-api/scripts/spike-store-binding.ts eggs-api/src/integrations/store-binding.* docs/superpowers/research/
git commit -m "feat(discovery): spike-validated store-binding recipes + probe harness"
```

---

### Task 8: Price-discovery orchestrator

**Files:**
- Create: `eggs-api/src/lib/price-discovery.ts`
- Test: `eggs-api/src/lib/price-discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { discoverPrice } from './price-discovery'
import type { StoreIdentity } from '../types/index.js'

const STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023', retailerStoreId: '790',
}

const CANDIDATE = { title: 'H-E-B Organics Chunk Chicken Breast 10 oz', price: 4.98, merchant: 'H-E-B' }
const PRODUCT_URL = 'https://www.heb.com/product-detail/x/1748922'
const BOUND_PAGE = "You're shopping Plano H-E-B! H-E-B Organics Chunk Chicken Breast 10 oz $4.98 each"
const UNBOUND_PAGE = "You're shopping Victoria H-E-B plus! H-E-B Organics Chunk Chicken Breast 10 oz $4.98 each"

function deps(overrides: Record<string, unknown> = {}) {
  return {
    serper: { shopping: vi.fn().mockResolvedValue([CANDIDATE]) },
    tavily: { search: vi.fn().mockResolvedValue([{ url: PRODUCT_URL, title: CANDIDATE.title, content: '' }]) },
    firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: BOUND_PAGE, statusCode: 200, sourceUrl: PRODUCT_URL }) },
    directFetch: vi.fn().mockResolvedValue(null), // default: direct fetch bot-walled
    counters: { serperQueries: 0, tavilyQueries: 0, firecrawlScrapes: 0, storeBound: 0, unbound: 0, indexOnly: 0, fallbackLlm: 0 },
    ...overrides,
  } as any
}

describe('discoverPrice', () => {
  it('returns store_page_verified when binding assertion passes', async () => {
    const d = deps()
    const out = await discoverPrice('chicken breast', STORE, 'Dallas, Texas, United States', d)
    expect(out).toMatchObject({
      unitPrice: 4.98,
      productUrl: PRODUCT_URL,
      provenance: 'store_page_verified',
      verifiedStoreId: '790',
    })
    expect(d.counters.storeBound).toBe(1)
  })

  it('caps at page_verified_unbound when page shows a different store', async () => {
    const d = deps({ firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: UNBOUND_PAGE, statusCode: 200, sourceUrl: PRODUCT_URL }) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('page_verified_unbound')
    expect(out?.verifiedStoreId).toBeUndefined()
  })

  it('prefers direct fetch when it returns verifiable content (no firecrawl spend)', async () => {
    const d = deps({ directFetch: vi.fn().mockResolvedValue(BOUND_PAGE) })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('store_page_verified')
    expect(d.firecrawl.scrape).not.toHaveBeenCalled()
  })

  it('returns shopping_index when URL resolution fails', async () => {
    const d = deps({ tavily: { search: vi.fn().mockResolvedValue([]) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out).toMatchObject({ unitPrice: 4.98, provenance: 'shopping_index', productUrl: null })
    expect(d.counters.indexOnly).toBe(1)
  })

  it('returns shopping_index when fetched page fails price verification', async () => {
    const wrongPrice = "You're shopping Plano H-E-B! Chunk Chicken Breast $7.49"
    const d = deps({ firecrawl: { scrape: vi.fn().mockResolvedValue({ markdown: wrongPrice, statusCode: 200, sourceUrl: PRODUCT_URL }) } })
    const out = await discoverPrice('chicken breast', STORE, 'Dallas', d)
    expect(out?.provenance).toBe('shopping_index')
  })

  it('returns null when serper has no candidates for the banner', async () => {
    const d = deps({ serper: { shopping: vi.fn().mockResolvedValue([{ ...CANDIDATE, merchant: 'Kroger' }]) } })
    expect(await discoverPrice('chicken breast', STORE, 'Dallas', d)).toBeNull()
  })

  it('returns null when serper is undefined (no key configured)', async () => {
    const d = deps({ serper: undefined })
    expect(await discoverPrice('chicken breast', STORE, 'Dallas', d)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL. **Step 3: Implement**

```ts
// WS1 price-discovery orchestrator: Serper (discover) → Tavily (resolve) →
// store-bound fetch (verify). Every return value carries provenance per the
// spec honesty contract. All deps injected for testability; any absent dep
// gracefully truncates the pipeline at that leg.
import { SerperClient, type ShoppingCandidate } from '../integrations/serper.js'
import type { TavilyClient } from '../integrations/tavily.js'
import type { FirecrawlClient, FirecrawlAction } from '../integrations/firecrawl.js'
import { bannerDomain, getBindingRecipe } from '../integrations/store-binding.js'
import { verifyContentText } from './content-verifier.js'
import type { StoreIdentity, Provenance, PlanDiagnostics } from '../types/index.js'

export interface DiscoveredPrice {
  unitPrice: number
  productTitle: string
  productUrl: string | null
  provenance: Extract<Provenance, 'store_page_verified' | 'page_verified_unbound' | 'shopping_index'>
  verifiedAt: number
  verifiedStoreId?: string
}

export interface DiscoveryDeps {
  serper?: Pick<SerperClient, 'shopping'>
  tavily?: Pick<TavilyClient, 'search'>
  firecrawl?: Pick<FirecrawlClient, 'scrape'>
  /** Direct Worker fetch of a product page → page text, or null on bot-wall/error. */
  directFetch: (url: string, headers?: Record<string, string>) => Promise<string | null>
  counters: PlanDiagnostics['discovery']
}

export async function discoverPrice(
  ingredientName: string,
  store: StoreIdentity,
  locationLabel: string | undefined,
  deps: DiscoveryDeps,
): Promise<DiscoveredPrice | null> {
  if (!deps.serper) return null

  // 1. DISCOVER — index prices are candidates only, never store-trusted.
  deps.counters.serperQueries++
  const all = await deps.serper.shopping(`${ingredientName} ${store.banner}`, locationLabel)
  const candidates = SerperClient.filterByMerchant(all, store.banner).filter(c => c.price !== null)
  const candidate = candidates[0]
  if (!candidate) return null

  // 2. RESOLVE — merchant product-page URL via domain-scoped Tavily search.
  const domain = bannerDomain(store.banner)
  let productUrl: string | null = null
  if (deps.tavily && domain) {
    deps.counters.tavilyQueries++
    const results = await deps.tavily.search(candidate.title, { includeDomains: [domain], maxResults: 5 })
    productUrl = results.find(r => looksLikeProductPage(r.url))?.url ?? results[0]?.url ?? null
  }
  if (!productUrl) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }

  // 3. VERIFY — store-bound fetch, then exact-price + name + binding checks.
  const recipe = getBindingRecipe(store.bannerNormalized)
  const cookie =
    recipe.kind === 'cookie' && store.retailerStoreId ? recipe.buildCookie(store.retailerStoreId) : undefined
  const fetchUrl =
    recipe.kind === 'url' && store.retailerStoreId ? recipe.buildUrl(productUrl, store.retailerStoreId) : productUrl
  const actions: FirecrawlAction[] | undefined =
    recipe.kind === 'actions' ? recipe.buildActions(store) : undefined

  let pageText = actions ? null : await deps.directFetch(fetchUrl, cookie ? { Cookie: cookie } : undefined)
  if (!pageText && deps.firecrawl) {
    deps.counters.firecrawlScrapes++
    const scraped = await deps.firecrawl.scrape(fetchUrl, {
      ...(cookie ? { headers: { Cookie: cookie } } : {}),
      ...(actions ? { actions } : {}),
      timeoutMs: 9000,
    })
    pageText = scraped?.markdown ?? null
  }
  if (!pageText) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }

  const check = verifyContentText(pageText, candidate.title, candidate.price as number, { expectedStore: store })
  if (!check.verified) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }
  if (check.storeBound) {
    deps.counters.storeBound++
    return {
      unitPrice: candidate.price as number,
      productTitle: candidate.title,
      productUrl,
      provenance: 'store_page_verified',
      verifiedAt: Date.now(),
      verifiedStoreId: store.retailerStoreId,
    }
  }
  deps.counters.unbound++
  return {
    unitPrice: candidate.price as number,
    productTitle: candidate.title,
    productUrl,
    provenance: 'page_verified_unbound',
    verifiedAt: Date.now(),
  }
}

function indexOnly(candidate: ShoppingCandidate): DiscoveredPrice {
  return {
    unitPrice: candidate.price as number,
    productTitle: candidate.title,
    productUrl: null,
    provenance: 'shopping_index',
    verifiedAt: Date.now(),
  }
}

/** Heuristic: product-detail URLs over category/search pages. */
function looksLikeProductPage(url: string): boolean {
  return /product|\/p\/|\/ip\/|item|pd\//i.test(url) && !/search|category|\/s\?|\/c\//i.test(url)
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/price-discovery.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(discovery): price-discovery orchestrator with provenance contract"`

---

### Task 9: Wire discovery into plan.ts + honesty downgrades + cache v2

**Files:**
- Modify: `eggs-api/src/routes/plan.ts` (AI-store reconcile block, ~lines 817-940; cacheKey fn; CachedStoreItem type)
- Test: `eggs-api/src/routes/plan.ai.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (pure helper level — follow the existing `validateAndNormalizeAiItems` test style). Add a new exported helper `applyDiscoveryResult(item, discovered, store)` and `downgradeUnverified(item, banner, ingredientName)` so the logic is unit-testable without the route:

```ts
import { applyDiscoveryResult, downgradeUnverified } from './plan'
import type { StoreItem, StoreIdentity } from '../types/index.js'

const baseItem = (): StoreItem => ({
  ingredientId: 'i1', name: 'chicken breast', quantity: 2, unit: 'lb',
  unitPrice: 5.99, lineTotal: 11.98, confidence: 'real',
  shopUrl: 'https://x', isLoyaltyPrice: false, pricedSize: { quantity: 1, unit: 'lb' },
})
const store: StoreIdentity = { banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano', retailerStoreId: '790' }

describe('applyDiscoveryResult', () => {
  it('store_page_verified → confidence real, proofUrl set, provenance + verifiedStoreId carried', () => {
    const item = applyDiscoveryResult(baseItem(), {
      unitPrice: 4.98, productTitle: 'HEB Chicken', productUrl: 'https://heb.com/p/1',
      provenance: 'store_page_verified', verifiedAt: 123, verifiedStoreId: '790',
    }, store)
    expect(item).toMatchObject({
      unitPrice: 4.98, confidence: 'real', provenance: 'store_page_verified',
      proofUrl: 'https://heb.com/p/1', shopUrl: 'https://heb.com/p/1', verifiedStoreId: '790', verifiedAt: 123,
    })
  })

  it('page_verified_unbound → confidence estimated_with_source, product link kept', () => {
    const item = applyDiscoveryResult(baseItem(), {
      unitPrice: 4.98, productTitle: 'HEB Chicken', productUrl: 'https://heb.com/p/1',
      provenance: 'page_verified_unbound', verifiedAt: 123,
    }, store)
    expect(item.confidence).toBe('estimated_with_source')
    expect(item.shopUrl).toBe('https://heb.com/p/1')
    expect(item.provenance).toBe('page_verified_unbound')
  })

  it('shopping_index → confidence estimated_with_source, NO proofUrl', () => {
    const item = applyDiscoveryResult(baseItem(), {
      unitPrice: 4.98, productTitle: 'HEB Chicken', productUrl: null,
      provenance: 'shopping_index', verifiedAt: 123,
    }, store)
    expect(item.confidence).toBe('estimated_with_source')
    expect(item.proofUrl).toBeUndefined()
  })
})

describe('downgradeUnverified', () => {
  it('unverified LLM item → estimated + model_estimate + search-landing shopUrl', () => {
    const item = downgradeUnverified(baseItem(), 'H-E-B', 'chicken breast')
    expect(item.confidence).toBe('estimated')
    expect(item.provenance).toBe('model_estimate')
    expect(item.proofUrl).toBeUndefined()
    expect(item.shopUrl).toContain('heb.com/search')
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL. **Step 3: Implement helpers** in `plan.ts` (exported, near `validateAndNormalizeAiItems`):

```ts
// ── WS1 honesty contract: map discovery results / failures onto StoreItem ────
export function applyDiscoveryResult(item: StoreItem, d: DiscoveredPrice, store: StoreIdentity): StoreItem {
  const verified = d.provenance === 'store_page_verified'
  return {
    ...item,
    unitPrice: d.unitPrice,
    confidence: verified ? 'real' : 'estimated_with_source',
    provenance: d.provenance,
    verifiedAt: d.verifiedAt,
    verifiedStoreId: verified ? d.verifiedStoreId : undefined,
    proofUrl: d.productUrl ?? undefined,
    productUrl: d.productUrl ?? undefined,
    shopUrl: d.productUrl ?? item.shopUrl,
  }
}

/** Spec: "search-landing URLs never accompany a confidently-styled price."
 *  Replaces the old plan.ts:892 downgrade (was estimated_with_source). */
export function downgradeUnverified(item: StoreItem, banner: string, ingredientName: string): StoreItem {
  return {
    ...item,
    confidence: 'estimated',
    provenance: 'model_estimate',
    proofUrl: undefined,
    productUrl: undefined,
    verifiedStoreId: undefined,
    shopUrl: getShopUrl(banner, ingredientName),
  }
}
```

- [ ] **Step 4: Wire into the reconcile loop** (plan.ts ~817-940). Replacing the current per-item URL reconcile (`882-893`):

```ts
  // WS1: per-(store, ingredient) discovery upgrade pass. Bounded: skip when
  // SERPER_API_KEY absent; per-item ceiling 10s; Firecrawl/Serper spend capped.
  const discoveryDeps = buildDiscoveryDeps(c.env, diagnostics.discovery)  // returns null when no SERPER_API_KEY
  const maxDiscoveryItems = isPro ? 60 : 24

  for (const aiStore of aiStorePlans) {
    const bannerKey = aiStore.storeBannerNormalized ?? normalizeBanner(aiStore.storeBanner)
    const storeIdentity: StoreIdentity = {
      banner: aiStore.storeBanner,
      bannerNormalized: bannerKey,
      storeName: aiStore.storeName,
      storeAddress: aiStore.storeAddress,
      distanceMiles: aiStore.distanceMiles,
      // retailerStoreId: resolved by locator adapters as recipes land (spike findings)
    }

    for (const item of aiStore.items) {
      const ingredient = ingredients.find(i => i.id === item.ingredientId)
      const ingredientName = ingredient?.name ?? item.name

      const cacheHit = cacheHits.get(`${bannerKey}::${item.ingredientId}`)
      if (cacheHit) {
        Object.assign(item, cacheHit.item, { ingredientId: item.ingredientId, pricedSize: cacheHit.item.pricedSize ?? null })
        // cache v2 entries carry provenance/verifiedAt — legacy entries surface as estimates
        if (!item.provenance) Object.assign(item, downgradeUnverified(item, aiStore.storeBanner, ingredientName))
        continue
      }

      let discovered: DiscoveredPrice | null = null
      if (discoveryDeps && !item.notAvailable && discoveryAttempts < maxDiscoveryItems) {
        discoveryAttempts++
        discovered = await withTimeout(
          discoverPrice(ingredientName, storeIdentity, locationLabel, discoveryDeps),
          10_000, null,
        )
      }

      if (discovered) {
        Object.assign(item, applyDiscoveryResult(item, discovered, storeIdentity))
      } else {
        // Fall back to the LLM's own claim — but only keep it confident if its
        // proofUrl passed the existing HEAD + content checks.
        const urlOk = item.proofUrl && verifiedUrls.has(item.proofUrl)
        const contentOk = item.proofUrl ? verifiedContentByUrl.get(item.proofUrl) === true : false
        if (urlOk && contentOk) {
          item.productUrl = item.proofUrl
          item.shopUrl = item.proofUrl as string
          item.provenance = 'page_verified_unbound'  // LLM fetch was never store-bound
          item.verifiedAt = Date.now()
          if (item.confidence === 'real') item.confidence = 'estimated_with_source'
        } else {
          diagnostics.discovery.fallbackLlm++
          Object.assign(item, downgradeUnverified(item, aiStore.storeBanner, ingredientName))
        }
      }
      // cache write block unchanged except value gains provenance/verifiedAt (next step)
      ...
    }
    ...
  }
```

Where `withTimeout` is the small helper (add near the cache helpers if not already present):

```ts
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))])
}
```

And `buildDiscoveryDeps`:

```ts
function buildDiscoveryDeps(env: HonoEnv['Bindings'], counters: PlanDiagnostics['discovery']): DiscoveryDeps | null {
  if (!env.SERPER_API_KEY) return null
  return {
    serper: new SerperClient(env.SERPER_API_KEY),
    tavily: env.TAVILY_API_KEY ? new TavilyClient(env.TAVILY_API_KEY) : undefined,
    firecrawl: env.FIRECRAWL_API_KEY ? new FirecrawlClient(env.FIRECRAWL_API_KEY) : undefined,
    directFetch: async (url, headers) => {
      try {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 6000)
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; EggsBot/1.0)', ...headers }, signal: controller.signal })
        clearTimeout(t)
        if (!res.ok) return null
        return await res.text()
      } catch { return null }
    },
    counters,
  }
}
```

Important: `IMPORTANT — keep the LLM-claims verification block (validateUrls + verifyProductContent, lines ~828-859) ABOVE this loop; the fallback branch consumes its results.` The Kroger/Walmart item paths set `provenance: 'api'` where their items are constructed (search for `priceSource: 'kroger_api'` / `'walmart_api'` item construction and add `provenance: 'api' as const, verifiedAt: Date.now()`).

- [ ] **Step 5: Cache v2** — bump the cache key version and persist provenance. In `cacheKey` (grep `item:v1:`):

```ts
// v2: store-scoped + provenance-carrying. v1 entries are simply never read again
// (different prefix) and expire via their 24h TTL.
return `item:v2:${banner}:${storeId ?? 'unbound'}:${hash}`
```

`readCache`/`writeCache`/`CachedStoreItem` gain `storeId?: string` plumbed from the StoreIdentity; the cached `item` now includes `provenance`/`verifiedAt`/`verifiedStoreId` automatically (full item spread, already `{ ...item }`). On cache-hit display, `verifiedAt` stays the ORIGINAL verification time (not Date.now()) so the UI can show age honestly.

- [ ] **Step 6: Run all tests** — `npx vitest run` from `eggs-api/` → PASS (including plan.ai.test.ts old scenarios)
- [ ] **Step 7: Typecheck** — `npx tsc --noEmit` → clean
- [ ] **Step 8: Commit** — `git commit -m "feat(plan): wire store-bound discovery into plan route — honesty downgrades + provenance cache v2"`

---

### Task 10: Frontend — additive provenance UI

**Files:**
- Modify: `eggs-frontend/src/types.ts` (StoreItem mirror — add the three optional fields exactly as Task 1)
- Modify: `eggs-frontend/src/components/ConfidenceBadge.tsx` (extend SOURCE_LABELS + optional prop)
- Modify: `eggs-frontend/src/components/PerStorePanels.tsx` (ItemRow — additive subtext only)
- Create: `eggs-frontend/src/components/VerifiedTotals.tsx`
- Test: `eggs-frontend/src/components/ConfidenceBadge.test.tsx`, `eggs-frontend/src/components/VerifiedTotals.test.tsx`

**UI constraint reminder: every change below ADDS — no element is removed or restyled. If implementation requires anything beyond this, STOP and show Jonathan a mockup.**

- [ ] **Step 1: Write failing ConfidenceBadge tests**

```tsx
import { render, screen } from '@testing-library/react'
import { ConfidenceBadge } from './ConfidenceBadge'

describe('ConfidenceBadge provenance mapping', () => {
  it('store_page_verified renders Verified', () => {
    render(<ConfidenceBadge confidence="real" provenance="store_page_verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
  it('page_verified_unbound renders Online price', () => {
    render(<ConfidenceBadge confidence="estimated_with_source" provenance="page_verified_unbound" />)
    expect(screen.getByText('Online price')).toBeInTheDocument()
  })
  it('shopping_index renders Online price', () => {
    render(<ConfidenceBadge confidence="estimated_with_source" provenance="shopping_index" />)
    expect(screen.getByText('Online price')).toBeInTheDocument()
  })
  it('model_estimate renders Est.', () => {
    render(<ConfidenceBadge confidence="estimated" provenance="model_estimate" />)
    expect(screen.getByText('Est.')).toBeInTheDocument()
  })
  it('legacy items without provenance keep old labels', () => {
    render(<ConfidenceBadge confidence="real" />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Extend ConfidenceBadge** (additive — `SOURCE_LABELS` and existing prop untouched):

```tsx
export const PROVENANCE_LABELS: Record<string, { label: string; color: string }> = {
  api:                   { label: 'Live',         color: '#34d399' },
  store_page_verified:   { label: 'Verified',     color: '#34d399' },
  page_verified_unbound: { label: 'Online price', color: '#fbbf24' },
  shopping_index:        { label: 'Online price', color: '#fbbf24' },
  model_estimate:        { label: 'Est.',         color: '#94a3b8' },
}

export function ConfidenceBadge({ confidence, provenance }: { confidence: string; provenance?: string }) {
  const { label, color } =
    (provenance && PROVENANCE_LABELS[provenance]) ?? SOURCE_LABELS[confidence] ?? SOURCE_LABELS.estimated
  return ( /* span unchanged */ )
}
```

- [ ] **Step 3: ItemRow additions** in `PerStorePanels.tsx` — pass `provenance={item.provenance}` to the badge, and add (under the existing name/member-price block, inside the same flex-col so layout is unchanged):

```tsx
          {(item.provenance === 'page_verified_unbound' || item.provenance === 'shopping_index') && (
            <span className="text-[10px] text-slate-500 italic">
              online price — not confirmed for this store
            </span>
          )}
          {item.provenance === 'model_estimate' && (
            <span className="text-[10px] text-slate-500 italic">
              estimate — no source found
            </span>
          )}
          {item.verifiedAt && (
            <span className="text-[10px] text-slate-600">
              checked {formatAge(item.verifiedAt)}
            </span>
          )}
```

with the helper at the top of the file:

```tsx
function formatAge(epochMs: number): string {
  const h = Math.max(0, Math.round((Date.now() - epochMs) / 3_600_000))
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
```

And de-emphasize estimate prices ONLY by changing the unit-price `<td>` class conditionally (same cell, same layout):

```tsx
      <td className={`py-3 text-right font-mono font-bold ${item.provenance === 'model_estimate' ? 'text-slate-500' : 'text-amber-400/90'}`}>
```

- [ ] **Step 4: VerifiedTotals component + tests**

```tsx
// VerifiedTotals — additive summary strip: the defensible number vs the estimate.
import React from 'react'
import { ShieldCheck } from 'lucide-react'
import type { StorePlan } from '../types'

function splitTotals(stores: StorePlan[]) {
  let verified = 0
  let estimated = 0
  for (const s of stores) {
    for (const it of s.items) {
      if (it.notAvailable) continue
      if (it.provenance === 'api' || it.provenance === 'store_page_verified') verified += it.lineTotal
      else estimated += it.lineTotal
    }
  }
  return { verified, estimated }
}

const VerifiedTotals: React.FC<{ stores: StorePlan[] }> = ({ stores }) => {
  const { verified, estimated } = splitTotals(stores)
  if (verified === 0 && estimated === 0) return null
  return (
    <div className="mt-3 flex items-center gap-4 text-xs bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <ShieldCheck className="w-3.5 h-3.5" /> Verified prices: <span className="font-mono font-bold">${verified.toFixed(2)}</span>
      </span>
      {estimated > 0 && (
        <span className="text-slate-400">
          + estimates: <span className="font-mono">${estimated.toFixed(2)}</span>
        </span>
      )}
    </div>
  )
}

export default VerifiedTotals
```

Test (`VerifiedTotals.test.tsx`):

```tsx
import { render, screen } from '@testing-library/react'
import VerifiedTotals from './VerifiedTotals'

const stores = [{
  storeName: 'S', storeBanner: 'S', storeType: 'physical', priceSource: 'ai_estimated',
  subtotal: 0, estimatedTax: 0, grandTotal: 0,
  items: [
    { ingredientId: '1', name: 'a', quantity: 1, unit: 'lb', unitPrice: 4, lineTotal: 4, confidence: 'real', shopUrl: 'x', isLoyaltyPrice: false, pricedSize: null, provenance: 'store_page_verified' },
    { ingredientId: '2', name: 'b', quantity: 1, unit: 'lb', unitPrice: 3, lineTotal: 3, confidence: 'estimated', shopUrl: 'x', isLoyaltyPrice: false, pricedSize: null, provenance: 'model_estimate' },
  ],
}] as any

it('splits verified vs estimated totals', () => {
  render(<VerifiedTotals stores={stores} />)
  expect(screen.getByText('$4.00')).toBeInTheDocument()
  expect(screen.getByText('$3.00')).toBeInTheDocument()
})
```

- [ ] **Step 5: Mount VerifiedTotals** — in `eggs-frontend/src/components/PlanResult.tsx`, find where the plan's grand-total/summary block renders (grep `summary.total` or `grandTotal` in PlanResult.tsx) and add `<VerifiedTotals stores={plan.stores} />` **directly below it** as a sibling — insert only, move nothing.

- [ ] **Step 6: Run frontend tests** — from `eggs-frontend/`: `npx vitest run` → PASS
- [ ] **Step 7: Visual sanity** — `npm run dev`, load a stored plan, confirm: existing layout identical; new subtexts and totals strip appear only where data exists.
- [ ] **Step 8: Commit** — `git commit -m "feat(ui): additive provenance labels, freshness age, verified-vs-estimate totals"`

---

### Task 11: TEST-COVERAGE.md + secrets + staging deploy + smoke

**Files:**
- Modify: `TEST-COVERAGE.md`
- Deploy: staging worker

- [ ] **Step 1: Update TEST-COVERAGE.md** — add a WS1 section listing every new unit/component test from Tasks 2-10 as ✅, plus planned-not-automated rows (📋): live binding-assertion probe per recipe banner, E2E plan flow asserting no confident price has a search-landing link.

- [ ] **Step 2: Push secrets to staging**

```bash
cd eggs-api
npx wrangler secret put SERPER_API_KEY --env staging      # paste from .dev.vars
npx wrangler secret put TAVILY_API_KEY --env staging
npx wrangler secret put FIRECRAWL_API_KEY --env staging
```

- [ ] **Step 3: Deploy staging** — `npx wrangler deploy --env staging`

- [ ] **Step 4: Live smoke** — generate a Dallas-area plan against staging (free test user from `.env.test.local`); verify in the response JSON: discovery diagnostics populated; at least one `store_page_verified` or `page_verified_unbound` item with a product-page proofUrl; zero items where `confidence !== 'estimated'` and shopUrl is a search-landing URL. Then run the `eggs-browser-test` skill flow against staging UI.

- [ ] **Step 5: Prod secrets + deploy** (after Jonathan reviews staging) —

```bash
npx wrangler secret put SERPER_API_KEY && npx wrangler secret put TAVILY_API_KEY && npx wrangler secret put FIRECRAWL_API_KEY
npx wrangler deploy
```

- [ ] **Step 6: Commit + push**

```bash
git add TEST-COVERAGE.md
git commit -m "test: WS1 coverage matrix — store-bound price discovery"
git push
```

---

## Self-Review

**Spec coverage:** StoreIdentity ✅ (T1) · binding registry + assertion ✅ (T5) · Sprint-0 spike ✅ (T7) · Serper/Tavily/Firecrawl ✅ (T2-4) · pre-fetched-content verifier ✅ (T6) · orchestrator + provenance ✅ (T8) · honesty downgrades incl. plan.ts:892 fix ✅ (T9) · cache v2 store-scoped + freshness ✅ (T9) · verified-vs-estimated totals + "online price" copy + de-emphasized estimates + "checked Nh ago" ✅ (T10) · Walmart "Walmart.com price" label ✅ (T10 maps provenance `api`→Live; the explicit "Walmart.com price" copy rides the storeType='delivery' row already shown — acceptable; revisit in WS3 polish if Jonathan wants stronger copy) · cost guardrails ✅ (caps in T9) · graceful degradation without keys ✅ (T8/T9).

**Known deferred (recorded, not silently dropped):** per-banner store-locator adapters (resolve `retailerStoreId`) land with spike findings in T7/T9 follow-up — until a banner has both a locator and a recipe, its items cap at `page_verified_unbound`, which is honest. Serper `/places` store discovery stays out of scope per spec.

**Type consistency check:** `DiscoveredPrice` defined in T8, consumed in T9 ✅ · `verifyContentText` signature consistent T6/T8 ✅ · `PlanDiagnostics['discovery']` field names match T1/T8/T9 ✅ · frontend `provenance` strings match backend `Provenance` union ✅.
