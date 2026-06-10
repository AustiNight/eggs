# E.G.G.S. Public Readiness — Design Spec

*Date: 2026-06-09 · Status: approved design, pressure-tested against codebase · Author: Claude + Jonathan*

## Goal

Make E.G.G.S. ready for public users (private event chefs):

1. **Trustworthy prices** — every price at a non-API store is either verified against a fetched
   source page the chef can click, or honestly labeled an estimate. No more prices that link
   to a generic store-search page while looking authoritative.
2. **Chef productivity** — shopping mode, receipt capture, price history, client-billable
   reports, event templates, and a smoother planning→shopping flow.
3. **Working billing** — Stripe checkout + webhook so free-tier limits have an upgrade path.

Sequencing: **WS1 pricing trust → WS2 billing → WS3 chef features.** Each ships to prod
independently.

## Pressure-test findings (what the codebase actually does today)

Verified by reading code and live API smoke tests on 2026-06-09:

- `content-verifier.ts` **already verifies the exact `unitPrice`** appears on the fetched page
  (4 format variants) plus 60% product-name token coverage. The verification primitive is good;
  the problem is what happens around it.
- `plan.ts:882-893` — when verification fails, the item **keeps the LLM's price**, gets a
  search-landing `shopUrl` from `store-urls.ts`, and is labeled `estimated_with_source`.
  This is the core dishonesty to fix.
- `plan.ts:872-880` — 24h KV cache hits **bypass all verification** and overwrite the item
  wholesale; `cachedAt` is stored but never surfaced to the user.
- Pass 1 (`plan.ts:353-417`) does double duty: **store discovery** (which banners are near the
  chef) *and* price research. Any replacement must preserve store discovery.
- Live smoke tests (all three keys working, stored in `eggs-api/.dev.vars`):
  - **Serper** `/shopping`: returns real prices + merchant names for "organic chicken breast
    H-E-B / Dallas" — but `link` is a **Google Shopping redirect**, not a merchant product page.
    Discovery-only; cannot satisfy "link leads to source" alone.
  - **Tavily** `/search`: surfaced a real heb.com product-detail URL with the price in the
    snippet. Good for product-URL resolution (`include_domains` per banner).
  - **Firecrawl** `/v2/scrape`: fetched the heb.com product page through the bot wall on the
    **basic proxy** (1 credit); exact price `$4.98 each ($0.50/oz)` and size `10 oz` present in
    returned markdown. Critical observation: page rendered with "Victoria H-E-B" store context —
    an unbound fetch returns **some arbitrary store's price, not the chef's store's price**.
    This drives the store-scoped verification requirement below. Firecrawl supports custom
    `Cookie` headers and pre-scrape `actions` (click/write/executeJavascript/wait) on `/scrape`,
    plus an `/interact` endpoint for stateful flows — confirmed via Firecrawl docs-search
    2026-06-09 — so fetches CAN be bound to a specific store.

---

## WS1 — Verifiable AI prices

### Store-scoped verification (hard requirement)

A price presented as a store's price MUST come from a fetch bound to a concrete store inside
the chef's distance-bound search — never from whatever store context a scraper's IP happens to
land on. Components:

1. **StoreIdentity** — store discovery must yield concrete stores, not just banners:
   `{ banner, storeName, address, lat, lng, distanceMiles, retailerStoreId? }`.
   `retailerStoreId` resolved via per-banner store-locator adapters (most retailers expose
   unauthenticated JSON store-locator endpoints); Serper `/places` and/or existing LLM
   discovery supply name + address to match against the locator.
2. **Store-binding registry** (`integrations/store-binding.ts`) — per banner, a recipe for
   scoping a product-page fetch to a specific store:
   - `url` — store ID encoded in URL/query param (cheapest)
   - `cookie` — known store-selection cookie recipe; usable by BOTH direct Worker fetch and
     Firecrawl (`headers: { Cookie: ... }`)
   - `actions` — Firecrawl actions script (enter zip → select store → wait) before capture;
     `/interact` as escalation for stateful flows
   - `none` — binding not yet supported for this banner
3. **Binding assertion** — recipes are never trusted blindly. The verifier checks the rendered
   page's store indicator (e.g. H-E-B's "You're shopping {storeName}" banner text or store ID
   in the page payload) matches the expected StoreIdentity. content-verifier's checks become:
   exact price + name coverage + **store binding confirmed**.
