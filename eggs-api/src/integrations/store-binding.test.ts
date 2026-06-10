import { describe, it, expect } from 'vitest'
import { getBindingRecipe, assertStoreBinding, bannerDomain } from './store-binding'
import type { StoreIdentity } from '../types/index.js'

const HEB_STORE: StoreIdentity = {
  banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
  storeAddress: '6001 Central Expy, Plano, TX 75023', distanceMiles: 4.2, retailerStoreId: '790',
}

describe('bannerDomain', () => {
  it('maps known banners to their domains', () => {
    expect(bannerDomain('H-E-B')).toBe('heb.com')
    expect(bannerDomain('Tom Thumb')).toBe('tomthumb.com')
    expect(bannerDomain('Sprouts Farmers Market')).toBe('shop.sprouts.com')
    expect(bannerDomain('Whole Foods Market')).toBe('wholefoodsmarket.com')
  })
  it('returns null for unknown banners', () => {
    expect(bannerDomain('Bob Grocery')).toBeNull()
  })
})

describe('assertStoreBinding', () => {
  it('passes when the page store indicator mentions the expected store city/name token', () => {
    const page = "You're shopping Plano H‑E‑B!  Curbside available"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('fails when the indicator names a different store', () => {
    const page = "You're shopping Victoria H‑E‑B plus!"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('fails when no store indicator is present at all', () => {
    expect(assertStoreBinding('Just a product page. $4.98', HEB_STORE)).toBe(false)
  })
  it('matches on retailerStoreId appearing in page payload', () => {
    const page = 'data-store-id="790" Add to cart'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('does NOT false-positive on an unrelated number matching the store id', () => {
    const page = 'Only 790 left in stock!'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('matches "my store" indicator phrasing with city token', () => {
    const page = 'My Store: Plano #790\nWeekly ad'
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('survives a store with no address (uses storeName tokens only)', () => {
    const noAddr: StoreIdentity = { banner: 'Target', bannerNormalized: 'target', storeName: 'Target Frisco North' }
    expect(assertStoreBinding("You're shopping Frisco North", noAddr)).toBe(true)
    expect(assertStoreBinding("You're shopping Dallas Central", noAddr)).toBe(false)
  })
  it('curly apostrophe indicator still vetoes a wrong store even when store id appears in field context', () => {
    const page = "You're shopping Victoria H-E-B! data-store-id=\"790\""
    expect(assertStoreBinding(page, HEB_STORE)).toBe(false)
  })
  it('curly apostrophe indicator matches the right store', () => {
    const page = "You're shopping Plano H-E-B!"
    expect(assertStoreBinding(page, HEB_STORE)).toBe(true)
  })
  it('token matching is word-bounded — "McAllen" must not match store "Allen"', () => {
    const allen: StoreIdentity = { banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Allen' }
    expect(assertStoreBinding("You're shopping McAllen H-E-B!", allen)).toBe(false)
    expect(assertStoreBinding("You're shopping Allen H-E-B!", allen)).toBe(true)
  })
  it('a single address street-token overlap is not sufficient (storeName token or >=2 address tokens required)', () => {
    expect(assertStoreBinding("You're shopping Dallas Central H-E-B!", HEB_STORE)).toBe(false)
    expect(assertStoreBinding("You're shopping Central Expy H-E-B!", HEB_STORE)).toBe(true)
  })
})

describe('getBindingRecipe', () => {
  // TODO(spike): when the first real recipe is promoted to RECIPES, pin its kind + builder output here.
  it('returns a recipe object for every known banner (none is acceptable)', () => {
    const r = getBindingRecipe('h-e-b')
    expect(r).toBeDefined()
    expect(['url', 'cookie', 'actions', 'none']).toContain(r.kind)
    // Verify self-normalizing: raw uppercase should behave identically to normalized
    const rUpper = getBindingRecipe('H-E-B')
    expect(rUpper).toEqual(r)
  })
  it('returns kind none for unknown banners', () => {
    expect(getBindingRecipe('bob grocery').kind).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Real captured page fixtures — Sprint-0 spike, 2026-06-09.
// Snippets pasted VERBATIM from scripts/spike-store-binding.ts output
// (docs/superpowers/research/2026-06-store-binding-captures.json). These prove
// assertStoreBinding behaves correctly against actual retailer markdown.
//
// Spike result: NO binding recipe cracked for any priority banner — RECIPES is
// empty, every banner caps at page_verified_unbound. See
// docs/superpowers/research/2026-06-store-binding-findings.md.
// ---------------------------------------------------------------------------
describe('real captured page fixtures (spike 2026-06)', () => {
  // H-E-B unbound PDP scrape (heb.com/product-detail/.../1279801). The hyphen in
  // "H‑E‑B" is U+2011 (non-breaking) — normalizeText folds it to ASCII '-'.
  const CAPTURED_HEB =
    " 6g\n\n  - Vitamin A\n    - 8%\n  - Calcium\n    - 20%\n  - Vitamin C\n    - 0%\n  - Iron\n    - 2%\n\n#### Ingredients\n\nOrganic Cultured Grade A Milk, Organic Cream.\n\n- ## Instructions\n\n- ## More information\n\nYou're shopping Victoria H‑E‑B plus!\n\nNot your H-E-B? Select your preferred location."

  it('H-E-B real page: binds to the rendered store (Victoria), rejects a different store', () => {
    // The page actually rendered "Victoria H‑E‑B plus" — the unbound scrape
    // landed on H-E-B's DEFAULT store (Victoria, TX), NOT our Dallas store.
    const renderedStore: StoreIdentity = {
      banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Victoria',
    }
    expect(assertStoreBinding(CAPTURED_HEB, renderedStore)).toBe(true)

    const otherStore: StoreIdentity = {
      banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Galleria Houston',
    }
    expect(assertStoreBinding(CAPTURED_HEB, otherStore)).toBe(false)
  })

  it('H-E-B real page: a Dallas/Plano target is NOT verified (binding not cracked — caps at page_verified_unbound)', () => {
    // The honesty proof: because the page bound to Victoria, our Dallas store
    // can NEVER reach store_page_verified off this capture. No recipe promoted.
    const plano: StoreIdentity = {
      banner: 'H-E-B', bannerNormalized: 'h-e-b', storeName: 'H-E-B Plano',
      storeAddress: '6001 Central Expy, Plano, TX 75023', retailerStoreId: '790',
    }
    expect(assertStoreBinding(CAPTURED_HEB, plano)).toBe(false)
    // Registry honestly carries NO recipe for H-E-B (spike validated none).
    expect(getBindingRecipe('H-E-B').kind).toBe('none')
  })

  // Sprouts unbound PDP scrape (shop.sprouts.com/.../439553). Renders a default
  // Scottsdale AZ store via "Shopping at …" phrasing — which INDICATOR_RE does
  // NOT recognize, so no store proof is reachable. Honest: assert is false.
  const CAPTURED_SPROUTS =
    'vary based on seasonality and other factors. Estimated price is approximate and provided only for reference.\n\n## How would you like to shop?\n\nItem pricing and availability may vary.\n\nDelivery\n\n85260\n\nShopping at Scottsdale - Shea Blvd. (Store #2)\n\nEdit\n\nPickup\n\nScottsdale - Shea Blvd. (Store #2)\n\nChange store\n\nIn-Store · open 7am - 10pm\n\nScottsdale - Shea Blvd. (Store #2)\n\nChange store\n\nAlready have an account?Login now\n\nConfirm'

  it('Sprouts real page: no recognized indicator → assert false for any store (caps at page_verified_unbound)', () => {
    const dallasSprouts: StoreIdentity = {
      banner: 'Sprouts', bannerNormalized: 'sprouts', storeName: 'Sprouts Dallas Lower Greenville',
    }
    // Even the default Scottsdale store can't be "verified" — the phrasing isn't
    // a recognized indicator and there's no store-id field.
    const scottsdale: StoreIdentity = {
      banner: 'Sprouts', bannerNormalized: 'sprouts', storeName: 'Sprouts Scottsdale Shea',
    }
    expect(assertStoreBinding(CAPTURED_SPROUTS, dallasSprouts)).toBe(false)
    expect(assertStoreBinding(CAPTURED_SPROUTS, scottsdale)).toBe(false)
    expect(getBindingRecipe('Sprouts').kind).toBe('none')
  })

  // Aldi unbound PDP scrape (aldi.us/.../18649227). Default Hutchinson KS store,
  // same unrecognized "Shopping at …" phrasing.
  const CAPTURED_ALDI =
    'sonality and other factors. Estimated price is approximate and provided only for reference.\n\n## How would you like to shop?\n\nItem pricing and availability may vary.\n\nDelivery · Tomorrow, 12pm\n\n67570\n\nShopping at ALDI - OLA 71 - Hutchinson\n\nEdit\n\nPickup · available from 11:00am tomorrow\n\nALDI - OLA 71 - Hutchinson\n\nChange store\n\nIn-Store · open 9am - 8pm\n\nALDI - OLA 71 - Hutchinson\n\nChange store\n\nAlready have an account?Login now\n\nConfirm\n\nStripeM-Inner'

  it('Aldi real page: no recognized indicator → assert false for any store (caps at page_verified_unbound)', () => {
    const dallasAldi: StoreIdentity = {
      banner: 'Aldi', bannerNormalized: 'aldi', storeName: 'Aldi Dallas Forest Lane',
    }
    expect(assertStoreBinding(CAPTURED_ALDI, dallasAldi)).toBe(false)
    expect(getBindingRecipe('Aldi').kind).toBe('none')
  })

  // Central Market unbound scrape (centralmarket.com category URL) returned an
  // hCaptcha bot-wall, NOT product content. Documented: bot-walled → no binding.
  const CAPTURED_CENTRAL_MARKET =
    "www.centralmarket.com Additional security check is required\n\nwww.centralmarket.com Additional security check is required\n\nhCaptcha\n\n![Check mark](<Base64-Image-Removed>)\n\n'I am human', Select in order to trigger the challenge, or to bypass it if you have an accessibility cookie\n\nI am human"

  it('Central Market real page: bot-walled (hCaptcha) → assert false (unbindable via this fetch path)', () => {
    const dallasCM: StoreIdentity = {
      banner: 'Central Market', bannerNormalized: 'central market', storeName: 'Central Market Dallas Lovers Lane',
    }
    expect(assertStoreBinding(CAPTURED_CENTRAL_MARKET, dallasCM)).toBe(false)
    expect(getBindingRecipe('Central Market').kind).toBe('none')
  })
})
