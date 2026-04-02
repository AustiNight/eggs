import { Hono } from 'hono'
import type {
  HonoEnv,
  PricePlanRequest,
  ShoppingPlan,
  StorePlan,
  StoreItem,
  IngredientLine
} from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuthOrServiceKey } from '../middleware/auth.js'
import { enforceFreeLimit } from '../middleware/limits.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { getProvider } from '../providers/index.js'
import { KrogerClient } from '../integrations/kroger.js'

const plan = new Hono<HonoEnv>()

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

  // ── Step 1: Kroger real prices ───────────────────────────────────────────
  const krogerResults: Record<string, {
    sku: string; name: string; brand: string
    regularPrice: number; promoPrice: number | null
    productUrl: string; size: string
    locationId: string; storeName: string; storeAddress: string; distanceMiles: number
  }> = {}

  if (c.env.KROGER_CLIENT_ID && c.env.KROGER_CLIENT_SECRET) {
    const kroger = new KrogerClient(c.env.KROGER_CLIENT_ID, c.env.KROGER_CLIENT_SECRET)
    const locations = await kroger.findNearbyLocations(body.location.lat, body.location.lng, body.settings.radiusMiles)

    if (locations.length) {
      const primaryLocation = locations[0]
      await Promise.allSettled(
        ingredients.map(async (ingredient) => {
          const result = await kroger.getPriceForIngredient(ingredient.name, primaryLocation.locationId)
          if (result) {
            krogerResults[ingredient.id] = {
              ...result,
              locationId: primaryLocation.locationId,
              storeName: primaryLocation.name,
              storeAddress: [
                primaryLocation.address.addressLine1,
                primaryLocation.address.city,
                primaryLocation.address.state
              ].join(', '),
              distanceMiles: 0
            }
          }
        })
      )
    }
  }

  // ── Step 2: AI fallback for items Kroger didn't cover ────────────────────
  const needsAI = ingredients.filter(i => !krogerResults[i.id])

  let aiStorePlans: StorePlan[] = []

  if (needsAI.length > 0) {
    const avoidStores = [...(body.settings.avoidStores ?? []), ...(user?.avoid_stores ?? [])]
    const avoidBrands = [...(body.settings.avoidBrands ?? []), ...(user?.avoid_brands ?? [])]
    const addressLine = user?.default_location_label
      ? `Chef location: ${user.default_location_label}`
      : `GPS coordinates: ${body.location.lat}, ${body.location.lng}`

    const itemLines = needsAI.map(i => `- ${i.quantity} ${i.unit} ${i.name} (id: ${i.id})`).join('\n')

    const aiResult = await provider.complete({
      system: `You are a professional grocery price research assistant for event chefs.
Find real, current prices for the listed ingredients from local stores near the given location.
You have web search access — use it to find actual product pages and current prices.

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
Max stores: ${body.settings.maxStores}
Include delivery: ${body.settings.includeDelivery}
${avoidStores.length ? `DO NOT include these stores: ${avoidStores.join(', ')}` : ''}
${avoidBrands.length ? `DO NOT include these brands: ${avoidBrands.join(', ')}` : ''}
${body.eventName ? `Event: ${body.eventName} (${body.headcount ?? '?'} guests)` : ''}

Find the lowest prices for these ingredients:
${itemLines}

Priority: find the absolute lowest total cost. Assume loyalty card pricing at every chain.
Tax rate: 8.25%.`
        }
      ],
      maxTokens: 6000,
      jsonMode: true
    })

    try {
      const parsed = JSON.parse(aiResult.content) as { stores: StorePlan[] }
      aiStorePlans = parsed.stores ?? []
    } catch {
      // AI fallback failed — continue with Kroger-only results
    }
  }

  // ── Step 3: Assemble final plan ──────────────────────────────────────────
  const krogerItems: StoreItem[] = []
  let krogerStoreName = ''
  let krogerStoreAddress = ''

  for (const [ingredientId, kr] of Object.entries(krogerResults)) {
    const ingredient = ingredients.find(i => i.id === ingredientId)!
    const effectivePrice = kr.promoPrice ?? kr.regularPrice
    krogerStoreName = kr.storeName
    krogerStoreAddress = kr.storeAddress

    krogerItems.push({
      ingredientId,
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
  }

  const allStores: StorePlan[] = []

  if (krogerItems.length > 0) {
    const subtotal = krogerItems.reduce((s, i) => s + i.lineTotal, 0)
    const tax = Math.round(subtotal * 0.0825 * 100) / 100
    allStores.push({
      storeName: krogerStoreName,
      storeBanner: 'Kroger',
      storeAddress: krogerStoreAddress,
      distanceMiles: 0,
      storeType: 'physical',
      priceSource: 'kroger_api',
      items: krogerItems,
      subtotal: Math.round(subtotal * 100) / 100,
      estimatedTax: tax,
      grandTotal: Math.round((subtotal + tax) * 100) / 100
    })
  }

  allStores.push(...aiStorePlans)

  // Enforce maxStores
  const finalStores = allStores.slice(0, body.settings.maxStores)

  const allItems: StoreItem[] = finalStores.flatMap(s => s.items)
  const subtotal = finalStores.reduce((s, st) => s + st.subtotal, 0)
  const tax = finalStores.reduce((s, st) => s + st.estimatedTax, 0)
  const total = Math.round((subtotal + tax) * 100) / 100
  const realCount = allItems.filter(i => i.confidence === 'real').length
  const estimatedCount = allItems.filter(i => i.confidence !== 'real').length

  const shoppingPlan: ShoppingPlan = {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    meta: {
      eventId: body.eventId,
      eventName: body.eventName,
      headcount: body.headcount,
      location: body.location,
      storesQueried: finalStores.map(s => ({ name: s.storeName, source: s.priceSource })),
      modelUsed: 'claude-haiku-4-5 + kroger_api',
      budgetMode: body.budget?.mode ?? 'calculate',
      budgetCeiling: body.budget?.amount,
      budgetExceeded: body.budget?.mode === 'ceiling' && body.budget.amount
        ? total > body.budget.amount
        : undefined
    },
    ingredients,
    stores: finalStores,
    summary: {
      subtotal: Math.round(subtotal * 100) / 100,
      estimatedTax: Math.round(tax * 100) / 100,
      total,
      realPriceCount: realCount,
      estimatedPriceCount: estimatedCount
    }
  }

  // Persist plan
  const { data: savedPlan } = await supabase
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

  // If linked to event, transition to shopping status
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
