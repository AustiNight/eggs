/**
 * ConfidenceBadge — shared badge for StoreItem price-confidence levels.
 *
 * Used by both LegacyPlanView and PerStorePanels. Extracted in M9 review
 * (Fix 5) to eliminate the duplicate definitions that existed in both files.
 */
import React from 'react'

export const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  real:                   { label: 'Live',      color: '#34d399' },
  estimated_with_source:  { label: 'Sourced',   color: '#fbbf24' },
  estimated:              { label: 'Est.',       color: '#94a3b8' },
}

/**
 * WS1 honesty labels — keyed by StoreItem.provenance. When provenance is present
 * and known it wins over confidence; legacy plans without provenance fall back to
 * SOURCE_LABELS.
 */
export const PROVENANCE_LABELS: Record<string, { label: string; color: string }> = {
  api:                   { label: 'Verified',     color: '#34d399' },
  store_page_verified:   { label: 'Verified',     color: '#34d399' },
  // "Online price" is reserved for rows that link to a real product listing
  // (page fetched + exact price confirmed on it), just not store-scoped.
  page_verified_unbound: { label: 'Online price', color: '#fbbf24' },
  // shopping_index has a price from an online listing index but NO openable
  // product page — estimate-tier (gray), but distinct from a pure model guess.
  shopping_index:        { label: 'Online est.',  color: '#94a3b8' },
  model_estimate:        { label: 'Est.',         color: '#94a3b8' },
}

export function ConfidenceBadge({ confidence, provenance }: { confidence: string; provenance?: string }) {
  const { label, color } =
    (provenance && PROVENANCE_LABELS[provenance]) ?? SOURCE_LABELS[confidence] ?? SOURCE_LABELS.estimated
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}30` }}
    >
      {label}
    </span>
  )
}
