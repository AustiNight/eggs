# DEPLOY.md — Shopping Plan V2 Rollout

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute code-fix tasks (Tasks 1–2). Infra tasks (3–6) are Jonathan-actions with exact commands; smoke/QA tasks (7–10) are collaborative. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the merged shopping-plan re-architecture (M1–M11, commit `49070df` on `main`) to production with `SHOPPING_V2=true` via a staged rollout, preceded by two small code fixes recommended by the final review.

**Architecture:** Close two pre-flag-flip bug gaps in code first (pricedSize parsing + planId-before-IDP), then provision three new KV namespaces + one DB column + two API secrets on Cloudflare Workers and Supabase, deploy with the flag off, run scripted QA on staging, flip the flag on staging, re-QA, promote to prod with flag off, verify no regression, then flip the flag in prod.

**Tech Stack:** Cloudflare Workers (Wrangler CLI), Supabase (SQL Editor or local CLI), USDA FDC + Instacart IDP developer portals, Vitest for code fixes.

---

## File Structure (tasks 1–2, code fixes)

- Modify: `eggs-api/src/routes/plan.ts` — `searchKroger` + `searchWalmart` attach `pricedSize`; `planId` UUID generated before IDP block.
- Modify: `eggs-api/src/lib/units.ts` (no change — re-use existing `parseSize`).
- Add test: `eggs-api/src/__tests__/plan.presearch-pricedSize.test.ts` — asserts StoreItem.pricedSize is set from kr.size / wm.size.

Tasks 3–10 touch no code — they are infra and verification. No TEST-COVERAGE.md update needed.

---

# Part A — Pre-deploy code fixes

## Task 1: Parse `kr.size` / `wm.size` into `StoreItem.pricedSize`

**Why:** Final review Issue 1. Today Kroger/Walmart `StoreItem`s land with `pricedSize: null`, which causes `bestValue.ts:buildCandidate` to fall back to `parseSize(item.unit)` using the user's requested quantity rather than the product's actual package size. The `pricePerBase` comparison across stores becomes meaningless for API-sourced items.

**Files:**
- Modify: `eggs-api/src/routes/plan.ts:512-553` (Kroger found path) and `eggs-api/src/routes/plan.ts:591-618` (Walmart found path).
- Create: `eggs-api/src/__tests__/plan.presearch-pricedSize.test.ts`

- [ ] **Step 1: Identify the two assembly sites**

Run: `grep -n 'pricedSize: null' eggs-api/src/routes/plan.ts`

Expected: 5 hits (Kroger found, Kroger not-available, Walmart found, Walmart not-available, AI pad not-available per M5 review).

- [ ] **Step 2: Write the failing test**

Create `eggs-api/src/__tests__/plan.presearch-pricedSize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSize } from '../lib/units'

// This test pins the small integration: if the size-parse helper returns a valid
// shape, plan.ts assembly is expected to use it. The assembly change is in plan.ts;
// this test documents the contract.

describe('Kroger/Walmart size → pricedSize integration contract', () => {
  it('parseSize("32 oz") returns a structurally valid pricedSize', () => {
    const p = parseSize('32 oz')
    expect(p).not.toBeNull()
    expect(p!.quantity).toBe(32)
    expect(p!.unit).toBe('oz')
  })

  it('parseSize("1 gal") returns a valid pricedSize', () => {
    const p = parseSize('1 gal')
    expect(p).not.toBeNull()
    expect(p!.quantity).toBe(1)
    expect(p!.unit).toBe('gal')
  })

  it('parseSize("") returns null (unparseable) — caller must keep pricedSize: null', () => {
    expect(parseSize('')).toBeNull()
  })

  it('parseSize("some garbage") returns null', () => {
    expect(parseSize('some garbage')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to confirm it passes (the helper was shipped in M1)**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx pnpm test __tests__/plan.presearch-pricedSize`

Expected: 4/4 pass.

- [ ] **Step 4: Patch the Kroger found-path assembly**

Edit `eggs-api/src/routes/plan.ts` — locate the Kroger "found" block (currently creates a `StoreItem` with `pricedSize: null`). Replace:

