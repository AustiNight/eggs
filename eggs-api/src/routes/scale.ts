import { Hono } from 'hono'
import type { HonoEnv, IngredientLine } from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { getProvider } from '../providers/index.js'

const scale = new Hono<HonoEnv>()

// POST /api/scale-recipes
// Input: { dishes: [{id, name, servings}], eventId?, storeToIngredientPool?: boolean }
scale.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: user } = await supabase.from('users').select('subscription_tier').eq('id', userId).single()
  const provider = getProvider(c, user ?? undefined)

  const body = await c.req.json<{
    dishes: { id: string; name: string; servings: number }[]
    eventId?: string
    storeToIngredientPool?: boolean
  }>()

  const dishList = body.dishes.map(d => `- ${d.name} (${d.servings} servings)`).join('\n')

  const result = await provider.complete({
    system: `You are a professional culinary assistant that converts dish lists into precise ingredient lists for event catering.
Return ONLY valid JSON matching the schema below — no prose, no markdown fences.

Schema:
{
  "ingredients": [
    {
      "id": "<uuid>",
      "name": "<canonical ingredient name>",
      "quantity": <number>,
      "unit": "<unit string>",
      "category": "<Produce|Protein|Dairy|Grains|Pantry|Spices|Beverages|Other>",
      "sources": [
        { "dishId": "<id>", "dishName": "<name>", "quantity": <number>, "unit": "<unit>", "proportion": <0-1> }
      ]
    }
  ]
}

Rules:
- Consolidate the same ingredient across multiple dishes into a single line, summing quantities
- Fill sources[] with which dishes contributed to each consolidated line and their proportion of the total
- Use professional culinary measurements (oz, lb, cup, tbsp, tsp, each, bunch, clove, etc.)
- Be precise: "boneless skinless chicken breast" not "chicken"
- Account for standard prep waste (10-15% for vegetables, trim loss for proteins)`,
    messages: [
      {
        role: 'user',
        content: `Scale the following dishes and produce a consolidated ingredient list:\n\n${dishList}`
      }
    ],
    maxTokens: 4096,
    jsonMode: true
  })

  let ingredients: IngredientLine[]
  try {
    const parsed = JSON.parse(result.content) as { ingredients: IngredientLine[] }
    // Assign fresh UUIDs to ensure uniqueness
    ingredients = parsed.ingredients.map(i => ({ ...i, id: i.id || crypto.randomUUID() }))
  } catch {
    return c.json({ error: 'Failed to parse AI response' }, 500)
  }

  // Optionally persist to ingredient_pool
  if (body.storeToIngredientPool && body.eventId) {
    // Clear existing pool for this event first
    await supabase.from('ingredient_pool').delete().eq('event_id', body.eventId).eq('user_id', userId)

    const rows = ingredients.map(i => ({
      id: i.id,
      event_id: body.eventId,
      user_id: userId,
      name: i.name,
      clarified_name: i.clarifiedName ?? null,
      quantity: i.quantity,
      unit: i.unit,
      category: i.category,
      sources: i.sources
    }))

    await supabase.from('ingredient_pool').insert(rows)
  }

  return c.json({ ingredients, modelUsed: result.model })
})

export default scale
