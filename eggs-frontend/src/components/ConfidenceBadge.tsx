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

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const { label, color } = SOURCE_LABELS[confidence] ?? SOURCE_LABELS.estimated
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}30` }}
    >
      {label}
    </span>
  )
}
