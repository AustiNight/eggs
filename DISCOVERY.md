# DISCOVERY.md — E.G.G.S. Shopping Plan Workflow

**Date:** 2026-04-19
**Phase:** 0 (read-only discovery)
**Scope:** map the current system end-to-end from raw-item input through store search, aggregation, render, and persistence; identify the known totals bug; evaluate state of prior disambiguation code; document prefs system.

---

## Executive Summary — Three Surprises That Change the Brief

1. **The disambiguation loop was never removed.** It is fully implemented and wired: `POST /api/clarify` exists, the LLM prompt returns a `ClarificationRequest[]`, `ClarificationModal.tsx` renders multiple-choice questions, and both `Plan.tsx` and `EventShop.tsx` await it before firing store search. It *feels* absent because the prompt is conservative — it commonly returns `[]` and the modal silently skips. The work is "strengthen and make ontology-aware," not "restore."
2. **`avoid_brands` already exists end-to-end.** Column on `users` table, `PATCH /api/users/me` accepts it, Settings page has a tag-input UI. BUT it is only injected into the AI-search prompt — Kroger and Walmart adapters do not consume it. No best-value selector applies it either.
3. **The totals bug is precisely locatable.** It is three lines: `eggs-api/src/routes/plan.ts:692–695`. The plan is not a "best basket across stores" — it is a ranked list of full store carts, and the `summary.total` is the **sum of every store's full cart**. There is no cross-store best-price-per-item reduction anywhere in the codebase.

---

## 1. End-to-End Shopping Plan Flow

### 1.1 Entry Point
- **UI:** `eggs-frontend/src/pages/Plan.tsx:180-196` renders `ShoppingListInput`. The "Find Best Prices" button fires `handleStartProcess` (`Plan.tsx:58`).
- **Client-side parse:** `eggs-frontend/src/components/ShoppingListInput.tsx:29-38`. Naive: if the first token parses as a number it becomes `quantity`, remainder becomes `name`. No LLM, no unit parsing. `unit` defaults to `'unit'` when converted to `IngredientLine` (`Plan.tsx:15-24`).
- **Client→server boundary:** `eggs-frontend/src/lib/api.ts:133-156`. Two calls: `clarifyIngredients()` → `POST /api/clarify`, then `generatePlan()` → `POST /api/price-plan`. Both carry a Clerk Bearer JWT.

### 1.2 Clarification Layer (the "disambiguation" that supposedly didn't exist)
- **Route:** `eggs-api/src/routes/clarify.ts:12` — `POST /api/clarify`.
- **Behavior:** Ships ingredient list to `claude-haiku-4-5` in JSON mode. System prompt (lines 27–51) instructs the model to return a `ClarificationRequest[]` or `[]`. Each request has `itemId`, `originalName`, `question`, `options[]`.
- **Frontend handling:** `Plan.tsx:81` (`handleClarificationComplete`) writes user answers into `clarifiedName` on each item, re-calls `runPlan`. On the server the priority chain is: `body.resolvedClarifications?.[i.id] ?? i.clarifiedName ?? i.name` (`eggs-api/src/routes/plan.ts:396`).
- **Why it feels gone:** the prompt is conservative. For well-formed inputs (`2 lbs chicken breast`) the LLM correctly returns `[]`. No user-facing "all items clear" toast, so the step silently no-ops behind the `'analyzing'` loading state.
- **Also wired in `EventShop.tsx:399-428`** for the event-based flow.

### 1.3 Orchestration
- **Route:** `eggs-api/src/routes/plan.ts:386` — `POST /api/price-plan`. Guards: `requireAuthOrServiceKey`, `rateLimit`, `enforceFreeLimit`.
- **Store discovery (lines 399–433):** Kroger + Walmart clients initialized if env present; `findNearbyLocations` called with user's GPS. `apiCoveredStores` (banners already handled by direct APIs) is built for AI-search exclusion.
- **Parallel search (lines 436–444):** `Promise.allSettled` over three providers simultaneously:
  - `searchKroger` — parallel per-ingredient `getPriceForIngredient` (`Promise.allSettled` at `plan.ts:78`)
  - `searchWalmart` — parallel per-ingredient (`Promise.allSettled` at `plan.ts:112`)
  - `searchNonApiStores` — two-pass AI (see §2.3)