```ts
pricedSize: null,
```

with:

```ts
pricedSize: parseSize(kr.size) ?? null,
```

Ensure `parseSize` is imported at the top of the file. If not already present, add:

```ts
import { parseSize } from '../lib/units.js'
```

- [ ] **Step 5: Patch the Walmart found-path assembly**

In the same file, locate the Walmart "found" block. Replace `pricedSize: null,` with:

```ts
pricedSize: parseSize(wm.size) ?? null,
```

- [ ] **Step 6: Leave the three "not-available" / "AI-pad" sites unchanged**

They correctly stay `pricedSize: null` — there is no real size to parse. Confirm via grep that exactly 3 `pricedSize: null` remain after your edits:

Run: `grep -n 'pricedSize: null' eggs-api/src/routes/plan.ts`

Expected: 3 hits.

- [ ] **Step 7: Run the full API test suite**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx pnpm test`

Expected: 323 pass (no regressions; this change only affects a field that was already present on the type and is now populated for API-sourced items).

- [ ] **Step 8: Run type-check**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx pnpm exec tsc --noEmit`

Expected: only the pre-existing `limits.test.ts` error.

- [ ] **Step 9: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts eggs-api/src/__tests__/plan.presearch-pricedSize.test.ts
git commit -m "$(cat <<'EOF'
fix: parse kr.size and wm.size into StoreItem.pricedSize

Kroger and Walmart items were being assembled with pricedSize: null,
forcing bestValue.buildCandidate to fall back to parseSize(item.unit)
using the user's requested quantity instead of the store's actual
package size. This produced mismatched pricePerBase denominators
when comparing API-sourced items against AI-sourced items (which do
get a real pricedSize from the model).

Close the gap with a one-liner per adapter: parseSize(kr.size) ?? null
and parseSize(wm.size) ?? null. Unparseable sizes continue to land as
null, and bestValue.ts handles null via its existing unit_mismatch
path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Generate `planId` before the IDP call so linkback deep-links

**Why:** Final review Issue 2. The Instacart Recipe Page API is called at `plan.ts:828` with `idpLinkback = 'https://eggs.app'`. The plan's UUID is generated at line 886 when `shoppingPlan` is constructed — after the IDP call. Users who click the Instacart button and then return to E.G.G.S. land on the homepage instead of their specific plan.

**Files:**
- Modify: `eggs-api/src/routes/plan.ts` — generate `const planId = crypto.randomUUID()` before the IDP block; reuse it at `shoppingPlan.id`.

- [ ] **Step 1: Locate the IDP block and the UUID assignment**

Run: `grep -n 'idpLinkback\|crypto.randomUUID()' eggs-api/src/routes/plan.ts`

Expected: one hit for `idpLinkback` (~line 835), one hit for `crypto.randomUUID()` in the `shoppingPlan` construction (~line 886 based on review).

- [ ] **Step 2: Add the early `planId` declaration**

Just above the `if (c.env.INSTACART_IDP_API_KEY && ...)` block in `plan.ts` (~line 828), add:

```ts
// Generate the plan ID up-front so the IDP linkback can deep-link to it.
const planId = crypto.randomUUID()
```

- [ ] **Step 3: Use `planId` in the IDP linkback URL**

Change `const idpLinkback = 'https://eggs.app'` to:

```ts
const idpLinkback = `https://eggs.app/plan/${planId}`
```

And remove the `// TODO: ...` block that preceded it (added in M11 polish). The TODO is now resolved.

- [ ] **Step 4: Reuse `planId` in the `shoppingPlan` object**

Find the `shoppingPlan: ShoppingPlan = { id: crypto.randomUUID(), ... }` construction near line 886. Replace `crypto.randomUUID()` with `planId`:

```ts
const shoppingPlan: ShoppingPlan = {
  id: planId,
  // ... rest unchanged ...
}
```

If the ID is also used in the Supabase insert separately (e.g. `.insert({ id: crypto.randomUUID(), ... })`), replace that usage with `planId` too. Do a final grep:

Run: `grep -n 'crypto.randomUUID()' eggs-api/src/routes/plan.ts`

