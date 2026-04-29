// ─── Universal Size Resolver (P2.5) ────────────────────────────────────────────
//
// Five-tier pipeline that resolves a package size for any StoreItem, even when
// the raw `size` string is "Family Size" / "Deli Thin Sliced" / unparseable.
//
// Tier order (first non-null result wins):
//   1. parseSize(item.size)                  — pure local string parse
//   2. USDA FDC branded-foods lookup          — packageWeight / servingSize
//   3. Open Food Facts search                 — product.quantity field
//   4. LLM web_fetch on item.productUrl       — single Anthropic call
//   5. LLM web_search "{brand} {name} weight" — last resort Anthropic call
//
// Each network tier result is cached in KV (positive: 7d, negative: 1h).
// All five tiers return null → caller marks item as truly unparseable.

import type { CanonicalUnit } from '../types/index.js'
import type { KVLike } from './cacheKV.js'
import type { ModelProvider, AnthropicTool } from '../providers/index.js'
import type { UsdaFdcClient } from '../integrations/usda-fdc.js'
import type { OpenFoodFactsClient } from '../integrations/openfoodfacts.js'
import { parseSize } from './units.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ResolvedSize {
  quantity: number
  unit: CanonicalUnit
  source: 'parseSize' | 'fdc' | 'off' | 'web_fetch' | 'web_search'
}

export interface SizeResolverEnv {
  FDC_CACHE: KVLike
  ONTOLOGY_CACHE: KVLike
  URL_CACHE: KVLike
}

// ─── Cache TTLs ───────────────────────────────────────────────────────────────

const TTL_POSITIVE = 7 * 24 * 60 * 60   // 7 days (FDC + OFF positive results)
const TTL_NEGATIVE = 60 * 60             // 1 hour (negative cache — retry sooner)
const TTL_LLM      = 24 * 60 * 60       // 24 hours (LLM-derived results)
const TTL_LLM_NEG  = 60 * 60            // 1 hour (LLM negative cache)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lc(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Read a KV key that might hold a JSON-encoded ResolvedSize or the literal
 * string "null" (negative cache). Returns:
 *   { hit: true, value: ResolvedSize } — positive cache hit
 *   { hit: true, value: null }         — negative cache hit (don't re-run tier)
 *   { hit: false }                     — key absent / expired
 */
async function kvGet(
  ns: KVLike,
  key: string,
): Promise<{ hit: true; value: ResolvedSize | null } | { hit: false }> {
  const raw = await ns.get(key)
  if (raw === null) return { hit: false }
  const parsed = JSON.parse(raw) as ResolvedSize | null
  return { hit: true, value: parsed }
}

async function kvPut(
  ns: KVLike,
  key: string,
  value: ResolvedSize | null,
  ttl: number,
): Promise<void> {
  try {
    await ns.put(key, JSON.stringify(value), { expirationTtl: ttl })
  } catch {
    // Cache write failure is non-fatal
  }
}

/** Parse a raw FDC unit string to CanonicalUnit. Returns null if unrecognised. */
function canonicalizeFdcUnit(raw: string): CanonicalUnit | null {
  const s = raw.trim().toLowerCase()
  const map: Record<string, CanonicalUnit> = {
    g: 'g', gram: 'g', grams: 'g',
    kg: 'kg',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
    l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    'fl oz': 'fl_oz', fl_oz: 'fl_oz',
    cup: 'cup', cups: 'cup',
    each: 'each', ea: 'each', unit: 'each', units: 'each', ct: 'each', count: 'each',
  }
  return map[s] ?? null
}

/**
 * Try to parse an LLM text response as { quantity: number, unit: string }.
 * The model is prompted to emit JSON; handles bare JSON or JSON embedded in prose.
 */
function parseLlmSizeResponse(text: string): ResolvedSize | null {
  // Try to find a JSON object in the response
  const match = text.match(/\{[^}]*"quantity"\s*:\s*(\d+(?:\.\d+)?)[^}]*"unit"\s*:\s*"([^"]+)"[^}]*\}/)
    ?? text.match(/\{[^}]*"unit"\s*:\s*"([^"]+)"[^}]*"quantity"\s*:\s*(\d+(?:\.\d+)?)[^}]*\}/)

  if (match) {
    // First pattern: quantity then unit
    if (match[1] && match[2] && !isNaN(parseFloat(match[1]))) {
      const qty = parseFloat(match[1])
      const unit = canonicalizeFdcUnit(match[2])
      if (unit) return { quantity: qty, unit, source: 'web_fetch' } // source patched by caller
    }
    // Second pattern: unit then quantity
    if (match[1] && match[2] && !isNaN(parseFloat(match[2]))) {
      const unit = canonicalizeFdcUnit(match[1])
      const qty = parseFloat(match[2])
      if (unit) return { quantity: qty, unit, source: 'web_fetch' }
    }
  }

  // Fallback: try direct JSON.parse on trimmed text
  try {
    const json = JSON.parse(text.trim()) as { quantity?: unknown; unit?: unknown }
    if (typeof json.quantity === 'number' && typeof json.unit === 'string') {
      const unit = canonicalizeFdcUnit(json.unit)
      if (unit) return { quantity: json.quantity, unit, source: 'web_fetch' }
    }
  } catch {
    // not JSON
  }

  return null
}