### 1.4 Aggregation
- **Location:** `eggs-api/src/routes/plan.ts:465-693`.
- **Shape:** `allStores: StorePlan[]` is built sequentially — Kroger block (468–527), Walmart block (531–591), AI loop (615–683). Sliced to `maxStores` at line 690.
- **Per-store `subtotal`:** computed correctly per store as sum of that store's available items (`plan.ts:512` for Kroger, `plan.ts:575` for Walmart).
- **No cross-store best-value selection exists.** Every store that returned results is included as its own full cart.

### 1.5 Results Page Render
- **Component:** `eggs-frontend/src/components/PlanResult.tsx`.
- **Grouping:** by store (`plan.stores.map(...)` at line 151). Each `StorePlan` gets its own card. There is **no per-ingredient-across-stores view** — multi-store comparison is only implicit via parallel cards.
- **Hero total JSX (lines 134–138):**
  ```jsx
  <div className="text-4xl font-bold ...">${total.toFixed(2)}</div>
  <span>Total w/ Tax</span>
  <span>Subtotal: ${plan.summary.subtotal.toFixed(2)}</span>
  ```
  where `total = plan.summary.total` (line 104) — the bugged number.
- **Per-store subtotal** displayed in each card footer (lines 194–196).

### 1.6 Persistence
- **Client-side:** `eggs-frontend/src/services/storageService.ts:5-21`. `localStorage` key `eggs_shopping_history_v2`. Only raw items + `lastPurchased` timestamps; **no prices, no results.**
- **Server-side:** Supabase insert at `eggs-api/src/routes/plan.ts:769-782` into `shopping_plans`:

  | column | value |
  | --- | --- |
  | `id` | `crypto.randomUUID()` |
  | `event_id` | `body.eventId` (nullable) |
  | `user_id` | Clerk userId from JWT |
  | `plan_data` | full `ShoppingPlan` JSON (all stores, items, summary, meta) |
  | `model_used` | e.g. `"claude-haiku-4-5 + kroger_api + walmart_api + web_search"` |
  | `generated_at` | DB default `now()` |

  Schema: `eggs-api/src/db/schema.sql:60-67`. **No dedicated `total` column — the total is frozen inside the JSON blob.** This means old plans permanently carry the bugged total; there is no recompute-on-read path.

---

## 2. Store Search Adapters

**No shared `StoreAdapter` interface.** Kroger and Walmart happen to return structurally similar shapes, but it is a convention, not an enforced contract. The only cross-cutting named type is:

```ts
// eggs-api/src/types/index.ts:145-146
export type PriceSource = 'kroger_api' | 'walmart_api' | 'ai_estimated'
export type Confidence  = 'real' | 'estimated_with_source' | 'estimated'
```

### 2.1 Kroger — `eggs-api/src/integrations/kroger.ts`
- **API:** `searchProducts(query, locationId)`, `findNearbyLocations(lat, lng, radius)`, `getPriceForIngredient(name, locationIds)`.
- **Input:** ingredient **name string only** + location IDs. **No brand, quantity, or unit input.**
- **Output:** `{ sku, name, brand, regularPrice, promoPrice, productUrl, size, matchedLocationId }`. `size` is a raw string like `"32 oz"` — **not normalized**.
- **Matching:** `firstPriced()` picks the first product with `items[0].price.regular` set from top-10 results. Strip-and-retry cascade:
  1. Strip unit/packaging noise via `stripUnitNoise()` (removes `lb`, `oz`, `can`, `head`, `bunch`, leading digits; preserves `fresh`, `organic`, `whole`).
  2. Try stripped first, then raw name.
  3. Per-query per-location loop.
