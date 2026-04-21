# DESIGN.md — Shopping Plan Workflow Re-architecture

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement the milestone plan in Part IV task-by-task. Implementation steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect the segment between raw-item input and first store search so every user-typed line is resolved to a zero-ambiguity `ShoppableItemSpec` (via an ontology-backed LLM clarification loop) before any store is hit, enforce brand rules at best-value selection, fix the totals bug that sums all stores instead of winners, and display a consolidated best-basket results view with per-item swap.

**Architecture:** Layered hybrid — hand-curated GS1 GPC-seeded TS taxonomy (Layer A, bundled), USDA FoodData Central Branded Foods API for branded-SKU + UoM grounding (Layer B, remote + KV cache), Open Food Facts taxonomy graph for dietary/allergen/category enrichment (Layer C, remote + KV cache). Two-tool LLM clarification loop (`ask_clarification` + `finalize_item`) with retrieval-grounded options pre-searched conditionally against Kroger/Walmart when cache miss + ambiguity or missing unit. Best-value selector reduces multi-store results to one winner per item applying `avoid_brands` when brand is unlocked. Totals via `recompute-at-read` selector + new `best_basket_total` column. Recipe Page API ships as a "Shop this list on Instacart" click-through on the results page, the only no-approval IDP surface.

**Tech Stack:** TypeScript (eggs-api Hono on Cloudflare Workers, eggs-frontend React/Vite), Supabase Postgres, Cloudflare KV + R2, Anthropic SDK (`claude-haiku-4-5`), Vitest, Clerk.

---

# Part I — Architecture & Contracts

## 1. ShoppableItemSpec (was §2.1)

The canonical resolved-item shape every user line must reach before any store search fires.

```ts
// eggs-api/src/types/spec.ts

export type CanonicalUnit =
  | 'g' | 'kg'           // mass
  | 'ml' | 'l'           // volume metric
  | 'oz' | 'lb'          // mass US
  | 'fl_oz' | 'cup' | 'pt' | 'qt' | 'gal'   // volume US
  | 'each' | 'dozen'     // count
  | 'bunch' | 'head' | 'clove' | 'pinch'    // produce/culinary

export type ResolutionConfidence = 'high' | 'medium' | 'low'

export interface ShoppableItemSpec {
  id: string                         // stable across clarifications; matches IngredientLine.id
  sourceText: string                 // raw user input — never mutated

  displayName: string                // resolved human label ("whole milk")
  categoryPath: string[]             // ["beverages","milk","whole-milk"] — GS1 GPC seeded
  usdaFdcId?: number
  offCategoryTag?: string            // "en:whole-milks"
  upc?: string

  brand: string | null               // null = price-shop mode
  brandLocked: boolean               // true iff user explicitly typed a brand

  quantity: number
  unit: CanonicalUnit
  attributes?: Record<string, string>   // fat_content, preparation, cut

  resolutionTrace: Array<{
    question: string
    options: string[]
    answer: string
    turnNumber: number
  }>
  confidence: ResolutionConfidence
}
```

**Invariants** (enforced by validator):
- `brand === null` ⟺ `brandLocked === false`.
- `quantity > 0`.
- `unit` is in `CanonicalUnit`.
- `resolutionTrace.length <= 3` (hard turn cap).
- `confidence === 'low'` when a forced `finalize_item` was emitted after the turn cap.
- `categoryPath.length >= 1` — every spec is grounded to at least a top-level GPC category.

**Wire format** — the spec converts to an Instacart-compatible `LineItem` for any external integration (Recipe Page API uses it):

```ts
export interface InstacartLineItem {
  name: string                       // = displayName
  display_text?: string              // = sourceText
  upc?: string
  line_item_measurements: Array<{ quantity: number; unit: string }>
}
```

## 2. Disambiguation Flow (was §2.2)

The existing `/api/clarify` route and `ClarificationModal.tsx` stay. The *prompt* and *resolver* get upgraded.

### State machine (per item, run server-side)

```
parse(sourceText)                    # naive split → tentative spec with confidence
  ↓
cache.lookup(raw,normalized,embed)   # L1/L2/L3; short-circuit if hit
  ↓ miss
[conditional pre-search]             # only when:
                                     #   confidence==='low' OR unit missing
                                     # → hit Kroger/Walmart with raw text
                                     # → extract candidate attributes
  ↓
turn = 0
while confidence !== 'high' AND turn < 3:
  tool_choice = { type: 'any' }      # Claude picks ask_clarification or finalize_item
  if ask_clarification → render in ClarificationModal
  if finalize_item     → emit spec; break
  turn += 1

if turn === 3 AND not finalized:
  tool_choice = { type: 'tool', name: 'finalize_item' }   # forced
  finalize with confidence='low'

validate(spec); cache.write(key, spec); return spec
```

### Tool schemas (Anthropic `tool_use`)

