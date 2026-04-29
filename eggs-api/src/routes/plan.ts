import { Hono } from 'hono'
import type {
  HonoEnv,
  PricePlanRequest,
  ShoppingPlan,
  StorePlan,
  StoreItem,
  IngredientLine,
  KrogerLocation,
  CanonicalUnit,
  UserProfile,
  ClarifiedAttributes
} from '../types/index.js'
import { CANONICAL_UNITS, validateSpecInput } from '../types/spec.js'
import type { ShoppableItemSpec } from '../types/spec.js'
import { computeBestBasketTotal, extractSpecs } from '../lib/planTotals.js'
import { parseSize } from '../lib/units.js'
import { selectWinner } from '../lib/bestValue.js'
import { buildSearchQuery } from '../lib/query-builder.js'
import type { WinnerResult } from '../lib/bestValue.js'
import { getSupabase } from '../db/client.js'
import { requireAuthOrServiceKey } from '../middleware/auth.js'
import { enforceFreeLimit } from '../middleware/limits.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { getProvider, type AnthropicTool } from '../providers/index.js'
import { KrogerClient } from '../integrations/kroger.js'
import { WalmartClient } from '../integrations/walmart.js'
import { IdpClient } from '../integrations/instacart-idp.js'
import { getShopUrl, normalizeBanner } from '../integrations/store-urls.js'
import { validateUrls } from '../lib/url-validator.js'
import { verifyProductContent } from '../lib/content-verifier.js'
import type { StoreSearchResult } from '../integrations/StoreAdapter.js'
import { buildNarrativePrompt, fallbackNarrative } from './plan-narrative.js'
import type { NarrativeFacts } from './plan-narrative.js'

const plan = new Hono<HonoEnv>()

// ── Cache helpers ────────────────────────────────────────────────────────────
// Cache key shape: item:v1:{banner-slug}:{sha256(ingredient)}
// Cache value: { storeItem, cachedAt }. Entries expire after 24h.

