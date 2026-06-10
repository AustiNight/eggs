// WS1 price-discovery orchestrator: Serper (discover) → Tavily (resolve) →
// store-bound fetch (verify). Every return value carries provenance per the
// spec honesty contract. All deps injected for testability; any absent dep
// gracefully truncates the pipeline at that leg.
import { SerperClient, type ShoppingCandidate } from '../integrations/serper.js'
import type { TavilyClient } from '../integrations/tavily.js'
import type { FirecrawlClient, FirecrawlAction } from '../integrations/firecrawl.js'
import { bannerDomain, getBindingRecipe, type BindingRecipe } from '../integrations/store-binding.js'
import { verifyContentText } from './content-verifier.js'
import type { StoreIdentity, Provenance, PlanDiagnostics } from '../types/index.js'

export interface DiscoveredPrice {
  unitPrice: number
  productTitle: string
  productUrl: string | null
  provenance: Extract<Provenance, 'store_page_verified' | 'page_verified_unbound' | 'shopping_index'>
  verifiedAt: number
  verifiedStoreId?: string
}

export interface DiscoveryDeps {
  serper?: Pick<SerperClient, 'shopping'>
  tavily?: Pick<TavilyClient, 'search'>
  firecrawl?: Pick<FirecrawlClient, 'scrape'>
  /** Direct Worker fetch of a product page → page text, or null on bot-wall/error. */
  directFetch: (url: string, headers?: Record<string, string>) => Promise<string | null>
  counters: PlanDiagnostics['discovery']
  /** Test seam: overrides getBindingRecipe lookup. */
  recipeOverride?: BindingRecipe
}

export async function discoverPrice(
  ingredientName: string,
  store: StoreIdentity,
  locationLabel: string | undefined,
  deps: DiscoveryDeps,
): Promise<DiscoveredPrice | null> {
  if (!deps.serper) return null

  // 1. DISCOVER — index prices are candidates only, never store-trusted.
  deps.counters.serperQueries++
  const all = await deps.serper.shopping(`${ingredientName} ${store.banner}`, locationLabel)
  const candidates = SerperClient.filterByMerchant(all, store.banner).filter(c => c.price !== null)
  const candidate = candidates[0]
  if (!candidate) return null

  // 2. RESOLVE — merchant product-page URL via domain-scoped Tavily search.
  const domain = bannerDomain(store.banner)
  let productUrl: string | null = null
  if (deps.tavily && domain) {
    deps.counters.tavilyQueries++
    const results = await deps.tavily.search(candidate.title, { includeDomains: [domain], maxResults: 5 })
    productUrl = results.find(r => looksLikeProductPage(r.url))?.url ?? results[0]?.url ?? null
  }
  if (!productUrl) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }

  // 3. VERIFY — store-bound fetch, then exact-price + name + binding checks.
  const recipe = deps.recipeOverride ?? getBindingRecipe(store.banner)
  const cookie =
    recipe.kind === 'cookie' && store.retailerStoreId ? recipe.buildCookie(store.retailerStoreId) : undefined
  const fetchUrl =
    recipe.kind === 'url' && store.retailerStoreId ? recipe.buildUrl(productUrl, store.retailerStoreId) : productUrl
  const actions: FirecrawlAction[] | undefined =
    recipe.kind === 'actions' ? recipe.buildActions(store) : undefined

  // Direct fetch can't run actions scripts — those need Firecrawl's browser.
  let pageText = actions ? null : await deps.directFetch(fetchUrl, cookie ? { Cookie: cookie } : undefined)
  if (!pageText && deps.firecrawl) {
    deps.counters.firecrawlScrapes++
    const scraped = await deps.firecrawl.scrape(fetchUrl, {
      ...(cookie ? { headers: { Cookie: cookie } } : {}),
      ...(actions ? { actions } : {}),
      timeoutMs: 9000,
    })
    pageText = scraped?.markdown ?? null
  }
  if (!pageText) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }

  const check = verifyContentText(pageText, candidate.title, candidate.price as number, { expectedStore: store })
  if (!check.verified) {
    deps.counters.indexOnly++
    return indexOnly(candidate)
  }
  if (check.storeBound) {
    deps.counters.storeBound++
    return {
      unitPrice: candidate.price as number,
      productTitle: candidate.title,
      productUrl,
      provenance: 'store_page_verified',
      verifiedAt: Date.now(),
      verifiedStoreId: store.retailerStoreId,
    }
  }
  deps.counters.unbound++
  return {
    unitPrice: candidate.price as number,
    productTitle: candidate.title,
    productUrl,
    provenance: 'page_verified_unbound',
    verifiedAt: Date.now(),
  }
}

function indexOnly(candidate: ShoppingCandidate): DiscoveredPrice {
  return {
    unitPrice: candidate.price as number,
    productTitle: candidate.title,
    productUrl: null,
    provenance: 'shopping_index',
    verifiedAt: Date.now(),
  }
}

/** Heuristic: product-detail URLs over category/search pages. */
function looksLikeProductPage(url: string): boolean {
  return /product|\/p\/|\/ip\/|item|pd\//i.test(url) && !/search|category|\/s\?|\/c\//i.test(url)
}
