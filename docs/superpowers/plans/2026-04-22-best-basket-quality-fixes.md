# Best-Basket Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four shipping-blocker quality issues on the plan results page: (A) clarifier answers not respected in store searches, (B) empty "item-by-item winners" list (downstream of A), (C) AI proof URLs that don't verify against the actual page content at the quoted price, (D) pricing/savings graphs missing from the best-basket view.

**Architecture:**
- **A+B (clarifier fidelity):** Change `resolvedClarifications` from `Record<string, string>` (flattened `"chicken (Boneless, Skinless)"`) to a structured `Record<string, ClarifiedAttributes>` carrying `baseName` + `selectedOptions[]`. Backend composes clean search queries by space-joining attributes in front of the base name. Issue B resolves as a side-effect of A — once searches return real candidates, `selectWinner` stops emitting `winner: null` for every spec.
- **C (AI proof URL honesty):** Defense in depth. Harden the pass-1 research prompt to MANDATE `web_fetch` per product and require an explicit "fetched-on" signal the pass-2 formatter must honor. Add a server-side `verifyProductContent(url, name, price)` that fetches the HTML, strips tags, and asserts product name tokens + price string both appear. Failed verifications downgrade confidence to `estimated` and null the `proofUrl`.
- **D (graphs):** Extract the recharts pie chart from `LegacyPlanView` into a reusable `CostBreakdownChart` component. Compute per-store totals from `winners` inside `BestBasketView` and render the chart above the item list.

**Tech Stack:** TypeScript, React, Vitest, recharts, Hono (Cloudflare Workers), Anthropic SDK with `web_search_20260209` and `web_fetch_20260209` server-side tools.

---

## File Structure

**Create:**
- `eggs-frontend/src/components/CostBreakdownChart.tsx` — extracted recharts pie chart (store-cost breakdown)
- `eggs-api/src/lib/content-verifier.ts` — `verifyProductContent(url, name, price)` HTML-parse verification
- `eggs-api/src/lib/content-verifier.test.ts` — unit tests for content verifier
- `eggs-frontend/src/components/ClarificationModal.test.tsx` — unit tests for structured answer shape
- `eggs-api/src/lib/query-builder.ts` — `buildSearchQuery(baseName, selectedOptions)` pure helper
- `eggs-api/src/lib/query-builder.test.ts` — unit tests for query builder

**Modify:**
- `eggs-frontend/src/components/ClarificationModal.tsx:22-32` — emit structured answers
- `eggs-frontend/src/types.ts` — add `ClarifiedAttributes` type
- `eggs-frontend/src/lib/api.ts:150` — update `resolvedClarifications` shape in request type
- `eggs-frontend/src/components/EventShop.tsx:204` — pass structured answers
- `eggs-api/src/types/index.ts:25` — update `resolvedClarifications` backend type
- `eggs-api/src/routes/plan.ts:450-460` — consume structured clarifications, build clean search query
- `eggs-api/src/routes/plan.ts:272` (system prompt) — mandate web_fetch per product
- `eggs-api/src/routes/plan.ts:697-706` (reconciliation) — call `verifyProductContent` and downgrade unverified items
- `eggs-api/src/routes/plan.ts:333-338` (pass-2 formatter prompt) — forbid proofUrl when pass-1 didn't emit `web_fetch_confirmed`
- `eggs-frontend/src/components/BestBasketView.tsx` — compute store totals + render `<CostBreakdownChart>`

---

## Part A — Clarifier Fidelity (Issues 1 + 2)

### Task A1: Add structured ClarifiedAttributes type (frontend + backend)

**Files:**
- Modify: `eggs-frontend/src/types.ts`
- Modify: `eggs-api/src/types/index.ts:25`

- [ ] **Step 1: Add `ClarifiedAttributes` to frontend types**

Add to `eggs-frontend/src/types.ts` (append near other clarifier-adjacent types):