interface CachedStoreItem {
  item: StoreItem
  storeName: string
  storeBanner: string
  storeAddress?: string
  priceSource: 'ai_estimated'
  cachedAt: number
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const bytes = new Uint8Array(buf)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function cacheKey(bannerNormalized: string, ingredientName: string): Promise<string> {
  const normalized = ingredientName.trim().toLowerCase().replace(/\s+/g, ' ')
  const hash = await sha256Hex(normalized)
  return `item:v1:${bannerNormalized.replace(/\s+/g, '-')}:${hash.slice(0, 24)}`
}

// ── Kroger: search all ingredients across nearby locations ──────────────────
// Primary location anchors the store card; per-ingredient fallback cascades
// through secondary locations when primary has no priced match (common with
// Kroger's sparser "Fresh Fare" inventory). Each ingredient disambiguates
// independently.
async function searchKroger(
  ingredients: IngredientLine[],
  locations: KrogerLocation[],
  client: KrogerClient
): Promise<{
  storeName: string
  storeAddress: string
  items: Record<string, StoreSearchResult>
} | null> {
  if (locations.length === 0) return null
  const primary = locations[0]
  const locationIds = locations.map(l => l.locationId)

  const items: Record<string, StoreSearchResult> = {}

  await Promise.allSettled(
    ingredients.map(async (ingredient) => {
      const result = await client.getPriceForIngredient(ingredient.name, locationIds)
      if (result) items[ingredient.id] = result
    })
  )

  return {
    storeName: primary.name,
    storeAddress: [
      primary.address.addressLine1,
      primary.address.city,
      primary.address.state
    ].join(', '),
    items
  }
}

// ── Walmart: search all ingredients (national-ish pricing, optional zip) ─────
async function searchWalmart(
  ingredients: IngredientLine[],
  client: WalmartClient,
  zipCode?: string
): Promise<Record<string, {
  sku: string; name: string; brand: string
  regularPrice: number; promoPrice: number | null
  productUrl: string; size: string
}>> {
  const items: Record<string, {
    sku: string; name: string; brand: string
    regularPrice: number; promoPrice: number | null
    productUrl: string; size: string
  }> = {}

  await Promise.allSettled(
    ingredients.map(async (ingredient) => {
      const result = await client.getPriceForIngredient(ingredient.name, zipCode)
      if (result) items[ingredient.id] = result
    })
  )

  return items
}

// ── Pure helper: validate + normalize AI-returned items (M5) ────────────────
// Extracted so it can be unit-tested without invoking the Anthropic SDK.
// Applies two post-processing passes:
//   1. pricedSize.unit validation — unknown units cause pricedSize to be nulled.
//   2. Confidence downgrade — 'real' or 'estimated_with_source' items with a
//      null pricedSize (after pass 1) are downgraded to 'estimated'.
export function validateAndNormalizeAiItems(rawItems: unknown[]): StoreItem[] {
  const validUnits = new Set<string>(CANONICAL_UNITS)

  return rawItems.map((raw) => {
    if (raw === null || typeof raw !== 'object') {
      console.warn('[ai-adapter] skipping non-object item in AI response')
      return null
    }

    const item = raw as StoreItem & { pricedSize?: { quantity: number; unit: string } | null }

    // Validate pricedSize.unit against CANONICAL_UNITS; null out on invalid unit.
    let pricedSize: { quantity: number; unit: CanonicalUnit } | null = null
    if (item.pricedSize != null) {
      if (validUnits.has(item.pricedSize.unit)) {
        pricedSize = { quantity: item.pricedSize.quantity, unit: item.pricedSize.unit as CanonicalUnit }
      } else {
        console.warn(`[ai-adapter] unknown pricedSize.unit "${item.pricedSize.unit}" for ${item.name} — nulling pricedSize`)
        pricedSize = null
      }
    }

    // Confidence downgrade when pricedSize is missing on non-estimated items.
    let confidence = item.confidence
    if ((confidence === 'real' || confidence === 'estimated_with_source') && pricedSize === null) {
      console.warn(`[ai-adapter] downgrading ${item.name} from ${confidence} to 'estimated' — pricedSize missing`)
      confidence = 'estimated'
    }

    return { ...item, pricedSize, confidence } as StoreItem
  }).filter((item): item is StoreItem => item !== null)
}

// ── AI: search all non-API stores for ALL ingredients (cache-first) ──────────
async function searchNonApiStores(
  ingredients: IngredientLine[],
  body: PricePlanRequest,
  user: { avoid_stores?: string[]; avoid_brands?: string[]; default_location_label?: string | null; subscription_tier?: string } | null,
  provider: ReturnType<typeof getProvider>,
  excludeStores: string[]
): Promise<StorePlan[]> {
  const avoidStores = [...(body.settings.avoidStores ?? []), ...(user?.avoid_stores ?? [])]
  const avoidBrands = [...(body.settings.avoidBrands ?? []), ...(user?.avoid_brands ?? [])]
  const addressLine = user?.default_location_label
    ? `Chef location: ${user.default_location_label}`
    : `GPS coordinates: ${body.location.lat}, ${body.location.lng}`

  const itemLines = ingredients.map(i => `- ${i.quantity} ${i.unit} ${i.name} (id: ${i.id})`).join('\n')
  const excludeLine = excludeStores.length
    ? `\nDO NOT search these stores — they are covered by direct API integrations: ${excludeStores.join(', ')}`
    : ''

  // Cost caps per Anthropic web_search (billed $10/1k). Free users capped at 25
  // searches per plan (~$0.25 ceiling); Pro gets headroom to 100.
  const isPro = user?.subscription_tier === 'pro'
  const maxSearches = isPro ? 100 : 25

  // Two-pass architecture:
  //   Pass 1 — RESEARCH. Web tools enabled, NO record tool. Model does free-form
  //            research and emits a plain-text summary. Often ends with
  //            stop_reason=end_turn which is fine here.
  //   Pass 2 — FORMAT. ONLY the record_shopping_plan client tool is offered,
  //            and tool_choice forces it. Model has only one thing it can do:
  //            emit the structured plan. Citations from pass 1 are handed to
  //            pass 2 verbatim so the model can attach real proofUrls.
  //
  // Why two passes: Haiku non-deterministically narrates-instead-of-finishes
  // when tools+client-tool share a single call. Forcing the client tool as the
  // ONLY option in pass 2 eliminates the failure mode.
  const researchTools: AnthropicTool[] = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches, allowed_callers: ['direct'] },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.floor(maxSearches / 2), allowed_callers: ['direct'] }
  ]

  const recordShoppingPlanTool: AnthropicTool = {
    name: 'record_shopping_plan',
    description: 'Emit the final structured shopping plan. For every item, report pricedSize — the package size YOU actually priced, not the user\'s input unit. Example: user asked for "2 lbs chicken breast" but you priced a 2.5 lb family pack from Whole Foods → pricedSize = { quantity: 2.5, unit: "lb" }. If you have no source (confidence=estimated), pricedSize may be null.',
    input_schema: {
      type: 'object',
      required: ['stores'],
      properties: {
        stores: {
          type: 'array',
          description: 'One entry per grocery store found. Include ALL stores — not just the cheapest.',
          items: {
            type: 'object',
            required: ['storeName', 'storeBanner', 'storeType', 'priceSource', 'items', 'subtotal', 'estimatedTax', 'grandTotal'],
            properties: {
              storeName: { type: 'string' },
              storeBanner: { type: 'string', description: 'Retailer brand, e.g. "Tom Thumb", "Target", "H-E-B"' },
              storeBannerNormalized: { type: 'string', description: 'Lowercase key with no geography, e.g. "tom thumb", "target"' },
              storeAddress: { type: 'string' },
              distanceMiles: { type: 'number' },
              storeType: { type: 'string', enum: ['physical', 'delivery', 'curbside'] },
              priceSource: { type: 'string', enum: ['ai_estimated'] },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['ingredientId', 'name', 'quantity', 'unit', 'unitPrice', 'lineTotal', 'confidence', 'isLoyaltyPrice', 'pricedSize'],
                  properties: {
                    ingredientId: { type: 'string' },
                    name: { type: 'string' },
                    sku: { type: ['string', 'null'] },
                    quantity: { type: 'number' },
                    unit: { type: 'string' },
                    unitPrice: { type: 'number' },
                    lineTotal: { type: 'number' },
                    confidence: { type: 'string', enum: ['real', 'estimated_with_source', 'estimated'] },
                    proofUrl: { type: ['string', 'null'], description: 'Must be one of the citation URLs from the research pass. Never fabricate.' },
                    isLoyaltyPrice: { type: 'boolean' },
                    nonMemberPrice: { type: ['number', 'null'] },
                    pricedSize: {
                      type: ['object', 'null'],
                      description: 'The actual package size the model priced. REQUIRED when confidence is "real" or "estimated_with_source". Can be null only when confidence is "estimated" (pure guess with no source).',
                      properties: {
                        quantity: { type: 'number', description: 'e.g. 32 for a 32 oz jug' },
                        unit: {
                          type: 'string',
                          enum: ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'cup', 'pt', 'qt', 'gal', 'each', 'dozen', 'bunch', 'head', 'clove', 'pinch'],
                          description: 'Canonical unit used by E.G.G.S.'
                        }
                      },
                      required: ['quantity', 'unit']
                    }
                  }
                }
              },
              subtotal: { type: 'number' },
              estimatedTax: { type: 'number' },
              grandTotal: { type: 'number' }
            }
          }
        }
      }
    }
  }

  // ── Pass 1 — Research ──────────────────────────────────────────────────────
  let researchResult
  try {
    researchResult = await provider.complete({
      system: `You are a professional grocery price research assistant for event chefs.

TASK: research current prices for the listed ingredients across grocery stores near the given location.

HARD REQUIREMENTS — these are non-negotiable:
1. For EVERY product you plan to report, you MUST call web_fetch on the candidate product URL and visually confirm BOTH the product name AND the price appear on the fetched page BEFORE recording it.
2. If web_fetch fails, returns a non-product page, or the product name / price does not appear, you MUST NOT include that URL as the proof. Either find a different URL and web_fetch that, or omit the URL and mark the item confidence:"estimated".
3. Never fabricate a URL. Every URL must come from a web_search citation OR a web_fetch you performed. If you did not web_fetch it, prefix that line with "NO-FETCH:".
4. Do NOT use web_search results alone as proof — web_search snippets are unreliable for price.

${excludeLine}

REPORT FORMAT (plain text, one store per section):
Store: <banner name>
Address/Distance: <if known>
- <ingredient id> | <product name> | $<unit price> | <URL> | FETCHED:<yes|no>
  (confidence rule: "real" ONLY if FETCHED:yes and you confirmed name+price on the page; "estimated_with_source" if FETCHED:no but URL came from a credible web_search result; "estimated" if no URL at all.)

Include ALL stores you find. If an item isn't carried at a store, still list it with price 0 and a "NOT CARRIED" note.
Assume loyalty/member pricing. Tax rate 8.25%.
Do NOT emit JSON. Just plain-text per-store findings.`,
      messages: [
        {
          role: 'user',
          content: `${addressLine}
Search radius: ${body.settings.radiusMiles} miles
Max stores to return: ${body.settings.maxStores}
Include delivery options: ${body.settings.includeDelivery}
${avoidStores.length ? `DO NOT include these stores: ${avoidStores.join(', ')}` : ''}
${avoidBrands.length ? `DO NOT include these brands: ${avoidBrands.join(', ')}` : ''}
${body.eventName ? `Event: ${body.eventName} (${body.headcount ?? '?'} guests)` : ''}

Ingredients:
${itemLines}`
        }
      ],
      maxTokens: 8000,
      jsonMode: false,
      tools: researchTools
    })
  } catch (err) {
    console.error('[searchNonApiStores pass1] provider.complete threw:', err instanceof Error ? err.message : err)
    return []
  }

  if (!researchResult) {
    console.error('[searchNonApiStores pass1] provider returned no result')
    return []
  }

  console.log('[searchNonApiStores pass1] stopReason:', researchResult.stopReason,
    '| text chars:', researchResult.content.length,
    '| citations:', researchResult.citations?.length ?? 0)

  if (researchResult.content.length < 100) {
    console.error('[searchNonApiStores pass1] research too short to format — aborting')
    return []
  }

  // ── Pass 2 — Format via forced tool call ───────────────────────────────────
  const citationList = (researchResult.citations ?? [])
    .slice(0, 150)
    .map((c, i) => `${i + 1}. ${c.url}${c.title ? ` — ${c.title}` : ''}`)
    .join('\n')

  let formatResult
  try {
    formatResult = await provider.complete({
      system: `You format grocery price research into a structured shopping plan.

The ONLY action available to you is calling the record_shopping_plan tool. Call it exactly once with the full structured data derived from the research below.

proofUrl MUST be set to null UNLESS the research pass line for that item contains "FETCHED:yes". If FETCHED:no or "NO-FETCH:" appears on the line, you MUST set proofUrl to null and confidence to "estimated_with_source" at most.
confidence MUST be "real" ONLY when FETCHED:yes AND the research text explicitly confirms both product name and price appeared on the fetched page. Otherwise downgrade to "estimated_with_source" or "estimated".`,
      messages: [
        {
          role: 'user',
          content: `## Research findings
${researchResult.content}

## Citation URLs (pool for proofUrl)
${citationList || '(no citations captured)'}

## Ingredient input list (use these exact ingredientId values)
${itemLines}

Emit the shopping plan now via record_shopping_plan.`
        }
      ],
      maxTokens: 6000,
      jsonMode: false,
      tools: [recordShoppingPlanTool],
      toolChoice: { type: 'tool', name: 'record_shopping_plan' }
    })
  } catch (err) {
    console.error('[searchNonApiStores pass2] provider.complete threw:', err instanceof Error ? err.message : err)
    return []
  }

  if (!formatResult) {
    console.error('[searchNonApiStores pass2] provider returned no result')
    return []
  }

  console.log('[searchNonApiStores pass2] stopReason:', formatResult.stopReason,
    '| toolCalls:', formatResult.toolCalls?.length ?? 0)

  const recordCall = formatResult.toolCalls?.find(tc => tc.name === 'record_shopping_plan')
  if (!recordCall) {
    console.error('[searchNonApiStores pass2] model did not call record_shopping_plan despite forced tool_choice. Text preview:',
      formatResult.content.slice(0, 300))
    return []
  }

  const input = recordCall.input as { stores?: unknown[] } | null
  const rawStores = input?.stores ?? []
  console.log('[searchNonApiStores pass2] record_shopping_plan returned', rawStores.length, 'stores')

  // Apply per-item validation + pricedSize normalization (M5) then cast to StorePlan[].
  const stores = rawStores.map((rawStore) => {
    const s = rawStore as StorePlan & { items: unknown[] }
    return { ...s, items: validateAndNormalizeAiItems(Array.isArray(s.items) ? s.items : []) }
  }) as StorePlan[]

  // Cross-reference: any proofUrl the model put on items must appear in pass-1
  // citations. URLs not in citations are treated as fabricated and dropped.
  const citedUrls = new Set((researchResult.citations ?? []).map(c => c.url))
  for (const store of stores) {
    for (const item of store.items) {
      if (item.proofUrl && !citedUrls.has(item.proofUrl)) {
        item.proofUrl = undefined
        if (item.confidence === 'real') item.confidence = 'estimated'
      }
    }
  }

  return stores
}

