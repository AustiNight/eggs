# Stripe Billing — Go-Live Checklist (WS2)

*Date: 2026-06-10. The billing CODE ships test-mode-ready and fully unit-tested. These are the **Jonathan-actions** to activate it — do them in test mode first, validate, then swap to live.*

The code: `eggs-api/src/integrations/stripe.ts` (Workers client), `eggs-api/src/routes/billing.ts` (`/api/billing/checkout`, `/portal`, `/webhook`), wired into `index.ts` at `/api/billing`. Frontend: Settings + plan paywall call `startCheckout`/`openBillingPortal`. The webhook is the **only** writer of `users.subscription_*` columns.

## 1. Create the Pro product + price (Stripe Dashboard, TEST mode)
- Stripe Dashboard → toggle **Test mode** (top-right) → Products → **+ Add product**.
- Name: `E.G.G.S. Pro`. Add a **recurring price** (e.g. $19/mo). Save.
- Copy the **Price ID** (`price_…`). This is `STRIPE_PRO_PRICE_ID`.

## 2. Set worker config (test keys first)
From `eggs-api/`:
```bash
# Secret key (Dashboard → Developers → API keys → Secret key, test mode = sk_test_…)
echo "sk_test_…" | npx wrangler secret put STRIPE_SECRET_KEY
# Pro price id — it's not sensitive; can go in [vars] in wrangler.toml, or as a secret:
echo "price_…" | npx wrangler secret put STRIPE_PRO_PRICE_ID
```
(`STRIPE_SECRET_KEY` for local dev is already in `eggs-api/.dev.vars` as the test key.)

## 3. Register the webhook endpoint → get the signing secret
- Stripe Dashboard (test mode) → Developers → **Webhooks** → **+ Add endpoint**.
- Endpoint URL: `https://eggs-api.jonathan-aulson.workers.dev/api/billing/webhook`
- Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- After creating, copy the **Signing secret** (`whsec_…`):
```bash
echo "whsec_…" | npx wrangler secret put STRIPE_WEBHOOK_SECRET
```
Then `npx wrangler deploy` so the worker picks up the new config.

## 4. Local webhook test (optional but recommended)
```bash
# in eggs-api/, with wrangler dev running on :8787
stripe listen --forward-to localhost:8787/api/billing/webhook   # prints a whsec_… for local
stripe trigger checkout.session.completed
```
Confirm the worker log shows the event handled and (if a real user/customer) the row updates.

## 5. End-to-end test on priceofeggs.online (test mode)
1. Sign in as a free account → hit a free limit (or use Settings "Upgrade to Pro").
2. Complete Stripe Checkout with test card `4242 4242 4242 4242`, any future expiry/CVC/ZIP.
3. Confirm redirect to `/settings?billing=success`, and that the tier flips to **Pro** (via the webhook) within a few seconds — limits should lift without re-login.
4. Settings → **Manage subscription** → cancel in the portal → confirm tier reverts (immediately or at period end per your cancel choice).

## 6. Flip to LIVE
Once test mode is validated:
- Repeat steps 1–3 in **Live mode** (create live product/price, live webhook endpoint, live keys):
  - `STRIPE_SECRET_KEY` → `sk_live_…`, `STRIPE_PRO_PRICE_ID` → live `price_…`, `STRIPE_WEBHOOK_SECRET` → live endpoint's `whsec_…`.
- `npx wrangler deploy`.
- Do one real-card smoke purchase (then refund it in the dashboard) to confirm the live path.

## Notes
- The webhook is idempotent (KV `stripe_evt:<id>`, 3-day TTL) and verifies the signature — safe to receive Stripe's retries.
- `past_due` keeps Pro access during Stripe's dunning retries; `paused`/`canceled`/`unpaid`/`incomplete` → free. Adjust `PRO_STATUSES` in `billing.ts` if you want different dunning behavior.
- Staging (`--env staging`) needs its own Stripe secrets/price-id set with `--env staging` since CF doesn't inherit env bindings.
- The `'team'` tier referenced in some frontend code is out of scope; the webhook only writes `'free'|'pro'`.