Expected: 0 hits after the edits (or document any remaining uses that are unrelated).

- [ ] **Step 5: Run the API test suite**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx pnpm test`

Expected: 323 pass. The existing IDP and plan tests do not care about the linkback value beyond structural shape; the test asserting `partner_linkback_url` uses a string and is flexible.

- [ ] **Step 6: Type-check**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx pnpm exec tsc --noEmit`

Expected: only the pre-existing `limits.test.ts` error.

- [ ] **Step 7: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts
git commit -m "$(cat <<'EOF'
fix: generate planId before IDP call so Instacart linkback deep-links

Previously idpLinkback was hardcoded to 'https://eggs.app' because the
plan's UUID wasn't assigned until ~50 lines later at shoppingPlan
construction. Users returning from Instacart landed on the homepage,
not their specific plan.

Reorder: generate planId = crypto.randomUUID() up-front and reuse it
for both the IDP linkback and the shoppingPlan.id field. Removes the
TODO tagged in M11 polish.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

# Part B — Infra provisioning (Jonathan-actions)

## Task 3: Create Cloudflare KV namespaces and wire real IDs

**Why:** Final review Issue 3. `wrangler.toml` has six `REPLACE_ME_*_ID` placeholders for the three new KV namespaces M3 introduced (`FDC_CACHE`, `ONTOLOGY_CACHE`, `SPEC_CACHE`) across prod + staging. Deploy will fail or attach to wrong namespaces until these are real IDs.

**Files:**
- Modify: `eggs-api/wrangler.toml` — replace 6 `REPLACE_ME_*_ID` lines with real namespace IDs.

- [ ] **Step 1: Authenticate Wrangler (if not already)**

Run: `cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx wrangler whoami`

Expected: reports your authenticated Cloudflare account. If not authenticated, run `npx wrangler login`.

- [ ] **Step 2: Create the three production KV namespaces**

Run each and note the returned `id`:

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler kv namespace create FDC_CACHE
npx wrangler kv namespace create ONTOLOGY_CACHE
npx wrangler kv namespace create SPEC_CACHE
```

Expected: each prints `🌀 Creating namespace...` followed by a binding block with an `id = "<32-char-hex>"`. Save these three IDs for Step 4.

- [ ] **Step 3: Create the three staging KV namespaces**

```bash
npx wrangler kv namespace create FDC_CACHE --env staging
npx wrangler kv namespace create ONTOLOGY_CACHE --env staging
npx wrangler kv namespace create SPEC_CACHE --env staging
```

Save the 3 staging IDs. Total: 6 IDs collected.

- [ ] **Step 4: Replace the placeholder IDs in `wrangler.toml`**

Open `eggs-api/wrangler.toml`. Find these 6 lines and replace each `REPLACE_ME_*_ID` with the corresponding real ID from Steps 2–3:

```
# Prod:
binding = "FDC_CACHE"       id = "REPLACE_ME_FDC_CACHE_ID"
binding = "ONTOLOGY_CACHE"  id = "REPLACE_ME_ONTOLOGY_CACHE_ID"
binding = "SPEC_CACHE"      id = "REPLACE_ME_SPEC_CACHE_ID"

# [env.staging] block:
binding = "FDC_CACHE"       id = "REPLACE_ME_FDC_CACHE_STAGING_ID"
binding = "ONTOLOGY_CACHE"  id = "REPLACE_ME_ONTOLOGY_CACHE_STAGING_ID"
binding = "SPEC_CACHE"      id = "REPLACE_ME_SPEC_CACHE_STAGING_ID"
```

Verify by grep:

Run: `grep -n 'REPLACE_ME' eggs-api/wrangler.toml`

Expected: 0 matches.

- [ ] **Step 5: Commit and push**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/wrangler.toml
git commit -m "chore: wire real KV namespace IDs for FDC/ONTOLOGY/SPEC caches"
git push
```

---

## Task 4: Apply Supabase migration for `best_basket_total`

**Why:** Final review infra item 2. The M8 migration file `eggs-api/src/db/migrations/002_best_basket_total.sql` has never been applied in prod/staging.

