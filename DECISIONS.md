# DECISIONS.md — E.G.G.S.

A dated log of significant architectural and strategic decisions.

---

## Strategic

**[2026-03] Pivoted from household grocery shopper to private event chef**
Original concept (grocery-hunt-ai / early E.G.G.S. prototype) targeted household shoppers. Pivoted to private event chefs as the beachhead market. Why: household grocery comparison is brutally competitive and free-tier dominated; private chefs have a clear ROI story, a specific multi-dish workflow need, and demonstrated willingness to pay for professional tools. The co-creator of the original concept (founder's fiancée) is a private event chef — making her the design partner and first user, which is an asset not to waste.

**[2026-03] Eliminated captcha-solving / scraping dependency**
grocery-hunt-ai used Capsolver to scrape grocery sites. This was identified as a hard blocker for a product business — scraping infrastructure is fragile, legally grey, and not under our control. New data model uses: (1) official grocery APIs where available (Kroger, Walmart), (2) user's own price history built over time, (3) AI web search grounding for public price discovery. No captcha solvers. No scraping.

**[2026-03] Private chef workflow features are the differentiator**
The product is not just a price comparison tool — it is a professional workflow tool. Recipe-to-shopping-list scaling, multi-dish event planning, budget tracking, and client billing reports are the features that justify subscription pricing. Price comparison alone would not.

---

## Architecture

**[2026-03] Migrating from Google AI Studio scaffold to production stack**
Original E.G.G.S. prototype was exported from Google AI Studio: React 18 + TypeScript + Vite + Tailwind + Gemini (gemini-2.5-flash + gemini-2.0-pro-preview) with Google Search grounding + localStorage. This is a starting point, not a production architecture.

**[open] Provider strategy for v1**
Gemini with Google Search grounding is a reasonable starting point for price discovery — it can surface publicly listed prices from store websites and weekly ads without scraping. Anthropic with web search tool is an alternative. Decision: start with Gemini grounding for price discovery (it is purpose-built for this), use empire provider abstraction so we can swap. Revisit if accuracy or cost becomes a problem.

**[open] Data persistence**
localStorage (current prototype) is fine for early testing but not for a product. Options: Supabase Postgres (aligns with empire standard, free tier generous), IndexedDB + sync (local-first like protoStudio). Decision pending — lean toward Supabase for simplicity since this product needs a server component anyway (API key proxy, price history across devices).

**[open] Hosting**
Cloudflare Pages (frontend) + Cloudflare Workers (API proxy, server-side price lookups). Aligns with empire standard. No always-on server needed for v1.

---

## Open Decisions

- Which official grocery APIs to integrate first (Kroger API is confirmed public; Walmart TBD)
- Whether to build recipe scaling from scratch or use a service/library
- Pricing model: flat monthly ($19?) vs. per-event vs. freemium with paid event history
- Mobile vs. web first — chefs shop on their phones
- Whether to build a shared ingredient price database across users (privacy implications, but strong moat)
