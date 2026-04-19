import { Hono } from 'hono'
import type {
  HonoEnv,
  PricePlanRequest,
  ShoppingPlan,
  StorePlan,
  StoreItem,
  IngredientLine,
  KrogerLocation
} from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuthOrServiceKey } from '../middleware/auth.js'
import { enforceFreeLimit } from '../middleware/limits.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { getProvider, type AnthropicTool } from '../providers/index.js'
import { KrogerClient } from '../integrations/kroger.js'
import { WalmartClient } from '../integrations/walmart.js'
import { getShopUrl, normalizeBanner } from '../integrations/store-urls.js'
import { validateUrls } from '../lib/url-validator.js'

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

// ── Kroger: search all ingredients at a single location ──────────────────────
async function searchKroger(
  ingredients: IngredientLine[],
  location: KrogerLocation,
  client: KrogerClient
): Promise<{
  storeName: string
  storeAddress: string
  items: Record<string, {
    sku: string; name: string; brand: string
    regularPrice: number; promoPrice: number | null
    productUrl: string; size: string
  }>
}> {
  const items: Record<string, {
    sku: string; name: string; brand: string
    regularPrice: number; promoPrice: number | null
    productUrl: string; size: string
  }> = {}

  await Promise.allSettled(
    ingredients.map(async (ingredient) => {
      const result = await client.getPriceForIngredient(ingredient.name, location.locationId)
      if (result) items[ingredient.id] = result
    })
  )

  return {
    storeName: location.name,
    storeAddress: [
      location.address.addressLine1,
      location.address.city,
      location.address.state
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

  // allowed_callers: ['direct'] is required for claude-haiku-4-5 — Haiku does not
  // support programmatic tool calling (code_execution calling other tools).
  const tools: AnthropicTool[] = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches, allowed_callers: ['direct'] },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.floor(maxSearches / 2), allowed_callers: ['direct'] }
  ]

  let aiResult
  try {
    aiResult = await provider.complete({
      system: `You are a professional grocery price research assistant for event chefs.
Use the web_search tool to find current prices for ALL listed ingredients across grocery stores near the given location.
When a web_search result looks promising, use web_fetch to load the actual product page and confirm the price and URL.
Search MULTIPLE stores and return a separate entry per store.${excludeLine}

CONFIDENCE RULES (strict):
- "real": you web_fetched the product page and the price is on the page you fetched
- "estimated_with_source": web_search returned a URL but you could not web_fetch it to confirm
- "estimated": no source URL at all — use a national average estimate (price only, no URL)

PROOF URL RULES (strict):
- proofUrl MUST be a URL returned by web_search or web_fetch — NEVER construct, guess, or infer one
- If no tool call returned a URL for an ingredient, leave proofUrl null
- Never fabricate a URL. Never use a search-results page as proofUrl.

Return ONLY valid JSON matching this schema (no markdown, no code fence):
{
  "stores": [
    {
      "storeName": string,
      "storeBanner": string,
      "storeBannerNormalized": string (lowercase key like "tom thumb", "target"; no geography or addresses),
      "storeAddress": string,
      "distanceMiles": number,
      "storeType": "physical"|"delivery"|"curbside",
      "priceSource": "ai_estimated",
      "items": [
        {
          "ingredientId": string,
          "name": string,
          "sku": string|null,
          "quantity": number,
          "unit": string,
          "unitPrice": number,
          "lineTotal": number,
          "confidence": "real"|"estimated_with_source"|"estimated",
          "proofUrl": string|null,
          "isLoyaltyPrice": boolean,
          "nonMemberPrice": number|null
        }
      ],
      "subtotal": number,
      "estimatedTax": number,
      "grandTotal": number
    }
  ]
}`,
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

Search ALL non-API stores in the area for EVERY ingredient below. Return ALL stores you find, not just the cheapest:
${itemLines}

For each store, find prices for every item. If an item isn't carried, include it with unitPrice: 0 and confidence: "estimated" and a note in the name field.
Assume loyalty/member card pricing where available.
Tax rate: 8.25%.`
        }
      ],
      maxTokens: 8000,
      jsonMode: false,  // tools are incompatible with Anthropic's jsonMode prefill
      tools
    })
  } catch (err) {
    console.error('[searchNonApiStores] provider.complete threw:', err instanceof Error ? err.message : err)
    return []
  }

  if (!aiResult) {
    console.error('[searchNonApiStores] provider returned no result')
    return []
  }
  const raw = aiResult.content
  console.log('[searchNonApiStores] AI returned', raw.length, 'chars;', aiResult.citations?.length ?? 0, 'citations')
  // Tool-mode responses are free-text; extract the first top-level JSON object.
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('[searchNonApiStores] no JSON object found in AI response. First 500 chars:', raw.slice(0, 500))
    return []
  }
  let parsed: { stores?: StorePlan[] }
  try {
    parsed = JSON.parse(jsonMatch[0]) as { stores?: StorePlan[] }
  } catch {
    return []
  }
  const stores = parsed.stores ?? []

  // Cross-reference asserted proofUrls against the citations the model actually
  // retrieved. Anything not in citations is presumed fabricated.
  const citedUrls = new Set((aiResult.citations ?? []).map(c => c.url))
  for (const store of stores) {
    for (const item of store.items) {
      if (item.proofUrl && !citedUrls.has(item.proofUrl)) {
        // Drop fabricated URL; downgrade confidence if it was asserted as real
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
    name: body.resolvedClarifications?.[i.id] ?? i.clarifiedName ?? i.name
  }))

  // ── Step 1: Direct API store discovery ───────────────────────────────────
  let krogerClient: KrogerClient | null = null
  let krogerPrimaryLocation: KrogerLocation | null = null
  if (c.env.KROGER_CLIENT_ID && c.env.KROGER_CLIENT_SECRET) {
    krogerClient = new KrogerClient(c.env.KROGER_CLIENT_ID, c.env.KROGER_CLIENT_SECRET)
    const locations = await krogerClient
      .findNearbyLocations(body.location.lat, body.location.lng, body.settings.radiusMiles)
      .catch(() => [])
    krogerPrimaryLocation = locations[0] ?? null
  }

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
    krogerClient && krogerPrimaryLocation
      ? searchKroger(ingredients, krogerPrimaryLocation, krogerClient)
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
          nonMemberPrice: kr.promoPrice !== null ? kr.regularPrice : undefined
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
          notAvailable: true
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
          nonMemberPrice: wm.promoPrice !== null ? wm.regularPrice : undefined
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
          notAvailable: true
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
        Object.assign(item, cacheHit.item, { ingredientId: item.ingredientId })
        continue
      }

      // Reconcile URLs: proofUrl only if HEAD-validated AND in citations
      const verified = item.proofUrl && verifiedUrls.has(item.proofUrl)
      if (verified) {
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
          notAvailable: true
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
  const subtotal = finalStores.reduce((s, st) => s + st.subtotal, 0)
  const tax = finalStores.reduce((s, st) => s + st.estimatedTax, 0)
  const total = Math.round((subtotal + tax) * 100) / 100
  const realCount = allItems.filter(i => i.confidence === 'real').length
  const estimatedCount = allItems.filter(i => i.confidence !== 'real').length

  // ── Narrative summary ────────────────────────────────────────────────────
  let planNarrative = ''
  try {
    const storeLines = finalStores.map(s => {
      const available = s.items.filter(i => !i.notAvailable)
      const source = s.priceSource === 'kroger_api' ? 'live Kroger API'
        : s.priceSource === 'walmart_api' ? 'live Walmart API'
        : 'AI web search + URL validation'
      return `${s.storeName} (${available.length}/${ingredients.length} items found, ${source}, subtotal $${s.subtotal.toFixed(2)})`
    }).join('; ')

    const totalItems = allItems.length
    const budgetNote = body.budget?.mode === 'ceiling' && body.budget.amount
      ? ` Budget ceiling was $${body.budget.amount.toFixed(2)} — plan ${total > body.budget.amount ? 'exceeded' : 'came in under'} at $${total.toFixed(2)}.`
      : ''

    const narrativeResult = await provider.complete({
      system: 'You write concise, honest shopping plan summaries for a grocery price optimization tool.',
      messages: [{
        role: 'user',
        content: `You are the E.G.G.S. shopping agent. Write a 2-3 sentence summary of the shopping plan results below. Be specific about which stores were found, how many items were matched, and whether prices are live or estimated.

Plan results:
- Direct APIs: Kroger${walmartClient ? ' + Walmart' : ''}. AI web search covers all other nearby stores.
- Results: ${storeLines}
- Total: $${total.toFixed(2)} (including ~8.25% tax)
- ${realCount} of ${totalItems} item prices are live (verified); ${estimatedCount} are AI-estimated${budgetNote}

Write only the summary paragraph, no preamble.`
      }],
      maxTokens: 200,
      jsonMode: false
    })
    planNarrative = narrativeResult.content.trim()
  } catch {
    const storeCount = finalStores.length
    planNarrative = `Searched Kroger${walmartClient ? ' + Walmart' : ''} via live API and ${storeCount > 1 ? `${storeCount - 1} additional store${storeCount > 2 ? 's' : ''} via AI + URL validation` : 'nearby stores via AI + URL validation'} in parallel. ${realCount} live price${realCount !== 1 ? 's' : ''}; ${estimatedCount} AI-estimated.`
  }

  const modelUsed = `claude-haiku-4-5 + kroger_api${walmartClient ? ' + walmart_api' : ''} + web_search + web_fetch (parallel, cached)`

  const shoppingPlan: ShoppingPlan = {
    id: crypto.randomUUID(),
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
        : undefined
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
    }
  }

  // Persist plan
  const { error: saveError } = await supabase
    .from('shopping_plans')
    .insert({
      id: shoppingPlan.id,
      event_id: body.eventId ?? null,
      user_id: userId,
      plan_data: shoppingPlan,
      model_used: shoppingPlan.meta.modelUsed
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