```typescript
export interface ClarifiedAttributes {
  /** Base ingredient name before refinement, e.g. "chicken thighs" */
  baseName: string
  /** Structured options the user selected, e.g. ["Boneless", "Skinless"] */
  selectedOptions: string[]
}
```

- [ ] **Step 2: Mirror the type in backend**

Add to `eggs-api/src/types/index.ts` (top of file near other shared types):

```typescript
export interface ClarifiedAttributes {
  baseName: string
  selectedOptions: string[]
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/types.ts eggs-api/src/types/index.ts
git commit -m "feat: add ClarifiedAttributes structured type"
```

---

### Task A2: Pure helper — buildSearchQuery

**Files:**
- Create: `eggs-api/src/lib/query-builder.ts`
- Test: `eggs-api/src/lib/query-builder.test.ts`

- [ ] **Step 1: Write failing test**

Create `eggs-api/src/lib/query-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSearchQuery } from './query-builder'

describe('buildSearchQuery', () => {
  it('returns baseName unchanged when no options selected', () => {
    expect(buildSearchQuery('chicken thighs', [])).toBe('chicken thighs')
  })

  it('prepends options in front of baseName with single spaces', () => {
    expect(buildSearchQuery('chicken thighs', ['Boneless', 'Skinless']))
      .toBe('boneless skinless chicken thighs')
  })

  it('lowercases options and trims whitespace', () => {
    expect(buildSearchQuery('  Chicken Thighs  ', ['  Organic  ']))
      .toBe('organic Chicken Thighs')
  })

  it('strips parentheses and commas that would confuse store search', () => {
    expect(buildSearchQuery('cheese (sharp)', ['Cheddar, aged']))
      .toBe('cheddar aged cheese sharp')
  })

  it('dedupes options that already appear in baseName', () => {
    expect(buildSearchQuery('organic milk', ['Organic', 'Whole']))
      .toBe('whole organic milk')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test query-builder
```
Expected: FAIL with "Cannot find module './query-builder'".

- [ ] **Step 3: Write minimal implementation**

Create `eggs-api/src/lib/query-builder.ts`:

```typescript
/**
 * Compose a clean product search query from a base ingredient name and
 * user-selected clarification options. Options are prepended as adjectives
 * and sanitized so store search APIs tokenize them correctly.
 */
export function buildSearchQuery(baseName: string, selectedOptions: string[]): string {
  const sanitize = (s: string) => s.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim()
  const cleanBase = sanitize(baseName)
  if (selectedOptions.length === 0) return cleanBase

  const baseTokens = new Set(cleanBase.toLowerCase().split(/\s+/))
  const prefixTokens: string[] = []
  for (const opt of selectedOptions) {
    const cleaned = sanitize(opt).toLowerCase()
    if (!cleaned) continue
    if (baseTokens.has(cleaned)) continue
    prefixTokens.push(cleaned)
  }
  return prefixTokens.length > 0 ? `${prefixTokens.join(' ')} ${cleanBase}` : cleanBase
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test query-builder
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/lib/query-builder.ts eggs-api/src/lib/query-builder.test.ts
git commit -m "feat: add buildSearchQuery helper for clean store search queries"
```

---

### Task A3: Emit structured answers from ClarificationModal

**Files:**
- Modify: `eggs-frontend/src/components/ClarificationModal.tsx:1-40`
- Create: `eggs-frontend/src/components/ClarificationModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `eggs-frontend/src/components/ClarificationModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ClarificationModal from './ClarificationModal'