- **Error handling:** non-200 returns `[]`; full cascade exhaustion returns `null`.

### 2.2 Walmart — `eggs-api/src/integrations/walmart.ts`
- **API:** `searchProducts(query, zipCode?)`, `getItems(itemIds)` (unused), `findNearbyLocations(lat, lng)`, `getPriceForIngredient(name, zipCode?)`.
- **Input:** name string + optional zip. **No brand, quantity, or unit input.**
- **Output:** `{ sku, name, brand, regularPrice, promoPrice, productUrl, size }`. No `matchedLocationId` — Walmart pricing is national. `size` raw string, not normalized.
- **Matching:** single pass, no retry cascade. First priced of up to 5 results.
- **Auth:** RSA-SHA256 request signing on every call, no token caching.

### 2.3 AI / Non-API Stores — `eggs-api/src/routes/plan.ts:122-343`
- Inline async function, not a class.
- **Input:** full `IngredientLine[]`, user prefs (`avoid_stores`, `avoid_brands`, subscription tier), location, radius, `maxStores`, `excludeStores` (banners already covered by Kroger/Walmart).
- **Output:** `StorePlan[]` emitted via the `record_shopping_plan` tool call. Items carry `confidence: 'real' | 'estimated_with_source' | 'estimated'` and optional `proofUrl`.
- **Two-pass architecture:**
  1. Pass 1 (research): `web_search_20260209` + `web_fetch_20260209` tools. Plain-text output. 25 searches free / 100 pro.
  2. Pass 2 (format): only `record_shopping_plan` client tool offered with `tool_choice: { type: 'tool', name: 'record_shopping_plan' }` — forces structured output.
- **Fabricated-URL guard:** `proofUrl` is cross-referenced against pass-1 citations, then HEAD-validated via `validateUrls()`. Unvalidated URLs are stripped and confidence downgraded.
- **Caching:** `URL_CACHE` KV, 24h TTL, keyed `item:v1:{banner-slug}:{sha256(ingredient)}`.
- **Unit handling:** the AI's output `unit` is **passed through from the input `IngredientLine.unit`**, not derived from what the AI actually found. Package size matching is implicit/unverified for AI-sourced stores.

### 2.4 OpenFoodFacts — `eggs-api/src/integrations/openfoodfacts.ts`
- **Not part of the shopping plan flow.** Separate `/api/foodfacts` enrichment route.
- Returns nutrition and category data by barcode or name. No price, no URL.
- **Implication for re-arch:** this is a candidate hook point for unit-of-measure + brand metadata, but is currently unused by the plan path.

### 2.5 Cross-Cutting Gaps
1. No `StoreAdapter` interface — normalizing inputs/outputs per-provider requires either a common interface or explicit per-provider mappers.
2. **Unit of measure passes through raw everywhere.** No normalization layer between `IngredientLine.unit` and store-returned `size` strings. This is the largest blocker for price-per-unit comparison.
3. Strip-and-retry is Kroger-only. Walmart has no equivalent despite similar unit-noise pressure.
4. None of the direct-API adapters (Kroger, Walmart) accept a brand filter. If a user types "Tillamook cheese" today, we send "Tillamook cheese" as a query string — we don't lock brand in the result filter.

---

## 3. User Preferences — Avoid Brands (Exists!)

### 3.1 Schema
`eggs-api/src/db/schema.sql:3-20` — `users` table:
```sql
avoid_stores            text[]  default '{}'
avoid_brands            text[]  default '{}'
default_settings        jsonb   default '{}'
default_location_label  text
```
No migrations touch these columns — they're in the initial schema.

### 3.2 API
`eggs-api/src/routes/users.ts`:
- `GET /api/users/me` (line 27) returns the full `users` row.
- `PATCH /api/users/me` (line 43) whitelisted update; `avoid_brands` and `avoid_stores` both in the allowed list (lines 55–56).