// ─── LLM tool definitions (mirrors plan.ts pass-1 pattern) ───────────────────

const WEB_FETCH_TOOL: AnthropicTool = {
  type: 'web_fetch_20260209',
  name: 'web_fetch',
  max_uses: 1,
  allowed_callers: ['direct'],
}

const WEB_SEARCH_TOOL: AnthropicTool = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 3,
  allowed_callers: ['direct'],
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the net package size for a store item via a five-tier cascade.
 * Returns the first successful ResolvedSize, or null if all tiers fail.
 *
 * @param item        - Item fields (name, brand, size, productUrl)
 * @param env         - KV namespace bindings for caching
 * @param provider    - Anthropic provider for tiers 4-5 LLM calls
 * @param fdcClient   - UsdaFdcClient for tier 2
 * @param offClient   - OpenFoodFactsClient for tier 3
 */
export async function resolveProductSize(
  item: { name: string; brand?: string; size?: string; productUrl?: string },
  env: SizeResolverEnv,
  provider: ModelProvider,
  fdcClient: Pick<UsdaFdcClient, 'searchBrandedByName'>,
  offClient: Pick<OpenFoodFactsClient, 'searchByName'>,
): Promise<ResolvedSize | null> {
  const { name, brand = '', size = '', productUrl } = item
  const brandLc = lc(brand)
  const nameLc = lc(name)

  // ── Tier 1: parseSize ──────────────────────────────────────────────────────
  if (size) {
    const parsed = parseSize(size)
    if (parsed) {
      return { quantity: parsed.quantity, unit: parsed.unit, source: 'parseSize' }
    }
  }

  // ── Tier 2: USDA FDC ──────────────────────────────────────────────────────
  const fdcCacheKey = `fdc-size:${brandLc}:${nameLc}`
  const fdcCached = await kvGet(env.FDC_CACHE, fdcCacheKey)
  if (fdcCached.hit) {
    if (fdcCached.value !== null) return fdcCached.value
    // negative cache — skip this tier
  } else {
    const query = [brand, name].filter(Boolean).join(' ')
    try {
      const fdcHits = await fdcClient.searchBrandedByName(query, { pageSize: 5 })
      for (const hit of fdcHits) {
        // Prefer packageWeight — it's the total package net weight
        if (hit.packageWeight) {
          const parsed = parseSize(hit.packageWeight)
          if (parsed) {
            const result: ResolvedSize = { ...parsed, source: 'fdc' }
            await kvPut(env.FDC_CACHE, fdcCacheKey, result, TTL_POSITIVE)
            return result
          }
        }
        // Fall back to servingSize + servingSizeUnit
        if (hit.servingSize !== null && hit.servingSizeUnit) {
          const unit = canonicalizeFdcUnit(hit.servingSizeUnit)
          if (unit) {
            const result: ResolvedSize = { quantity: hit.servingSize!, unit, source: 'fdc' }
            await kvPut(env.FDC_CACHE, fdcCacheKey, result, TTL_POSITIVE)
            return result
          }
        }
      }
      // FDC had results but none parseable — negative cache
      await kvPut(env.FDC_CACHE, fdcCacheKey, null, TTL_NEGATIVE)
    } catch (err) {
      // FDC unavailable — don't block, just skip tier
      console.warn('[size-resolver] FDC tier error (skipping)', { name, brand, err: String(err) })
    }
  }

  // ── Tier 3: Open Food Facts ───────────────────────────────────────────────
  const offCacheKey = `off-size:${brandLc}:${nameLc}`
  const offCached = await kvGet(env.ONTOLOGY_CACHE, offCacheKey)
  if (offCached.hit) {
    if (offCached.value !== null) return offCached.value
    // negative cache — skip
  } else {
    const query = [brand, name].filter(Boolean).join(' ')
    try {
      const offResult = await offClient.searchByName(query, 1, 5)
      for (const product of offResult.products) {
        const qty = (product as { quantity?: string }).quantity
        if (qty) {
          const parsed = parseSize(qty)
          if (parsed) {
            const result: ResolvedSize = { ...parsed, source: 'off' }
            await kvPut(env.ONTOLOGY_CACHE, offCacheKey, result, TTL_POSITIVE)
            return result
          }
        }
      }
      await kvPut(env.ONTOLOGY_CACHE, offCacheKey, null, TTL_NEGATIVE)
    } catch (err) {
      console.warn('[size-resolver] OFF tier error (skipping)', { name, brand, err: String(err) })
    }
  }

  // ── Tier 4: LLM web_fetch ─────────────────────────────────────────────────
  if (productUrl) {
    const fetchCacheKey = `wfetch-size:${productUrl}`
    const fetchCached = await kvGet(env.URL_CACHE, fetchCacheKey)
    if (fetchCached.hit) {
      if (fetchCached.value !== null) return fetchCached.value
      // negative cache — skip
    } else {
      try {
        const fetchResult = await provider.complete({
          system: 'You are a product data extractor. Given a product page, extract ONLY the net package weight/size as JSON. Respond with ONLY a JSON object: {"quantity": <number>, "unit": "<unit>"}. Valid units: g, kg, oz, lb, ml, l, fl_oz, cup, each, dozen. If you cannot determine the package size, respond with: null',
          messages: [
            {
              role: 'user',
              content: `Fetch this product page and extract the net package weight: ${productUrl}\n\nProduct name hint: ${[brand, name].filter(Boolean).join(' ')}\n\nRespond with ONLY JSON like {"quantity": 32, "unit": "oz"} or null if not found.`
            }
          ],
          maxTokens: 256,
          tools: [WEB_FETCH_TOOL],
        })

        const parsed = parseLlmSizeResponse(fetchResult.content)
        if (parsed) {
          const result: ResolvedSize = { ...parsed, source: 'web_fetch' }
          await kvPut(env.URL_CACHE, fetchCacheKey, result, TTL_LLM)
          return result
        }
        await kvPut(env.URL_CACHE, fetchCacheKey, null, TTL_LLM_NEG)
      } catch (err) {
        console.warn('[size-resolver] web_fetch tier error (skipping)', { name, brand, productUrl, err: String(err) })
      }
    }
  }

  // ── Tier 5: LLM web_search ────────────────────────────────────────────────
  const searchCacheKey = `wsearch-size:${brandLc}:${nameLc}`
  const searchCached = await kvGet(env.URL_CACHE, searchCacheKey)
  if (searchCached.hit) {
    if (searchCached.value !== null) return searchCached.value
    // negative cache — return null (all tiers exhausted)
  } else {
    try {
      const searchQuery = `${[brand, name].filter(Boolean).join(' ')} package weight`
      const searchResult = await provider.complete({
        system: 'You are a product data extractor. Search for product package size information and respond with ONLY a JSON object: {"quantity": <number>, "unit": "<unit>"}. Valid units: g, kg, oz, lb, ml, l, fl_oz, cup, each, dozen. If you cannot determine the package size, respond with: null',
        messages: [
          {
            role: 'user',
            content: `Search for the net package weight of: ${searchQuery}\n\nRespond with ONLY JSON like {"quantity": 32, "unit": "oz"} or null if not found.`
          }
        ],
        maxTokens: 256,
        tools: [WEB_SEARCH_TOOL],
      })

      const parsed = parseLlmSizeResponse(searchResult.content)
      if (parsed) {
        const result: ResolvedSize = { ...parsed, source: 'web_search' }
        await kvPut(env.URL_CACHE, searchCacheKey, result, TTL_LLM)
        return result
      }
      await kvPut(env.URL_CACHE, searchCacheKey, null, TTL_LLM_NEG)
    } catch (err) {
      console.warn('[size-resolver] web_search tier error (skipping)', { name, brand, err: String(err) })
    }
  }

  // All tiers exhausted
  console.warn('[size-resolver] all tiers failed', { name, brand, size, productUrl })
  return null
}
