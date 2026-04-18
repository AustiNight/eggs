# E.G.G.S. Integrations Reference

*Last updated: 2026-04-18*

A map of every US grocery / product-URL data source we've evaluated, the approach we chose, and why. Update this file whenever a new retailer API is integrated, dropped, or changes availability.

---

## Active

| Source | Type | Price data | Store-local pricing | Shop link | Proof link | Cost | Notes |
|---|---|---|---|---|---|---|---|
| **Kroger Public API** | OAuth 2.0 client-credentials | ✅ | ✅ (per `locationId`) | Deterministic template `https://www.kroger.com/p/{slug}/{productId}` | Same as shop | Free | GA, no rate-limit concerns observed. `eggs-api/src/integrations/kroger.ts` |
| **Walmart Affiliate API** | RSA-SHA256 signed (WM_SEC) | ✅ | Partial (`zipCode` param) | Affiliate tracking URL from `productTrackingUrl` | Same as shop | Free tier (affiliate revshare) | Decrypted PKCS#8 key stored as `WALMART_PRIVATE_KEY` Worker secret. `eggs-api/src/integrations/walmart.ts` |
| **Anthropic `web_search_20260209`** | Server-side tool via Messages API | ✅ (via citations) | Via prompt/zip | Citation URL after HEAD-validation | Same as shop | $10/1k searches | Free-tier `max_uses: 25` (~$0.25/plan ceiling); Pro: 100. |
| **Anthropic `web_fetch_20260209`** | Server-side tool via Messages API | Confirms price on fetched page | — | — | — | Token costs only | Used to verify web_search candidate URLs actually carry the product. |
| **Deterministic search-landing URL** | Static template per banner | ❌ | — | Always valid landing page | — | $0 | `eggs-api/src/integrations/store-urls.ts`. Google-scoped fallback for unknown banners. |
| **Per-(banner, ingredient) KV cache** | `URL_CACHE` namespace | Cached price + URL result | — | — | — | $0 | 24h TTL. Second user searching the same item/banner within the window is free. |
| **Open Food Facts** | Public HTTP + Prices extension | Weak US coverage for prices | ❌ | — | — | Free (OdBL) | Integrated for product metadata (nutrition, allergens), NOT for pricing. `eggs-api/src/integrations/openfoodfacts.ts` |

---

## Deferred / Dropped

| Source | Status | Reason | Reference |
|---|---|---|---|
| **Instacart Developer Platform** | Deferred | IDP access requested 2026-04-18, awaiting approval. Would unlock ~1,500 banners including Tom Thumb/Albertsons/Publix/Aldi/Costco via a single API. No code scaffolded yet to avoid premature commitment. | https://docs.instacart.com/developer_platform_api/ |
| **Walgreens Developer API** | Dropped | Verified April 2026 — no product pricing endpoint exists in any of the six Walgreens API products (Store Inventory returns only `{id, s, q, ut}` stock levels). Removed `walgreens_api` from `PriceSource`. | https://developer.walgreens.com/apis |
| **Albertsons direct partner API** | Dropped | Partner-only, slow sales cycle, and Tom Thumb coverage comes for free once Instacart is approved. | https://portal-prod.apim.azwestus.stratus.albertsons.com/ |
| **Target / Costco / H-E-B / Publix / Aldi / Trader Joe's / Sprouts / Whole Foods / Sam's Club** | No direct API | No public product/pricing API exists. Covered by the AI web_search + web_fetch + deterministic shopUrl fallback chain. | — |

---

## Future evaluation (not a commitment)

| Source | Type | Possible role |
|---|---|---|
| **Target RedSky** (`redsky.target.com/redsky_aggregations/v1/web/*`) | Undocumented JSON backing target.com | Direct pricing + URL for Target specifically, if AI path proves insufficient. ToS-grey; avoid for now. |
| **SerpAPI Google Shopping** | Paid SERP aggregator ($15/1k) | Drop-in URL validator when web_search returns no citation. |
| **DataForSEO Google Shopping** | Paid SERP aggregator ($1/1k) | Cheaper SERP fallback; 10x cheaper than SerpAPI for the same shape. |
| **Bright Data Web Scraper** | Proxy + unlocker ($1.50/1k) | Only if a specific retailer bot-blocks us and is strategically important. |
| **Apify retail actors marketplace** | Pre-built retailer scrapers | Path of least resistance for a regional-only banner (e.g. H-E-B) if ever needed. |

---

## Architecture: how the three-tier URL guarantee works

For every `StoreItem` we return in a shopping plan:

```
Tier 1: LIVE RETRIEVAL
  ↓ Direct API (Kroger/Walmart) — deterministic URL from real item data
  ↓ or Claude web_search → candidate URLs in citations
  ↓ Claude web_fetch → confirms product is on the page
       ↓
Tier 2: SERVER VALIDATION
  ↓ Cross-reference: proofUrl must appear in response citations (not fabricated)
  ↓ HEAD-request the URL with 3s timeout, retry GET-range on 405/403
  ↓ Passed? → shopUrl = proofUrl = productUrl, confidence: 'real'
  ↓ Failed?
       ↓
Tier 3: DETERMINISTIC FALLBACK
  ↓ shopUrl = getShopUrl(banner, ingredientName)  ← always valid
  ↓ proofUrl = undefined
  ↓ confidence: 'estimated_with_source' (if URL was claimed) or 'estimated' (if none)
```

Then the resolved item is persisted to `URL_CACHE` for 24h so the next user searching the same `(banner, ingredient)` pair skips the AI call entirely.

Cost ceiling per free-tier plan: $0.25 (25 × $0.01 web_search + token costs).
Cost per fully-cached plan: $0.
