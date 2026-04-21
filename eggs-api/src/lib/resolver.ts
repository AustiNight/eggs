// ─── resolver — disambiguation loop v2 ───────────────────────────────────────
//
// Runs ONE turn of the two-tool (ask_clarification / finalize_item) disambiguation
// loop for a single ingredient.  The route handler drives multiple items and
// multiple turns by re-calling this function with an accumulated `priorTrace`.
//
// Decision flow:
//   1. specCache.lookup(rawText)            → cache hit? return early.
//   2. If priorTrace.length >= 3             → force finalize_item (turn cap).
//   3. Build system prompt (+ retrieval candidates block if provided).
//   4. Call provider with both tools + tool_choice:'any'
//      (or forced 'finalize_item' when turn cap hit).
//   5. On finalize_item  → validateSpec → write to cache → return finalized.
//      On ask_clarification → return clarification request (no cache write).
//   6. Wall-clock timeout              → naive-parse fallback with confidence:'low'.

import type { ShoppableItemSpec } from '../types/spec.js'
import { validateSpec, CANONICAL_UNITS } from '../types/spec.js'
import type { ModelProvider } from '../providers/index.js'
import { SpecCache } from './specCache.js'
import { stripUnitNoise } from './queryStrip.js'
import type { StoreAdapter } from '../integrations/StoreAdapter.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ResolutionTraceEntry {
  question: string
  options: string[]
  answer: string
  turnNumber: number
}

export interface StoreCandidate {
  brand: string
  name: string
  size: string
}

export interface ResolveItemInput {
  /** Stable ID from IngredientLine — echoed back in the ask_clarification request. */
  id: string
  /** Raw user-typed text: "2 lbs chicken" or "whole milk" etc. */
  rawText: string
  /** Accumulated Q/A from prior server calls for this item. */
  priorTrace?: ResolutionTraceEntry[]
  /** Pre-searched product candidates — injected into the LLM prompt for retrieval grounding. */
  retrievalCandidates?: StoreCandidate[]
}

export type ResolveItemOutput =
  | { kind: 'finalized'; spec: ShoppableItemSpec }
  | { kind: 'ask_clarification'; request: { itemId: string; question: string; options: string[] } }
  | { kind: 'cached'; spec: ShoppableItemSpec }

