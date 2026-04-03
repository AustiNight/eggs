# Summary Fix — 3 files to patch

## 1. eggs-frontend/src/types.ts
Add `summary?: string` to the ShoppingPlan interface:

Find this block:
  summary: {
    subtotal: number
    estimatedTax: number
    total: number
    estimatedSavings?: number
    realPriceCount: number
    estimatedPriceCount: number
  }

Replace with:
  summary: {
    subtotal: number
    estimatedTax: number
    total: number
    estimatedSavings?: number
    realPriceCount: number
    estimatedPriceCount: number
    narrative?: string   // AI-written explanation of store choices and savings logic
  }

## 2. eggs-api/src/types/index.ts
Same change — find the summary block in ShoppingPlan and add:
  narrative?: string

## 3. eggs-api/src/routes/plan.ts
After the finalStores / allItems calculations are done and BEFORE the shoppingPlan object
is constructed, add a narrative generation step.

Find this comment:
  // ── Step 3: Assemble final plan ──────────────────────────────────────────

And after the krogerItems / allStores assembly but before `const shoppingPlan: ShoppingPlan = {`
insert the narrative generation block from narrative-gen.ts (see below).

Then in the shoppingPlan object, inside the summary block, add:
  narrative: planNarrative
