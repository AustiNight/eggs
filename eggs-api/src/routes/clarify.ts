import { Hono } from 'hono'
import type { HonoEnv, ClarificationRequest, IngredientLine } from '../types/index.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { getProvider } from '../providers/index.js'

const clarify = new Hono<HonoEnv>()

// POST /api/clarify
// Input: { ingredients: IngredientLine[] }
clarify.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: user } = await supabase.from('users').select('subscription_tier').eq('id', userId).single()
  const provider = getProvider(c, user ?? undefined)

  const body = await c.req.json<{ ingredients: IngredientLine[] }>()

  const itemsContext = body.ingredients
    .map(i => `ID: "${i.id}" | ${i.quantity} ${i.unit} ${i.name}`)
    .join('\n')

  const result = await provider.complete({
    system: `You are a grocery procurement assistant for professional event chefs.
Your job is to identify ingredients that are vague enough to affect which specific product to buy and at what price.
Return ONLY valid JSON: an array of ClarificationRequest objects, or an empty array if nothing is ambiguous.

Schema per clarification:
{ "itemId": "<id from input>", "originalName": "<name>", "question": "<question>", "options": ["<opt1>", "..."] }

Rules:
- Ask about spec when it genuinely changes which SKU to look for (size, fat%, variety, etc.)
- Provide 2-5 short, realistic options
- If the spec is already precise enough for purchasing, skip it
- Return [] if everything is clear`,
    messages: [
      {
        role: 'user',
        content: `Review these ingredients for a catering event and flag any that need clarification before I search for prices:\n\n${itemsContext}`
      }
    ],
    maxTokens: 2048,
    jsonMode: true
  })

  let clarifications: ClarificationRequest[] | null = null
  try {
    const parsed = JSON.parse(result.content)
    clarifications = Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    clarifications = null
  }

  return c.json({ clarifications })
})

export default clarify