describe('ClarificationModal', () => {
  it('emits structured answer with baseName + selectedOptions (not a flattened string)', () => {
    const onComplete = vi.fn()
    render(
      <ClarificationModal
        requests={[{
          itemId: 'i1',
          originalName: 'chicken thighs',
          question: 'Which style?',
          options: ['Boneless', 'Skinless', 'Bone-in'],
        }]}
        onComplete={onComplete}
      />
    )

    fireEvent.click(screen.getByText('Boneless'))
    fireEvent.click(screen.getByText('Skinless'))
    fireEvent.click(screen.getByRole('button', { name: /submit|done|confirm/i }))

    expect(onComplete).toHaveBeenCalledWith({
      i1: { baseName: 'chicken thighs', selectedOptions: ['Boneless', 'Skinless'] },
    })
  })

  it('omits items with zero selections', () => {
    const onComplete = vi.fn()
    render(
      <ClarificationModal
        requests={[
          { itemId: 'i1', originalName: 'A', question: '?', options: ['x', 'y'] },
          { itemId: 'i2', originalName: 'B', question: '?', options: ['x', 'y'] },
        ]}
        onComplete={onComplete}
      />
    )
    fireEvent.click(screen.getByText('x', { selector: '[data-item-id="i1"] *' }))
    fireEvent.click(screen.getByRole('button', { name: /submit|done|confirm/i }))
    expect(onComplete).toHaveBeenCalledWith({
      i1: { baseName: 'A', selectedOptions: ['x'] },
    })
  })
})
```

(If existing markup doesn't expose `data-item-id`, skip the second test's selector specificity and assert the callback shape only. Adjust selectors to match the component's actual DOM.)

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend
pnpm test ClarificationModal
```
Expected: FAIL — current component emits flattened string.

- [ ] **Step 3: Update ClarificationModal to emit structured answers**

Edit `eggs-frontend/src/components/ClarificationModal.tsx`. Update props and submit handler:

```typescript
// at top, update props import
import type { ClarifiedAttributes } from '../types'

interface ClarificationModalProps {
  requests: ClarificationRequest[]
  onComplete: (answers: Record<string, ClarifiedAttributes>) => void
}

// inside component, replace handleSubmit body:
const handleSubmit = () => {
  const answers: Record<string, ClarifiedAttributes> = {}
  Object.entries(selections).forEach(([itemId, selectedSet]) => {
    if (selectedSet.size > 0) {
      const originalName = requests.find(r => r.itemId === itemId)?.originalName || ''
      answers[itemId] = {
        baseName: originalName,
        selectedOptions: Array.from(selectedSet),
      }
    }
  })
  onComplete(answers)
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend
pnpm test ClarificationModal
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/components/ClarificationModal.tsx eggs-frontend/src/components/ClarificationModal.test.tsx
git commit -m "fix(clarifier): emit structured answers instead of flattened string"
```

---

### Task A4: Update API request type and EventShop caller

**Files:**
- Modify: `eggs-frontend/src/lib/api.ts:150`
- Modify: `eggs-frontend/src/components/EventShop.tsx:204`

- [ ] **Step 1: Update request type in api.ts**

Open `eggs-frontend/src/lib/api.ts` around line 150. Change the `resolvedClarifications` field type in the `generatePlan` request payload from `Record<string, string>` to `Record<string, ClarifiedAttributes>`. Add the import at the top:

```typescript
import type { ClarifiedAttributes } from '../types'
```

Then update the field:

```typescript
resolvedClarifications?: Record<string, ClarifiedAttributes>
```

- [ ] **Step 2: Update EventShop to pass the structured shape through**

`EventShop.tsx:204` already forwards whatever `handleClarificationComplete` receives. Verify the state type for `resolvedClarifications` is now `Record<string, ClarifiedAttributes>` and nothing coerces it to a string. Update the state annotation and the `onComplete` wiring:

```typescript
const [resolvedClarifications, setResolvedClarifications] =
  useState<Record<string, ClarifiedAttributes>>({})

const handleClarificationComplete = (answers: Record<string, ClarifiedAttributes>) => {
  setResolvedClarifications(answers)
  // ... existing flow unchanged
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend
pnpm typecheck
```
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/lib/api.ts eggs-frontend/src/components/EventShop.tsx
git commit -m "feat(api): accept structured resolvedClarifications payload"
```

---

### Task A5: Backend — consume structured clarifications, build clean query

**Files:**
- Modify: `eggs-api/src/types/index.ts:25` (already changed in A1 — verify)
- Modify: `eggs-api/src/routes/plan.ts:450-460`

- [ ] **Step 1: Update the body-parsing type**

In `eggs-api/src/routes/plan.ts`, find the request body type near line 450 and change:

```typescript
// BEFORE
resolvedClarifications?: Record<string, string>

