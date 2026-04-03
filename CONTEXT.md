# CONTEXT.md — E.G.G.S.

Everything needed to work on E.G.G.S. productively in a new Claude session.

---

## What It Is

An AI-powered grocery planning and price optimization tool for private event chefs and caterers. Input: a menu and headcount. Output: a scaled ingredient list, multi-store shopping plan, and cost estimate. Built around an event planning workflow — not a one-off price check, but a professional tool chefs use every time they plan an event.

The acronym: **Explore** (AI scales menu to ingredient list), **Gather** (price discovery via official APIs + AI web search), **Group** (multi-store shopping plan optimization), **Save** (cost tracking and event reporting).

---

## Origin

Evolved from two prior projects:
- `grocery-hunt-ai` — full-stack FastAPI + MongoDB + React implementation that used Capsolver for scraping. Abandoned as a product due to scraping dependency. May contain useful business logic to port.
- `eggs` (Google AI Studio export) — single-commit prototype demonstrating the core AI loop with Gemini search grounding. This is the starting point for the rewrite.

---

## Tech Stack (Target)

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind |
| Auth | Supabase Auth |
| Database | Supabase Postgres |
| AI — recipe scaling | Anthropic Claude (structured output) |
| AI — price discovery | Gemini with Google Search grounding |
| Provider abstraction | Empire LiteLLM wrapper |
| API proxy | Cloudflare Workers (Hono) |
| Hosting | Cloudflare Pages |
| Billing | Stripe |

---

## Repo Location

- Local: /Users/jonathanaulson/Projects/eggs (or consider renaming to `eggs-app` or `price-of-eggs`)
- GitHub: https://github.com/AustiNight/eggs

---

## Key Design Decisions

**No scraping.** Price data comes from: Kroger API (official), Walmart API (TBD), Gemini search grounding for other stores, and user-logged price history. Never Capsolver or similar.

**Event-first, not list-first.** The primary unit is an event (e.g., "40-person dinner party, Saturday"). Events contain dishes. Dishes generate ingredient lists. This is what differentiates E.G.G.S. from a grocery comparison app.

**Mobile-responsive is required.** Chefs shop on their phones. The UI must work well on mobile from day one, not as an afterthought.

**Design partner.** Founder's fiancée is a private event chef and co-creator of the original concept. She is the first user and primary design partner. All v1 feature decisions should be validated with her before building.

---

## Price Discovery Architecture

```
User inputs menu + headcount
        ↓
Claude: scale recipes → ingredient list with quantities
        ↓
For each ingredient:
  1. Kroger API → price + loyalty price (if available)
  2. Walmart API → price (if available)
  3. Gemini search grounding → public prices from other stores
  4. User price history → override/supplement with known prices
        ↓
Optimizer: build multi-store shopping plan minimizing total cost
(accounting for configurable store preferences and drive time)
        ↓
Output: per-store list + estimated total + savings vs. single-store
```

---

## Kroger API Notes

Kroger has a public developer API (developer.kroger.com). It provides:
- Product search with pricing
- Loyalty card pricing
- Store locator
- OAuth 2.0 authentication required
- Free tier available

This is the highest-priority official integration. Covers Kroger, Ralphs, Fred Meyer, King Soopers, Smith's, and other Kroger-owned chains.

---

## What to Read Before Working on This

- `DECISIONS.md` — strategic context on the pivot and why
- `STATUS.md` — what exists vs. what needs to be built
- Existing prototype in `/eggs` repo — understand the Gemini search grounding implementation before replacing it
