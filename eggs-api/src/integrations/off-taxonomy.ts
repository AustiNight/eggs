// ─── OffTaxonomyClient — Open Food Facts taxonomy + product search adapter ─────
//
// Wraps two OFF v2 endpoints with KV caching (7-day TTL).
//
// Taxonomy endpoint:  world.openfoodfacts.org/api/v2/taxonomy
//   Used for: getParents, getChildren, getSynonyms
//   Rate limit: ~2 req/min for facet queries — do NOT retry on 429.
//
// Search endpoint:    world.openfoodfacts.org/api/v2/search
//   Used for: searchByText (US-filtered by default)
//   Rate limit: ~10 req/min — do NOT retry on 429.
//
// No auth required — OFF is an open API.

import { cacheKV } from '../lib/cacheKV.js'
import type { KVLike } from '../lib/cacheKV.js'

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single product from the OFF search results. */
export interface OffProduct {
  /** Barcode (EAN/UPC) */
  code: string
  productName: string | null
  /** Raw comma-separated brand string from OFF */
  brands: string | null
  /** e.g. ["en:orange-juices", "en:fruit-juices"] */
  categoriesTags: string[]
  /** e.g. ["en:organic"] */
  labelsTags: string[]
  countriesTags: string[]
  /** Raw quantity string, e.g. "12 oz" */
  quantity: string | null
  servingSize: string | null
  imageUrl: string | null
}

// ─── Constructor options ──────────────────────────────────────────────────────

export interface OffTaxonomyClientOptions {
  /** KV namespace for caching (7-day TTL). Use env.ONTOLOGY_CACHE. */
  cacheNs: KVLike
  /** Optional fetch override for testing; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

// ─── Internal OFF API response shapes ────────────────────────────────────────

interface OffTaxonomyEntry {
  name?: Record<string, string>
  synonyms?: Record<string, string[]>
  parents?: string[]
  children?: string[]
}

type OffTaxonomyResponse = Record<string, OffTaxonomyEntry>

interface OffSearchResponse {
  products?: OffProductRaw[]
}

interface OffProductRaw {
  code?: string
  product_name?: string | null
  brands?: string | null
  categories_tags?: string[]
  labels_tags?: string[]
  countries_tags?: string[]
  quantity?: string | null
  serving_size?: string | null
  image_url?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2'
const TTL_SECONDS = 7 * 24 * 60 * 60  // 7 days
const TTL_SECONDS_NEGATIVE = 60 * 60   // 1 hour for null / no-result caches
const DEFAULT_PAGE_SIZE = 25
const BROADER_TERM_TIMEOUT_MS = 5000   // 5-second ceiling for broader-term lookup

// ─── Mapping helper ───────────────────────────────────────────────────────────

function mapProduct(raw: OffProductRaw): OffProduct {
  return {
    code: raw.code ?? '',
    productName: raw.product_name ?? null,
    brands: raw.brands ?? null,
    categoriesTags: raw.categories_tags ?? [],
    labelsTags: raw.labels_tags ?? [],
    countriesTags: raw.countries_tags ?? [],
    quantity: raw.quantity ?? null,
    servingSize: raw.serving_size ?? null,
    imageUrl: raw.image_url ?? null,
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class OffTaxonomyClient {
  private readonly fetchImpl: typeof fetch
  // Raw KV namespace kept for broader-term caching (custom TTL logic).
  private readonly cacheNs: KVLike

  // Cached taxonomy fetcher (shared by getParents/getChildren/getSynonyms)
  private readonly taxonomyCached: (tag: string, lang: string) => Promise<OffTaxonomyResponse>
  // Cached product search fetcher
  private readonly searchCached: (term: string, country: string, pageSize: number) => Promise<OffProduct[]>

  constructor(opts: OffTaxonomyClientOptions) {
    // Arrow wrapper avoids "Illegal invocation" on Cloudflare Workers when the
    // default unbound `globalThis.fetch` is called as a method.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.cacheNs = opts.cacheNs

    // ── Taxonomy cache ────────────────────────────────────────────────────────
    // All three taxonomy methods (getParents, getChildren, getSynonyms) share
    // the same underlying fetch so a single request populates all three.
    this.taxonomyCached = cacheKV({
      ns: opts.cacheNs,
      ttlSeconds: TTL_SECONDS,
      // TODO: insert an `ontology_ver` segment into this cache key per DESIGN.md note 12
      // so bumping ontology version invalidates downstream caches without a manual purge.
      // Deferred to M6 or whenever the first ontology version bump is planned.
      keyFn: (tag: string, lang: string) =>
        `off:v1:taxonomy:categories:${tag}:${lang}`,
      loader: (tag: string, lang: string) =>
        this._fetchTaxonomy(tag, lang),
    })

    // ── Search cache ──────────────────────────────────────────────────────────
    this.searchCached = cacheKV({
      ns: opts.cacheNs,
      ttlSeconds: TTL_SECONDS,
      keyFn: (term: string, country: string, pageSize: number) =>
        `off:v1:search:${encodeURIComponent(term.toLowerCase())}:${country}:${pageSize}`,
      loader: (term: string, country: string, pageSize: number) =>
        this._fetchSearch(term, country, pageSize),
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Return all parent tags for a concept tag (e.g. "en:whole-milks" → ["en:milks"]). */
  async getParents(tag: string): Promise<string[]> {
    const taxonomy = await this.taxonomyCached(tag, 'en')
    const entry = taxonomy[tag]
    return entry?.parents ?? []
  }