// AFTER
resolvedClarifications?: Record<string, ClarifiedAttributes>
```

Add the import near the top of the file if missing:

```typescript
import type { ClarifiedAttributes } from '../types'
import { buildSearchQuery } from '../lib/query-builder'
```

- [ ] **Step 2: Apply clarifications via buildSearchQuery**

Replace the ingredient-name assignment at `plan.ts:454`. Find:

```typescript
name: body.resolvedClarifications?.[i.id] ?? i.clarifiedName ?? i.name,
```

Replace with:

```typescript
name: (() => {
  const clar = body.resolvedClarifications?.[i.id]
  if (clar) return buildSearchQuery(clar.baseName || i.name, clar.selectedOptions)
  return i.clarifiedName ?? i.name
})(),
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts
git commit -m "fix(plan): respect structured clarifications in store search queries"
```

---

### Task A6: End-to-end smoke test via Vitest integration

**Files:**
- Test: `eggs-api/src/routes/plan.test.ts` (existing — extend)

- [ ] **Step 1: Add failing integration test**

In `eggs-api/src/routes/plan.test.ts`, add a new test that exercises the full clarifier path with a structured answer and asserts the store-search function is called with a clean query. Mock the Kroger/Walmart/AI providers to capture the query they receive.

```typescript
it('passes clean search query (attributes + base name) to store providers after clarification', async () => {
  const krogerSearchSpy = vi.fn().mockResolvedValue({ success: true, data: [] })
  vi.mocked(KrogerClient.prototype.getPriceForIngredient).mockImplementation(krogerSearchSpy)

  await app.request('/api/price-plan', {
    method: 'POST',
    body: JSON.stringify({
      ingredients: [{ id: 'i1', name: 'chicken', /* ...minimum fields... */ }],
      resolvedClarifications: { i1: { baseName: 'chicken thighs', selectedOptions: ['Boneless', 'Skinless'] } },
      location: 'dallas',
      stores: ['kroger'],
    }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
  })

  expect(krogerSearchSpy).toHaveBeenCalledWith('boneless skinless chicken thighs', expect.anything())
})
```

(Adjust to match actual test harness patterns in the existing file.)

- [ ] **Step 2: Run test, confirm it passes against the new implementation**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test plan
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.test.ts
git commit -m "test(plan): verify clean search query from structured clarifications"
```

---

## Part B — Verify Issue #1 (empty winners) resolves downstream

Issue B is caused by searches returning zero candidates because of the mangled query in Issue A. After Part A lands, `selectWinner` at `bestValue.ts:212-306` should receive populated `storeResults` and produce real winners. This task adds regression coverage so it never silently reappears.

### Task B1: Regression test — winners populate when searches return candidates

**Files:**
- Test: `eggs-api/src/lib/bestValue.test.ts` (existing — extend)

- [ ] **Step 1: Add failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { selectWinner } from './bestValue'

describe('selectWinner regression', () => {
  it('returns a non-null winner when any store has a candidate for the spec', () => {
    const spec = { id: 's1', ingredientId: 'i1', name: 'chicken thighs', quantity: 1, unit: 'lb' } as any
    const storeResults = [{
      storeName: 'Kroger',
      items: [{
        ingredientId: 'i1',
        name: 'Kroger Boneless Skinless Chicken Thighs',
        unitPrice: 4.99,
        confidence: 'real',
      }],
    }] as any
    const user = { brandLocks: {}, avoidBrands: [] } as any

    const result = selectWinner(spec, storeResults, user)
    expect(result.winner).not.toBeNull()
    expect(result.winner?.item.name).toContain('Chicken Thighs')
  })
})
```

- [ ] **Step 2: Run test**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test bestValue
```
Expected: PASS (already works — test is a guardrail).

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/lib/bestValue.test.ts
git commit -m "test(bestValue): regression guard — winners populate when candidates exist"
```

---

## Part C — AI Proof URL Verification (Option #4: stricter prompt + sync verify)

### Task C1: Harden the pass-1 research system prompt

**Files:**
- Modify: `eggs-api/src/routes/plan.ts` (research system prompt near line 272)

- [ ] **Step 1: Update the prompt text**

Find the multi-line system prompt string at `plan.ts:272` and add a mandatory verification section. The prompt currently reads (paraphrased from the investigation):

```
TASK: research current prices ... Use the web_search tool to find candidates;
use web_fetch to confirm prices on actual product pages.
...
REPORT FORMAT:
- <id> | <name> | $<price> | <URL> (mark confidence: "real" if web_fetched, ...)
```

Replace that block with:

```
TASK: research current prices for the listed ingredients across grocery stores near the given location.

HARD REQUIREMENTS — these are non-negotiable:
1. For EVERY product you plan to report, you MUST call web_fetch on the candidate product URL and visually confirm BOTH the product name AND the price appear on the fetched page BEFORE recording it.
2. If web_fetch fails, returns a non-product page, or the product name / price does not appear, you MUST NOT include that URL as the proof. Either find a different URL and web_fetch that, or omit the URL and mark the item confidence:"estimated".
3. Never fabricate a URL. Every URL must come from a web_search citation OR a web_fetch you performed. If you did not web_fetch it, prefix that line with "NO-FETCH:".
4. Do NOT use web_search results alone as proof — web_search snippets are unreliable for price.

REPORT FORMAT (plain text, one store per section):
Store: <banner name>
Address/Distance: <if known>
- <ingredient id> | <product name> | $<unit price> | <URL> | FETCHED:<yes|no>
  (confidence rule: "real" ONLY if FETCHED:yes and you confirmed name+price on the page; "estimated_with_source" if FETCHED:no but URL came from a credible web_search result; "estimated" if no URL at all.)
```

- [ ] **Step 2: Update the pass-2 formatter prompt at plan.ts:333-338**

Find the pass-2 formatter block. Current text says:

```
proofUrl MUST be one of the citation URLs provided. If no citation matches an item, set proofUrl to null.
```

Replace with:

```
proofUrl MUST be set to null UNLESS the research pass line for that item contains "FETCHED:yes". If FETCHED:no or "NO-FETCH:" appears on the line, you MUST set proofUrl to null and confidence to "estimated_with_source" at most.
confidence MUST be "real" ONLY when FETCHED:yes AND the research text explicitly confirms both product name and price appeared on the fetched page. Otherwise downgrade to "estimated_with_source" or "estimated".
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts
git commit -m "fix(ai): mandate web_fetch verification in research + formatter prompts"
```

---

### Task C2: Content verifier — fetch HTML, assert product + price appear

**Files:**
- Create: `eggs-api/src/lib/content-verifier.ts`
- Test: `eggs-api/src/lib/content-verifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `eggs-api/src/lib/content-verifier.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyProductContent } from './content-verifier'

describe('verifyProductContent', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns verified:true when name tokens and price both appear in page text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Kroger Boneless Skinless Chicken Thighs — $4.99 / lb</body></html>',
    }))
    const result = await verifyProductContent('https://kroger.com/p/123', 'Boneless Skinless Chicken Thighs', 4.99)
    expect(result.verified).toBe(true)
  })

  it('returns verified:false when the page has the name but a different price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Chicken Thighs — $7.49 / lb</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/price/i)
  })

  it('returns verified:false when the page has the price but not the product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Sliced Turkey — $4.99</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/name|product/i)
  })

  it('returns verified:false when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }))
    const result = await verifyProductContent('https://ex.com/p', 'Anything', 1.00)
    expect(result.verified).toBe(false)
  })

  it('accepts $X.XX, X.XX, and X,XX price formats', async () => {
    const html = '<html><body>Product Foo — 4,99 €</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }))
    const result = await verifyProductContent('https://ex.com/p', 'Product Foo', 4.99)
    expect(result.verified).toBe(true)
  })

  it('treats fewer than 60% name-token coverage as a mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>thighs — $4.99</body></html>',
    }))
    const result = await verifyProductContent('https://ex.com/p', 'Organic Free-Range Boneless Skinless Chicken Thighs', 4.99)
    expect(result.verified).toBe(false)
  })

  it('times out gracefully after 6 seconds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
    const result = await verifyProductContent('https://slow.example', 'x', 1, { timeoutMs: 50 })
    expect(result.verified).toBe(false)
    expect(result.reason).toMatch(/timeout|abort/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test content-verifier
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `eggs-api/src/lib/content-verifier.ts`:

```typescript
export interface VerifyResult {
  verified: boolean
  reason?: string
}

export interface VerifyOptions {
  timeoutMs?: number
  minNameCoverage?: number
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'or'])