export interface ResolverDeps {
  provider: ModelProvider
  specCache: SpecCache
  /** Wall-clock budget in ms before falling back to naive parse. Default 20000. */
  wallClockMs?: number
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const askClarificationTool = {
  name: 'ask_clarification',
  description:
    'Ask the user a focused multiple-choice question to disambiguate the item. ' +
    'When retrieval candidates are provided in the prompt, options MUST be drawn from those candidates.',
  input_schema: {
    type: 'object' as const,
    required: ['itemId', 'question', 'options'],
    properties: {
      itemId: { type: 'string' },
      question: { type: 'string' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 5,
      },
    },
  },
}

const finalizeItemTool = {
  name: 'finalize_item',
  description:
    'Emit the finalized ShoppableItemSpec once the item is unambiguous. ' +
    'Use this as soon as you have enough information.',
  input_schema: {
    type: 'object' as const,
    required: [
      'id', 'sourceText', 'displayName', 'categoryPath',
      'brand', 'brandLocked', 'quantity', 'unit', 'confidence',
    ],
    properties: {
      id: { type: 'string' },
      sourceText: { type: 'string' },
      displayName: { type: 'string' },
      categoryPath: { type: 'array', items: { type: 'string' }, minItems: 1 },
      brand: { type: ['string', 'null'] },
      brandLocked: { type: 'boolean' },
      quantity: { type: 'number', exclusiveMinimum: 0 },
      unit: { type: 'string', enum: CANONICAL_UNITS as unknown as string[] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      usdaFdcId: { type: 'number' },
      offCategoryTag: { type: 'string' },
      upc: { type: 'string' },
      attributes: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
}

const BOTH_TOOLS = [askClarificationTool, finalizeItemTool]

// ─── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(retrievalCandidates?: StoreCandidate[]): string {
  const candidatesBlock =
    retrievalCandidates && retrievalCandidates.length > 0
      ? `\n\n## Real product candidates (from live store search)\n` +
        `Options presented to the user MUST be drawn from these when clarifying.\n` +
        retrievalCandidates
          .map((c, i) => `${i + 1}. Brand: ${c.brand || 'N/A'} | Name: ${c.name} | Size: ${c.size}`)
          .join('\n')
      : ''

  return `You are a grocery procurement assistant resolving ingredient descriptions into structured specs for professional event chefs.

Your job: determine the exact product a chef needs by either asking a single focused clarification question OR finalizing the spec immediately when there is enough information.

## Tools
- Use \`ask_clarification\` when the item is genuinely ambiguous (fat%, variety, cut, size, etc.) in a way that materially changes which SKU to buy.
- Use \`finalize_item\` as soon as the spec is unambiguous — even on the first turn.

## Rules
- Provide 2–5 short, realistic options when asking a question.
- If prior Q/A answers have already resolved all ambiguity, call finalize_item immediately.
- You have at most 3 turns total. On the third turn you MUST call finalize_item.
- For brand: null = price-shop mode (no brand preference). Set brandLocked:true only when the user explicitly named a brand.
- resolutionTrace must include the full Q/A history from the priorTrace below (if any).${candidatesBlock}`
}

// ─── Conversation message builder ─────────────────────────────────────────────

function buildMessages(
  rawText: string,
  priorTrace: ResolutionTraceEntry[]
): { role: 'user' | 'assistant'; content: string }[] {
  const msgs: { role: 'user' | 'assistant'; content: string }[] = []

  // First user message — the ingredient to resolve
  msgs.push({
    role: 'user',
    content: `Resolve this ingredient: "${rawText}"`,
  })

  // Replay Q/A history as alternating assistant (question) / user (answer) turns
  for (const entry of priorTrace) {
    msgs.push({
      role: 'assistant',
      content: `Question: ${entry.question}\nOptions: ${entry.options.join(', ')}`,
    })
    msgs.push({
      role: 'user',
      content: `Answer: ${entry.answer}`,
    })
  }

  return msgs
}

// ─── Naive-parse fallback ──────────────────────────────────────────────────────
// Used on timeout / LLM error. Heuristically splits the raw text into a
// best-effort spec with confidence:'low'.

export function naiveParse(rawText: string, id: string, priorTrace?: ResolutionTraceEntry[]): ShoppableItemSpec {
  const trimmed = rawText.trim()
  const tokens = trimmed.split(/\s+/)

  // If first token is a number, treat it as quantity
  const firstNum = parseFloat(tokens[0] ?? '')
  const quantity = !isNaN(firstNum) && firstNum > 0 ? firstNum : 1
  const remainingTokens = !isNaN(parseFloat(tokens[0] ?? '')) ? tokens.slice(1) : tokens

  // Strip unit noise (e.g. "lbs", "oz", "gal") from the display name so
  // "3 lbs ground beef" → displayName "ground beef" not "lbs ground beef".
  const rawDisplayName = remainingTokens.join(' ') || trimmed
  const strippedDisplayName = stripUnitNoise(rawDisplayName)
  const displayName = strippedDisplayName || rawDisplayName

  return {
    id,
    sourceText: rawText,
    displayName: displayName || rawText,
    categoryPath: ['uncategorized'],
    brand: null,
    brandLocked: false,
    quantity,
    unit: 'each',
    // Cap to 3 entries to match validateSpec.max(3) invariant.
    // A caller supplying 4+ entries would silently violate the zod schema otherwise.
    resolutionTrace: (priorTrace ?? []).slice(0, 3),
    confidence: 'low',
  }
}

// ─── needsPreSearch — pre-search gate helper ─────────────────────────────────
//
// Determines whether a pre-search against live store adapters should fire for
// a given raw ingredient text.  Matches DESIGN.md §I-2:
//   "pre-search only when: confidence === 'low' OR unit missing"
//
// `naiveParse` always emits `unit: 'each'` as the fallback.  We treat the
// combination of `quantity === 1 AND unit === 'each'` as the literal fallback
// signature (i.e. "we couldn't parse a real unit from the text").  A plain
// countable item like "1 dozen eggs" will still parse quantity=1 but the
// unit-noise pass won't transform 'each' to 'dozen' — so we conservatively
// trigger pre-search to let the LLM confirm.  The cost of an extra pre-search
// is low; the cost of missing real-unit disambiguation is high.
//
// Returns true  → fire pre-search before calling resolveItem.
// Returns false → skip pre-search (spec is already high-confidence enough).
export function needsPreSearch(rawText: string): boolean {
  const spec = naiveParse(rawText, '_probe')
  // The naive parse falls back to quantity=1 + unit='each' when no quantity/unit
  // was parseable.  That combination is our proxy for "low confidence / unit missing".
  const isFallbackSignature = spec.quantity === 1 && spec.unit === 'each'
  return isFallbackSignature || spec.confidence === 'low'
}

// ─── resolveItem ──────────────────────────────────────────────────────────────

/**
 * Run one turn of the disambiguation loop for a single item.
 *
 * Returns either a finalized spec, a clarification request, or a cached spec.
 * The route handler accumulates clarifications across items and returns them to
 * the frontend. When the user answers, the client re-calls /api/clarify with
 * resolvedClarifications populated; the route builds a priorTrace for each item
 * and calls resolveItem again.
 */
export async function resolveItem(
  input: ResolveItemInput,
  deps: ResolverDeps
): Promise<ResolveItemOutput> {
  const { id, rawText, priorTrace = [], retrievalCandidates } = input
  const { provider, specCache, wallClockMs = 20_000 } = deps

  // ── 1. Cache lookup ────────────────────────────────────────────────────────
  const cached = await specCache.lookup(rawText)
  if (cached !== null) {
    return { kind: 'cached', spec: cached }
  }

  // ── 2. Turn cap check ──────────────────────────────────────────────────────
  // Count how many LLM turns have already been used (= prior Q/A entries).
  // If we're at or beyond 3, force finalize.
  const turnsUsed = priorTrace.length
  const forcedFinalize = turnsUsed >= 3

  // ── 3. Build LLM call ──────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(retrievalCandidates)
  const messages = buildMessages(rawText, priorTrace)

  const toolChoice = forcedFinalize
    ? { type: 'tool' as const, name: 'finalize_item' }
    : { type: 'any' as const }

  // ── 4. Call provider with wall-clock timeout ───────────────────────────────
  let result
  try {
    const llmCall = provider.complete({
      system: systemPrompt,
      messages,
      maxTokens: 1024,
      tools: BOTH_TOOLS,
      toolChoice,
    })

    let timerId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = globalThis.setTimeout(
        () => reject(new Error(`resolveItem timeout after ${wallClockMs}ms`)),
        wallClockMs
      )
    })

    try {
      result = await Promise.race([llmCall, timeoutPromise])
    } finally {
      // Clear the dangling timer so it doesn't fire after the LLM call succeeds,
      // burning Worker CPU on a rejection that nobody is listening to anymore.
      if (timerId !== undefined) globalThis.clearTimeout(timerId)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[resolver] provider error or timeout for "${rawText}": ${msg}`)
    return { kind: 'finalized', spec: naiveParse(rawText, id, priorTrace) }
  }

  // ── 5. Parse tool call ─────────────────────────────────────────────────────
  const toolCalls = result.toolCalls ?? []
  const finalizeCall = toolCalls.find((tc) => tc.name === 'finalize_item')
  const askCall = toolCalls.find((tc) => tc.name === 'ask_clarification')

  // ── 5a. finalize_item ──────────────────────────────────────────────────────
  if (finalizeCall) {
    const raw = finalizeCall.input as Record<string, unknown>

    // Merge the priorTrace into the spec before validation
    const specInput = {
      ...raw,
      id,
      sourceText: rawText,
      resolutionTrace: priorTrace,
    }

    let spec: ShoppableItemSpec
    try {
      spec = validateSpec(specInput)
    } catch (err) {
      // validateSpec failed — fall back to naive parse rather than crash
      console.warn(`[resolver] validateSpec failed for "${rawText}": ${err instanceof Error ? err.message : err}`)
      return { kind: 'finalized', spec: naiveParse(rawText, id, priorTrace) }
    }

    // Write to cache so future calls skip LLM
    await specCache.write(rawText, spec)
    return { kind: 'finalized', spec }
  }

  // ── 5b. ask_clarification ──────────────────────────────────────────────────
  if (askCall) {
    const raw = askCall.input as { itemId?: string; question?: string; options?: string[] }
    return {
      kind: 'ask_clarification',
      request: {
        itemId: raw.itemId ?? id,
        question: raw.question ?? 'Could you clarify this item?',
        options: Array.isArray(raw.options) ? raw.options : [],
      },
    }
  }

  // ── 5c. Fallback: no recognized tool call ──────────────────────────────────
  console.warn(`[resolver] no tool call in LLM response for "${rawText}" — naive fallback`)
  return { kind: 'finalized', spec: naiveParse(rawText, id, priorTrace) }
}

// ─── preSearchCandidates — retrieval grounding helper ─────────────────────────
//
// Queries Kroger and/or Walmart in parallel for product candidates to ground
// the LLM's clarification options. Accepts StoreAdapter instances (M4 interface)
// for testability. Uses the standard StoreAdapter.search() signature and
// projects brand/name/size into StoreCandidate for injection into the LLM prompt.
//
// Deduplication: candidates with the same (brand, name) pair are collapsed to one.
// Returns up to `maxResults` candidates (default 10).

// Re-export StoreAdapter so callers can import it from here or from StoreAdapter.ts.
export type { StoreAdapter }

export async function preSearchCandidates(
  rawText: string,
  adapters: StoreAdapter[],
  timeoutMs: number = 800,
  maxResults: number = 10
): Promise<StoreCandidate[]> {
  if (adapters.length === 0) return []

  const settled = await Promise.allSettled(
    adapters.map((adapter) => {
      const adapterCall = adapter.search({ name: rawText })
      let timerId: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<null>((resolve) => {
        timerId = globalThis.setTimeout(() => resolve(null), timeoutMs)
      })
      return Promise.race([adapterCall, timeout]).finally(() => {
        if (timerId !== undefined) globalThis.clearTimeout(timerId)
      })
    })
  )

  const seen = new Set<string>()
  const candidates: StoreCandidate[] = []

  for (const outcome of settled) {
    if (outcome.status === 'rejected') continue
    const r = outcome.value
    if (!r) continue
    const dedupeKey = `${r.brand}|${r.name}`
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      // Project StoreSearchResult → StoreCandidate (prompt-injection shape)
      candidates.push({ brand: r.brand, name: r.name, size: r.size })
    }
    // Cap at 10 candidates. With current M4 adapters each returning a single
    // best-priced result, this cap is effectively unused — future-proofed for
    // when adapters return ranked result lists.
    if (candidates.length >= maxResults) break
  }

  return candidates
}
