import { Hono } from 'hono'
import type { HonoEnv, ClarificationRequest, IngredientLine } from '../types/index.js'
import type { ShoppableItemSpec } from '../types/spec.js'
import { getSupabase } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { getProvider } from '../providers/index.js'
import { SpecCache } from '../lib/specCache.js'
import { resolveItem, preSearchCandidates, needsPreSearch } from '../lib/resolver.js'
import type { ResolutionTraceEntry, StoreCandidate } from '../lib/resolver.js'
import { KrogerClient } from '../integrations/kroger.js'
import { WalmartClient } from '../integrations/walmart.js'
import type { StoreAdapter } from '../integrations/StoreAdapter.js'

const clarify = new Hono<HonoEnv>()

// ─── Request body types ───────────────────────────────────────────────────────

interface ClarifyBody {
  ingredients: IngredientLine[]
  /**
   * Map of ingredientId → chosen answer from the previous clarification round.
   * The route rebuilds a priorTrace for each item from this map.
   */
  resolvedClarifications?: Record<string, string>
  /**
   * Full Q/A history per item, keyed by ingredientId.
   * Shape: { [ingredientId]: ResolutionTraceEntry[] }
   * Clients that implement the stateless multi-turn loop populate this on
   * subsequent calls so the route can pass a full priorTrace to resolveItem.
   */
  resolutionTraces?: Record<string, ResolutionTraceEntry[]>
}

// ─── Trace builder ────────────────────────────────────────────────────────────

/**
 * Build a ResolutionTraceEntry[] for an ingredient from the accumulated
 * state the client sends back.
 *
 * Priority:
 *   1. If `resolutionTraces[id]` is present, use it verbatim (full history).
 *   2. If `resolvedClarifications[id]` is present (single-answer legacy shape),
 *      wrap it in a one-entry trace. The question text is reconstructed as a
 *      placeholder — this path is fine for backward compat but the full
 *      resolutionTraces field is preferred for multi-turn.
 */
function buildPriorTrace(
  ingredient: IngredientLine,
  body: ClarifyBody
): ResolutionTraceEntry[] {
  const traces = body.resolutionTraces?.[ingredient.id]
  if (traces && traces.length > 0) return traces

  const clarified = body.resolvedClarifications?.[ingredient.id]
  if (clarified) {
    return [
      {
        question: `Clarification for ${ingredient.name}`,
        // Legacy compat: we don't know what options were originally offered — just the answer.
        // Leave options empty; the answer is the truthful signal. M7+ will use resolutionTraces
        // for full multi-turn history.
        options: [],
        answer: clarified,
        turnNumber: 1,
      },
    ]
  }

  return []
}

// ─── Route handler ────────────────────────────────────────────────────────────

// POST /api/clarify
// Input:  { ingredients, resolvedClarifications?, resolutionTraces? }
// Output: { clarifications: ClarificationRequest[], specs: Record<string, ShoppableItemSpec> }
//
// Backward-compatible: existing callers that only read `clarifications` continue
// to work. New callers (M7+) can also consume `specs` for directly-resolved items.
clarify.post('/', requireAuth, rateLimit, async (c) => {
  const userId = c.get('userId')
  const supabase = getSupabase(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY)

  const { data: user } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()

  const provider = getProvider(c, user ?? undefined)

  // TODO: derive modelId from provider once multi-model support expands (Opus tier, etc.)
  // For now AnthropicProvider always uses claude-haiku-4-5 — hardcode to match.
  const specCache = new SpecCache({
    ns: c.env.SPEC_CACHE,
    modelId: 'claude-haiku-4-5',
  })

  const body = await c.req.json<ClarifyBody>()

  // ── Build store adapters for retrieval grounding ──────────────────────────
  // KrogerClient and WalmartClient already implement StoreAdapter (M4) — pass
  // them directly to preSearchCandidates. No bridge wrappers needed.

  const storeAdapters: StoreAdapter[] = []

  if (c.env.KROGER_CLIENT_ID && c.env.KROGER_CLIENT_SECRET) {
    // KrogerClient implements StoreAdapter (M4). We don't have a user location
    // here — pass an empty locationIds array via the search call; Kroger adapter
    // gracefully returns null when locationIds is empty.
    // For a real location-aware pre-search, callers can pass a location in the
    // body (future milestone).
    storeAdapters.push(new KrogerClient(
      c.env.KROGER_CLIENT_ID,
      c.env.KROGER_CLIENT_SECRET,
      undefined,
      c.env.URL_CACHE
    ))
  }

  if (
    c.env.WALMART_CONSUMER_ID &&
    c.env.WALMART_KEY_VERSION &&
    c.env.WALMART_PRIVATE_KEY &&
    c.env.WALMART_PUBLISHER_ID
  ) {
    storeAdapters.push(
      new WalmartClient(
        c.env.WALMART_CONSUMER_ID,
        c.env.WALMART_KEY_VERSION,
        c.env.WALMART_PRIVATE_KEY,
        c.env.WALMART_PUBLISHER_ID,
        c.env.WALMART_BASE_URL
      )
    )
  }

  // ── Process each ingredient ───────────────────────────────────────────────

  const clarifications: ClarificationRequest[] = []
  const specs: Record<string, ShoppableItemSpec> = {}

  await Promise.allSettled(
    body.ingredients.map(async (ingredient) => {
      const priorTrace = buildPriorTrace(ingredient, body)

      // Pre-search gate: per DESIGN.md §I-2, fire only when confidence==='low'
      // OR unit is missing (naive parse falls back to 'each'). This is more
      // accurate than gating on first-turn only — an unambiguous item like
      // "1 gal whole milk" skips pre-search even on turn 0, while a newly-ambiguous
      // mid-loop item can still trigger pre-search if needed.
      let retrievalCandidates: StoreCandidate[] | undefined
      if (needsPreSearch(ingredient.clarifiedName ?? ingredient.name) && storeAdapters.length > 0) {
        try {
          const candidates = await preSearchCandidates(
            ingredient.name,
            storeAdapters,
            800  // per-adapter timeout ms
          )
          if (candidates.length > 0) retrievalCandidates = candidates
        } catch {
          // Pre-search failure is non-fatal — proceed without candidates
        }
      }

      let result
      try {
        result = await resolveItem(
          {
            id: ingredient.id,
            rawText: ingredient.clarifiedName ?? ingredient.name,
            priorTrace,
            retrievalCandidates,
          },
          { provider, specCache }
        )
      } catch (e) {
        console.error('[clarify] resolveItem threw for ingredient', ingredient.id, e)
        return
      }

      if (result.kind === 'ask_clarification') {
        clarifications.push({
          itemId: result.request.itemId,
          originalName: ingredient.name,
          question: result.request.question,
          options: result.request.options,
        })
      } else {
        // 'finalized' or 'cached'
        specs[ingredient.id] = result.spec
      }
    })
  )

  // Return shape is a superset of the original: `clarifications` (unchanged) +
  // `specs` (new in M6). Existing frontend code that only reads `clarifications`
  // continues to work without modification.
  return c.json({ clarifications, specs })
})

export default clarify