function extractTextFromHtml(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return noScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
}

function priceAppears(text: string, price: number): boolean {
  const dollars = Math.floor(price)
  const cents = Math.round((price - dollars) * 100).toString().padStart(2, '0')
  const formats = [
    `$${dollars}.${cents}`,
    `${dollars}.${cents}`,
    `${dollars},${cents}`,
    `$ ${dollars}.${cents}`,
  ]
  return formats.some(f => text.includes(f))
}

function nameCoverage(text: string, name: string): number {
  const tokens = name.toLowerCase().split(/[\s\-_/]+/).filter(t => t.length > 2 && !STOP_WORDS.has(t))
  if (tokens.length === 0) return 1
  const hits = tokens.filter(t => text.includes(t)).length
  return hits / tokens.length
}

export async function verifyProductContent(
  url: string,
  productName: string,
  price: number,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 6000
  const minCoverage = opts.minNameCoverage ?? 0.6

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; EggsBot/1.0)' },
    })
    if (!res.ok) return { verified: false, reason: `http_${res.status}` }
    const html = await res.text()
    const text = extractTextFromHtml(html)

    const coverage = nameCoverage(text, productName)
    if (coverage < minCoverage) return { verified: false, reason: `name_coverage_${coverage.toFixed(2)}` }

    if (!priceAppears(text, price)) return { verified: false, reason: 'price_not_found' }

    return { verified: true }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { verified: false, reason: 'timeout' }
    return { verified: false, reason: `fetch_error_${err?.message ?? 'unknown'}` }
  } finally {
    clearTimeout(t)
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test content-verifier
```
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/lib/content-verifier.ts eggs-api/src/lib/content-verifier.test.ts
git commit -m "feat(ai): add verifyProductContent for HTML-parse proof verification"
```

---

### Task C3: Wire content verifier into reconciliation

**Files:**
- Modify: `eggs-api/src/routes/plan.ts:697-706` (reconciliation block where `proofUrl` is assigned)

- [ ] **Step 1: Add the import**

At the top of `plan.ts`:

```typescript
import { verifyProductContent } from '../lib/content-verifier'
```

- [ ] **Step 2: Call verifier after HEAD validation, before assigning proofUrl**

Find the reconciliation block near line 697-706 where `validateUrls` runs and `proofUrl` is set. After the existing HEAD-validated URL set is computed, add a parallel content-verification pass:

```typescript
// existing: const verifiedUrls = await validateUrls(candidateUrls)

// new: content verification in parallel, bounded concurrency
const verifiedContentByUrl = new Map<string, boolean>()
await Promise.all(
  aiItems
    .filter(it => it.proofUrl && verifiedUrls.has(it.proofUrl))
    .map(async it => {
      const result = await verifyProductContent(it.proofUrl!, it.name, it.unitPrice)
      verifiedContentByUrl.set(it.proofUrl!, result.verified)
      if (!result.verified) {
        console.warn('[ai-verify] rejected', { url: it.proofUrl, name: it.name, price: it.unitPrice, reason: result.reason })
      }
    }),
)

// when assigning final item fields, downgrade unverified:
const finalItems = aiItems.map(it => {
  const urlOk = it.proofUrl && verifiedUrls.has(it.proofUrl)
  const contentOk = it.proofUrl ? verifiedContentByUrl.get(it.proofUrl) === true : false
  if (!urlOk || !contentOk) {
    return { ...it, proofUrl: undefined, confidence: 'estimated' as const }
  }
  return it
})
```

(Integrate with the existing variable names in that block — this snippet shows the shape; adapt to match the actual destructuring already present.)

- [ ] **Step 3: Run existing plan route tests**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
pnpm test plan
```
Expected: existing tests pass; any that break on the stricter confidence downgrade need their fixtures updated (expected behavior).

- [ ] **Step 4: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts
git commit -m "fix(ai): reject AI proof URLs whose pages don't show the named product at the quoted price"
```

---

### Task C4: Add metric/log for verification rejection rate

**Files:**
- Modify: `eggs-api/src/routes/plan.ts` (same reconciliation block)

- [ ] **Step 1: Emit a structured summary log**

Right after the verification Promise.all in C3, add:

```typescript
const totalChecked = verifiedContentByUrl.size
const rejected = Array.from(verifiedContentByUrl.values()).filter(v => !v).length
console.log('[ai-verify] summary', { totalChecked, rejected, rejectionRate: totalChecked ? rejected / totalChecked : 0 })
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-api/src/routes/plan.ts
git commit -m "chore(ai): log content-verification rejection rate per plan"
```

---

## Part D — Pricing/Savings Graphs on Best-Basket View

### Task D1: Lock down Candidate/StoreItem field names used for cost attribution

**Files:**
- Read: `eggs-frontend/src/types.ts` (Candidate / WinnerResult)
- Read: `eggs-api/src/types/index.ts` (StoreItem / Candidate)

- [ ] **Step 1: Confirm the exact fields available on `winner.item`**

Open both type files and verify the field names that give: the store name, the unit price, and the quantity to multiply by. Expected from the investigation:
- `WinnerResult.winner: Candidate | null`
- `Candidate.item.storeName: string` (verify)
- `Candidate.item.unitPrice: number`
- `WinnerResult.spec.quantity: number`

If the actual field is `.store`, `.storeBanner`, or `.store.name` instead of `.storeName`, record the correct path. The chart in D3 will use exactly this path.

- [ ] **Step 2: Write findings into the task (no commit needed)**

Record the confirmed path here as a comment in the chart file in the next task.

---

### Task D2: Extract CostBreakdownChart component

**Files:**
- Create: `eggs-frontend/src/components/CostBreakdownChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

export interface StoreTotal {
  name: string
  value: number
}

interface Props {
  data: StoreTotal[]
  height?: number
}

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6']

export const CostBreakdownChart: React.FC<Props> = ({ data, height = 256 }) => {
  if (data.length === 0) return null
  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <h3 className="text-sm font-medium text-slate-300 mb-3">Cost by store</h3>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
              {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default CostBreakdownChart
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/components/CostBreakdownChart.tsx
git commit -m "feat(ui): extract CostBreakdownChart reusable component"
```

---

### Task D3: Compute store totals in BestBasketView and render chart

**Files:**
- Modify: `eggs-frontend/src/components/BestBasketView.tsx`

- [ ] **Step 1: Add the computation + render**

At the top of `BestBasketView.tsx`:

```typescript
import { useMemo } from 'react'
import CostBreakdownChart, { type StoreTotal } from './CostBreakdownChart'
```

Inside the component body, compute store totals from `winners` (adjust `storeName` path based on Task D1 findings):

```typescript
const storeTotals: StoreTotal[] = useMemo(() => {
  const totals = new Map<string, number>()
  for (const wr of winners) {
    if (!wr.winner) continue
    const storeName = wr.winner.item.storeName // VERIFY path in Task D1
    const qty = wr.spec.quantity ?? 1
    const cost = wr.winner.item.unitPrice * qty
    totals.set(storeName, (totals.get(storeName) ?? 0) + cost)
  }
  return Array.from(totals, ([name, value]) => ({ name, value }))
}, [winners])
```

In the JSX, render the chart above `<BestBasketList>`:

```tsx
{storeTotals.length > 0 && <CostBreakdownChart data={storeTotals} />}
<BestBasketList ... />
```

- [ ] **Step 2: Visual smoke test**

```bash
cd /Users/jonathanaulson/Projects/eggs
pnpm dev
```

Open `http://localhost:5173`, sign in, generate a plan, and confirm the pie chart appears above the winners list with correct per-store totals.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/components/BestBasketView.tsx
git commit -m "feat(ui): restore cost-by-store pie chart on best-basket view"
```

---

### Task D4: Unit-test the store-totals computation

**Files:**
- Create: `eggs-frontend/src/components/BestBasketView.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BestBasketView from './BestBasketView'

describe('BestBasketView cost chart', () => {
  it('renders CostBreakdownChart with one entry per distinct store summing qty × unitPrice', () => {
    const winners = [
      { spec: { id: 's1', quantity: 2 }, winner: { item: { storeName: 'Kroger', unitPrice: 3.00 } } },
      { spec: { id: 's2', quantity: 1 }, winner: { item: { storeName: 'Walmart', unitPrice: 5.00 } } },
      { spec: { id: 's3', quantity: 3 }, winner: { item: { storeName: 'Kroger', unitPrice: 2.00 } } },
    ] as any
    const plan = { stores: [], winners } as any

    render(<BestBasketView plan={plan} winners={winners} onReset={() => {}} eventId={null} getToken={async () => null} />)

    expect(screen.getByText(/cost by store/i)).toBeInTheDocument()
    // Tooltips render totals on hover — assert via legend text presence:
    expect(screen.getByText('Kroger')).toBeInTheDocument()
    expect(screen.getByText('Walmart')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend
pnpm test BestBasketView
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add eggs-frontend/src/components/BestBasketView.test.tsx
git commit -m "test(ui): cost chart renders and aggregates per store from winners"
```

---

## Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api && pnpm test
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend && pnpm test
```
Expected: all PASS.

- [ ] **Step 2: Typecheck both packages**

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api && pnpm typecheck
cd /Users/jonathanaulson/Projects/eggs/eggs-frontend && pnpm typecheck
```

- [ ] **Step 3: Run the E.G.G.S. browser smoke test (Playwright MCP)**

Trigger the `eggs-browser-test` skill and walk the full flow: sign-in → create plan → answer a clarifier question with 2 specific options (e.g. "Boneless" + "Skinless" for chicken) → verify the winners list is populated with real store matches that reflect those options → click a proof URL and confirm the landing page actually shows the product + price → confirm the cost-by-store pie chart renders above the winners list.

- [ ] **Step 4: Update TEST-COVERAGE.md**

Add rows for: clarifier structured-answer fidelity, buildSearchQuery, verifyProductContent, BestBasketView chart rendering, and the bestValue regression guard.

- [ ] **Step 5: Final commit + push**

```bash
cd /Users/jonathanaulson/Projects/eggs
git add TEST-COVERAGE.md
git commit -m "docs: update TEST-COVERAGE for best-basket quality fixes"
git push
```

---

## Out of Scope (explicit non-goals)

- Changing the clarifier LLM prompt structure (resolver.ts already emits clean structured options — the bug was purely in how the frontend serialized the answer).
- Adding OpenAI web_fetch support (that provider lacks server-side browsing tools; continue to route proof-URL-requiring work through Anthropic).
- Replacing recharts with a lighter chart lib.
- Re-enabling LegacyPlanView — once winners are populated it will stay hidden behind the existing `if (winners.length > 0)` gate in `PlanResult.tsx:237-244`.