4. **Sprint 0 spike** — establish and validate binding recipes for priority banners
   (H-E-B / Central Market, Tom Thumb + Albertsons family, Target, Sprouts, Aldi,
   Trader Joe's; Kroger family already store-bound via API `locationId`). Each banner ships
   only after its recipe passes an automated binding-assertion test. Banners without a working
   recipe stay at `estimate` tier — honestly labeled, never silently wrong.

Note: Walmart affiliate API returns walmart.com e-commerce prices (purchasable for
pickup/delivery from the chef's store, but not shelf-verified) — label "Walmart.com price" in
the UI for the same honesty standard.

### Pipeline (per non-API store × ingredient)

```
Store discovery → StoreIdentity[] (LLM pass 1 + store-locator adapters;
                                   optional Serper /places upgrade later)
  └─ for each (storeIdentity, ingredient):
     1. DISCOVER   Serper /shopping (q="{ingredient} {banner}", location bias)
                   → candidate {title, price, merchant}; filter to merchant == banner.
                   Index prices are NEVER store-trusted — candidates only.
     2. RESOLVE    Tavily /search (query=product title, include_domains=[banner domain])
                   → merchant product-page URL candidates
     3. VERIFY     store-bound fetch of product page (binding recipe applied):
                   direct fetch w/ cookie recipe → on 403/429/challenge or actions-required,
                   Firecrawl /v2/scrape (proxy:auto, headers/actions per recipe,
                   formats:[markdown], timeout:9000)
                   → exact-price + name-coverage + binding-assertion checks
     4. FALLBACK   existing Anthropic two-pass research for items steps 1–3 couldn't source
                   (and the only path when Serper/Tavily keys absent). Its results are
                   subject to the same verification — unverified = estimate tier.
```

New modules: `integrations/serper.ts`, `integrations/tavily.ts`, `integrations/firecrawl.ts`,
`integrations/store-binding.ts` (+ per-banner locator adapters), orchestrated by
`lib/price-discovery.ts`. `content-verifier.ts` refactored to accept pre-fetched content and
the expected StoreIdentity. Each integration degrades gracefully when its key/env is missing.

### Honesty rules (the contract)

- A row may display a confidently-styled price **only** with store-scoped provenance:
  - `verified` — Kroger API (store-bound by locationId), **or** exact-price-verified against a
    store-bound fetched product page whose binding assertion passed. Link goes to the product
    page. (Replaces `real`.)
  - `sourced` — a real product page was resolved and fetched, price verified on page, but the
    fetch could not be store-bound (recipe `none` or assertion failed) — OR price comes only
    from Serper's shopping index. Displayed de-emphasized with explicit copy
    "online price — not confirmed for {storeName}". Counts toward estimated subtotal only.
  - `estimate` — no source. De-emphasized, "estimate — no source found"; link (if any) is the
    search-landing URL presented as "search at store →", never styled as a product link.
- **Search-landing URLs never accompany a confidently-styled price.** `plan.ts:892` downgrade
  path → `estimate`, not `estimated_with_source`.
- Wire format: keep `confidence: 'real' | 'estimated_with_source' | 'estimated'` enum values
  (avoid breaking stored plans/UI); add `provenance?: 'api' | 'store_page_verified' |
  'page_verified_unbound' | 'shopping_index' | 'model_estimate'`, `verifiedAt?: number`, and
  `verifiedStoreId?: string` to StoreItem; frontend maps to the three labels above.
- **Cache transparency:** cache key gains the store dimension (`item:v2:{banner}:{storeId}:
  {ingredient-hash}`); cached items retain provenance + `verifiedAt`; UI shows "checked Nh
  ago". Cache hits no longer overwrite provenance fields blindly. TTL stays 24h.
- Plan summary splits **verified subtotal vs. estimated subtotal** — the number a chef can
  defend to a client is explicit. Only store-bound (`verified`) prices enter the verified
  subtotal.

### Cost guardrails

Per plan run (20 items × ~3 AI banners): Serper ~60 queries ≈ $0.06; Tavily ~30–60 credits;
Firecrawl only on direct-fetch failure (observed: basic proxy often suffices ≈1 credit/page).
Free-tier caps: per-plan ceilings (`maxSerperQueries`, `maxFirecrawlScrapes`) mirroring the
existing `maxSearches` pattern; Pro gets headroom. All counts logged into `PlanDiagnostics`.

### Acceptance

- Zero rows in a generated plan where a non-API price displays confidently with a
  search-landing link.
- **Zero rows labeled `verified` whose price was fetched without a passing store-binding
  assertion against a store inside the search radius.**
- For banners with shipped binding recipes, ≥70% of non-API rows reach `verified` in a
  Dallas-area test plan; remaining rows are honestly `sourced`/`estimate`.
- Every `verified` row's link opens the exact product page containing the displayed price,
  scoped to the chef's store where the retailer's site supports store context.
- Plan generation stays under the Worker timeout (per-item ceilings preserved; binding
  recipes add bounded latency — actions-based fetches are budgeted like stealth fetches).

---

## WS2 — Stripe billing

- `POST /api/billing/checkout` — creates Checkout Session (Pro subscription price ID from env),
  `success_url`/`cancel_url` back to the app. Auth required.
- `POST /api/billing/portal` — Stripe customer portal session for manage/cancel.
- `POST /api/webhooks/stripe` — **no auth middleware**, raw-body signature verification
  (`STRIPE_WEBHOOK_SECRET`). Handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted` → updates
  `users.subscription_tier/status/period_end/stripe_customer_id`. Idempotent by event id.
- Stripe SDK: use `stripe` npm with `fetch` http client (Workers-compatible) or raw REST.
- Frontend: Upgrade CTA on usage meter + limit-hit 403 modal + Settings billing section
  (current plan, renew date, portal link).
- Test-mode E2E (Stripe test cards) before flipping live keys. New secrets:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` var.

### Acceptance

Free user hits limit → upgrades with test card → tier flips to `pro` via webhook → limits
lift without re-login; cancel via portal → reverts at period end.

---

## WS3 — Chef productivity

### Data model (new tables, following existing schema.sql conventions)

```sql
shopping_sessions (id, event_id, shopping_plan_id, user_id, store_banner,
                   items jsonb,        -- [{ingredientId, checked, actualPrice?, note?}]
                   status text,        -- 'active' | 'done'
                   created_at, updated_at)

receipts          (id, event_id, user_id, store_banner, storage_path text,
                   extracted jsonb,    -- {store, date, lineItems[], totals}
                   status text,        -- 'uploaded' | 'extracted' | 'confirmed'
                   created_at)

price_history     (id, user_id, ingredient_name text, normalized_name text,
                   store_banner text, unit_price numeric, priced_size jsonb,
                   source text,        -- 'receipt' | 'shopping' | 'reconcile'
                   event_id uuid, recorded_at)

menu_templates    (id, user_id, name, dishes jsonb, source_event_id uuid, created_at)
```

### Features

- **Shopping mode** (`/events/:id/shopping`) — phone-first per-store checklist from latest
  plan; check-off + optional actual-price quick entry; server-persisted (survives reload /
  flaky store wifi via optimistic UI + retry); "store done" → prefills reconcile.
- **Receipt capture** — upload/photo in shopping mode or reconcile → Supabase Storage
  (private bucket `receipts/{userId}/...`, signed URLs only) → Claude vision extraction →
  confirm/edit screen → feeds reconcile actuals + `price_history`.
- **Price history** — written from confirmed receipts, shopping-mode actual prices, and
  line-by-line reconcile. Surfaced: "you paid $X at {banner} on {date}" chip on plan rows
  (matched via `normalized_name` + banner), and as a personal-history candidate in best-value
  selection (chef's own paid price = strong prior).
- **Reports & export** — read-only shareable report route per event (estimated vs actual,
  per-dish costs via existing `sources[]` proportions, per-store breakdown) with print CSS
  (browser print → PDF; no server PDF infra). CSV download of plan + reconcile. Pro-gated.
  Receipt images linkable from the report.
- **Templates / repeat events** — "Duplicate event" and "Save menu as template";
  new-event screen offers templates first.
- **Flow polish** — continuous create→dishes→shop flow without dashboard dead-ends;
  visible fallback message when clarification loop times out (known stub).

### Acceptance

A chef can: plan an event from a template, shop two stores on their phone checking items off,
snap both receipts, confirm extraction, and produce a client-ready cost report (PDF via print)
showing estimated vs. actual — without touching a laptop.

---

## Cross-cutting

- **TEST-COVERAGE.md** updated with every feature (standing rule). Unit tests:
  serper/tavily/firecrawl adapters (mocked), price-discovery orchestration, honesty-rule
  mapping, webhook signature + idempotency, receipt extraction parsing, price-history matching.
  E2E: checkout (test mode), shopping mode, receipt flow, report render.
- **Secrets:** local `eggs-api/.dev.vars` (done, gitignored); prod via
  `wrangler secret put SERPER_API_KEY / TAVILY_API_KEY / FIRECRAWL_API_KEY / STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET`.
  wrangler.toml secret-comment list updated accordingly.
- **Privacy:** receipts are PII-adjacent — private bucket, signed URLs, never public.
- **Out of scope:** native mobile, barcode scanning, additional direct store APIs,
  Serper Places store discovery (noted as later upgrade).