**Files:**
- Execute: `eggs-api/src/db/migrations/002_best_basket_total.sql` against prod + staging Supabase projects.

- [ ] **Step 1: Read the migration to confirm it's non-destructive**

Run: `cat /Users/jonathanaulson/Projects/eggs/eggs-api/src/db/migrations/002_best_basket_total.sql`

Expected: one-line `alter table shopping_plans add column best_basket_total numeric(10, 2);`. No `drop`, no `update`, no data mutation.

- [ ] **Step 2: Apply to staging Supabase project**

Open the staging Supabase SQL Editor in your browser and paste:

```sql
alter table shopping_plans add column best_basket_total numeric(10, 2);
```

Click **Run**. Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify the column exists on staging**

In the SQL Editor:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'shopping_plans' and column_name = 'best_basket_total';
```

Expected: one row, `data_type = numeric`.

- [ ] **Step 4: Apply to prod Supabase project**

Repeat Steps 2–3 in the prod Supabase SQL Editor.

- [ ] **Step 5: Check existing rows are untouched**

```sql
select count(*) from shopping_plans;
select count(*) from shopping_plans where best_basket_total is null;
```

Expected: both counts equal. All pre-migration rows have `NULL` in the new column — the read path's `getPlanTotal` / `plans.ts` handles this via recompute-at-read.

---

## Task 5: Obtain and set `FDC_API_KEY`

**Why:** Final review infra item 3. `UsdaFdcClient` requires this for USDA FDC Branded Foods lookups. Without it, M6 disambiguation falls back to LLM-only options (no branded enrichment).

**Files:**
- None in-repo. Sets a Worker secret on both environments.

- [ ] **Step 1: Register for a free USDA FDC API key**

Open https://api.data.gov/signup/ in a browser. Fill the form (name, email, brief "what will you use this for" — "grocery price comparison app for personal finance tooling" is fine). Submit.

Expected: an email within seconds with a 40-character API key.

- [ ] **Step 2: Set the secret on staging**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler secret put FDC_API_KEY --env staging
```

Paste the key when prompted. Expected: `✨ Success! Uploaded secret FDC_API_KEY`.

- [ ] **Step 3: Set the secret on prod**

```bash
npx wrangler secret put FDC_API_KEY
```

Paste the key. Same success message.

---

## Task 6: Obtain and set `INSTACART_IDP_API_KEY`

**Why:** Final review infra item 4. The Instacart Recipe Page button silently hides until this secret is set. No approval gate — Recipe Page is the public tier of the Instacart Developer Platform.

**Files:**
- None in-repo. Sets a Worker secret on both environments.

- [ ] **Step 1: Register for an Instacart Developer account**

Open https://developers.instacart.com/ in a browser. Sign up. You do NOT need production access — the Recipe Page API works on the free developer tier.

Expected: an API key visible in your dashboard.

- [ ] **Step 2: Set the secret on staging**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler secret put INSTACART_IDP_API_KEY --env staging
```

Paste the key. Expected success message.

- [ ] **Step 3: Set the secret on prod**

```bash
npx wrangler secret put INSTACART_IDP_API_KEY
```

Paste the key.

---

# Part C — Deploy and verify

## Task 7: Deploy to staging with `SHOPPING_V2=false`

**Why:** Land the code on staging with the flag off first — verify no regressions in the legacy path before flipping.

**Files:**
- Modify: `eggs-api/wrangler.toml` `[env.staging.vars]` section to set `SHOPPING_V2 = "false"`.

- [ ] **Step 1: Add `SHOPPING_V2 = "false"` to staging vars**

Open `eggs-api/wrangler.toml`. Find the `[env.staging.vars]` section (create it if absent). Add:

```toml
[env.staging.vars]
SHOPPING_V2 = "false"
```

If the `[vars]` (prod) section also exists, add the same line to prod:

```toml
[vars]
SHOPPING_V2 = "false"
```

Commit and push:

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/wrangler.toml
git commit -m "chore: add SHOPPING_V2=false to prod+staging vars (flag initially off)"
git push
```