  /** Return direct child tags for a concept tag. */
  async getChildren(tag: string): Promise<string[]> {
    const taxonomy = await this.taxonomyCached(tag, 'en')
    const entry = taxonomy[tag]
    return entry?.children ?? []
  }

  /**
   * Return synonyms for a concept tag in the given language.
   * Defaults to English ('en').
   */
  async getSynonyms(tag: string, lang = 'en'): Promise<string[]> {
    const taxonomy = await this.taxonomyCached(tag, lang)
    const entry = taxonomy[tag]
    return entry?.synonyms?.[lang] ?? []
  }

  /**
   * Search OFF products by text, filtered to the given country (default: 'united-states').
   * Results are KV-cached for 7 days.
   */
  async searchByText(
    term: string,
    opts?: { country?: string; pageSize?: number }
  ): Promise<OffProduct[]> {
    const country = opts?.country ?? 'united-states'
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
    return this.searchCached(term, country, pageSize)
  }

  /**
   * Return a broader (parent) search term for the given free-text ingredient
   * name using the OFF taxonomy.  Returns null when no broader term is found.
   *
   * Algorithm:
   *   1. Cache-check ONTOLOGY_CACHE with key `broader:{lc(name)}` (7d positive,
   *      1h negative — parent terms rarely change).
   *   2. searchByText(name) — take the first product's categoriesTags.
   *   3. Pick the most-specific tag (last element), walk up one level via
   *      getParents(tag).
   *   4. Strip the language prefix and convert dashes to spaces ("en:oats" → "oats").
   *   5. Cache and return.
   *
   * The entire operation is wrapped in a 5-second AbortController timeout so a
   * slow OFF API never blocks the store search.
   */
  async broaderTerm(name: string): Promise<string | null> {
    const cacheKey = `broader:${name.toLowerCase().trim()}`

    // ── 1. Cache check ────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheNs.get(cacheKey)
      if (cached !== null) {
        return JSON.parse(cached) as string | null
      }
    } catch {
      /* cache read failure is non-fatal; proceed to network */
    }