### 3.3 UI
`eggs-frontend/src/pages/Settings.tsx:138-176` — "Preferences" section renders "Avoid Stores" and "Avoid Brands" as identical tag-input widgets. Loaded at line 38, saved via `updateMe` at line 54.

### 3.4 Consumption
- **AI search:** `avoid_brands` is injected into the AI search prompt in `searchNonApiStores` (confirmed in `eggs-api/src/routes/plan.ts:123`).
- **Kroger adapter:** NOT applied.
- **Walmart adapter:** NOT applied.
- **Best-value selector:** does not exist, so cannot apply.

**Implication for Phase 2 design:** the schema + API + UI are already shipped and stable. The work is (a) enforcing `avoid_brands` in a new best-value selector, and (b) ensuring user-typed brand locks override it with a warning.

---

## 4. The Totals Bug — Pinpointed

### 4.1 Root Cause
`eggs-api/src/routes/plan.ts:692-695`:
```ts
const allItems: StoreItem[] = finalStores.flatMap(s => s.items.filter(i => !i.notAvailable))
const subtotal = finalStores.reduce((s, st) => s + st.subtotal, 0)
const tax      = finalStores.reduce((s, st) => s + st.estimatedTax, 0)
const total    = Math.round((subtotal + tax) * 100) / 100
```

`finalStores` is the full ranked list of stores (up to `maxStores`). Each store's `subtotal` already represents its entire available item list. Summing them means: *"if you bought every item at every store simultaneously."* This is guaranteed to be a multiple of actual expected spend whenever multiple stores return coverage of the same items.

The correct computation is: for each ingredient, select the cheapest available price across stores (applying brand rules), sum those winners. That reduction does not exist anywhere.

### 4.2 Every Place `plan.summary.total` Is Read

| # | File | Line | Use |
|---|---|---|---|
| 1 | `eggs-frontend/src/components/PlanResult.tsx` | 104, 136 | Hero total on results page |
| 2 | `eggs-frontend/src/pages/Dashboard.tsx` | 138 | Per-card total in "Shopping Lists" history |
| 3 | `eggs-frontend/src/pages/Dashboard.tsx` | 356 | `totalTracked` stat chip — sums all historical totals |
| 4 | `eggs-frontend/src/pages/Dashboard.tsx` | 242 | `MonthlyActivityChart` — monthly spend bar |

The `SpendByStoreChart` (`Dashboard.tsx:175-188`) reads `store.subtotal` not `summary.total`, so it is not directly affected, but its aggregate inherits the same over-count when multiple stores cover the same item.

### 4.3 Historical Data Contamination
`shopping_plans.plan_data` is a `jsonb` blob written once at plan-save time (`plan.ts:769-782`). There is **no dedicated `total` column**, and no recompute-on-read path. Every plan saved before the fix will display the wrong total forever unless we migrate.

Two options for the backfill plan in Phase 3:
1. Recompute at read time (wrap consumers in a selector that reduces from `plan_data.stores` instead of reading `summary.total`). Keeps history pristine and self-correcting.
2. Run a one-time migration over `shopping_plans`, recomputing `plan_data.summary.*` in place. Simple for consumers but loses the original (bugged) snapshot.

Decision needed in Phase 2 design.

---

## 5. Shopping Plan History Schema

`eggs-api/src/db/schema.sql:60-67`:
```sql
create table if not exists shopping_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  user_id text not null references users(id) on delete cascade,
  plan_data jsonb not null,
  model_used text,
  generated_at timestamptz default now()
);
```

- **No total column.** Total is `plan_data->summary->total`.
- Retrieval: `eggs-api/src/routes/plans.ts:9-22` selects `id, generated_at, plan_data` for user's standalone plans (no `event_id`).
- Consumers described in §4.2.

---

## 6. Essential File Reference (for Phase 2 design)

