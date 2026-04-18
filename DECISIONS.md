# DECISIONS.md — E.G.G.S.

A dated log of significant architectural and strategic decisions.

---

## Strategic

**[2026-03] Pivoted from household grocery shopper to private event chef**
Original concept (grocery-hunt-ai / early E.G.G.S. prototype) targeted household shoppers. Pivoted to private event chefs as the beachhead market. Why: household grocery comparison is brutally competitive and free-tier dominated; private chefs have a clear ROI story, a specific multi-dish workflow need, and demonstrated willingness to pay for professional tools. The co-creator of the original concept (founder's fiancée) is a private event chef — making her the design partner and first user, which is an asset not to waste.

**[2026-03] Eliminated captcha-solving / scraping dependency**
grocery-hunt-ai used Capsolver to scrape grocery sites. This was identified as a hard blocker for a product business — scraping infrastructure is fragile, legally grey, and not under our control. New data model uses: (1) official grocery APIs where available (Kroger, Walmart), (2) user's own price history built over time, (3) AI web search grounding for public price discovery. No captcha solvers. No scraping.

**[2026-03] Private chef workflow features are the differentiator**
The product is not just a price comparison tool — it is a professional workflow tool. Recipe-to-shopping-list scaling, multi-dish event planning, budget tracking, and client billing reports are the features that justify subscription pricing. Price comparison alone would not.

---

## Architecture

**[2026-03] Migrating from Google AI Studio scaffold to production stack**
Original E.G.G.S. prototype was exported from Google AI Studio: React 18 + TypeScript + Vite + Tailwind + Gemini (gemini-2.5-flash + gemini-2.0-pro-preview) with Google Search grounding + localStorage. This is a starting point, not a production architecture.

**[open] Provider strategy for v1**
Gemini with Google Search grounding is a reasonable starting point for price discovery — it can surface publicly listed prices from store websites and weekly ads without scraping. Anthropic with web search tool is an alternative. Decision: start with Gemini grounding for price discovery (it is purpose-built for this), use empire provider abstraction so we can swap. Revisit if accuracy or cost becomes a problem.

**[open] Data persistence**
localStorage (current prototype) is fine for early testing but not for a product. Options: Supabase Postgres (aligns with empire standard, free tier generous), IndexedDB + sync (local-first like protoStudio). Decision pending — lean toward Supabase for simplicity since this product needs a server component anyway (API key proxy, price history across devices).

**[open] Hosting**
Cloudflare Pages (frontend) + Cloudflare Workers (API proxy, server-side price lookups). Aligns with empire standard. No always-on server needed for v1.

---

## Integrations

**[2026-04-18] Walgreens Developer API has no pricing endpoint — removed `walgreens_api` from PriceSource union**
Verified against https://developer.walgreens.com/apis (April 2026): all six Walgreens API products (Store Inventory, Add to Cart, Photo Prints, Rx Refill/Transfer, Scheduling, Store Locator) return zero price data. Walgreens inventory endpoint returns `{id, s, q, ut}` — stock levels only. The aspirational `'walgreens_api'` PriceSource branch in types + frontend has been removed. If a pharmacy/OTC price source becomes necessary we will revisit via SerpAPI / DataForSEO scoped to `site:walgreens.com`.

**[2026-04-18] Instacart Developer Platform integration deferred pending approval**
Submitted IDP access request on 2026-04-18 with our use-case description (private event chefs, large scheduled baskets, high repeat frequency, no competing marketplace). Architecture and types not scaffolded until approval — avoiding premature commitment to endpoint shapes that may change. On approval, Instacart unlocks pricing for ~1,500 banners including Tom Thumb (Dallas) and Publix/Aldi/Costco nationally. Reference: https://docs.instacart.com/developer_platform_api/

**[2026-04-18] URL guarantee architecture — web_search + web_fetch + HEAD validation + deterministic fallback**
Root cause of the "AI stores have no Shop link" prod bug: the Anthropic provider previously called `/v1/messages` with no `tools` array. The prompt *claimed* "you have web search access" but the model was hallucinating or nulling URLs. Architecture now:
1. Claude Haiku with `web_search_20260209` + `web_fetch_20260209` tools (GA). Free-tier cap: `max_uses: 25` ≈ $0.25/plan ceiling. Pro: 100.
2. Server-side cross-reference: asserted `proofUrl`s must appear in the response's citation blocks.
3. Server-side HEAD validation (`lib/url-validator.ts`): 3s timeout, falls back to GET-range on 405/403.
4. Deterministic search-landing URL per banner (`integrations/store-urls.ts`): guarantees `shopUrl` is always a valid clickable link, even when Tier 1 returns nothing.
5. Per-`(banner, ingredient)` KV cache with 24h TTL (`URL_CACHE` namespace): the second user searching the same item at the same banner within 24h pays $0 — no AI call, no web_search cost. Fire-and-forget writes via `c.executionCtx.waitUntil` so cache population doesn't block response.

StoreItem contract now has `shopUrl: string` as the required, always-set Shop link. `proofUrl` remains optional, present only when web_search+web_fetch+HEAD-validation all pass. Deprecated `productUrl` is kept on the type for backward compatibility with plans already stored in Supabase.

---

## Open Decisions

- Which official grocery APIs to integrate next (Instacart on approval; Albertsons direct is covered by Instacart so deprioritized)
- Whether to build recipe scaling from scratch or use a service/library
- Pricing model: flat monthly ($19?) vs. per-event vs. freemium with paid event history
- Mobile vs. web first — chefs shop on their phones
- Whether to build a shared ingredient price database across users (privacy implications, but strong moat)
