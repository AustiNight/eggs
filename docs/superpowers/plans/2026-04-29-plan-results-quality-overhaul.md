# Plan Results Page Quality Overhaul

## Status: DRAFT — pending user approval (post-Option-A direction)

## Context

Workers Paid is now active and `/api/price-plan` returns 200. But prod testing on 2026-04-26 surfaced six distinct quality defects, four of them trust-breaking:

- "whole kiwi" → "Stonyfield Yogurt" winning (catastrophic wrong product).
- "Red Seedless Grapes" → "Fresh Seeded Red Grapes" (opposite spec accepted).
- Line totals 2× / 12× the per-unit price (math/UI quantity disagreement).
- Narrative claims "100% confirmed" while 4 of 8 items are unmatched.
- Common items (eggs, milk, mayo, turkey) returning "No match found" even though Kroger returned valid products for 3 of them — silently dropped at `bestValue.ts:228` due to `parseSize` returning null or unit-dimension mismatch.
- Swap UI lists the chosen winner as the only "alternative."

Per the 2026-04-29 conversation, the user has settled on **Option A** for line-total math (user-quantity-driven) AND raised the bar for the entire matching pipeline. The new product spec:

- **Smart matching, not first-hit.** Search store with the user's exact term; if no priced results, fall back to broader terms via the Open Food Facts ontology (parent categories) and/or USDA FDC. The LLM grades each candidate against user intent before selection.
- **No silent drops.** When Kroger returns "Family Size" or any unparseable size string, resolve the actual package weight via USDA FDC → Open Food Facts → LLM `web_fetch` on the product page. Don't accept "we can't parse this" as an answer; LLMs have web search and 99.99% of grocery products are documented online.
- **Display three units of truth.** UI shows: (1) number of units to buy, (2) actual product weight, (3) price per gram. The user can compare apples to apples regardless of how stores brand or package.
- **Substitutions are first-class.** When the closest match is a substitution (e.g., "1 lb steel cut oats" → "Quaker Oats 1.25 lb cylinder"), display category + reason ("excellent substitution: same product class, slightly more than asked, different brand"). Don't pretend it's an exact match.
- **Bias toward refusing obstacles.** If a step is hard, do the work; don't silently downgrade.

Subrequest budget is no longer a constraint (10,000/invocation on Paid). Latency, however, matters — this plan parallelizes aggressively and caches in `URL_CACHE` / `SPEC_CACHE`.

---

## Existing infrastructure we can leverage (already in repo, unwired)

- `eggs-api/src/integrations/usda-fdc.ts` — USDA FDC Branded Foods client; tests pass; **not imported by any route/lib**.
- `eggs-api/src/integrations/off-taxonomy.ts` — Open Food Facts taxonomy client; tests pass; **not imported by any route/lib**.
- `eggs-api/src/integrations/openfoodfacts.ts` — Open Food Facts product lookup client.
- `FDC_CACHE` (7d TTL), `ONTOLOGY_CACHE` (7d TTL), `SPEC_CACHE` (30d TTL) KV namespaces — already provisioned in `wrangler.toml`.
- Anthropic provider with `web_search` + `web_fetch` server-tools wired in `eggs-api/src/providers/anthropic.ts` — already used for AI store search.
- `URL_CACHE` (24h TTL) — already used for resolved StoreItems.

Wiring these in is mostly net-additive code, not architectural surgery.

---

## Phased delivery

The work is too big for one PR. Three phases, each independently shippable:

### Phase 1 — Stop the bleeding (small, immediate)
Tier-1 trust fixes that don't require the new pipeline.