```ts
const askClarification = {
  name: 'ask_clarification',
  description: 'Ask the user a focused multiple-choice question to disambiguate the item. Options MUST be drawn from retrieval candidates when provided.',
  input_schema: {
    type: 'object',
    required: ['itemId', 'question', 'options'],
    properties: {
      itemId: { type: 'string' },
      question: { type: 'string' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 5,
      },
      // Note: escape_hatch (boolean) was removed. Free-text escape is always
      // available at the UI modal layer; the prompt hint is unnecessary.
    },
  },
}

const finalizeItem = {
  name: 'finalize_item',
  description: 'Emit the finalized ShoppableItemSpec once the item is unambiguous.',
  input_schema: {
    type: 'object',
    required: ['id', 'displayName', 'categoryPath', 'brand', 'brandLocked',
               'quantity', 'unit', 'confidence'],
    properties: { /* mirrors ShoppableItemSpec */ },
  },
}
```

### Termination conditions
- `finalize_item` called by the model → success.
- Turn cap reached (3) → force `finalize_item` via `tool_choice: { type: 'tool', name: 'finalize_item' }` with a system nudge ("best guess; mark confidence low").
- Wall-clock cap: 20 seconds/item → hard fail, return `confidence: 'low'` spec derived from naive parse.

### Retrieval-grounded options

When the conditional pre-search fires:
1. Call `KrogerClient.searchProducts(rawText, firstLocationId)` + `WalmartClient.searchProducts(rawText, zipCode)` in parallel, 800 ms timeout each.
2. Collect `{ brand, size, name }` tuples from both result sets.
3. Compute *distinguishing attributes* — the dimensions where candidates differ most (brand, fat_content, cut, size).
4. Inject candidates into the clarifier prompt under a `<retrieval>` block with instruction: "draw options from this list; do not invent options that are not present."

Fallback: if pre-search returns 0 candidates, loop proceeds with LLM-invented options.

## 3. Brand Handling Rules (was §2.3)

Enforced at best-value selection (see Part I §5), using the `ShoppableItemSpec` and the user's `avoid_brands` list.

### Priority order

```
if spec.brandLocked === true:
  # User explicitly typed the brand. Lock wins unconditionally.
  # Filter store results to matching brand (normalized compare).
  # If locked brand is on user.avoid_brands: emit a warning on the
  # results-row, also write to resolutionTrace.
  # Do NOT substitute or exclude.
  winners = bestBy(priceperUnit, filter_by_brand(results, spec.brand))

else:
  # Price-shop mode. Exclude avoid_brands hits.
  eligible = filter_out_avoid_brands(results, user.avoid_brands)
  winners = bestBy(priceperUnit, eligible)
  # Fallback: if eligible === [] and results !== [], relax the avoid filter
  # and mark the winner with flag `avoided_fallback: true` on the row.
```

### Brand normalization

Store-returned brand strings vary ("Land O'Lakes" vs "Land O Lakes" vs "Land O&apos;Lakes"). A normalization pass applies before compare:
- Lowercase, NFD-normalize, strip punctuation, collapse whitespace.
- A small synonym map (~30 entries for common US grocery brands) resolves known variants. Seeded from OFF `brands_tags` synonyms for the US country filter.

### Warning surface

When a brand-locked item conflicts with `avoid_brands`:
- Inline: the winning result row displays a small warning icon with tooltip "You've set {brand} on your avoid list. Respecting your explicit choice." No block; no modal.
- Persisted: the `resolutionTrace` records the conflict.

## 4. Unit Normalization (was §2.4)

### Canonical unit enum

Defined in Part I §1. Mass, volume, count, culinary.

### Conversion table

All conversions funnel through SI base (grams for mass, millilitres for volume, units for count). The table lives in a pure TS module with no runtime dependencies.

```ts
// eggs-api/src/lib/units.ts

const TO_BASE: Record<CanonicalUnit, { base: 'g' | 'ml' | 'count'; factor: number }> = {
  g:      { base: 'g',     factor: 1 },
  kg:     { base: 'g',     factor: 1000 },
  oz:     { base: 'g',     factor: 28.3495 },
  lb:     { base: 'g',     factor: 453.592 },
  ml:     { base: 'ml',    factor: 1 },
  l:      { base: 'ml',    factor: 1000 },
  fl_oz:  { base: 'ml',    factor: 29.5735 },
  cup:    { base: 'ml',    factor: 236.588 },
  pt:     { base: 'ml',    factor: 473.176 },
  qt:     { base: 'ml',    factor: 946.353 },
  gal:    { base: 'ml',    factor: 3785.41 },
  each:   { base: 'count', factor: 1 },
  dozen:  { base: 'count', factor: 12 },
  bunch:  { base: 'count', factor: 1 },
  head:   { base: 'count', factor: 1 },
  clove:  { base: 'count', factor: 1 },
  pinch:  { base: 'count', factor: 1 },
}

export function convert(qty: number, from: CanonicalUnit, to: CanonicalUnit): number | null
export function toBase(qty: number, unit: CanonicalUnit): { qty: number; base: 'g' | 'ml' | 'count' }
export function pricePerBase(price: number, size: { qty: number; unit: CanonicalUnit }): { pricePerBase: number; base: 'g' | 'ml' | 'count' } | null
```

### Unconvertible-unit handling

When a store returns "each" but the user specified oz (mass base ≠ count base):
- If the item is in `KNOWN_COUNTABLES` (GPC-seeded map: eggs → 50 g, bananas → 118 g, apples → 180 g, lemons → 58 g, avocados → 200 g, ...), convert via `typical_each_weight_g` to bring the result into the user's base.
- Else: mark the row with `unitMismatch: true`, exclude from best-value selection, show it in that store's panel under a "Unit mismatch — not comparable" banner, and include a tooltip explaining the exclusion.

