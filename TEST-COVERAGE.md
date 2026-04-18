# E.G.G.S. Test Coverage Matrix

**Last updated:** 2026-04-18  
**Rule:** Every new feature or change that may impact automated testing must update this file — even if the automation isn't written yet. The matrix is the source of truth for what tests *should* exist.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Written & passing in CI |
| 🟡 | Written locally, not yet wired into CI |
| 📋 | Planned — test case defined, automation not yet written |
| ⏭️ | Skipped/deferred — written but marked skip |
| ➖ | N/A for this channel |

## Channels

| Column | Description |
|--------|-------------|
| **Web** | Desktop browser (Chromium / Firefox / WebKit via Playwright) |
| **MWeb** | Mobile browser viewport (Pixel 7, iPhone 15 via Playwright) |
| **iOS** | Native iOS via Capacitor + Maestro (not yet shipped) |
| **And** | Native Android via Capacitor + Maestro (not yet shipped) |

## Test Types

`Unit` · `Integration` · `E2E` · `Visual` · `Manual`

---

## Authentication

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Sign up — new user | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/auth.spec.ts` | Requires Clerk test mode |
| Sign in — valid credentials | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/auth.spec.ts` | |
| Sign out | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/auth.spec.ts` | |
| Protected route redirects unauthenticated user | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/auth.spec.ts` | |
| Clerk JWT verified by API middleware | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/auth.test.ts` | 📋 to write |
| Invalid/expired token returns 401 | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/auth.test.ts` | 📋 to write |
| Service key auth passes for internal calls | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/auth.test.ts` | 📋 to write |

---

## Dashboard

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Both sections render (Shopping Lists + Active Events) | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| "New Shopping List" button visible and navigates | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| "New Event" button visible and navigates | E2E @smoke | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Search filters both events AND lists simultaneously | E2E | ✅ | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| PRO tier badge in header for pro user | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | |
| Free tier usage bar visible for free user | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | Needs free test account |
| Free tier usage bar hidden for pro user | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | |
| Insight stat chips render when plans exist | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Spend by Store donut chart renders when data exists | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Monthly activity bar chart renders when data exists | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Empty states render for new users | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Mobile header brand + avatar stay in viewport | E2E @smoke | ✅ | ✅ | 📋 | 📋 | `e2e/plan-flow.spec.ts` | Fixed 2026-04-06 |
| Shopping list cards show summary data | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Past events collapsible section works | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |

---

## Shopping List Flow

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Navigate to /plan from dashboard | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Enter items via ShoppingListInput | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Clarification modal renders and accepts answers | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Loading state: "analyzing" phase shows | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Loading state: "discovering" phase shows | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Loading state: "searching" phase shows | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Loading state: "optimizing" phase shows | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/plan-flow.spec.ts` | |
| Plan results render on success | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |
| Available items: all 6 columns render | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Not-available items: dimmed row with — values (not omitted) | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Confidence badge: "Live" for real prices | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Confidence badge: "Est." for AI estimates | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Member Price badge shows when isLoyaltyPrice | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Store header shows "Live API" vs "AI search" label | Unit | 📋 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Total cost summary correct | Unit | 📋 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| "Shop All" button opens product URLs | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | |

---

## Upgrade Paywall

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| 403 from API renders paywall card, not generic error | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/pages/Plan.test.tsx` | |
| Non-403 errors render generic error message | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/pages/Plan.test.tsx` | |
| Paywall shows free vs pro comparison table | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/pages/Plan.test.tsx` | |
| "Upgrade to Pro" navigates to /settings | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/pages/Plan.test.tsx` | |
| "Back to my list" resets to idle | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/pages/Plan.test.tsx` | |
| Pro user has no upgrade prompts on dashboard | E2E @smoke | ✅ | 📋 | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | |
| Free user at limit sees paywall after search | E2E | ⏭️ | ⏭️ | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | Needs free test account + seeded limit |
| Paywall CTA navigates to settings | E2E | ⏭️ | ⏭️ | 📋 | 📋 | `e2e/upgrade-paywall.spec.ts` | |

---

## Price Plan API (Backend)

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Free tier: under limit → 200 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/limits.test.ts` | 🟡 |
| Free tier: plans at limit → 403 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/limits.test.ts` | 🟡 |
| Free tier: events at limit → 403 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/limits.test.ts` | 🟡 |
| Free tier: 403 body includes usage counts | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/limits.test.ts` | 🟡 |
| Pro tier: bypasses limit check | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/limits.test.ts` | 🟡 |
| Rate limiter: under limit → passes | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/ratelimit.test.ts` | 📋 Needs KV mock |
| Rate limiter: at limit → 429 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/ratelimit.test.ts` | 📋 |
| Store discovery: finds Kroger locations | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 Mock Kroger client |
| Parallel search: Kroger + Walmart + AI run simultaneously | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| Not-available padding: all ingredients present in every store | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| Plan persisted to Supabase on success | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| Event transitions to 'shopping' when plan linked | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| maxStores limit enforced in result | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |

---