1. **Personalized + occasionally humorous narrative** (Task 1)
2. **Drop winner from `eligibleCandidates`** (Task 2)
3. **`stripUnitNoise` doesn't over-strip + new noise words** (Task 3)
4. **`bestValue.ts` no longer silently drops `size_unparseable` candidates — fallback rank by unit price alone** (Task 4 — interim, replaced by Phase 2's smarter resolution)

### Phase 2 — Smart matching pipeline (the real fix)
The architecture the user described: spec → multi-tier search → LLM grading → unit-aware selection.

5. **Universal size resolver: FDC → OFF → LLM web_fetch fallback** (Task 5)
6. **OFF-ontology search fallback when exact term has no priced results** (Task 6)
7. **LLM candidate grader (alignment + substitution scoring)** (Task 7)
8. **`selectWinner` rewrite: never drop on parseSize; rank by alignment × per-gram price** (Task 8)
9. **Quantity math reconciliation: lineTotal = unitPrice × ceil(qtyConverted / pricedSize.qty)** (Task 9 — Option A)

### Phase 3 — Surface the truth in the UI
10. **BestBasketList: display units + weight + per-gram + substitution badge** (Task 10)
11. **Plan response diagnostics block** (Task 11)

Phases ship as independent commits; nothing in Phase 2 depends on Phase 3 being done first.

---

## Cross-cutting concerns

**Caching strategy.** Every external lookup gets cached:

| Lookup | Cache | TTL | Key |
|---|---|---|---|
| FDC product → weight | `FDC_CACHE` | 7d | `fdc:{normalized name}` |
| OFF product → weight + parent term | `ONTOLOGY_CACHE` | 7d | `off:{brand}:{name}` |
| LLM `web_fetch` on product URL → weight | `URL_CACHE` | 24h | `wfetch:{url}` |
| LLM candidate grading | `URL_CACHE` | 24h | `grade:{specId}:{candidate sku}` |

**Latency target.** A 10-ingredient plan should still complete in < 30s. Parallelize all per-ingredient work via `Promise.all` (already done for store search).

**Subrequest budget on Paid.** Worst case (10 ingredients × 1 LLM grading call + 5 unparseable sizes × 1 web_fetch + Kroger + Walmart + AI + Supabase): ~50 subrequests. Well under 10,000.

**Cost.** Anthropic `claude-haiku-4-5` for grading (~10 calls per plan × ~500 tokens each = ~5k input tokens, ~1k output). At Haiku pricing this is fractions of a penny per plan. Acceptable.

---

## Phase 1 — Stop the bleeding

### Task 1 — Personalized narrative with rare humor

Replaces the loose narrative prompt at `eggs-api/src/routes/plan.ts:909-925`. The LLM is given deterministic facts to honor and an occasional "humor opportunity" hint when the shopping list contains either a pun-target word OR lifestyle markers that invite gentle non-judgmental observation.

**Files:** Create `eggs-api/src/routes/plan-narrative.ts` + test. Modify `plan.ts:894-930`.

Tone rules in the prompt: warm + specific, 2–3 sentences, never claim "100% verified", always mention unmatched items by name, fall back on canned text on error. Humor is OPT-IN per plan — only fires when `detectHumorOpportunity()` returns `pun` or `lifestyle`. Skip if forced.

Pun-targets: `lettuce, thyme, flour, leek, mushroom(s), rosemary, cumin, sage, mint, whisk, butter, kale, beet(s), pear(s), …` (extend as we discover more).

Lifestyle markers (regex): `kombucha|kefir|kvass|sauerkraut|kimchi`, `raw (milk|honey|cheese)`, `(hemp|chia|flax|spirulina|chlorella|maca|ashwagandha|ginseng|moringa)`, `medicinal mushrooms`, `colloidal silver`, `\borganic\b.*\borganic\b` (when "organic" appears 2+ times).

Tone for lifestyle hits: affectionate "we don't judge / free spirits / in touch with nature." Never disparaging.

### Task 2 — Drop winner from `eligibleCandidates`

`bestValue.ts:300` — change `eligibleCandidates: sorted` to `eligibleCandidates: sorted.slice(1)`. Adjust `BestBasketList.tsx` count text accordingly. One-line data fix + test.

### Task 3 — `stripUnitNoise` fixes

In `eggs-api/src/lib/queryStrip.ts`:
- Add `each, ea, piece, pieces, count, ct, item, items` to `NOISE_WORDS`.
- Add backoff: if stripping leaves < 2 meaningful tokens but the original had ≥ 2 non-numeric tokens, return only the leading-numeric strip (preserve descriptors like "gallons", "loaf", etc. when they're load-bearing).

Tests: `gallons milk → gallons milk` (don't over-strip), `1 gallon whole milk → whole milk`, `X-Large Eggs (12 each) → x-large eggs`, `2 lbs ground beef → ground beef`.

### Task 4 — `bestValue` no-silent-drop interim fix

In `eggs-api/src/lib/bestValue.ts:130-164`, when a candidate's size can't be parsed (`parseSize` null) OR the unit dimension mismatches the spec, **don't return null pricePerBase**. Instead:
- Compute a fallback `pricePerBase` from the unit price alone (effectively per-package).
- Mark `excludeReason` as `'size_unparseable'` for diagnostics but do NOT exclude from `pricedCandidates`.
- The candidate is still rankable; it just ranks below candidates with confident per-gram prices.

This is an interim patch. Phase 2's Task 5 replaces the fallback with real size resolution.

---

## Phase 2 — Smart matching pipeline

### Task 5 — Universal size resolver

**Goal:** Given any `StoreItem` with a possibly-bad `size` string, return a confident `pricedSize: { quantity, unit }` by trying, in order:

1. `parseSize(item.size)` — current pure-string parser.
2. **USDA FDC lookup** (`integrations/usda-fdc.ts`) by item name — returns serving + total grams.
3. **Open Food Facts** by `brand + name` — returns net weight on the package.
4. **LLM `web_fetch` on `item.productUrl`**, prompted to extract net weight. Cache result.
5. **LLM `web_search` "{brand} {name} package weight oz"** as last resort.

**Files:** Create `eggs-api/src/lib/size-resolver.ts` + test. Wire from `plan.ts` after Kroger/Walmart return items.

Cache every step in `FDC_CACHE` / `ONTOLOGY_CACHE` / `URL_CACHE` keyed by normalized name. Repeat searches in the same session never re-resolve.

### Task 6 — Ontology-aware search fallback

**Goal:** When a Kroger / Walmart search returns 0 priced results for the exact spec term, broaden via Open Food Facts taxonomy.

`eggs-api/src/integrations/off-taxonomy.ts` already loads the OFF parent map. Add `broaderTerm(name)` that returns the immediate ontology parent (e.g., "steel cut oats" → "oats"; "whole kiwi" → "kiwi" → "fruits"). Try one broader term before declaring "no match."

**Files:** Modify `kroger.ts:search()` and `walmart.ts` adapters to accept an `onMiss: () => Promise<string | null>` callback for the broader term. Or simpler: in `plan.ts`, after Kroger search returns null, retry with `broaderTerm(spec.name)`.

### Task 7 — LLM candidate grader

**Goal:** For each candidate, score how well it matches the user's intent. Reject "wrong product." Tag substitutions.

**Inputs:** `spec` (displayName, brand, quantity, unit, category) + candidate (name, brand, sku, description, size). Return:

```typescript
interface AlignmentGrade {
  score: number              // 0-100
  category: 'exact' | 'substitute' | 'wrong'
  reason: string             // one sentence — surfaces in UI when 'substitute'
}
```

**Implementation:** `eggs-api/src/lib/candidate-grader.ts`. Single batched LLM call per ingredient (one prompt, all candidates for that spec); output structured JSON. Cache per `(specId, candidateSku)` in `URL_CACHE`.

Prompt rules: prefer exact-class matches, accept brand-equivalent substitutions when the spec isn't brand-locked, reject category mismatches (kiwi vs yogurt) hard with `category: 'wrong'`.

### Task 8 — `selectWinner` rewrite

**Goal:** Replace the current single-axis (lowest pricePerBase) selection with a graded multi-axis ranker.

New ranking, in order:
1. Drop candidates with `category: 'wrong'`.
2. Among remainder, sort by `score` desc (so 'exact' beats 'substitute' beats lower-scoring 'substitute').
3. Within same score band (±5), sort by `pricePerBase` asc.
4. Within same price band, sort by distance asc (existing tie-break).

Inputs already include `parsedSize` from Task 5 and `alignmentGrade` from Task 7. `pricedCandidates` filter is removed entirely — every candidate reaches the ranker.

`WinnerResult` extends to include `alignmentGrade?: AlignmentGrade` so the UI can render substitution badges.

### Task 9 — Quantity math (Option A)

**Goal:** `lineTotal` reflects what the user will actually pay to get their requested quantity.

```typescript
function computeLineTotal(unitPrice, ingredient, pricedSize): number {
  if (!pricedSize) return unitPrice  // shouldn't happen post-Task-5
  const qtyInPkgUnits = convertQuantity(ingredient.quantity, ingredient.unit, pricedSize.unit)
  if (qtyInPkgUnits === null) return unitPrice  // dimension mismatch — buy 1 package
  const packagesNeeded = Math.max(1, Math.ceil(qtyInPkgUnits / pricedSize.quantity))
  return Math.round(unitPrice * packagesNeeded * 100) / 100
}
```

Add `convertQuantity()` to `eggs-api/src/lib/units.ts` if not present. Apply at `plan.ts:563` (Kroger) and `:628` (Walmart). Investigate where `ingredient.quantity = 12` for "Whole kiwi" comes from — likely scale-recipes or AI clarifier — and stop the inflation, or expose it to the user as "we scaled to 12 for your event of N people."

---

## Phase 3 — Surface the truth in the UI

### Task 10 — BestBasketList display

For each item row, render:

```
[Product Image]  Steel Cut Oats                                $4.99
                 → Quaker Oats 1.25 lb cylinder    [Substitute ⓘ]
                 1 unit · 1.25 lb · $0.0088/g
                 You wanted: 1 lb · Slightly more than requested
```

`Substitute ⓘ` tooltip on hover shows `alignmentGrade.reason`.

Per-gram price always shown for items where `pricedSize.unit` is mass-based; analogous per-mL for liquids; "per unit" for countables.

**Files:** `eggs-frontend/src/components/BestBasketList.tsx` (existing), `BestBasketRow.tsx` (extract from inline if not yet a component).

### Task 11 — Plan response diagnostics

Add `meta.diagnostics` to the plan response with:

```typescript
{
  aiPass1Failed: boolean
  aiPass2Failed: boolean
  aiCandidateCount: number
  sizeResolutions: { method: 'parseSize'|'fdc'|'off'|'web_fetch'|'web_search', count: number }[]
  graderRejects: number
  ontologyBroaderUsed: number
}
```

Expose collapsed by default in the UI as "How we picked these matches." Becomes a debugging affordance for QA, then a trust-building affordance for users ("we checked 47 things to confirm these prices").

---

## Open questions for confirmation before execution

1. **Latency tolerance.** A 10-ingredient plan with full grading + occasional size-resolution may run 30–45s end-to-end (longer than the current ~20s). Acceptable? Alternative: parallelize aggressively and stream partial results to the UI as each ingredient resolves.

2. **Substitution policy strictness.** When the only match is a `'substitute'` (no `'exact'` available), do we show it as the winner with a substitute badge, or treat it like "no match found" and surface unmatched? Default: show with badge — substitution is better than nothing.

3. **Where does `ingredient.quantity = 12` for "Whole kiwi" come from?** Investigation task inside Task 9. If scale-recipes is doing it on the user's behalf for headcount math, we should communicate that, not silently roll it into a $65.88 line.

4. **Does the user want the LLM grader's reasoning visible in the UI by default, or behind a tooltip?** Default proposal: default-collapsed for `'exact'`; surfaced for `'substitute'`; loud for `'wrong'` (which would mean we shipped the wrong-category as winner — shouldn't happen post-fix, but worth a guard).

---

## Scope check

Phase 1 alone (Tasks 1–4) takes one focused day and ships immediately as visible improvements. Phase 2 (Tasks 5–9) is the architecture work, ~3–4 days of focused execution. Phase 3 (Tasks 10–11) is ~1 day.

If user wants to ship Phase 1 first as a discrete PR while Phase 2 is being designed in detail, that's clean — there are no Phase-1→Phase-2 dependencies that block Phase 1 from going live.

If user wants the whole vision shipped at once, Phase 1's interim patches in Tasks 3 and 4 still land but get superseded by Phase 2's permanent versions. No wasted code.

Recommend: **ship Phase 1 standalone; design Phase 2 in detail (separate plan doc) once Phase 1 lands.**

## Verification (Phase 1 only — Phase 2/3 verification expanded in their own plans)

- `cd eggs-api && npm test` — green.
- `cd eggs-frontend && npm test && npm run build` — green.
- Push, watch `Deploy eggs-api` CI succeed.
- `npx wrangler tail eggs-api` and re-run the same shopping list. Confirm:
  - Narrative mentions the 4 unmatched items by name and avoids "100% confirmed" language.
  - Swap UI shows the chosen winner separately from a non-empty alternatives list (or "no alternatives" if there genuinely are none).
  - Tasks 3 + 4 together: items that previously showed "No match found" now appear in the basket (turkey, milk via fallback ranking; eggs via better query).
- Update `TEST-COVERAGE.md` with the new tests.

## Critical files to touch in Phase 1

- `eggs-api/src/routes/plan.ts:894-930` — narrative
- `eggs-api/src/routes/plan-narrative.ts` — new
- `eggs-api/src/lib/bestValue.ts:130-164, 228, 300` — drop winner from alternatives + no-silent-drop interim
- `eggs-api/src/lib/queryStrip.ts` — NOISE_WORDS + backoff
- `eggs-frontend/src/components/BestBasketList.tsx` — alt count copy

## Out of scope for this plan

- Walmart "delivery" labeling
- Subtotal/total reconciliation across UI sections (Phase 3 partially addresses)
- Kroger first-hit cascade trim (recently shipped per user request; revisit only if Phase 2's smarter pipeline benefits from cross-location cascade)
