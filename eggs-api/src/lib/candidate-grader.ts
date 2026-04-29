/**
 * LLM Candidate Grader — P2.7
 *
 * Grades each store candidate against a ShoppableItemSpec by calling the LLM
 * ONCE per ingredient (bulk-batch), returning an AlignmentGrade per candidate SKU.
 *
 * Grades:
 *   'exact'      — same product class + key attributes (90-100)
 *   'substitute' — same class, one attribute differs  (50-89)
 *   'wrong'      — different class or contradictory descriptor (0-49)
 *
 * Caching: key `grade:{spec.id}:{sku}` in URL_CACHE, TTL 24h.
 * On LLM timeout (10s): all uncached candidates get score=50/substitute/grading-timeout.
 * On parse failure: all uncached candidates get score=50/substitute/fallback.
 */

import type { AlignmentGrade } from '../types/index.js'
import type { ModelProvider } from '../providers/index.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GradeRequest {
  spec: {
    id: string
    displayName: string
    brand: string | null
    brandLocked: boolean
    quantity: number
    unit: string
    category?: string
  }
  candidates: Array<{
    sku: string
    storeName: string
    name: string        // product description
    brand: string
    size: string        // raw size string from store
    unitPrice: number
  }>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 86_400   // 24 hours
const LLM_TIMEOUT_MS   = 10_000   // 10 seconds

const FALLBACK_GRADE: AlignmentGrade = {
  score: 50,
  category: 'substitute',
  reason: 'fallback',
}

