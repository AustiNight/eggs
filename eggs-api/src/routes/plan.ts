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
import { getProvider } from '../providers/index.js'
import { KrogerClient } from '../integrations/kroger.js'

const plan = new Hono<HonoEnv>()

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

// ── AI: search all non-API stores for ALL ingredients ───────────────────────
async function searchNonApiStores(
  ingredients: IngredientLine[],
  body: PricePlanRequest,
  user: { avoid_stores?: string[]; avoid_brands?: string[]; default_location_label?: string | null } | null,
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

  let aiResult
  try {
    aiResult = await provider.complete({
      system: `You are a professional grocery price research assistant for event chefs.
Search for current prices for ALL listed ingredients across grocery stores near the given location.
You have web search access — use it to find actual product pages and current prices.
Search MULTIPLE stores and return a separate entry per store.${excludeLine}

CONFIDENCE RULES (strictly follow):
- "real": only when you retrieved and confirmed the price from an actual product page URL
- "estimated_with_source": you found a source URL but cannot confirm the exact price matches
- "estimated": no verifiable source found — use national average estimate

PROOF URL RULES:
- proofUrl MUST be a real page URL you actually retrieved — not a search page, not a homepage
- If you cannot provide a real proofUrl, omit it entirely and set confidence to "estimated"
- NEVER fabricate a URL

Return ONLY valid JSON matching this schema (no markdown):
{
  "stores": [
    {
      "storeName": string,
      "storeBanner": string,
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
          "productUrl": string|null,
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

For each store, find prices for every item on the list. If an item isn't carried at a store, include it with unitPrice: 0 and confidence: "estimated" and a note in the name field.
Assume loyalty/member card pricing where available.
Tax rate: 8.25%.`
        }
      ],
      maxTokens: 8000,
      jsonMode: true
    })
  } catch {
    return []
  }

  if (!aiResult) return []
  try {
    const parsed = JSON.parse(aiResult.content) as { stores: StorePlan[] }
    return parsed.stores ?? []
  } catch {
    return []
  }
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

  // ── Step 1: Store discovery ──────────────────────────────────────────────
  // Find nearby locations for all integrated APIs before launching price searches.
  let krogerClient: KrogerClient | null = null
  let krogerPrimaryLocation: KrogerLocation | null = null

  if (c.env.KROGER_CLIENT_ID && c.env.KROGER_CLIENT_SECRET) {
    krogerClient = new KrogerClient(c.env.KROGER_CLIENT_ID, c.env.KROGER_CLIENT_SECRET)
    const locations = await krogerClient
      .findNearbyLocations(body.location.lat, body.location.lng, body.settings.radiusMiles)
      .catch(() => [])
    krogerPrimaryLocation = locations[0] ?? null
  }

  // Build the list of stores covered by integrated APIs so AI doesn't duplicate them
  const apiCoveredStores = krogerPrimaryLocation ? [krogerPrimaryLocation.name, 'Kroger'] : []

  // ── Step 2: Parallel price search ───────────────────────────────────────
  // Stream A: All integrated APIs (Kroger now; Walmart/Walgreens when ready)
  // Stream B: AI searches every other store in the area for all ingredients
  const [krogerSearchOutcome, aiSearchOutcome] = await Promise.allSettled([
    krogerClient && krogerPrimaryLocation
      ? searchKroger(ingredients, krogerPrimaryLocation, krogerClient)
      : Promise.resolve(null),
    searchNonApiStores(ingredients, body, user, provider, apiCoveredStores)
  ])

  const krogerResult = krogerSearchOutcome.status === 'fulfilled' ? krogerSearchOutcome.value : null
  const aiStorePlans = aiSearchOutcome.status === 'fulfilled' ? aiSearchOutcome.value : []

  // ── Step 3: Assemble store plans ─────────────────────────────────────────
  const allStores: StorePlan[] = []

  // Build Kroger store plan from API results
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
          productUrl: kr.productUrl,
          proofUrl: kr.productUrl,
          isLoyaltyPrice: kr.promoPrice !== null && kr.promoPrice < kr.regularPrice,
          nonMemberPrice: kr.promoPrice !== null ? kr.regularPrice : undefined
        })
      } else {
        // Item not found at Kroger — include as not-available so schema stays uniform
        krogerItems.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          sku: undefined,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 'estimated',
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

  // Add AI-found stores, padding any missing ingredients with not-available entries
  for (const aiStore of aiStorePlans) {
    const foundIds = new Set(aiStore.items.map(i => i.ingredientId))
    const paddedItems = [...aiStore.items]

    for (const ingredient of ingredients) {
      if (!foundIds.has(ingredient.id)) {
        paddedItems.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          sku: undefined,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 'estimated',
          productUrl: undefined,
          proofUrl: undefined,
          isLoyaltyPrice: false,
          nonMemberPrice: undefined,
          notAvailable: true
        })
      }
    }

    allStores.push({ ...aiStore, items: paddedItems })
  }

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
      const source = s.priceSource === 'kroger_api' ? 'live Kroger API' : 'AI search'
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
        content: `You are the E.G.G.S. shopping agent. Write a 2-3 sentence summary of the shopping plan results below. Be specific about which stores were found, how many items were matched, and whether prices are live or estimated. Be direct and helpful.

Plan results:
- Stores searched in parallel: Kroger API + AI web search for all other nearby stores
- Results: ${storeLines}
- Total: $${total.toFixed(2)} (including ~8.25% tax)
- ${realCount} of ${totalItems} item prices are live from Kroger API; ${estimatedCount} are AI-estimated${budgetNote}

Write only the summary paragraph, no preamble.`
      }],
      maxTokens: 200,
      jsonMode: false
    })
    planNarrative = narrativeResult.content.trim()
  } catch {
    const storeCount = finalStores.length
    planNarrative = `Searched Kroger via live API and ${storeCount > 1 ? `${storeCount - 1} additional store${storeCount > 2 ? 's' : ''} via AI` : 'nearby stores via AI'} in parallel. ${realCount} live price${realCount !== 1 ? 's' : ''} from Kroger API; ${estimatedCount} AI-estimated.`
  }

  const shoppingPlan: ShoppingPlan = {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    meta: {
      eventId: body.eventId,
      eventName: body.eventName,
      headcount: body.headcount,
      location: body.location,
      storesQueried: finalStores.map(s => ({ name: s.storeName, source: s.priceSource })),
      modelUsed: 'claude-haiku-4-5 + kroger_api (parallel)',
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

export default plan