### Backend
- `eggs-api/src/routes/plan.ts` — orchestration, aggregation, the totals bug (lines 692–695), Supabase write (769–782)
- `eggs-api/src/routes/clarify.ts` — current disambiguation LLM call + prompt
- `eggs-api/src/routes/users.ts` — prefs API
- `eggs-api/src/routes/plans.ts` — history read API
- `eggs-api/src/integrations/kroger.ts` — Kroger adapter
- `eggs-api/src/integrations/walmart.ts` — Walmart adapter
- `eggs-api/src/integrations/openfoodfacts.ts` — nutrition adapter (unused in plan flow)
- `eggs-api/src/providers/anthropic.ts` — LLM provider wrapper
- `eggs-api/src/db/schema.sql` — canonical schema
- `eggs-api/src/types/index.ts` — shared type contracts

### Frontend
- `eggs-frontend/src/pages/Plan.tsx` — standalone plan flow state machine
- `eggs-frontend/src/pages/EventShop.tsx` — event-based plan flow
- `eggs-frontend/src/pages/Settings.tsx` — prefs UI (Avoid Brands lives here)
- `eggs-frontend/src/pages/Dashboard.tsx` — all four downstream consumers of `summary.total`
- `eggs-frontend/src/components/ShoppingListInput.tsx` — naive client-side parse
- `eggs-frontend/src/components/ClarificationModal.tsx` — existing multiple-choice UI
- `eggs-frontend/src/components/PlanResult.tsx` — results rendering
- `eggs-frontend/src/lib/api.ts` — all fetch calls
- `eggs-frontend/src/services/storageService.ts` — localStorage raw-item history
- `eggs-frontend/src/types.ts` — mirror of shared types

---

## 7. Open Questions for Jonathan

These emerged from discovery and need your steer before Phase 2 design:

1. **Strengthen vs. rebuild the clarification loop?** The existing `/api/clarify` route + `ClarificationModal.tsx` are clean and well-structured. My default plan is to keep the route + UI shells and replace the prompt + spec-resolution logic with an ontology-backed resolver that emits your `Shoppable Item Specification`. Is that acceptable, or do you want a greenfield rebuild for separation?
2. **Kroger/Walmart brand filtering.** Neither adapter currently supports brand-filtered queries. `getPriceForIngredient` takes only a name string. Do we (a) pass brand as a query-string suffix (fragile), (b) filter post-hoc by comparing returned `brand` fields (requires a normalization map), or (c) extend the adapters with a structured `search({name, brand, unit})` signature? Option (c) is the cleanest, but it's adapter-level surgery.
3. **Historical totals migration.** Option 1 (recompute at read time) or Option 2 (one-time data migration)? See §4.2.
4. **AI-sourced unit reality.** The AI adapter currently emits `unit` from the input spec, not from what it actually found. For accurate price-per-unit, we need the AI to report the package size it priced. This requires extending the `record_shopping_plan` tool schema. Approve adding a `pricedSize: { quantity, unit }` field per item?
5. **Strip-and-retry on Walmart.** Kroger has a strip-and-retry cascade; Walmart doesn't. Should Phase 3 bring Walmart to parity, or does the ontology-driven query reduce the need?
6. **Results page layout.** Today the page is per-store cards. Your brief calls for "highlight the single best price-per-unit result across all searched stores" while keeping "every store's results grouped by item." That implies a per-item primary grouping with store cards underneath, or per-store cards with winner-chips threaded through. Which layout do you want in Phase 2 design?
7. **Persistence schema.** Proposal: add a `best_basket_total` numeric column on `shopping_plans` for fast aggregate queries; keep `plan_data` JSON for the full snapshot. Worth it, or stay JSON-only?

---

## 8. Not Found / Absent

- No ontology or food-knowledge integration today (FoodOn / FoodKG / USDA FDC / Open Food Facts is adapter-only for nutrition, not for resolution).
- No `StoreAdapter` interface.
- No unit normalization utilities anywhere in the repo.
- No best-value or cross-store reducer.
- No `avoid_brands` enforcement in Kroger or Walmart paths.
- No "winner highlight" UI state or styling primitive.
