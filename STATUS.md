# STATUS.md — E.G.G.S.

*Last updated: March 2026*

---

## Current State

**Early prototype.** Single commit. Exported from Google AI Studio. Functional demo but not production-ready. Strategy pivot in progress (household shopper → private event chef).

The prototype demonstrates the core AI loop: take a shopping list, clarify ambiguities via AI, search for prices with Gemini search grounding, output a multi-store shopping plan. This core mechanic is validated and worth keeping. The use case and data model are being reframed.

---

## What Exists (Prototype)

- React 18 + TypeScript + Vite + Tailwind scaffold
- Gemini 2.5 Flash + 2.0 Pro integration with Google Search grounding
- Shopping list input with AI ambiguity clarification
- Multi-store price search via Gemini grounding (not scraping)
- Shopping plan output with estimated costs
- Recharts for visualization
- localStorage for history
- Single-page app, no backend, no auth, no billing

---

## What Needs to Be Built (v1 Private Chef Product)

**Core workflow:**
- [ ] Menu/dish input (not just ingredient list — dishes that get scaled)
- [ ] AI recipe-to-ingredient scaling by headcount with waste ratio awareness
- [ ] Multi-dish event workspace (one event = multiple dishes)
- [ ] Multiple events in progress simultaneously

**Price gathering (scraping-free):**
- [x] Kroger API integration (public, free, covers significant US market)
- [x] Walmart Affiliate API integration (RSA-signed, shipped 2026-04-18)
- [x] Anthropic web_search + web_fetch tools for non-API stores with HEAD-validation + 24h KV cache (shipped 2026-04-18)
- [x] Deterministic search-landing URL fallback per banner → guarantees a Shop link on every row
- [ ] Instacart Developer Platform — deferred pending IDP access approval (requested 2026-04-18); covers Kroger/Albertsons/Publix/Aldi/Costco via a single API when approved
- [ ] User price history — log what you actually paid, surface next time

**Output and tracking:**
- [ ] Multi-store shopping plan split by store
- [ ] Estimated total with per-store breakdown
- [ ] Loyalty card pricing acknowledgment
- [ ] Actual vs. estimated spend tracking
- [ ] Per-event cost report (for client billing / future event pricing)

**Infrastructure:**
- [ ] Supabase Auth + Postgres (replace localStorage)
- [ ] Cloudflare Workers API proxy (keep API keys off client)
- [ ] Stripe billing
- [ ] Mobile-responsive design (chefs shop on their phones)

---

## Immediate Next Steps

1. Confirm v1 scope with founder and fiancée (design partner / first user)
2. Explore Kroger API capabilities and coverage
3. Decide on data persistence (Supabase recommended)
4. Scaffold the event planning workspace UI
5. Reuse Gemini search grounding from prototype for price discovery
