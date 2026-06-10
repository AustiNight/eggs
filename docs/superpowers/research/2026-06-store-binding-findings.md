# Store-binding spike findings — 2026-06

**Task 7 (WS1).** LIVE spike: can a product-page fetch be BOUND to a concrete
store per priority US grocery banner? Authorized credit burn.

- **Harness:** `scripts/spike-store-binding.ts`
- **Raw captures:** `docs/superpowers/research/2026-06-store-binding-captures.json`
- **Date:** 2026-06-09
- **Firecrawl credits used (est):** **14 / 60 budget** (8 basic scrapes + 3 action scrapes)
- **Serper calls:** 7 shopping queries. **Tavily calls:** 7 searches.
- **Context:** Dallas, Texas (`Dallas, Texas, United States`); store-picker ZIP `75201`.

## Method

Per banner, the harness runs our own pipeline end-to-end (no hand-guessed URLs):

1. `SerperClient.shopping("<staple> <banner>", "Dallas, Texas, United States")` → a real product candidate.
2. `TavilyClient.search(..., { includeDomains: [bannerDomain] })` → a real product-page URL on the banner's own domain.
3. **Unbound** Firecrawl scrape (basic `proxy: auto`) → did a store-indicator render? Capture exact text + ~500-char snippet.
4. ≤2 binding **levers** where an indicator rendered: a guessed store cookie and/or a Firecrawl `actions` script (open store picker → type ZIP 75201 → wait → re-scrape). Did the indicator rebind to a Dallas-area store?

A lever is only a **validated recipe** if, after applying it, `assertStoreBinding(boundPage, targetDallasStore)` returns **true** for the intended store. "The store-picker modal opened" is **not** a binding.

## Verdict table

| Banner | Domain | Unbound scrape | Indicator rendered | Indicator text (verbatim) | Lever cracked binding? | Verdict |
|---|---|---|---|---|---|---|
| **H-E-B** | heb.com | OK | Yes | `You're shopping Victoria H‑E‑B plus!` | **No** | **indicator renders, binding not cracked — caps at `page_verified_unbound`** |
| **Central Market** | centralmarket.com | **hCaptcha wall** | n/a | (bot challenge page) | n/a | **bot-walled — unbindable via this fetch path** |
| **Tom Thumb** | tomthumb.com | OK | No | (none — Albertsons SSR omits a bound store) | n/a | **no indicator — unbindable for now** |
| **Target** | target.com | OK | No¹ | `Ship to 23462 / Pembroke` (ship-to ZIP, not a store) | n/a | **no store indicator — unbindable for now** |
| **Sprouts** | shop.sprouts.com | OK | Yes² | `Shopping at Scottsdale - Shea Blvd. (Store #2)` | **No** | **indicator renders, binding not cracked — caps at `page_verified_unbound`** |
| **Aldi** | aldi.us | OK | Yes² | `Shopping at ALDI - OLA 71 - Hutchinson` | **No** | **indicator renders, binding not cracked — caps at `page_verified_unbound`** |
| **Trader Joe's** | traderjoes.com | OK (cookie banner only) | No | (cookie-consent gate; no e-commerce PDP content) | n/a | **no indicator — unbindable for now** |

¹ Target prints a *ship-to ZIP* ("Ship to 23462 / Pembroke" — a Virginia Beach default), not a pickup-store identity. Not a store binding.
² Sprouts and Aldi use the phrase **"Shopping at \<store\>"**, which the registry's `INDICATOR_RE` does NOT recognize (it matches only "You're shopping" / "my store" / "your store"). So `assertStoreBinding` correctly returns **false** on these captures — no store_page_verified reachable today.

## Bottom line

**No binding recipe cracked. RECIPES stays empty.** Every priority banner caps at
`page_verified_unbound` (price/product confirmed on the merchant page, but the page
is bound to the retailer's *default* store, not the user's Dallas store).

This is the honest, expected outcome for a first spike against bot-defended retail
sites — and it is exactly what the honesty architecture is built for: a `none`
recipe can never mislabel an item "verified."

## Per-banner detail

### H-E-B — indicator renders, binding NOT cracked

The unbound scrape of a real PDP (`heb.com/product-detail/.../1279801`) cleanly
renders H-E-B's canonical indicator:

```
You're shopping Victoria H‑E‑B plus!

Not your H-E-B? Select your preferred location.
```

(The hyphen is U+2011 non-breaking hyphen; `normalizeText` folds it to ASCII `-`.)

- **Cookie lever** (`CURR_SESSION_STORE=38`): page **unchanged** — still Victoria.
  The cookie name/value were guesses; H-E-B's store session is not set by this cookie on an unauthenticated Firecrawl fetch.