### Size parsing

Store-returned `size` strings ("32 oz", "1 lb 4 oz", "500 ml", "half gallon") are parsed by a regex-driven `parseSize` utility into `{ quantity: number; unit: CanonicalUnit }`. Failed parses yield `null` and disqualify the result from best-value with a `sizeUnparseable: true` flag.

## 5. Best-Value Selection and Totals (was §2.5)

### Algorithm

Pure function, deterministic, fully unit-testable.

```ts
// eggs-api/src/lib/bestValue.ts

export interface Candidate {
  storeName: string
  storeBanner: string
  item: StoreItem
  parsedSize: { quantity: number; unit: CanonicalUnit } | null
  pricePerBase: number | null        // null means excluded
  excludeReason?: 'unit_mismatch' | 'size_unparseable' | 'not_available' | 'avoid_brand' | 'brand_mismatch'
}

export interface WinnerResult {
  spec: ShoppableItemSpec
  winner: Candidate | null           // null = no eligible candidates
  eligibleCandidates: Candidate[]    // for the swap selector
  allCandidates: Candidate[]         // for the per-store panels
  warning?: 'avoid_brand_lock_conflict' | 'all_avoided_fallback'
}

export function selectWinner(
  spec: ShoppableItemSpec,
  storeResults: StorePlan[],
  user: UserProfile
): WinnerResult
```

### Tie-breaking

1. Lowest `pricePerBase` (rounded to 4 decimals).
2. Nearest store by `distanceMiles`.
3. Alphabetical by `storeName` (case-insensitive, trimmed).

### Total calculation — FIX

The current bug at `eggs-api/src/routes/plan.ts:692-695` is replaced:

```ts
// OLD (buggy)
const subtotal = finalStores.reduce((s, st) => s + st.subtotal, 0)

// NEW
const winners: WinnerResult[] = specs.map(s => selectWinner(s, finalStores, user))
const bestBasketSubtotal = winners
  .map(w => w.winner?.item.lineTotal ?? 0)
  .reduce((a, b) => a + b, 0)
const bestBasketTax = estimateTax(bestBasketSubtotal, user)
const bestBasketTotal = round2(bestBasketSubtotal + bestBasketTax)
```

The per-store `StorePlan.subtotal` stays (still shown in the per-store panels, still correct as "what that one store would cost"). The *plan-level* summary becomes the best-basket sum.

### Historical totals — `recompute-at-read`

