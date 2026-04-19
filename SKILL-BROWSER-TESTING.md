# E.G.G.S. Browser Smoke Test — Skill Runbook

*Drive prod (or preview) through Playwright MCP to verify the full shopping-list flow end-to-end.*

---

## Prerequisites

1. **Playwright MCP tools must be loaded.** They're deferred by default — load them with:
   ```
   ToolSearch(query: "+playwright browser navigate snapshot click type evaluate wait")
   ```
   Tools needed: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_evaluate`, `browser_wait_for`, `browser_console_messages`, `browser_network_requests`.

2. **Test credentials must be seeded.** Check `.env.test.local` at repo root:
   ```bash
   test -f /Users/jonathanaulson/Projects/eggs/.env.test.local && echo ok || echo MISSING
   ```
   If missing, seed first:
   ```bash
   # Requires /Users/jonathanaulson/Projects/eggs/.env.seed.local with
   # CLERK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
   cd /Users/jonathanaulson/Projects/eggs && npm run seed-test-users
   ```
   This creates / rotates:
   - `eggs-test-pro@aulson.pro` — subscription_tier=pro, bypasses free-limit paywall
   - `eggs-test-free@aulson.pro` — subscription_tier=free, tests paywall

3. **Wrangler authed to the right Cloudflare account** (for tail):
   ```bash
   cd /Users/jonathanaulson/Projects/eggs/eggs-api && npx wrangler whoami
   ```
   Should show email `jonathan@aulson.pro`. Account ID `fbb20e771b802596ecf22cef729e4879`.

---

## The full flow

### Step 1 — Start tail in background

```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler tail --format pretty
```
Run with `run_in_background: true` so you can keep driving the browser. Note the background task id — you'll read it at the end.

### Step 2 — Mint a Clerk sign-in ticket (zero-password, zero-OTP)

Default to the **pro** user. Switch to `free` only when testing the paywall.

```bash
cd /Users/jonathanaulson/Projects/eggs
TICKET_URL=$(npm run -s mint-sign-in-token pro 2>&1 | tail -1)
echo "$TICKET_URL" > /tmp/ticket-url.txt
```

Under the hood this calls `clerkClient.signInTokens.createSignInToken({ userId })` with the test user's Clerk ID from `.env.test.local`. The resulting URL has shape:
```
https://priceofeggs.online/sign-in?__clerk_ticket=<single-use JWT>
```
The token is one-shot, expires in 5 min, and bypasses password + MFA + device verification by design.

### Step 3 — Navigate Playwright to the ticket URL

```
browser_navigate(url: <TICKET_URL>)
```

Then `browser_wait_for(text: "Pro Test User", time: 10)` — Clerk's SDK consumes the `__clerk_ticket` query param, establishes a session, and redirects to `/dashboard`. Takes 1–3 seconds after the navigate; wait_for bridges the gap.

Expected landing: `/dashboard` with the greeting "Hey, Pro Test User 👋" and a PRO badge in the header.

**If the ticket doesn't consume** (rare; usually expired >5min or stale session):
1. Clear the stale session first: `browser_evaluate(function: "async () => { if (window.Clerk) { await window.Clerk.signOut() } })"`
2. Mint a fresh token (re-run Step 2).
3. Navigate again.

**Password-based sign-in is still available** as a fallback — credentials are in `.env.test.local` as `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`. Only useful if you're specifically testing the password UI itself. Device verification will fire on a fresh browser and will require email OTP (see note below).

**About OTP receipt:** Currently no automated OTP retrieval. If you ever need to exercise the password-reset / email-code / device-verify flow, either ask the user to paste the code, or activate `eggs-email-catcher` (already deployed, dormant — needs a real domain with MX → Cloudflare to receive mail).

### Step 4 — Create a shopping list

From `/dashboard`:
1. `browser_click(ref: <New Shopping List>)` → lands at `/plan`
2. Optionally bump Max Stores slider (default 3) via `browser_evaluate`:
   ```js
   () => {
     const s = document.querySelector('input[type=range][value="3"]');
     if (s) {
       const n = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       n.call(s, '5');
       s.dispatchEvent(new Event('input', { bubbles: true }));
       s.dispatchEvent(new Event('change', { bubbles: true }));
     }
   }
   ```
3. Add ingredients via the textbox (use `submit: true` to press Enter after each):
   - `1 bunch fresh basil`
   - `1 lb unsalted butter`
   - `2 lbs chicken thighs`
   - `1 loaf sourdough bread`
4. `browser_click(ref: <Find Best Prices>)`
5. `browser_wait_for(text: "Shopping Plan Ready", time: 60)` — the AI + Walmart pass typically takes 20-40s.

### Step 5 — Verify results

Take a snapshot. Expect:
- **Kroger** store card with `Live API` label, real `kroger.com/p/…` product URLs, proof links
- **Walmart** store card with `Live API` label, `goto.walmart.com/c/<PUBLISHER_ID>/…` affiliate URLs on all 4 items
- **3+ AI-sourced stores** (Whole Foods, Sprouts, Central Market, etc.) with `AI search` label
- **Every row** has a clickable Shop link icon — NO em-dashes in the Shop column for available items
- Confidence badges: `Live` (direct-API), `Sourced` (web_fetched), `Est.` (unconfirmed)
- Unknown banners fall back to Google-scoped search URLs (still valid clicks)

### Step 6 — Read the tail and confirm no red flags

Pull the tail's latest output. Look for:
- `[searchNonApiStores] stopReason: tool_use | ... | toolCalls: 1` ← structured output fired
- `[searchNonApiStores] record_shopping_plan returned N stores` where N ≥ 3
- `[plan] results → kroger items: N  walmart items: N  ai stores: N` — all non-zero
- **No** `[walmart] searchProducts status 401` entries
- **No** `[anthropic] API error` entries
- If you see `[searchNonApiStores] model did not call record_shopping_plan`, the structured-output contract broke — escalate.

### Step 7 — Cache verification (optional, second run)

Immediately rerun the same plan with the same ingredients. In tail:
- Walmart API calls still fire (Walmart is direct-API, not cached at this layer)
- Anthropic `web_search` activity should be **near-zero** — cached items served from `URL_CACHE` KV
- Response latency drops noticeably

To inspect the cache:
```bash
cd /Users/jonathanaulson/Projects/eggs/eggs-api
npx wrangler kv key list --binding URL_CACHE | head
```
Keys match `item:v1:<banner-slug>:<ingredient-hash>`.

---

## Variations

### Testing the paywall (use free account)

Skip Step 2's default and read `FREE_TEST_USER_EMAIL` / `FREE_TEST_USER_PASSWORD` instead. Expected behavior:
- Free user can create up to `FREE_MONTHLY_LIMIT` (default 3) shopping plans / events per month
- On the 4th attempt: POST `/api/price-plan` returns 403 with body `{"error":"free_limit_reached",…}`
- Frontend renders the upgrade paywall card, not a generic error

### Testing against a staging/preview worker

Change the base URL in Step 3 (`browser_navigate`) to the frontend staging URL. The frontend must be pointed at the correct API worker via `VITE_API_BASE_URL` env var.

### Fresh browser profile / cookie wipe

```
browser_evaluate(function: "() => { document.cookie.split(';').forEach(c => { document.cookie = c.split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT'; }); localStorage.clear(); }")
```
Then rerun Step 3. Warning: device verification will re-fire.

---

## When to run this skill

- After changes to: `eggs-api/src/routes/plan.ts`, `providers/anthropic.ts`, `integrations/kroger.ts`, `integrations/walmart.ts`, `integrations/store-urls.ts`, `lib/url-validator.ts`, `middleware/auth.ts`, any Supabase schema
- Before every `wrangler deploy` to prod
- When diagnosing a user-reported bug in plan results
- As the tail of a Cloudflare deploy pipeline (future automation)

## When NOT to run this skill

- Unit-level testing — `cd eggs-api && npm test` is faster
- Frontend-only tweaks (styles, copy) — `cd eggs-frontend && npm test` + visual check
- Auth/middleware refactors that should run through full Playwright suite — `npm run test:e2e:smoke` instead

---

## Known gotchas

- **Clerk device verification** fires on every new MCP browser profile. Keep a single MCP session alive for as long as possible. Session cookies persist.
- **Walmart 401** usually means the private key in Worker secrets doesn't match the public key Walmart has on file. Re-run `wrangler secret put WALMART_PRIVATE_KEY < walmart_rsa_key_prod` from `eggs-api/`.
- **`web_search` tool rejected** with "does not support programmatic tool calling" means `allowed_callers: ['direct']` is missing from the tool definition in `plan.ts`.
- **`record_shopping_plan` not called** — the model narrated instead of finishing. Check the prompt still says "call record_shopping_plan EXACTLY ONCE as the last action". If the model's still ignoring it, consider two-pass: first call for research, second call for JSON-only formatting.
- **Test user data pollutes prod Supabase.** Plans and events accumulate. Filter out `is_test_account = true` users from analytics queries.

## Credentials handling

- Test-user passwords DO pass through `browser_type` tool calls → transcript. Tradeoff we accepted; rotate via `npm run seed-test-users` whenever a transcript is exported externally.
- `CLERK_SECRET_KEY` / `SUPABASE_SERVICE_KEY` never pass through chat — stored only in `.env.seed.local` on disk.
- After `.env.seed.local` use, scrub with `rm /Users/jonathanaulson/Projects/eggs/.env.seed.local` to minimize on-disk exposure.