// ── KV cache: bulk read + bulk write ─────────────────────────────────────────

async function readCache(
  env: HonoEnv['Bindings'],
  pairs: Array<{ banner: string; ingredient: IngredientLine }>
): Promise<Map<string, CachedStoreItem>> {
  const hits = new Map<string, CachedStoreItem>()
  await Promise.all(
    pairs.map(async ({ banner, ingredient }) => {
      const key = await cacheKey(banner, ingredient.name)
      try {
        const raw = await env.URL_CACHE.get(key)
        if (!raw) return
        const value = JSON.parse(raw) as CachedStoreItem
        hits.set(`${banner}::${ingredient.id}`, value)
      } catch {
        /* cache miss / parse error → treat as absent */
      }
    })
  )
  return hits
}

async function writeCache(
  env: HonoEnv['Bindings'],
  entries: Array<{ banner: string; ingredient: IngredientLine; value: CachedStoreItem }>
): Promise<void> {
  await Promise.all(
    entries.map(async ({ banner, ingredient, value }) => {
      const key = await cacheKey(banner, ingredient.name)
      try {
        await env.URL_CACHE.put(key, JSON.stringify(value), { expirationTtl: 86400 })
      } catch {
        /* cache write failure is non-fatal */
      }
    })
  )
}

// POST /api/price-plan [free limit applies]
plan.post('/', requireAuthOrServiceKey, rateLimit, enforceFreeLimit, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
  const provider = getProvider(c, user ?? undefined)

  const body = await c.req.json<PricePlanRequest>()

  const ingredients = body.ingredients.map(i => ({
    ...i,
    name: (() => {
      const clar = body.resolvedClarifications?.[i.id] as unknown
      // Legacy SPA bundles sent a flattened string here; tolerate that shape so
      // a stale browser tab doesn't crash the worker after the structured rollout.
      if (typeof clar === 'string' && clar.length > 0) return clar
      if (clar && typeof clar === 'object') {
        const c = clar as { baseName?: string; selectedOptions?: string[] }
        return buildSearchQuery(c.baseName || i.name, c.selectedOptions)
      }
      return i.clarifiedName ?? i.name
    })()
  }))

  // ── Step 1: Direct API store discovery ───────────────────────────────────
  let krogerClient: KrogerClient | null = null
  let krogerLocations: KrogerLocation[] = []
  if (c.env.KROGER_CLIENT_ID && c.env.KROGER_CLIENT_SECRET) {
    krogerClient = new KrogerClient(
      c.env.KROGER_CLIENT_ID,
      c.env.KROGER_CLIENT_SECRET,
      undefined,
      c.env.URL_CACHE
    )
    krogerLocations = await krogerClient
      .findNearbyLocations(body.location.lat, body.location.lng, body.settings.radiusMiles)
      .catch(() => [])
  }
  const krogerPrimaryLocation = krogerLocations[0] ?? null

  let walmartClient: WalmartClient | null = null
  if (
    c.env.WALMART_CONSUMER_ID &&
    c.env.WALMART_KEY_VERSION &&
    c.env.WALMART_PRIVATE_KEY &&
    c.env.WALMART_PUBLISHER_ID
  ) {
    walmartClient = new WalmartClient(
      c.env.WALMART_CONSUMER_ID,
      c.env.WALMART_KEY_VERSION,
      c.env.WALMART_PRIVATE_KEY,
      c.env.WALMART_PUBLISHER_ID,
      c.env.WALMART_BASE_URL
    )
  }

  // Walmart zip — rough extraction from user's default_location_label (e.g. "Dallas, TX 75201")
  const walmartZip = extractZip(user?.default_location_label)

  // Direct-API banners excluded from AI search to avoid duplication
  const apiCoveredStores = [
    ...(krogerPrimaryLocation ? [krogerPrimaryLocation.name, 'Kroger'] : []),
    ...(walmartClient ? ['Walmart'] : [])
  ]

  // ── Step 2: Parallel price search ───────────────────────────────────────
  const [krogerSearchOutcome, walmartSearchOutcome, aiSearchOutcome] = await Promise.allSettled([
    krogerClient && krogerLocations.length > 0
      ? searchKroger(ingredients, krogerLocations, krogerClient)
      : Promise.resolve(null),
    walmartClient
      ? searchWalmart(ingredients, walmartClient, walmartZip)
      : Promise.resolve(null),
    searchNonApiStores(ingredients, body, user, provider, apiCoveredStores)
  ])

  if (krogerSearchOutcome.status === 'rejected') {
    console.error('[plan] Kroger search rejected:', krogerSearchOutcome.reason)
  }
  if (walmartSearchOutcome.status === 'rejected') {
    console.error('[plan] Walmart search rejected:', walmartSearchOutcome.reason)
  }
  if (aiSearchOutcome.status === 'rejected') {
    console.error('[plan] AI search rejected:', aiSearchOutcome.reason)
  }

  const krogerResult = krogerSearchOutcome.status === 'fulfilled' ? krogerSearchOutcome.value : null
  const walmartResult = walmartSearchOutcome.status === 'fulfilled' ? walmartSearchOutcome.value : null
  const aiStorePlans = aiSearchOutcome.status === 'fulfilled' ? aiSearchOutcome.value : []

  console.log('[plan] results → kroger items:', krogerResult ? Object.keys(krogerResult.items).length : 'null',
    'walmart items:', walmartResult ? Object.keys(walmartResult).length : 'null',
    'ai stores:', aiStorePlans.length)

  // ── Step 3: Assemble store plans ─────────────────────────────────────────
  const allStores: StorePlan[] = []

  // Kroger store plan
  if (krogerResult && Object.keys(krogerResult.items).length > 0) {
    const krogerItems: StoreItem[] = []

    for (const ingredient of ingredients) {
      const kr = krogerResult.items[ingredient.id]
      if (kr) {
        const effectivePrice = kr.promoPrice ?? kr.regularPrice
        krogerItems.push({
          ingredientId: ingredient.id,
          name: kr.name,
          sku: kr.sku,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: effectivePrice,
          lineTotal: Math.round(effectivePrice * ingredient.quantity * 100) / 100,
          confidence: 'real',
          shopUrl: kr.productUrl,
          productUrl: kr.productUrl,
          proofUrl: kr.productUrl,
          isLoyaltyPrice: kr.promoPrice !== null && kr.promoPrice < kr.regularPrice,
          nonMemberPrice: kr.promoPrice !== null ? kr.regularPrice : undefined,
          pricedSize: parseSize(kr.size) ?? null
        })
      } else {
        krogerItems.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          sku: undefined,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 'estimated',
          shopUrl: getShopUrl('Kroger', ingredient.name),
          productUrl: undefined,
          proofUrl: undefined,
          isLoyaltyPrice: false,
          nonMemberPrice: undefined,
          notAvailable: true,
          pricedSize: null
        })
      }
    }

    const availableItems = krogerItems.filter(i => !i.notAvailable)
    if (availableItems.length > 0) {
      const subtotal = availableItems.reduce((s, i) => s + i.lineTotal, 0)
      const tax = Math.round(subtotal * 0.0825 * 100) / 100
      allStores.push({
        storeName: krogerResult.storeName,
        storeBanner: 'Kroger',
        storeBannerNormalized: 'kroger',
        storeAddress: krogerResult.storeAddress,
        distanceMiles: 0,
        storeType: 'physical',
        priceSource: 'kroger_api',
        items: krogerItems,
        subtotal: Math.round(subtotal * 100) / 100,
        estimatedTax: tax,
        grandTotal: Math.round((subtotal + tax) * 100) / 100
      })
    }
  }

  // Walmart store plan
  if (walmartResult && Object.keys(walmartResult).length > 0) {
    const walmartItems: StoreItem[] = []

    for (const ingredient of ingredients) {
      const wm = walmartResult[ingredient.id]
      if (wm) {
        const effectivePrice = wm.promoPrice ?? wm.regularPrice
        walmartItems.push({
          ingredientId: ingredient.id,
          name: wm.name,
          sku: wm.sku,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: effectivePrice,
          lineTotal: Math.round(effectivePrice * ingredient.quantity * 100) / 100,
          confidence: 'real',
          shopUrl: wm.productUrl,
          productUrl: wm.productUrl,
          proofUrl: wm.productUrl,
          isLoyaltyPrice: wm.promoPrice !== null && wm.promoPrice < wm.regularPrice,
          nonMemberPrice: wm.promoPrice !== null ? wm.regularPrice : undefined,
          pricedSize: parseSize(wm.size) ?? null
        })
      } else {
        walmartItems.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          sku: undefined,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 'estimated',
          shopUrl: getShopUrl('Walmart', ingredient.name),
          productUrl: undefined,
          proofUrl: undefined,
          isLoyaltyPrice: false,
          nonMemberPrice: undefined,
          notAvailable: true,
          pricedSize: null
        })
      }
    }

    const availableItems = walmartItems.filter(i => !i.notAvailable)
    if (availableItems.length > 0) {
      const subtotal = availableItems.reduce((s, i) => s + i.lineTotal, 0)
      const tax = Math.round(subtotal * 0.0825 * 100) / 100
      allStores.push({
        storeName: 'Walmart',
        storeBanner: 'Walmart',
        storeBannerNormalized: 'walmart',
        storeAddress: undefined,
        distanceMiles: undefined,
        storeType: 'delivery',
        priceSource: 'walmart_api',
        items: walmartItems,
        subtotal: Math.round(subtotal * 100) / 100,
        estimatedTax: tax,
        grandTotal: Math.round((subtotal + tax) * 100) / 100
      })
    }
  }

  // AI-sourced stores — pad, validate URLs, guarantee shopUrl on every item
  // ── Pre-pass: bring in any cached items we already resolved within 24h ──
  const cacheLookupPairs: Array<{ banner: string; ingredient: IngredientLine }> = []
  for (const aiStore of aiStorePlans) {
    const bannerKey = aiStore.storeBannerNormalized ?? normalizeBanner(aiStore.storeBanner)
    for (const ingredient of ingredients) {
      cacheLookupPairs.push({ banner: bannerKey, ingredient })
    }
  }
  const cacheHits = await readCache(c.env, cacheLookupPairs)

  // Collect candidate proofUrls from the AI response for validation
  const candidateUrls: string[] = []
  for (const store of aiStorePlans) {
    for (const item of store.items) {
      if (item.proofUrl) candidateUrls.push(item.proofUrl)
    }
  }
  const verifiedUrls = await validateUrls(candidateUrls)

  // Content-verify each HEAD-ok proofUrl: parse the page HTML and confirm
  // the product name + price actually appear. Failures downgrade to estimated.
  const verifiedContentByUrl = new Map<string, boolean>()
  await Promise.all(
    aiStorePlans.flatMap(store =>
      store.items
        .filter(it => it.proofUrl && verifiedUrls.has(it.proofUrl!))
        .map(async it => {
          const result = await verifyProductContent(it.proofUrl!, it.name, it.unitPrice)
          verifiedContentByUrl.set(it.proofUrl!, result.verified)
          if (!result.verified) {
            console.warn('[ai-verify] rejected', { url: it.proofUrl, name: it.name, price: it.unitPrice, reason: result.reason })
          }
        })
    )
  )

  const totalChecked = verifiedContentByUrl.size
  const rejected = Array.from(verifiedContentByUrl.values()).filter(v => !v).length
  console.log('[ai-verify] summary', { totalChecked, rejected, rejectionRate: totalChecked ? rejected / totalChecked : 0 })

  const cacheWrites: Array<{ banner: string; ingredient: IngredientLine; value: CachedStoreItem }> = []

  for (const aiStore of aiStorePlans) {
    const bannerKey = aiStore.storeBannerNormalized ?? normalizeBanner(aiStore.storeBanner)
    const foundIds = new Set(aiStore.items.map(i => i.ingredientId))

    // Reconcile each AI-returned item
    for (const item of aiStore.items) {
      const ingredient = ingredients.find(i => i.id === item.ingredientId)
      const ingredientName = ingredient?.name ?? item.name

      // Check cache first — cache wins over AI result (24h TTL means it's recent)
      const cacheHit = cacheHits.get(`${bannerKey}::${item.ingredientId}`)
      if (cacheHit) {
        Object.assign(item, cacheHit.item, {
          ingredientId: item.ingredientId,
          pricedSize: cacheHit.item.pricedSize ?? null,
        })
        continue
      }

      // Reconcile URLs: proofUrl only if HEAD-validated AND content-verified
      const urlOk = item.proofUrl && verifiedUrls.has(item.proofUrl)
      const contentOk = item.proofUrl ? verifiedContentByUrl.get(item.proofUrl) === true : false
      if (urlOk && contentOk) {
        item.productUrl = item.proofUrl
        item.shopUrl = item.proofUrl as string
      } else {
        item.proofUrl = undefined
        item.productUrl = undefined
        item.shopUrl = getShopUrl(aiStore.storeBanner, ingredientName)
        if (item.confidence === 'real') item.confidence = 'estimated_with_source'
      }

      // Persist the resolved item to cache for 24h — future requests skip the AI entirely
      if (ingredient && !item.notAvailable && item.unitPrice > 0) {
        cacheWrites.push({
          banner: bannerKey,
          ingredient,
          value: {
            item: { ...item },
            storeName: aiStore.storeName,
            storeBanner: aiStore.storeBanner,
            storeAddress: aiStore.storeAddress,
            priceSource: 'ai_estimated',
            cachedAt: Date.now()
          }
        })
      }
    }

    // Pad items the AI didn't return — still guarantee a shopUrl
    for (const ingredient of ingredients) {
      if (!foundIds.has(ingredient.id)) {
        aiStore.items.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          sku: undefined,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 'estimated',
          shopUrl: getShopUrl(aiStore.storeBanner, ingredient.name),
          productUrl: undefined,
          proofUrl: undefined,
          isLoyaltyPrice: false,
          nonMemberPrice: undefined,
          notAvailable: true,
          pricedSize: null
        })
      }
    }

    aiStore.storeBannerNormalized = bannerKey
    allStores.push(aiStore)
  }

  // Fire-and-forget cache writes (don't block response)
  c.executionCtx.waitUntil(writeCache(c.env, cacheWrites))

  // Enforce maxStores
  const finalStores = allStores.slice(0, body.settings.maxStores)

  const allItems: StoreItem[] = finalStores.flatMap(s => s.items.filter(i => !i.notAvailable))
  const realCount = allItems.filter(i => i.confidence === 'real').length
  const estimatedCount = allItems.filter(i => i.confidence !== 'real').length

  // ── Totals: SHOPPING_V2 uses best-basket selector; legacy sums all stores ──
  let subtotal: number
  let tax: number
  let total: number
  let bestBasketTotal: number | null = null
  let planWinners: WinnerResult[] | undefined
  let resolvedSpecs: ShoppableItemSpec[] | undefined

  // Generate the plan ID up-front so the IDP linkback can deep-link to it
  // and shoppingPlan.id reuses the same value.
  const planId = crypto.randomUUID()

  if (c.env.SHOPPING_V2 === 'true') {
    const userProfile: UserProfile = {
      // Request-first to match the AI-prompt helper's order (line ~165) — the
      // per-request setting logically takes precedence over the account default.
      avoid_brands: [
        ...(body.settings?.avoidBrands ?? []),
        ...(user?.avoid_brands ?? []),
      ],
    }

    // M9: Use body.resolvedSpecs if the caller provided them (from /api/clarify),
    // else fall back to extractSpecs on an interim plan constructed from store results.
    //
    // IMPORTANT: /api/clarify returns `specs` ONLY for items that did NOT need
    // clarification. Clarified items come back via `resolvedClarifications` on
    // the subsequent /api/price-plan call with no corresponding spec. So even
    // when `body.resolvedSpecs` is populated it may be missing some ingredients.
    // We always synthesize a full spec list from the interim plan, then overlay
    // the client-provided specs by id. That way every ingredient is guaranteed
    // to have a spec that `selectWinner` can operate on.
    let clientSpecs: ShoppableItemSpec[] = []
    if (body.resolvedSpecs && body.resolvedSpecs.length > 0) {
      try {
        clientSpecs = body.resolvedSpecs.map(validateSpecInput) as ShoppableItemSpec[]
      } catch (err) {
        console.warn('[plan] resolvedSpecs validation failed, falling back to synthesized specs:', err)
      }
    }

    const interimPlan: ShoppingPlan = {
      id: planId,
      generatedAt: new Date().toISOString(),
      meta: {
        location: body.location,
        storesQueried: finalStores.map(s => ({ name: s.storeName, source: s.priceSource })),
        modelUsed: '__interim__',
        budgetMode: body.budget?.mode ?? 'calculate',
      },
      ingredients,
      stores: finalStores,
      summary: { subtotal: 0, estimatedTax: 0, total: 0, realPriceCount: 0, estimatedPriceCount: 0 },
    }
    const synthesizedSpecs = extractSpecs(interimPlan)
    const clientSpecsById = new Map(clientSpecs.map(s => [s.id, s]))
    resolvedSpecs = synthesizedSpecs.map(s => clientSpecsById.get(s.id) ?? s)

    // Compute per-item winners and attach to the plan.
    planWinners = resolvedSpecs.map(spec => selectWinner(spec, finalStores, userProfile))

    // Sum winner lineTotals for the best-basket total (replaces the legacy summing bug).
    const winnerSubtotalRaw = planWinners.reduce((s, w) => s + (w.winner?.item.lineTotal ?? 0), 0)
    subtotal = Math.round(winnerSubtotalRaw * 100) / 100
    tax = Math.round(subtotal * 0.0825 * 100) / 100
    total = Math.round((subtotal + tax) * 100) / 100
    bestBasketTotal = total
  } else {
    // Legacy: sum every store's subtotal (known to 4.5× inflate the total)
    subtotal = finalStores.reduce((s, st) => s + st.subtotal, 0)
    tax = finalStores.reduce((s, st) => s + st.estimatedTax, 0)
    total = Math.round((subtotal + tax) * 100) / 100
  }

  // ── M11: Instacart Recipe Page API — fire-and-forget ────────────────────
  // Attach a shoppable Instacart URL to the plan when INSTACART_IDP_API_KEY is
  // configured.  Fails silently: a failed IDP call never blocks plan delivery.
  // Only runs on the SHOPPING_V2 path (resolvedSpecs required); skip on legacy.
  let instacartUrl: string | undefined
  if (c.env.INSTACART_IDP_API_KEY && resolvedSpecs && resolvedSpecs.length > 0) {
    try {
      const idp = new IdpClient({ apiKey: c.env.INSTACART_IDP_API_KEY })
      const idpTitle = `E.G.G.S. Shopping List — ${new Date().toISOString().slice(0, 10)}`
      const idpLinkback = `https://eggs.app/plan/${planId}`
      const idpResult = await idp.createShoppingListPage(resolvedSpecs, idpTitle, idpLinkback)
      instacartUrl = idpResult.productsLinkUrl
    } catch (err) {
      console.warn('[plan] Instacart IDP call failed, continuing without link:', err)
    }
  }

  // ── Narrative summary ────────────────────────────────────────────────────
  // Compute which ingredients have NO match across ALL stores.
  const trulyUnmatched = ingredients.filter(ing =>
    finalStores.every(s =>
      s.items.some(item => item.ingredientId === ing.id && item.notAvailable)
      || !s.items.some(item => item.ingredientId === ing.id)
    )
  )

  const narrativeFacts: NarrativeFacts = {
    requested: ingredients.length,
    matched: ingredients.length - trulyUnmatched.length,
    unmatchedNames: trulyUnmatched.map(i => i.name),
    stores: finalStores.map(s => ({
      name: s.storeName,
      source: s.priceSource === 'kroger_api' ? 'live Kroger API'
        : s.priceSource === 'walmart_api' ? 'live Walmart API'
        : 'AI web search + URL validation',
      subtotal: s.subtotal,
    })),
    total,
    realCount,
    estimatedCount,
    ingredientNames: ingredients.map(i => i.name.toLowerCase()),
  }

  let planNarrative = ''
  try {
    const narrativeResult = await provider.complete({
      system: 'You write concise, honest shopping plan summaries for a grocery price optimization tool.',
      messages: [{
        role: 'user',
        content: buildNarrativePrompt(narrativeFacts),
      }],
      maxTokens: 200,
      jsonMode: false,
    })
    planNarrative = narrativeResult.content.trim()
  } catch {
    planNarrative = fallbackNarrative(narrativeFacts)
  }

  const modelUsed = `claude-haiku-4-5 + kroger_api${walmartClient ? ' + walmart_api' : ''} + web_search + web_fetch (parallel, cached)`

  const shoppingPlan: ShoppingPlan = {
    id: planId,
    generatedAt: new Date().toISOString(),
    meta: {
      eventId: body.eventId,
      eventName: body.eventName,
      headcount: body.headcount,
      location: body.location,
      storesQueried: finalStores.map(s => ({ name: s.storeName, source: s.priceSource })),
      modelUsed,
      budgetMode: body.budget?.mode ?? 'calculate',
      budgetCeiling: body.budget?.amount,
      budgetExceeded: body.budget?.mode === 'ceiling' && body.budget.amount
        ? total > body.budget.amount
        : undefined,
      // M9: persist resolved specs for future reads / recompute-at-read
      ...(resolvedSpecs ? { specs: resolvedSpecs } : {})
    },
    ingredients,
    stores: finalStores,
    summary: {
      narrative: planNarrative,
      subtotal: Math.round(subtotal * 100) / 100,
      estimatedTax: Math.round(tax * 100) / 100,
      total,
      realPriceCount: realCount,
      estimatedPriceCount: estimatedCount
    },
    // M9: attach winners for the best-basket UI (only on SHOPPING_V2 plans)
    ...(planWinners ? { winners: planWinners } : {}),
    // M11: Instacart Recipe Page URL (absent when IDP key is missing or call failed)
    ...(instacartUrl ? { instacartUrl } : {})
  }

  // Persist plan
  const { error: saveError } = await supabase
    .from('shopping_plans')
    .insert({
      id: shoppingPlan.id,
      event_id: body.eventId ?? null,
      user_id: userId,
      plan_data: shoppingPlan,
      model_used: shoppingPlan.meta.modelUsed,
      best_basket_total: bestBasketTotal  // null for legacy path; numeric for SHOPPING_V2 path
    })
    .select()
    .single()

  if (saveError) {
    return c.json({ error: 'Failed to save plan' }, 500)
  }

  if (body.eventId) {
    await supabase
      .from('events')
      .update({ status: 'shopping' })
      .eq('id', body.eventId)
      .eq('user_id', userId)
  }

  return c.json(shoppingPlan)
})

// Pull a US ZIP code out of a free-text location label, or undefined.
function extractZip(label?: string | null): string | undefined {
  if (!label) return undefined
  const match = label.match(/\b(\d{5})(?:-\d{4})?\b/)
  return match ? match[1] : undefined
}

export default plan