## Walmart Affiliate API Integration

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| PEM parser: strips armor and decodes base64 body | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| signHeaders: produces 4 WM_* headers | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| signHeaders: canonical string uses alphabetical header order | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| signHeaders: caches imported CryptoKey across calls | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| getPriceForIngredient: maps first hit with URL | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| getPriceForIngredient: returns null when 5xx | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| getPriceForIngredient: skips items without productUrl | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/walmart.test.ts` | 🟡 |
| plan.ts: Walmart StorePlan assembled with priceSource 'walmart_api' | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| plan.ts: Walmart and Kroger run in parallel (both in Promise.allSettled) | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |

---

## URL Guarantee (shopUrl + proofUrl)

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| getShopUrl: known banner returns correct template | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/store-urls.test.ts` | 🟡 |
| getShopUrl: case-insensitive banner matching | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/store-urls.test.ts` | 🟡 |
| getShopUrl: unknown banner → Google fallback | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/store-urls.test.ts` | 🟡 |
| getShopUrl: percent-encodes special chars | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/store-urls.test.ts` | 🟡 |
| validateUrl: HEAD 2xx → true | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| validateUrl: HEAD 404 → false | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| validateUrl: HEAD 405 → retries GET-range | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| validateUrl: timeout → false | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| validateUrl: rejects malformed URL without fetch | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| validateUrls: deduplicates + returns verified Set | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/url-validator.test.ts` | 🟡 |
| plan.ts: every item in response has a non-null shopUrl | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| plan.ts: fabricated URL (not in citations) is dropped + confidence downgraded | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| plan.ts: citation URL + HEAD-ok becomes proofUrl with confidence real | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| plan.ts: 2nd request for same (banner, ingredient) within 24h uses cache (no AI call) | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| plan.ts: KV cache writes are fire-and-forget (do not block response) | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/plan.test.ts` | 📋 |
| Frontend: Shop button renders for every item (including padded not-available rows) | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/plan-flow.spec.ts` | Includes AI-sourced stores |
| Frontend: Proof button renders only when proofUrl present | Unit | 🟡 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |
| Frontend: Shop All uses shopUrl (falls back to productUrl for legacy plans) | Unit | 📋 | ➖ | ➖ | ➖ | `eggs-frontend/src/__tests__/components/PlanResult.test.tsx` | |

---

## Events

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Create new event | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/events.spec.ts` | |
| Add dish to event | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/events.spec.ts` | |
| Generate price plan from event | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/events.spec.ts` | |
| Reconcile event — receipt mode | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/events.spec.ts` | |
| Event status transitions correctly | Integration | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/events.test.ts` | 📋 |
| Completed event shows report | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/events.spec.ts` | |

---

## Open Food Facts Integration

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Barcode lookup — valid barcode returns product | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/openfoodfacts.test.ts` | 📋 Mock fetch |
| Barcode lookup — unknown barcode returns 404 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/openfoodfacts.test.ts` | 📋 |
| Barcode lookup — invalid format returns 400 | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/openfoodfacts.test.ts` | 📋 |
| Name search returns paginated results | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/openfoodfacts.test.ts` | 📋 |
| Normalized product strips OUT raw noise | Unit | ➖ | ➖ | ➖ | ➖ | `eggs-api/src/__tests__/openfoodfacts.test.ts` | 📋 |

---

## Settings

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| Settings page loads user profile | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/settings.spec.ts` | |
| Pro tier shown correctly in settings | E2E | 📋 | 📋 | 📋 | 📋 | `e2e/settings.spec.ts` | |
| Save settings updates profile | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/settings.spec.ts` | |
| Avoid stores/brands tags add and remove | E2E | 📋 | 📋 | ➖ | ➖ | `e2e/settings.spec.ts` | |

---

## Mobile Native (Capacitor — future)

| Test Case | Type | Web | MWeb | iOS | And | File | Notes |
|-----------|------|-----|------|-----|-----|------|-------|
| App launches and reaches dashboard | Maestro | ➖ | ➖ | 📋 | 📋 | `maestro/launch.yaml` | Pending Capacitor setup |
| Sign in flow completes | Maestro | ➖ | ➖ | 📋 | 📋 | `maestro/auth.yaml` | |
| Barcode scan triggers product lookup | Maestro | ➖ | ➖ | 📋 | 📋 | `maestro/barcode.yaml` | Needs camera mock |
| Push notification taps navigate correctly | Maestro | ➖ | ➖ | 📋 | 📋 | `maestro/notifications.yaml` | Pending notification setup |

---

## CI Matrix

| Workflow | Trigger | Tests Included |
|----------|---------|----------------|
| `test.yml` — unit | PR + push to main | API unit, Frontend unit |
| `test.yml` — smoke E2E | PR + push to main (after unit pass) | `@smoke` tagged E2E, Chromium only |
| `nightly.yml` — full unit | Daily 01:00 CST | All unit + coverage report |
| `nightly.yml` — full E2E | Daily 01:00 CST | All browsers + mobile viewports |
| `nightly.yml` — visual | Daily 01:00 CST | `@visual` tagged screenshot diffs |

---

## Required CI Secrets

| Secret | Used By | Description |
|--------|---------|-------------|
| `TEST_USER_EMAIL` | E2E | Pro-tier test account email |
| `TEST_USER_PASSWORD` | E2E | Pro-tier test account password |
| `FREE_TEST_USER_EMAIL` | Nightly E2E | Free-tier test account at monthly limit |
| `FREE_TEST_USER_PASSWORD` | Nightly E2E | Free-tier test account password |
| `PLAYWRIGHT_STAGING_URL` | Smoke E2E | Staging deployment URL |
| `PLAYWRIGHT_PROD_URL` | Nightly E2E | Production URL |