- **Actions lever** (open store picker → type ZIP 75201 → wait): the indicator
  *string* changed to `Selected Store` / `Select a store` — but inspection of the
  captured markdown shows this is just the **store-picker modal opening**. It still
  lists **Victoria** stores ("Victoria H‑E‑B plus! Selected Store", "59 and Laurent
  H-E-B", all Victoria TX 779xx). The ZIP write did not land in the modal's search
  field, so **no rebind to Dallas occurred**. `assertStoreBinding(boundAttempt,
  PlanoStore)` is **false** — correctly.

**Endpoint note:** H-E-B exposes store data via `cx.static.heb.com` map tiles and
`/heb-store/tx/<city>/<slug>` detail links inside the picker. A future recipe would
need to (a) drive the picker's actual search input selector, then (b) click a Dallas
store row, then (c) confirm `You're shopping <Dallas store>` rendered. Not achieved here.

→ **Caps at `page_verified_unbound`.** Recipe NOT promoted.

### Sprouts — "Shopping at" indicator, default AZ store, not cracked

Real PDP on `shop.sprouts.com` renders a fulfillment block:

```
Shopping at Scottsdale - Shea Blvd. (Store #2)
```

A Scottsdale AZ default. The ZIP-entry actions lever did not move it (the
`shop.sprouts.com` ZIP control was not reached by a bare `write`). Note this phrasing
is **not** matched by `INDICATOR_RE`, so the registry treats this page as having no
usable store proof → `assertStoreBinding` is false. Recipe NOT promoted.

→ **Caps at `page_verified_unbound`.**

### Aldi — "Shopping at" indicator, default KS store, not cracked

Real PDP on `aldi.us` renders:

```
Shopping at ALDI - OLA 71 - Hutchinson
```

A Hutchinson KS default. Same as Sprouts: ZIP lever didn't move it; phrasing not
recognized by `INDICATOR_RE`. Recipe NOT promoted.

→ **Caps at `page_verified_unbound`.**

### Central Market — bot-walled (hCaptcha)

The unbound Firecrawl scrape of the resolved category URL returned an **hCaptcha
"Additional security check is required"** challenge page, not product content. We
could not even confirm a price on the page, let alone a store binding. A different
fetch path (residential proxy, stealth, or an official API) would be needed before
binding is even a question.

→ **Unbindable via this fetch path.**

### Tom Thumb (Albertsons family) — renders, no store indicator

Real PDP on `tomthumb.com` rendered product content (Horizon Whole Milk) but printed
**no bound-store string** in the SSR markdown. Albertsons-family banners gate the
store onto an authenticated session / client-side hydration not captured by a basic
scrape.

→ **No indicator — unbindable for now.** (Kroger family is the counter-example and is
already store-bound via official API — out of scope per the spike.)

### Target — renders a ship-to ZIP, not a store

Real PDP on `target.com` rendered product content and a `Ship to 23462 / Pembroke`
label (a Virginia Beach default geo). That is a *delivery ZIP*, not a pickup-store
identity, and `INDICATOR_RE` does not (and should not) treat it as a store binding.

→ **No store indicator — unbindable for now.** (`GuestLocation` cookie lever was
queued but not reached because no usable indicator rendered to compare against.)

### Trader Joe's — no e-commerce

Trader Joe's has no online ordering. The scrape returned only a cookie-consent banner;
the PDP carries no price/store content to bind.

→ **No indicator — unbindable for now.**

## What this means for the registry

`src/integrations/store-binding.ts` `RECIPES` **stays empty `{}`**. No recipe was
validated against a real bound capture, so promoting any would violate the honesty
guarantee. The `none`-default path already handles every banner correctly: items cap
at `page_verified_unbound` and can never be mislabeled `store_page_verified`.

## Next levers worth trying (future task, not this spike)

- **H-E-B:** drive the store-picker search input by its real selector + click a
  Dallas store row; verify `You're shopping <Dallas store>` rendered. Highest-value
  target — it already prints a clean, parseable indicator.
- **Sprouts / Aldi:** both run the same fulfillment widget ("Shopping at …"). If a
  recipe is ever cracked, also extend `INDICATOR_RE` to recognize the "Shopping at
  \<store\>" phrasing (currently unmatched by design).
- **Central Market:** needs a stealthier fetch (residential proxy) to clear hCaptcha
  before binding is even testable.
- **Target:** investigate the `redsky`/`GuestLocation` cookie to flip the ship-to ZIP,
  then check whether a pickup-store identity renders.