const TIMEOUT_GRADE: AlignmentGrade = {
  score: 50,
  category: 'substitute',
  reason: 'grading-timeout',
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(specId: string, sku: string): string {
  return `grade:${specId}:${sku}`
}

async function readCached(
  cache: KVNamespace,
  specId: string,
  sku: string,
): Promise<AlignmentGrade | null> {
  try {
    const raw = await cache.get(cacheKey(specId, sku))
    if (!raw) return null
    return JSON.parse(raw) as AlignmentGrade
  } catch {
    return null
  }
}

async function writeCache(
  cache: KVNamespace,
  specId: string,
  sku: string,
  grade: AlignmentGrade,
): Promise<void> {
  try {
    await cache.put(cacheKey(specId, sku), JSON.stringify(grade), {
      expirationTtl: CACHE_TTL_SECONDS,
    })
  } catch {
    // Non-fatal — cache write failure just means a cache miss next time.
  }
}

// ─── LLM prompt helpers ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a strict grocery product matcher. Decide whether each candidate product matches the user's request. Use these rules:

- 'exact' — same product class, same key attributes (brand if specified, size class if specified, key descriptors like 'organic', 'whole', 'seedless'). Score 90-100.
- 'substitute' — same product class, ONE relevant attribute differs (brand swap, slightly different size, equivalent product). Score 50-89.
- 'wrong' — different product class entirely (kiwi vs yogurt), or contradictory key descriptor (seedless requested vs seeded returned, organic requested vs conventional). Score 0-49.

For brand-locked specs (brandLocked: true), brand mismatch is automatically 'wrong'.

Provide a one-sentence reason for substitutes and wrongs (e.g., 'Same brand and class, slightly larger package — equivalent.', 'Yogurt product, not the requested kiwi fruit.').

Respond with a JSON object keyed by sku. Example:
{
  "sku-1": { "score": 95, "category": "exact", "reason": "Same product class and brand." },
  "sku-2": { "score": 60, "category": "substitute", "reason": "Same brand, slightly larger package." },
  "sku-3": { "score": 5, "category": "wrong", "reason": "Yogurt product, not the requested kiwi fruit." }
}`

function buildUserPrompt(req: GradeRequest): string {
  const specBlock = JSON.stringify({
    displayName: req.spec.displayName,
    brand: req.spec.brand,
    brandLocked: req.spec.brandLocked,
    quantity: req.spec.quantity,
    unit: req.spec.unit,
    category: req.spec.category ?? null,
  }, null, 2)

  const candidatesBlock = JSON.stringify(
    req.candidates.map(c => ({
      sku: c.sku,
      storeName: c.storeName,
      name: c.name,
      brand: c.brand,
      size: c.size,
      unitPrice: c.unitPrice,
    })),
    null,
    2,
  )

  return `Grade these grocery candidates against the requested item.

Requested item:
${specBlock}

Candidates:
${candidatesBlock}

Return a JSON object keyed by sku with fields: score (number 0-100), category ('exact'|'substitute'|'wrong'), reason (string).`
}

// ─── Response parser ──────────────────────────────────────────────────────────

function isValidGrade(obj: unknown): obj is AlignmentGrade {
  if (typeof obj !== 'object' || obj === null) return false
  const g = obj as Record<string, unknown>
  return (
    typeof g.score === 'number' &&
    g.score >= 0 && g.score <= 100 &&
    (g.category === 'exact' || g.category === 'substitute' || g.category === 'wrong') &&
    typeof g.reason === 'string'
  )
}

function parseGrades(
  raw: string,
  skus: string[],
): Map<string, AlignmentGrade> {
  const result = new Map<string, AlignmentGrade>()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Parse failure — assign fallback to all
    for (const sku of skus) result.set(sku, { ...FALLBACK_GRADE, reason: 'parse-error' })
    return result
  }

  if (typeof parsed !== 'object' || parsed === null) {
    for (const sku of skus) result.set(sku, { ...FALLBACK_GRADE, reason: 'parse-error' })
    return result
  }

  const obj = parsed as Record<string, unknown>
  for (const sku of skus) {
    const entry = obj[sku]
    if (isValidGrade(entry)) {
      result.set(sku, entry)
    } else {
      result.set(sku, { ...FALLBACK_GRADE, reason: 'missing-in-response' })
    }
  }

  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Grade all candidates for one ingredient spec in a single LLM call.
 *
 * @param req        Spec + candidate list to grade
 * @param provider   Anthropic provider (from getProvider)
 * @param cache      URL_CACHE KV namespace for per-grade caching
 * @returns          Map from candidate.sku → AlignmentGrade
 */
export async function gradeCandidates(
  req: GradeRequest,
  provider: ModelProvider,
  cache: KVNamespace,
): Promise<Map<string, AlignmentGrade>> {
  const result = new Map<string, AlignmentGrade>()

  if (req.candidates.length === 0) return result

  // ── Step 1: Check cache per candidate ───────────────────────────────────────
  const uncached: typeof req.candidates = []
  for (const candidate of req.candidates) {
    const cached = await readCached(cache, req.spec.id, candidate.sku)
    if (cached) {
      result.set(candidate.sku, cached)
    } else {
      uncached.push(candidate)
    }
  }

  if (uncached.length === 0) return result

  // ── Step 2: Single LLM call for uncached candidates ─────────────────────────
  const uncachedReq: GradeRequest = { spec: req.spec, candidates: uncached }
  const uncachedSkus = uncached.map(c => c.sku)

  let graded: Map<string, AlignmentGrade>
  try {
    const llmPromise = provider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(uncachedReq) }],
      maxTokens: 1024,
      jsonMode: true,
    })

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('grader-timeout')), LLM_TIMEOUT_MS),
    )

    const response = await Promise.race([llmPromise, timeoutPromise])
    graded = parseGrades(response.content, uncachedSkus)
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'grader-timeout'
    const fallback = isTimeout ? TIMEOUT_GRADE : FALLBACK_GRADE
    graded = new Map(uncachedSkus.map(sku => [sku, { ...fallback }]))
  }

  // ── Step 3: Store in cache and merge into result ─────────────────────────────
  const cacheWrites: Promise<void>[] = []
  for (const [sku, grade] of graded) {
    result.set(sku, grade)
    cacheWrites.push(writeCache(cache, req.spec.id, sku, grade))
  }
  // Fire-and-forget: don't block return on cache writes
  Promise.all(cacheWrites).catch(() => { /* non-fatal */ })

  return result
}
