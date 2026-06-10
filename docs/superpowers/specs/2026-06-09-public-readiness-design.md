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
    returned markdown. Caveat observed: page rendered with "Victoria H-E-B" store context —
    **scraped prices are store-location-dependent** and may differ from the chef's local store.

---

## WS1 — Verifiable AI prices

### Pipeline (per non-API banner × ingredient)

```
Store discovery (unchanged: LLM pass 1; optional Serper /places upgrade later)
  └─ for each (banner, ingredient):
     1. DISCOVER   Serper /shopping (q="{ingredient} {banner}", location bias)
                   → candidate {title, price, merchant}; filter to merchant == banner
     2. RESOLVE    Tavily /search (query=product title, include_domains=[banner domain])
                   → merchant product-page URL candidates
     3. VERIFY     fetch product page: direct fetch → on 403/429/challenge,
                   Firecrawl /v2/scrape (proxy:auto, formats:[markdown], timeout:9000)
                   → run existing exact-price + name-coverage check against content
     4. FALLBACK   existing Anthropic two-pass research for banners/items steps 1–3
                   couldn't source (and as the only path when Serper/Tavily keys absent)
```

New modules: `integrations/serper.ts`, `integrations/tavily.ts`, `integrations/firecrawl.ts`,
orchestrated by `lib/price-discovery.ts`. `content-verifier.ts` refactored to accept
pre-fetched content (so one fetch serves both Firecrawl fallback and verification).
Each integration degrades gracefully when its key/env is missing.

### Honesty rules (the contract)

- A row may display a price **only** with provenance:
  - `verified` — Kroger/Walmart API, **or** exact-price-verified against a fetched product
    page. Link goes to the product page. (Replaces `real`.)
  - `sourced` — price came from Serper Shopping (Google's index) and a product page was
    resolved, but page verification of the exact price failed/was unavailable. Link goes to the
    product page, never a search page. (Replaces legitimate `estimated_with_source`.)
  - `estimate` — no source. Price rendered de-emphasized with explicit "estimate — no source
    found" copy; link (if any) is the search-landing URL, visually presented as
    "search at store →", not as a product link.
- **Search-landing URLs never accompany a confidently-styled price.** `plan.ts:892` downgrade
  path → `estimate`, not `estimated_with_source`.
- Wire format: keep `confidence: 'real' | 'estimated_with_source' | 'estimated'` enum values
  (avoid breaking stored plans/UI), add `verifiedAt?: number` and `priceSource detail` to
  StoreItem; frontend maps them to the three labels above. New field
  `provenance?: 'api' | 'page_verified' | 'shopping_index' | 'model_estimate'`.
- **Cache transparency:** cached items retain provenance + `verifiedAt`; UI shows "checked Nh
  ago". Cache hits no longer overwrite provenance fields blindly. TTL stays 24h.
- Plan summary splits **verified subtotal vs. estimated subtotal** — the number a chef can
  defend to a client is explicit.
- Disclosure: store-location caveat ("online price; your store may vary") on `sourced`/scraped
  rows.

### Cost guardrails

Per plan run (20 items × ~3 AI banners): Serper ~60 queries ≈ $0.06; Tavily ~30–60 credits;
Firecrawl only on direct-fetch failure (observed: basic proxy often suffices ≈1 credit/page).
Free-tier caps: per-plan ceilings (`maxSerperQueries`, `maxFirecrawlScrapes`) mirroring the
existing `maxSearches` pattern; Pro gets headroom. All counts logged into `PlanDiagnostics`.

### Acceptance

- Zero rows in a generated plan where a non-API price displays confidently with a
  search-landing link.
- ≥80% of non-API rows for major banners (Target, H-E-B, Albertsons-family, Sprouts) reach
  `verified` or `sourced` in a Dallas-area test plan.
- Every `verified` row's link opens the exact product page containing the displayed price.
- Plan generation stays under the Worker timeout (per-item ceilings preserved).

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
