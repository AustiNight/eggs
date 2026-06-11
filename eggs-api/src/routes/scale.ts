import { Hono } from 'hono'
import type { HonoEnv, IngredientLine } from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { getProvider } from '../providers/index.js'

const scale = new Hono<HonoEnv>()

/**
 * Best-effort extraction of a JSON object from an LLM response. Handles the
 * common ways a model wraps JSON despite instructions: ```json fences, leading
 * prose, or a prefilled leading "{". Returns the substring from the first "{"
 * to the last "}" after stripping fences. Does NOT fix truncated JSON — that's
 * what the larger maxTokens is for.
 */
export function extractJsonObject(raw: string): string {
  let s = raw.trim()
  // strip a leading ```json / ``` fence and a trailing ``` fence
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) return s.slice(first, last + 1)
  return s
}

// POST /api/scale-recipes
// Input: { dishes: [{id, name, servings}], eventId?, storeToIngredientPool?: boolean }
scale.post('/', requireAuth, rateLimit, async (c) => {
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

  let result
  try {
    result = await provider.complete({
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
    // Large events consolidate many dishes into ingredient lines each carrying a
    // sources[] array — 4096 truncated the JSON mid-object. Haiku 4.5 supports
    // far more; 16000 stays under the non-streaming HTTP-timeout threshold.
    maxTokens: 16000,
    jsonMode: true
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'AI service unavailable: ' + msg }, 503)
  }

  let ingredients: IngredientLine[]
  try {
    const parsed = JSON.parse(extractJsonObject(result.content)) as { ingredients: IngredientLine[] }
    if (!Array.isArray(parsed.ingredients)) throw new Error('missing ingredients array')
    // Always assign fresh UUIDs to prevent AI-generated collisions
    ingredients = parsed.ingredients.map(i => ({ ...i, id: crypto.randomUUID() }))
  } catch (e) {
    // Diagnostics so a recurrence is debuggable from the worker log: truncation
    // shows stopReason 'max_tokens'; malformed output shows in the previews.
    console.error('[scale] parse failed', {
      reason: e instanceof Error ? e.message : String(e),
      stopReason: result.stopReason,
      len: result.content?.length,
      head: result.content?.slice(0, 200),
      tail: result.content?.slice(-200),
    })
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

    const { error: poolError } = await supabase.from('ingredient_pool').insert(rows)
    if (poolError) return c.json({ error: 'Failed to save ingredients: ' + poolError.message }, 500)
  }

  return c.json({ ingredients, modelUsed: result.model })
})

export default scale
