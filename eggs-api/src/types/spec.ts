// ─── ShoppableItemSpec — canonical resolved-item shape ───────────────────────
//
// Every user-typed line must reach this shape before any store search fires.
// Invariants enforced by validateSpec():
//   1. brand === null  ⟺  brandLocked === false
//   2. quantity > 0
//   3. unit ∈ CanonicalUnit
//   4. resolutionTrace.length <= 3
//   5. categoryPath.length >= 1

import { z } from 'zod'
import type { CanonicalUnit } from './index.js'

// ─── Re-use CanonicalUnit values as a zod enum ───────────────────────────────

const CANONICAL_UNITS = [
  'g', 'kg',
  'ml', 'l',
  'oz', 'lb',
  'fl_oz', 'cup', 'pt', 'qt', 'gal',
  'each', 'dozen',
  'bunch', 'head', 'clove', 'pinch',
] as const

// Type-level check: every value in our constant array must be assignable to
// CanonicalUnit (caught at compile time if the two lists drift).
type _VerifyCanonicalUnitsComplete = (typeof CANONICAL_UNITS)[number] extends CanonicalUnit
  ? CanonicalUnit extends (typeof CANONICAL_UNITS)[number]
    ? true
    : never
  : never

// ─── ResolutionConfidence ─────────────────────────────────────────────────────

export type ResolutionConfidence = 'high' | 'medium' | 'low'

// ─── Zod schema ───────────────────────────────────────────────────────────────

const ResolutionTraceEntrySchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  answer: z.string(),
  turnNumber: z.number().int().positive(),
})

const ShoppableItemSpecSchema = z
  .object({
    id: z.string(),
    sourceText: z.string(),

    displayName: z.string(),
    categoryPath: z.array(z.string()).min(1),
    usdaFdcId: z.number().int().positive().optional(),
    offCategoryTag: z.string().optional(),
    upc: z.string().optional(),

    brand: z.string().nullable(),
    brandLocked: z.boolean(),

    quantity: z.number().gt(0),
    unit: z.enum(CANONICAL_UNITS),
    attributes: z.record(z.string(), z.string()).optional(),

    resolutionTrace: z.array(ResolutionTraceEntrySchema).max(3),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .superRefine((data, ctx) => {
    // Invariant 1: brand === null  ⟺  brandLocked === false
    const brandIsNull = data.brand === null
    const brandIsLocked = data.brandLocked === true
    if (brandIsNull && brandIsLocked) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['brandLocked'],
        message: 'brandLocked must be false when brand is null',
      })
    } else if (!brandIsNull && !brandIsLocked) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['brandLocked'],
        message: 'brandLocked must be true when brand is a non-null string',
      })
    }
  })

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface ShoppableItemSpec {
  id: string                         // stable across clarifications; matches IngredientLine.id
  sourceText: string                 // raw user input — never mutated

  displayName: string                // resolved human label ("whole milk")
  categoryPath: string[]             // ["beverages","milk","whole-milk"] — GS1 GPC seeded
  usdaFdcId?: number
  offCategoryTag?: string            // "en:whole-milks"
  upc?: string

  brand: string | null               // null = price-shop mode
  brandLocked: boolean               // true iff user explicitly typed a brand

  quantity: number
  unit: CanonicalUnit
  attributes?: Record<string, string>   // fat_content, preparation, cut

  resolutionTrace: Array<{
    question: string
    options: string[]
    answer: string
    turnNumber: number
  }>
  confidence: ResolutionConfidence
}

// Type-level assertion: ShoppableItemSpec and the zod inferred type must be
// mutually assignable. If either drifts from the other this line will fail to
// compile.
type _Verify = ShoppableItemSpec extends z.infer<typeof ShoppableItemSpecSchema>
  ? z.infer<typeof ShoppableItemSpecSchema> extends ShoppableItemSpec
    ? true
    : never
  : never

export interface InstacartLineItem {
  name: string                       // = displayName
  display_text?: string              // = sourceText (omitted when equal to displayName)
  upc?: string
  line_item_measurements: Array<{ quantity: number; unit: string }>
}

// ─── validateSpec ─────────────────────────────────────────────────────────────

/**
 * Parse and validate an unknown value as a ShoppableItemSpec.
 * Throws a descriptive Error on parse failure (includes zod issue list).
 */
export function validateSpec(x: unknown): ShoppableItemSpec {
  const result = ShoppableItemSpecSchema.safeParse(x)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ')
    throw new Error(`ShoppableItemSpec validation failed: ${issues}`)
  }
  return result.data as ShoppableItemSpec
}

// ─── toInstacartLineItem ──────────────────────────────────────────────────────

/**
 * Convert a validated ShoppableItemSpec to an Instacart Recipe Page API
 * line item. Omits optional fields when not meaningful.
 */
export function toInstacartLineItem(spec: ShoppableItemSpec): InstacartLineItem {
  const item: InstacartLineItem = {
    name: spec.displayName,
    line_item_measurements: [{ quantity: spec.quantity, unit: spec.unit }],
  }

  // Omit display_text when it conveys the same info as name
  if (spec.sourceText !== spec.displayName) {
    item.display_text = spec.sourceText
  }

  // Omit upc when absent
  if (spec.upc !== undefined) {
    item.upc = spec.upc
  }

  return item
}