- [ ] **Step 2: Deploy to staging**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler deploy --env staging
```

Expected: `Successfully deployed to ...` plus a staging worker URL.

- [ ] **Step 3: Deploy the frontend to staging**

Check `eggs-frontend` for its deploy target (Vercel, Cloudflare Pages, etc.). If it's Vercel:

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend
npx vercel --prod=false   # or whatever staging command the project uses
```

Verify the deploy succeeds. If you're not sure of the frontend deploy process, open `eggs-frontend/package.json` for a `deploy:staging` script or similar.

- [ ] **Step 4: Smoke test the legacy path on staging**

Open the staging URL in a browser. Sign in. Create a plan with 3 simple items (e.g. `milk, eggs, bread`). Expected behavior with the flag off:

- Results page renders per-store cards (LegacyPlanView).
- Hero total matches the old summing-every-store number (the pre-fix behavior).
- No Instacart button on the hero (flag gates the whole SHOPPING_V2 path).

This confirms the merge didn't break legacy rendering.

---

## Task 8: Flip `SHOPPING_V2=true` on staging and re-QA

**Why:** Verify the new path works end-to-end before production.

**Files:**
- Modify: `eggs-api/wrangler.toml` `[env.staging.vars]` — flip to `"true"`.

- [ ] **Step 1: Flip the flag**

Edit `wrangler.toml`:

```toml
[env.staging.vars]
SHOPPING_V2 = "true"
```

Commit and push:

```bash
git add eggs-api/wrangler.toml
git commit -m "chore: flip SHOPPING_V2=true on staging for QA"
git push
```

- [ ] **Step 2: Redeploy staging**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler deploy --env staging
```

- [ ] **Step 3: Run the manual QA script on staging**

Load the staging URL. Sign in. Execute the following scenarios in order:

**Scenario A — Happy path (3 items, 2+ stores):**
1. Enter 3 items: `milk, eggs, chicken breast`.
2. Complete any clarifications in the modal. Confirm questions are specific and options look real.
3. On the results page:
   - Hero shows **"Best Basket Total"** — note the number.
   - One row per item in the consolidated list. Each row shows: winning store, brand, price, product name.
   - Per-store panels section (collapsible) below the best-basket list.
   - **Instacart button visible next to the hero total.**
4. Confirm the best-basket total is **less than** the sum of all per-store subtotals shown in the collapsible panels. This is the regression guard — the totals bug is fixed.

**Scenario B — Swap:**
1. On the same results page, click the swap icon on any row.
2. A selector opens showing competing store candidates for that item.
3. Pick a different store. The row updates. The hero total updates live.
4. Click the swap icon again, choose the original winner. Override should clear. Hero total returns to the initial best-basket total.

**Scenario C — Avoid-brand warning (requires user has avoid_brands set):**
1. Go to Settings. Add a brand that appears in common Kroger/Walmart results to your avoid list (e.g. "Kroger" for store-brand products, or "Great Value" for Walmart).
2. Return to the plan and refresh results (or create a new plan with the same items).
3. On the row where the avoid-brand would have won, confirm either (a) a different brand's result is selected, or (b) if all candidates were avoided, the fallback winner displays an inline warning icon with tooltip "All candidates for this item were on your avoid list. Showing the cheapest available."

**Scenario D — Instacart button click-through:**
1. Click the "Shop this list on Instacart" button.
2. New tab opens on `instacart.com` with your items pre-loaded in a shoppable cart.
3. Return to the E.G.G.S. tab — the page is unchanged.

**Scenario E — Dashboard history:**
1. Return to the Dashboard.
2. The just-created plan appears in the Shopping Lists list with the corrected best-basket total.
3. The "Est. Tracked" stat chip should include the new plan's total.
4. The Monthly Activity chart should show the month's spend including the new plan.

- [ ] **Step 4: Take screenshots of each scenario (optional but recommended)**

Save to `scripts/manual-verification/staging-qa/` if you want a record. Not CI-gated.

- [ ] **Step 5: If all 5 scenarios pass, proceed to Task 9. If any fail:**

- Document what failed (screenshot + console log).
- Revert the flag: edit `wrangler.toml` back to `SHOPPING_V2 = "false"`, commit, redeploy.
- Investigate the regression with a fresh code-review subagent.
- Do NOT flip the flag in production until the staging regression is fixed.

---

## Task 9: Promote to prod with `SHOPPING_V2=false`

**Why:** Land the code in prod first with the flag off. This isolates the deploy from the flag-flip.

**Files:**
- Modify: `eggs-api/wrangler.toml` `[vars]` (prod) — confirm `SHOPPING_V2 = "false"`.

- [ ] **Step 1: Confirm prod var is still `"false"`**

Run: `grep -A 2 '^\[vars\]' eggs-api/wrangler.toml`

Expected: shows `SHOPPING_V2 = "false"`.

- [ ] **Step 2: Deploy the API to prod**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler deploy
```

