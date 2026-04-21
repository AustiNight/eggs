/**
 * StoreAdapter — shared interface for all store product-search integrations.
 *
 * Each adapter (Kroger, Walmart, …) implements `StoreAdapter` and maps
 * the store's native API response shape to `StoreSearchResult`.
 *
 * Types only — no implementation in this file.
 */

import type { CanonicalUnit } from '../types/index.js'

export interface StoreSearchInput {
  /** Ingredient name (free-text, may include unit/packaging noise). */
  name: string
  /** Optional brand lock — if present, only brand-matching results are returned. */
  brand?: string
  /** Optional unit preference — results whose size parses to the same base dimension are preferred. */
  unit?: CanonicalUnit
  /** Kroger: one or more store location IDs to search; results cascade through list. */
  locationIds?: string[]
  /** Walmart: regional pricing hint (best-effort). */
  zipCode?: string
}

export interface StoreSearchResult {
  sku: string
  name: string
  brand: string
  regularPrice: number
  promoPrice: number | null
  productUrl: string
  /** Raw size string as returned by the store API. */
  size: string
  /** Kroger only: the location ID where this product was actually found. */
  matchedLocationId?: string
}

export interface StoreAdapter {
  search(input: StoreSearchInput): Promise<StoreSearchResult | null>
}
