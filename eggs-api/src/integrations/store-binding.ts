// Store-binding registry (WS1). A "binding recipe" scopes a product-page fetch
// to a concrete store. Recipes are NEVER trusted: assertStoreBinding() must
// confirm the rendered page is actually bound to the expected store before an
// item may carry provenance 'store_page_verified'.
//
// Recipes start at 'none' for every banner — the Sprint-0 spike
// (scripts/spike-store-binding.ts → docs/superpowers/research/) promotes
// banners as their recipes are validated. A 'none' recipe just means lower
// yield (items cap at 'page_verified_unbound'); it can never cause a wrong
// "verified" label.
import type { StoreIdentity } from '../types/index.js'
import type { FirecrawlAction } from './firecrawl.js'
import { normalizeBanner } from './store-urls.js'

export type BindingRecipe =
  | { kind: 'url'; buildUrl: (productUrl: string, storeId: string) => string }
  | { kind: 'cookie'; buildCookie: (storeId: string) => string }
  | { kind: 'actions'; buildActions: (store: StoreIdentity) => FirecrawlAction[] }
  | { kind: 'none' }

/** Banner domain registry — Tavily include_domains scoping. Keys are normalizeBanner() output. */
const DOMAINS: Record<string, string> = {
  'h-e-b': 'heb.com',
  'heb': 'heb.com',
  'central market': 'centralmarket.com',
  'target': 'target.com',
  'costco': 'costco.com',
  'tom thumb': 'tomthumb.com',
  'albertsons': 'albertsons.com',
  'safeway': 'safeway.com',
  'vons': 'vons.com',
  'sprouts': 'shop.sprouts.com',
  'sprouts farmers market': 'shop.sprouts.com',
  'whole foods': 'wholefoodsmarket.com',
  'whole foods market': 'wholefoodsmarket.com',
  'aldi': 'aldi.us',
  "trader joe's": 'traderjoes.com',
  'trader joes': 'traderjoes.com',
  'publix': 'publix.com',
  'fiesta mart': 'fiestamart.com',
  'meijer': 'meijer.com',
  'wegmans': 'shop.wegmans.com',
}

export function bannerDomain(banner: string): string | null {
  return DOMAINS[normalizeBanner(banner)] ?? null
}

/**
 * Per-banner binding recipes. Spike-validated entries only — everything else
 * stays 'none'. DO NOT add a recipe without an assertStoreBinding-passing
 * probe run recorded in docs/superpowers/research/.
 */
const RECIPES: Record<string, BindingRecipe> = {}

export function getBindingRecipe(bannerNormalized: string): BindingRecipe {
  return RECIPES[bannerNormalized] ?? { kind: 'none' }
}

/** Lowercase + fold unicode hyphens/dashes (U+2010..U+2015, U+2212) to ASCII '-'. */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[‐-―−]/g, '-')
}

/** Generic words that never distinguish one location of a banner from another. */
const GENERIC_STOP_TOKENS = new Set(['the', 'and', 'store', 'market', 'plus', 'h-e-b', 'heb'])

/**
 * Tokens that identify WHICH store this is — from storeName + storeAddress,
 * minus banner words, generic words, pure digits, short tokens, state codes.
 */
function distinctiveTokens(store: StoreIdentity): string[] {
  const stop = new Set(GENERIC_STOP_TOKENS)
  // Banner's own words are part of every location's name — not distinctive.
  for (const w of normalizeText(store.banner).split(/[\s,]+/)) {
    if (w) stop.add(w)
  }
  const source = `${store.storeName} ${store.storeAddress ?? ''}`
  return normalizeText(source)
    .split(/[\s,]+/)
    .filter(t =>
      t.length > 2 &&          // also excludes 2-letter state codes
      !stop.has(t) &&
      !/^\d+$/.test(t),        // pure digits (street numbers, zips) are not distinctive
    )
}

/** "You're shopping <label>" / "My Store: <label>" — label runs to '!', '.', or newline. */
const INDICATOR_RE = /(?:you'?re shopping|my store:?|your store:?)\s+([^!\n.]{2,60})/i

/** retailerStoreId appearing as a store-id field, not as a bare number in prose. */
function storeIdInPayload(text: string, retailerStoreId: string): boolean {
  const id = retailerStoreId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`store[-_]?id["'=:\\s]+["']?${id}\\b`, 'i').test(text)
}

/**
 * The honesty guarantee: does this rendered page text prove it is bound to the
 * expected store? Two signals:
 *  1. A store-indicator phrase whose label shares a distinctive token with the
 *     expected store. An indicator naming a DIFFERENT store is a hard fail —
 *     positive evidence the binding went elsewhere.
 *  2. The retailerStoreId appearing as a store-id field in the page payload.
 */
export function assertStoreBinding(pageText: string, store: StoreIdentity): boolean {
  const text = normalizeText(pageText)
  const tokens = distinctiveTokens(store)

  const indicator = INDICATOR_RE.exec(text)
  if (indicator) {
    const label = indicator[1].trim()
    // Indicator present: it decides. A label sharing no distinctive token
    // names a different store — never fall through to weaker signals.
    return tokens.some(t => label.includes(t))
  }

  if (store.retailerStoreId && storeIdInPayload(text, store.retailerStoreId)) {
    return true
  }

  return false
}