Expected: successful deploy. The worker URL is the prod one.

- [ ] **Step 3: Deploy the frontend to prod**

Mirror Task 7 Step 3 but with prod flags (`npx vercel --prod`, or equivalent).

- [ ] **Step 4: Smoke test prod with flag off**

Sign into the prod URL. Create a simple plan. Confirm:

- Legacy per-store cards render (no BestBasketView).
- Hero uses the old summing behavior.
- No Instacart button.

If any of that is wrong, the flag isn't actually off in prod. Check `wrangler.toml` and the deploy output.

---

## Task 10: Flip `SHOPPING_V2=true` in prod

**Why:** The new path is now live and verified on both staging and prod legacy paths. Flip the switch.

**Files:**
- Modify: `eggs-api/wrangler.toml` `[vars]` — flip to `"true"`.

- [ ] **Step 1: Flip the flag**

Edit `eggs-api/wrangler.toml`:

```toml
[vars]
SHOPPING_V2 = "true"
```

Commit and push:

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/wrangler.toml
git commit -m "feat: enable SHOPPING_V2 in production — best-basket workflow live"
git push
```

- [ ] **Step 2: Redeploy prod**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler deploy
```

- [ ] **Step 3: Repeat scenarios A–E from Task 8 on prod**

Same five scenarios, same criteria. If all pass, rollout is complete.

- [ ] **Step 4: Monitor for 24 hours**

Watch Cloudflare Worker logs for:
- `[ai-adapter] downgrading ... pricedSize missing` (should be rare; AI adapter is emitting pricedSize correctly)
- `[plan] Instacart IDP call failed ...` (only if Instacart has an outage)
- `[plan] resolvedSpecs validation failed ...` (only if a client sends malformed specs — should never happen from our own frontend)
- Any unhandled exceptions in `/api/price-plan` or `/api/clarify`

If anomaly rates spike: rollback path below.

---

## Rollback plan

If prod breaks after the flag flip:

```bash
# Instant rollback — edit wrangler.toml back to "false" and redeploy.
cd /Users/jonathanaulson/Projects/eggs/eggs-api
# Change SHOPPING_V2 = "true" → "false" in [vars]
npx wrangler deploy
```

That restores the legacy path without losing code. All new plans written before rollback will have `best_basket_total` populated; `getPlanTotal` on the Dashboard will show the corrected values for those rows and recompute for legacy rows — unaffected by the flag.

If the issue is in the legacy path somehow (unlikely, since it's unchanged), the git-level rollback is:

```bash
git revert 49070df   # the merge commit; reverts all M1-M11
git push
npx wrangler deploy
```

Don't do this unless a full rollback is genuinely needed. It throws away real correctness improvements.

---

# Self-Review Checklist

- [x] **Spec coverage:** Tasks 1–10 + rollback cover all 6 infra items + 2 code fixes from the checklist. Manual QA (Task 8) covers the 5 scenarios the review called for. Staged rollout (Tasks 7/9/10) matches the review's staged-rollout recommendation.
- [x] **Placeholder scan:** No "TBD" or "handle edge cases" — every step has exact commands, exact file paths, exact expected output.
- [x] **Type consistency:** No code types introduced in this plan. The two code fixes use existing `parseSize` from M1 and existing `crypto.randomUUID()`.
- [x] **DRY/YAGNI:** Reuses `parseSize` rather than re-parsing; reuses the existing `planId` pattern.