`shopping_plans.plan_data` JSON keeps the raw store results (they're still accurate at the per-store level — the bug was only in the summary). A new server-side selector recomputes `best_basket_total` on read for legacy plans:

```ts
function computeBestBasketTotal(plan: ShoppingPlan, user: UserProfile): number {
  const specs = extractSpecsFromPlan(plan)     // from plan_data.meta.specs when present
  return sumWinners(specs, plan.stores, user)
}
```

For new plans (post-migration) the correct value is cached into the new `best_basket_total numeric` column at write time for O(1) dashboard aggregates.

## 6. Substitution Engine Hook (was §2.6)

Not built in Phase 3. Plug point, confirmed viable with the recommended stack:

```ts
// Future, not implemented:
function suggestSubstitutes(
  spec: ShoppableItemSpec,
  notAvailableAt: StorePlan,
  user: UserProfile,
): Array<{ alt: ShoppableItemSpec; reason: string; score: number }>
```

Signal sources available:
- **OFF categories_tags** — sibling concepts under the same parent in the taxonomy graph.
- **OFF labels_tags** — dietary compatibility filters (user has `is_vegan: true` → exclude non-vegan substitutes).
- **USDA FDC nutrients** — per-100g nutrient vectors → cosine similarity for nutrition-aware substitution.
- **GS1 GPC tree** — is-a walk up to common ancestor for generic-category fallback.

Hook point: the result of `selectWinner` for each spec is passed through an optional substitution pass that may return a ranked list of alternatives rendered as a secondary row under the winner.

---

# Part II — Data Model Changes

## 2.1 Supabase schema additions

```sql
-- 002_best_basket_total.sql
alter table shopping_plans
  add column best_basket_total numeric(10, 2);

-- Backfill null-safe: null means "legacy plan, read via selector".
-- New inserts populate at write time.
```

## 2.2 KV namespaces (Cloudflare)

Existing: `URL_CACHE`. Add:

- `SPEC_CACHE` — resolved `ShoppableItemSpec` keyed by `spec:v1:{modelId}:{ontologyVer}:sha256(normalized)`. TTL 30d.
- `ONTOLOGY_CACHE` — OFF taxonomy graph responses keyed by `off:v1:{tag}`. TTL 7d.
- `FDC_CACHE` — USDA FDC Branded responses keyed by `fdc:v1:{upc_or_query}`. TTL 7d.

Wrangler config update needed; see Milestone 3.

## 2.3 Vectorize (for L3 semantic cache)

New Cloudflare Vectorize index `spec-embeddings` (768-dim, cosine). Stored key: same as SPEC_CACHE; vector: embedding of normalized sourceText. Threshold: 0.92 cosine.

Vectorize is a paid feature at scale. MVP plan: implement the abstraction but gate the L3 layer behind a feature flag; ship L1+L2 only initially.

## 2.4 User preferences — no schema change needed

`avoid_brands text[]` already exists on `users`. The `typical_each_weight_g` countable map (for unit conversion fallback) lives in a bundled JSON module, not the DB.

---

# Part III — Recipe Page API Integration

Single-endpoint, no-approval Instacart integration. Rendered as a secondary action on the results page.

### Endpoint

`POST https://connect.instacart.com/idp/v1/products/recipe`

### Input

```ts
{
  title: "E.G.G.S. Shopping List — 2026-04-21",
  image_url: null,
  link_type: "recipe",
  instructions: [],
  ingredients: ShoppableItemSpec[] → InstacartLineItem[],
  landing_page_configuration: {
    partner_linkback_url: "https://eggs.app/plan/{planId}",
    enable_pantry_items: false,
  },
}
```

### Output

Returns `{ products_link_url: string }` — a shoppable URL we surface as a button.

### UX placement

Top of `PlanResult.tsx`, next to the hero total:

```
┌─ Best Basket Total ──────────────────────┐
│  $42.17  ←—— (updates on swap)            │
│  [Shop entire list on Instacart 🔗]       │  ← Recipe Page API button
└──────────────────────────────────────────┘
```

### Auth

Requires an **API key** from an Instacart Developer account — self-serve at `developers.instacart.com`, no approval needed for the Recipe Page endpoint. Key lives in `INSTACART_IDP_API_KEY` Worker secret.

### Failure handling

If the call fails (429, 5xx, missing key), the button is hidden. No errors bubble to the user. Silent degrade.

---

# Part IV — Implementation Plan (milestones)

Each milestone produces testable output and lands with a commit + brief demo note. Milestones are ordered by dependency. Testing strategy: unit tests for every stable business-logic change (per the brief's MVP testing split); Playwright is manual-only, kept out of CI.

## Milestone 1 — Foundations: unit normalization + avoid-brand normalizer + GS1 GPC seed

**Files:**
- Create: `eggs-api/src/lib/units.ts`
- Create: `eggs-api/src/lib/units.test.ts`
- Create: `eggs-api/src/lib/brands.ts`
- Create: `eggs-api/src/lib/brands.test.ts`
- Create: `eggs-api/src/data/gpcSeed.ts` (~150 hand-curated categories)
- Create: `eggs-api/src/data/gpcSeed.test.ts`
- Create: `eggs-api/src/data/countables.ts` (~30 entries: egg, banana, apple, lemon, avocado, ...)
- Modify: `eggs-api/src/types/index.ts` — add `CanonicalUnit` enum

**Tasks:**

- [ ] Write failing tests for `convert()` covering: mass↔mass (oz ↔ g ↔ lb), volume↔volume (fl_oz ↔ ml ↔ gal), count↔count (each ↔ dozen), and the 3 unconvertible-base pairs (mass↔volume, mass↔count, volume↔count all return `null`). Target: 16 test cases.
- [ ] Implement `convert()`, `toBase()`, `pricePerBase()`, `parseSize()`. Confirm all tests pass.
- [ ] Write failing tests for `normalizeBrand()` — lowercasing, punctuation strip, apostrophe variants ("Land O'Lakes" vs "Land O Lakes"), synonym map.
- [ ] Implement `normalizeBrand()` + seed synonym map from OFF `brands_tags` US subset.
- [ ] Draft `gpcSeed.ts` — have Claude generate the initial ~150-entry JSON tree from the GS1 GPC public browser (see §IV-1a below); review for accuracy; commit.
- [ ] Draft `countables.ts` — 30 common produce/pantry countables with `typical_each_weight_g`. Small, deterministic, no source API needed.
- [ ] Commit: `feat: canonical units, brand normalizer, GPC/countables seed`

**Verification:** `cd eggs-api && pnpm test lib/units lib/brands data/gpcSeed` — all green.

### §IV-1a — GPC seed curation procedure
Per Jonathan's approval: Claude drafts from the GS1 GPC public browser (https://gpc-browser.gs1.org/), Jonathan reviews and corrects. Draft covers top-level segment → family → class → brick for: Beverages, Dairy, Meat/Poultry/Seafood, Produce, Bread/Bakery, Dry Goods, Frozen, Canned/Jarred, Condiments/Sauces, Snacks, Baking, Pet Food, Household/Personal Care (light). Target: 150–200 leaf bricks, each with `{ id, label, parent, synonyms[] }`.

## Milestone 2 — ShoppableItemSpec type + validators

**Files:**
- Create: `eggs-api/src/types/spec.ts`
- Create: `eggs-api/src/types/spec.test.ts`
- Modify: `eggs-api/src/types/index.ts` — re-export from `spec.ts`

**Tasks:**

- [ ] Write failing tests for `ShoppableItemSpec` invariants: `brand===null ⇔ brandLocked===false`; `quantity>0`; `unit ∈ CanonicalUnit`; `resolutionTrace.length<=3`; `categoryPath.length>=1`. Target: 12 tests covering happy paths + each invariant violated.
- [ ] Implement `validateSpec(x: unknown): ShoppableItemSpec` using a lightweight `zod` schema (add as dep to eggs-api if not present; confirm edge-compat).
- [ ] Implement `toInstacartLineItem(spec: ShoppableItemSpec): InstacartLineItem`.
- [ ] Commit: `feat: ShoppableItemSpec type + validators + Instacart wire format`

**Verification:** `pnpm test types/spec` — all green.

## Milestone 3 — KV cache wrappers + USDA FDC adapter + OFF taxonomy adapter

**Files:**
- Create: `eggs-api/src/lib/cacheKV.ts` (generic typed KV-cache wrapper)
- Create: `eggs-api/src/lib/cacheKV.test.ts`
- Create: `eggs-api/src/integrations/usda-fdc.ts`
- Create: `eggs-api/src/integrations/usda-fdc.test.ts`
- Create: `eggs-api/src/integrations/off-taxonomy.ts`
- Create: `eggs-api/src/integrations/off-taxonomy.test.ts`
- Modify: `eggs-api/wrangler.toml` — add `FDC_CACHE`, `ONTOLOGY_CACHE`, `SPEC_CACHE` KV bindings
- Modify: `eggs-api/src/index.ts` (env types)

**Tasks:**

- [ ] Write failing tests for `cacheKV<T>({ ns, ttl, keyFn })`: fresh miss calls loader, subsequent call hits cache, TTL expiry triggers re-fetch, loader failure doesn't poison cache.
- [ ] Implement `cacheKV` with MiniflareKV-compatible interface for tests; production uses `env.FDC_CACHE` etc.
- [ ] Write failing tests for `UsdaFdcClient.searchBrandedByName(name)` and `UsdaFdcClient.getByFdcId(fdcId)` — mock responses from the published FDC schema; assert UoM parsing + KV-caching.
- [ ] Implement `UsdaFdcClient` using `FDC_API_KEY` env secret, 1000-req/hr rate-limit back-off helper, 7d KV TTL.
- [ ] Write failing tests for `OffTaxonomyClient.getParents(tag)`, `getChildren(tag)`, `getSynonyms(tag)`, `searchByText(term, country='united-states')`.
- [ ] Implement `OffTaxonomyClient` against `world.openfoodfacts.org/api/v2/*` with `countries_tags_en=united-states` filter; KV cache.
- [ ] Add new KV bindings to `wrangler.toml`, create the namespaces via `wrangler kv:namespace create <name>`.
- [ ] Commit: `feat: cache wrapper + USDA FDC + OFF taxonomy adapters`

**Verification:** `pnpm test lib/cacheKV integrations/usda-fdc integrations/off-taxonomy` all green. One live smoke test against the real endpoints with a disposable key, before committing.

## Milestone 4 — StoreAdapter interface + Kroger/Walmart structured search refactor

**Files:**
- Create: `eggs-api/src/integrations/StoreAdapter.ts` (interface)
- Modify: `eggs-api/src/integrations/kroger.ts` — extend `getPriceForIngredient` to accept `{ name, brand, unit }`; structured filter
- Modify: `eggs-api/src/integrations/walmart.ts` — same signature change; add Kroger-style strip-and-retry cascade
- Create: `eggs-api/src/integrations/kroger.test.ts` — new brand/unit filter paths
- Create: `eggs-api/src/integrations/walmart.test.ts` — cascade + filter paths
- Modify: `eggs-api/src/routes/plan.ts` — callers of `getPriceForIngredient` pass `{ name, brand, unit }` from the spec

**Tasks:**

- [ ] Define `StoreAdapter` interface in a new file:
  ```ts
  export interface StoreSearchInput { name: string; brand?: string; unit?: CanonicalUnit; locationIds?: string[]; zipCode?: string }
  export interface StoreSearchResult { sku: string; name: string; brand: string; regularPrice: number; promoPrice: number | null; productUrl: string; size: string; matchedLocationId?: string }
  export interface StoreAdapter { search(input: StoreSearchInput): Promise<StoreSearchResult | null> }
  ```
- [ ] Write failing tests for `KrogerClient.search({ name, brand, unit })`: brand present → filter results by `normalizeBrand(result.brand) === normalizeBrand(input.brand)`; unit present → prefer results whose parsed `size.unit` matches.
- [ ] Refactor `KrogerClient` to implement `StoreAdapter`; keep legacy `getPriceForIngredient(name, locations)` as a thin backward-compatible shim during migration.
- [ ] Write failing tests for `WalmartClient.search(...)` — same brand/unit filtering + strip-and-retry cascade (stripped query first, raw fallback).
- [ ] Port Kroger's `stripUnitNoise` + cascade into Walmart; implement `search` signature.
- [ ] Update `routes/plan.ts` call sites to pass the spec's `brand` + `unit`.
- [ ] Commit: `feat: StoreAdapter interface, structured brand/unit filtering, Walmart strip-and-retry parity`

**Verification:** full `pnpm test integrations/` suite green; a live smoke test against real Kroger + Walmart APIs for "2% milk" and "Fairlife whole milk" (brand-locked) to confirm filtering.

## Milestone 5 — AI adapter `pricedSize` extension

**Files:**
- Modify: `eggs-api/src/routes/plan.ts` — `searchNonApiStores`'s `record_shopping_plan` tool schema
- Modify: the `StoreItem` type to carry optional `pricedSize: { quantity: number; unit: CanonicalUnit } | null`
- Modify: the fabricated-URL post-processing to also validate `pricedSize` is present for `confidence: 'real'`
- Create: `eggs-api/src/routes/plan.ai.test.ts` — golden tests for the new tool schema

**Tasks:**

- [ ] Update `record_shopping_plan` tool schema to require `items[].pricedSize` when `confidence !== 'estimated'`.
- [ ] Write failing test that parses a realistic fake `tool_use` response and asserts `pricedSize` ends up on each `StoreItem`.
- [ ] Implement the schema extension + downstream wiring.
- [ ] Write failing test for the fabricated-URL post-processor: items without `pricedSize` on `confidence:'real'` get downgraded to `confidence:'estimated'`.
- [ ] Implement the downgrade path.
- [ ] Commit: `feat: AI adapter emits pricedSize for accurate price-per-unit comparison`

**Verification:** `pnpm test routes/plan.ai` green; one live call to confirm the model actually populates the field.

## Milestone 6 — Disambiguation loop v2 (two-tool pattern + retrieval-grounded options + three-layer cache)

**Files:**
- Modify: `eggs-api/src/routes/clarify.ts` — replace existing prompt + JSON-mode call with a two-tool conversation loop
- Create: `eggs-api/src/lib/resolver.ts` — the loop itself, callable from `clarify.ts` and from `plan.ts` for pre-resolution
- Create: `eggs-api/src/lib/resolver.test.ts` — loop termination, turn cap, forced finalize, retrieval grounding
- Create: `eggs-api/src/lib/specCache.ts` — L1/L2/(L3 flagged-off) cache wrapper
- Create: `eggs-api/src/lib/specCache.test.ts`
- Modify: `eggs-frontend/src/components/ClarificationModal.tsx` — preserve API but accept `retrievalCandidates` for display in the modal (optional)

**Tasks:**

- [ ] Write failing tests for `specCache.lookup(raw) / .write(key, spec)` — L1 hit, L1 miss + L2 hit (after normalization), L2 miss + miss response path.
- [ ] Implement `specCache` with `SPEC_CACHE` KV namespace + versioned key (`spec:v1:{model}:{ontology_ver}:sha256(normalized)`).
- [ ] Write failing tests for `resolveItem(raw, user, env)`:
  - cache hit → skip all LLM calls
  - cache miss + high-confidence parse → skip pre-search, single-turn finalize
  - cache miss + low-confidence OR missing unit → pre-search fires, retrieval injected
  - turn 3 hits → forced finalize with `confidence:'low'`
  - wall-clock exceed → naive-parse fallback
- [ ] Implement `resolveItem` using the two-tool Claude call pattern.
- [ ] Replace the current `/api/clarify` JSON-mode call with a call to `resolveItem` per ingredient in `ingredients[]`; return any `ask_clarification` outputs to the frontend as before (modal UX unchanged).
- [ ] Commit: `feat: disambiguation v2 — two-tool, retrieval-grounded, three-layer cache`

**Verification:** `pnpm test lib/resolver lib/specCache routes/clarify` green; manual Playwright walk (see §V.1) to confirm modal still renders questions.

## Milestone 7 — Best-value selector

**Files:**
- Create: `eggs-api/src/lib/bestValue.ts`
- Create: `eggs-api/src/lib/bestValue.test.ts`

**Tasks:**

- [ ] Write failing tests for `selectWinner(spec, stores, user)`:
  - brand-locked + brand hit in store A → winner is A
  - brand-locked + no brand hit anywhere → winner null, `eligibleCandidates` empty
  - brand-locked conflict with `avoid_brands` → winner is brand match, `warning: 'avoid_brand_lock_conflict'`
  - brand-unlocked + avoid_brands excludes best-price → winner is next-best; if all excluded, fallback with `warning: 'all_avoided_fallback'`
  - tie on `pricePerBase` → nearest store wins
  - tie on `pricePerBase` + same distance → alphabetical store name wins
  - unit mismatch (countable known) → converted via `typical_each_weight_g`
  - unit mismatch (not countable) → excluded with `excludeReason: 'unit_mismatch'`
  - **The §2.5 three-item-four-store acceptance test**: 3 items × 4 stores = 12 results; winners are specific 3; total equals sum of those 3 exactly; regression-guard against the old summing bug.
- [ ] Implement `selectWinner` as a pure function.
- [ ] Commit: `feat: best-value selector + brand rules + three-item-four-store acceptance test`

**Verification:** `pnpm test lib/bestValue` all green.

## Milestone 8 — Totals correction: selector + `best_basket_total` column + write path

**Files:**
- Create: `eggs-api/src/db/migrations/002_best_basket_total.sql`
- Modify: `eggs-api/src/routes/plan.ts` lines 692–695 — replace the buggy sum with `selectWinner`-driven total; persist `best_basket_total` on insert
- Create: `eggs-api/src/lib/planTotals.ts` — `computeBestBasketTotal(plan, user)` selector for legacy reads
- Create: `eggs-api/src/lib/planTotals.test.ts`
- Modify: `eggs-api/src/routes/plans.ts` — on read, if `best_basket_total` is null, compute via selector and return alongside

**Tasks:**

- [ ] Write the migration SQL: `alter table shopping_plans add column best_basket_total numeric(10,2)`.
- [ ] Write failing tests for `computeBestBasketTotal(plan, user)` on a plan JSON with the old `summary.total` still present — asserts the recomputed total != the legacy total in the three-item-four-store fixture.
- [ ] Implement `computeBestBasketTotal`.
- [ ] Edit `plan.ts:692-695` to sum winners; persist `best_basket_total` in the insert.
- [ ] Edit `plans.ts` read path to lazily compute for legacy rows.
- [ ] Run the migration via `supabase migration up`.
- [ ] Commit: `fix: correct plan total to sum of best-value winners, add best_basket_total column`

**Verification:** `pnpm test lib/planTotals` + end-to-end smoke with a real 3-item plan, confirm Dashboard numbers shift as expected.

## Milestone 9 — Results page UI v2 (consolidated best-basket + swap selector + per-store panels)

**Files:**
- Modify: `eggs-frontend/src/components/PlanResult.tsx` — new primary view
- Create: `eggs-frontend/src/components/BestBasketList.tsx` — one row per item, winner displayed
- Create: `eggs-frontend/src/components/ItemSwapSelector.tsx` — modal/drawer showing `eligibleCandidates` for an item
- Create: `eggs-frontend/src/components/PerStorePanels.tsx` — tabbed/collapsible per-store views (existing grouping)
- Modify: `eggs-frontend/src/types.ts` — add `WinnerResult` mirror, plan-level `winners` field
- Modify: `eggs-api/src/types/index.ts` — add `winners: WinnerResult[]` to `ShoppingPlan`
- Modify: `eggs-api/src/routes/plan.ts` — compute and persist `winners` alongside `stores`

**Tasks:**

- [ ] Update `ShoppingPlan` shared type to include `winners: WinnerResult[]`.
- [ ] Update server-side plan builder to attach winners to the plan before save.
- [ ] Build `BestBasketList` component: one row per winner, shows store + brand + price + product image, "swap" icon opens `ItemSwapSelector`.
- [ ] Build `ItemSwapSelector`: renders `eligibleCandidates` list; click-to-swap updates the local UI winner; displayed total updates via a local React state reducer.
- [ ] Build `PerStorePanels`: migrate existing per-store card grouping into a collapsible section below the best-basket list.
- [ ] Wire inline avoid-brand warning icon with tooltip where applicable.
- [ ] `pnpm dev` in `eggs-frontend`, manually walk the golden path + one swap + one avoid-brand warning case; screenshot.
- [ ] Commit: `feat: best-basket primary view + swap selector + per-store panels`

**Verification:** manual browser verification is the gating test per the brief's testing strategy. Playwright is not used in CI here.

## Milestone 10 — Dashboard consumer migration to the new total

**Files:**
- Modify: `eggs-frontend/src/pages/Dashboard.tsx` lines 138, 242, 356 — replace reads of `plan.plan_data.summary.total` with a `getPlanTotal(plan)` helper that prefers `best_basket_total` and falls back to client-side recompute for legacy rows
- Create: `eggs-frontend/src/lib/planTotals.ts` — mirror of the server selector for client-side fallback
- Create: `eggs-frontend/src/lib/planTotals.test.ts`

**Tasks:**

- [ ] Write failing tests for `getPlanTotal(plan)`: new-plan uses column, legacy-plan recomputes.
- [ ] Implement `getPlanTotal` on the frontend.
- [ ] Replace all three Dashboard usages (PlanCard total, `totalTracked` stat, MonthlyActivityChart spend).
- [ ] Commit: `fix: Dashboard widgets read corrected best-basket total with legacy fallback`

**Verification:** manual Dashboard walk — verify Est. Tracked and Monthly chart update; `pnpm test frontend-src/lib/planTotals` green.

## Milestone 11 — Recipe Page API "Shop this list on Instacart" button

**Files:**
- Create: `eggs-api/src/integrations/instacart-idp.ts`
- Create: `eggs-api/src/integrations/instacart-idp.test.ts`
- Modify: `eggs-api/src/routes/plan.ts` — after winners computed, call IDP Recipe Page API, attach `instacartUrl` to plan response
- Modify: `eggs-api/src/types/index.ts` — add `instacartUrl?: string` to `ShoppingPlan`
- Modify: `eggs-frontend/src/components/PlanResult.tsx` — add button next to hero total when `plan.instacartUrl` is present

**Tasks:**

- [ ] Obtain Instacart IDP API key from self-serve `developers.instacart.com`; add to Cloudflare secrets as `INSTACART_IDP_API_KEY`.
- [ ] Write failing tests for `IdpClient.createShoppingListPage(specs, title, linkbackUrl)` with a mocked response.
- [ ] Implement `IdpClient` against `POST https://connect.instacart.com/idp/v1/products/recipe`.
- [ ] Wire into `plan.ts` — fire-and-forget (Promise.allSettled with the other searches); attach URL if succeeded; silent fail otherwise.
- [ ] Add button UI with Instacart branding per Instacart brand guidelines.
- [ ] Commit: `feat: Instacart Recipe Page API — shop entire list button on results`

**Verification:** manual e2e — create a plan with 5 items, click the button, verify it opens a populated Instacart cart page.

---

# Part V — Testing Strategy

Per the brief's MVP split.

### Required unit tests (CI-gated)
Each milestone lists them. Aggregated:
- Unit conversion round-trips + unconvertible pairs (M1)
- Brand normalization + synonyms (M1)
- `ShoppableItemSpec` invariants (M2)
- KV cache wrapper behavior (M3)
- USDA FDC + OFF adapter request/response (M3)
- Kroger + Walmart structured search + strip-and-retry (M4)
- AI adapter pricedSize schema + downgrade (M5)
- Disambiguation loop termination + turn cap + forced finalize + retrieval grounding (M6)
- Best-value selector — all brand/avoid-list branches + **three-item-four-store acceptance test** (M7)
- `computeBestBasketTotal` selector including legacy recomputation (M8, M10)
- Instacart Recipe Page API client (M11)

### Deferred (no Playwright CI)
- Disambiguation UX wording, clarification question count, modal click sequences.
- Snapshot-style assertions on results page rendering.

### Permitted ad-hoc Playwright
`scripts/manual-verification/` folder, labeled non-CI. Used during M6, M9, M11 for visual verification. These are exploratory, not assertion-based.

---

# Part VI — Rollout & Risks

## Sequencing
M1 → M2 → (M3, M4 in parallel) → M5 → M6 → M7 → M8 → M9 → M10 → M11.

## Feature flag
Entire new path gates behind a server-side `SHOPPING_V2` env flag until M9 completes. `plan.ts` branches on `env.SHOPPING_V2 === 'true'` between the legacy pipeline and the new one. Toggle off in prod until QA passes, toggle on progressively.

## Biggest risks
1. **USDA FDC rate limit (1000 req/hr IP-level)** — cached aggressively (7d KV); MVP traffic is well under. Mitigation: add a 429 back-off that falls through to OFF-only enrichment.
2. **Embedding/Vectorize cost for L3 cache** — gated behind a feature flag in M6; ship L1+L2 first.
3. **IDP Recipe Page API schema change** — Instacart versioned endpoint (`/idp/v1/`), acceptable risk for MVP. Silent-fail path means no outages if the endpoint changes.
4. **GPC seed drift from retail reality** — accepted MVP limitation; flagged for a v2 review cycle.
5. **Kroger/Walmart brand-filter false negatives** — if a store returns `brand: ''` for a brand we locked to, the filter excludes it. Mitigation: on empty-brand result, fall back to a name-contains brand match before excluding.

## Data integrity
Legacy `shopping_plans` rows keep their original `plan_data`. Totals are recomputed on read via the selector. No destructive migration. New rows carry `best_basket_total` in the column for O(1) aggregates.

---

# Part VII — Open Questions (resolved per Jonathan's steers)

1. Clarification loop: **strengthen** — keep route and modal shells, replace prompt + resolver.
2. Kroger/Walmart brand filter: **option (c) — structured `search({ name, brand, unit })`.**
3. Historical totals: **recompute-at-read via selector.**
4. AI adapter pricedSize: **approved.**
5. Walmart strip-and-retry parity: **yes, in M4.**
6. Results page layout: **hybrid** — primary consolidated best-basket list + per-item swap + per-store panels in same area.
7. Persistence schema: **add `best_basket_total` column.**
8. GPC seed: **Claude drafts, Jonathan reviews.**
9. Pre-search conditionality: **conditional — only on cache miss + low confidence OR missing unit.**
10. Unconvertible units: **countable conversion via `typical_each_weight_g` map; else exclude with flag.**
11. Brand-lock + avoid-list conflict: **inline warning icon + resolutionTrace log; respect user's choice.**
12. OFF tag versioning: **version the `ontology_ver` segment of cache keys; bump invalidates.**
13. AI `pricedSize` fallback: **include with `confidence:'estimated'` marker; user sees it competing with a visual flag.**
14. Price-per-unit tie-break: **nearest store, then alphabetical.**
15. IDP Recipe Page API: **rolled into M11, self-serve key, silent-fail on error.**

## Remaining open questions for DESIGN review
None load-bearing. Surface any before M1 starts if you see a design choice you disagree with.

---

# Self-review checklist (per writing-plans skill)

- [x] Every spec section (§2.1 – §2.6) maps to at least one milestone (§M1 covers 2.4; M2 covers 2.1; M4+M5 cover 2.1/2.3 adapter layer; M6 covers 2.2; M7 covers 2.3+2.5; M8 fixes 2.5's totals bug; M9+M10 render 2.5).
- [x] No "TBD", "implement later", or vague-handling placeholders.
- [x] Type consistency: `CanonicalUnit`, `ShoppableItemSpec`, `StoreAdapter`, `WinnerResult`, `Candidate`, `InstacartLineItem` used identically across all milestones.
- [x] Exact file paths everywhere.
- [x] Testing strategy split per brief.
- [x] Legacy data integrity preserved (recompute-at-read).
- [x] Zero-cost architecture respected (KV + Vectorize-later + self-serve IDP key; no paid third-party API except USDA FDC which is free at 1000/hr).