    // ── 2. Network lookup with 5-second timeout ────────────────────────────
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), BROADER_TERM_TIMEOUT_MS)
    let broader: string | null = null

    try {
      broader = await this._computeBroaderTerm(name, ac.signal)
    } catch {
      /* OFF rate-limit, timeout, or any other error → return null */
    } finally {
      clearTimeout(timer)
    }

    // ── 3. Cache result ───────────────────────────────────────────────────────
    // Positive results (non-null) cached 7 days; null results cached 1 hour.
    const ttl = broader !== null ? TTL_SECONDS : TTL_SECONDS_NEGATIVE
    try {
      await this.cacheNs.put(cacheKey, JSON.stringify(broader), { expirationTtl: ttl })
    } catch {
      /* cache write failure is non-fatal */
    }

    return broader
  }

  /** Internal: compute broader term without caching. Separated for testability. */
  private async _computeBroaderTerm(name: string, signal?: AbortSignal): Promise<string | null> {
    // Fetch first page of products for this name.
    const products = await this._fetchSearchWithSignal(name, 'united-states', 5, signal)
    if (products.length === 0) return null

    // Find the first product that has at least one category tag.
    const withTags = products.find(p => p.categoriesTags.length > 0)
    if (!withTags) return null

    // The most-specific tag is the LAST one (OFF orders general → specific).
    const specificTag = withTags.categoriesTags[withTags.categoriesTags.length - 1]
    if (!specificTag) return null

    // Walk one level up in the taxonomy.
    const parents = await this.getParents(specificTag)
    if (parents.length === 0) return null

    // Convert the first parent tag to plain English: "en:steel-cut-oats" → "steel cut oats"
    const parentTag = parents[0]
    const plain = parentTag
      .replace(/^[a-z]{2}:/, '')    // strip language prefix
      .replace(/-/g, ' ')            // dashes → spaces
    return plain || null
  }

  /** Thin variant of _fetchSearch that accepts an AbortSignal for timeout. */
  private async _fetchSearchWithSignal(
    term: string,
    country: string,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<OffProduct[]> {
    if (signal?.aborted) return []
    const params = new URLSearchParams({
      search_terms: term,
      countries_tags_en: country,
      page_size: String(pageSize),
      fields: 'code,product_name,brands,categories_tags,labels_tags,countries_tags,quantity,serving_size,image_url',
    })
    const url = `${OFF_BASE}/search?${params}`

    const res = await this.fetchImpl(url, { signal })

    if (res.status === 429) {
      throw new Error(
        `Open Food Facts rate limit exceeded (429) on search for "${term}". ` +
        `Rate limit is ~10 req/min for search. Do not retry automatically.`
      )
    }

    if (!res.ok) {
      throw new Error(`OFF search failed for term "${term}" with status ${res.status}`)
    }

    const data = (await res.json()) as OffSearchResponse
    return (data.products ?? []).map(mapProduct)
  }

  // ─── Private fetch helpers ────────────────────────────────────────────────────

  private async _fetchTaxonomy(tag: string, lang: string): Promise<OffTaxonomyResponse> {
    const params = new URLSearchParams({
      tagtype: 'categories',
      tags: tag,
      fields: 'parents,children,name,synonyms',
      lc: lang,
    })
    const url = `${OFF_BASE}/taxonomy?${params}`

    const res = await this.fetchImpl(url)

    if (res.status === 429) {
      throw new Error(
        `Open Food Facts rate limit exceeded (429) on taxonomy lookup for tag "${tag}". ` +
        `Rate limit is ~2 req/min for facet queries. Do not retry automatically.`
      )
    }

    if (!res.ok) {
      throw new Error(`OFF taxonomy fetch failed for tag "${tag}" with status ${res.status}`)
    }

    return (await res.json()) as OffTaxonomyResponse
  }

  private async _fetchSearch(
    term: string,
    country: string,
    pageSize: number
  ): Promise<OffProduct[]> {
    const params = new URLSearchParams({
      search_terms: term,
      countries_tags_en: country,
      page_size: String(pageSize),
      fields: 'code,product_name,brands,categories_tags,labels_tags,countries_tags,quantity,serving_size,image_url',
    })
    const url = `${OFF_BASE}/search?${params}`

    const res = await this.fetchImpl(url)

    if (res.status === 429) {
      throw new Error(
        `Open Food Facts rate limit exceeded (429) on search for "${term}". ` +
        `Rate limit is ~10 req/min for search. Do not retry automatically.`
      )
    }

    if (!res.ok) {
      throw new Error(`OFF search failed for term "${term}" with status ${res.status}`)
    }

    const data = (await res.json()) as OffSearchResponse
    return (data.products ?? []).map(mapProduct)
  }
}
