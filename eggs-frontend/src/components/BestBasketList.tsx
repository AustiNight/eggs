/**
 * BestBasketList — one row per plan.winners[] entry.
 *
 * Each row shows the current winning store + product + price.
 * A swap icon opens ItemSwapSelector inline below the row.
 *
 * State management lives in PlanResult.tsx (via winnerOverrides prop).
 * This component is purely presentational: it receives resolved winners
 * and fires callbacks when the user swaps.
 */
import React, { useState } from 'react'
import { ArrowLeftRight, ExternalLink, AlertTriangle } from 'lucide-react'
import type { WinnerResult, Candidate } from '../types'
import ItemSwapSelector from './ItemSwapSelector'

interface BestBasketListProps {
  winners: WinnerResult[]
  /** Overrides map from PlanResult state — keyed by spec.id */
  winnerOverrides: Record<string, Candidate | null>
  onSwap: (specId: string, candidate: Candidate) => void
}

/** Warning tooltip text per DESIGN.md */
function warningTooltip(warning: WinnerResult['warning'], brand: string | null): string {
  if (warning === 'avoid_brand_lock_conflict') {
    return `You've set ${brand ?? 'this brand'} on your avoid list. Respecting your explicit brand choice.`
  }
  if (warning === 'all_avoided_fallback') {
    return 'All candidates for this item were on your avoid list. Showing the cheapest available.'
  }
  return ''
}

function AvoidBrandIcon({ warning, brand }: { warning: WinnerResult['warning']; brand: string | null }) {
  if (!warning) return null
  const tip = warningTooltip(warning, brand)
  return (
    <span
      title={tip}
      aria-label={tip}
      className="inline-flex items-center ml-1.5 cursor-help"
    >
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
    </span>
  )
}

interface WinnerRowProps {
  winnerResult: WinnerResult
  displayedWinner: Candidate | null
  isSwapOpen: boolean
  onToggleSwap: () => void
  onSwap: (c: Candidate) => void
  onCloseSwap: () => void
}

function WinnerRow({
  winnerResult,
  displayedWinner,
  isSwapOpen,
  onToggleSwap,
  onSwap,
  onCloseSwap
}: WinnerRowProps) {
  const { spec, eligibleCandidates, warning } = winnerResult
  const w = displayedWinner

  return (
    <div className="border border-slate-700 rounded-xl overflow-visible">
      {/* Main row */}
      <div className={[
        'flex items-center gap-3 px-4 py-3',
        isSwapOpen ? 'bg-slate-800' : 'bg-slate-800/70 hover:bg-slate-800 transition-colors'
      ].join(' ')}>

        {/* Item name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="font-medium text-white text-sm">{spec.displayName}</span>
            {warning && <AvoidBrandIcon warning={warning} brand={spec.brand} />}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {spec.quantity} {spec.unit}
            {spec.brand && (
              <span className="ml-1.5 text-slate-600">· {spec.brand}</span>
            )}
          </div>
        </div>

        {w ? (
          <>
            {/* Store */}
            <div className="text-right hidden sm:block min-w-[90px]">
              <div className="text-xs font-medium text-slate-300">{w.storeName}</div>
              {w.distanceMiles !== undefined && (
                <div className="text-xs text-slate-600">{w.distanceMiles.toFixed(1)} mi</div>
              )}
            </div>

            {/* Product name */}
            <div className="text-right hidden md:block min-w-[120px] max-w-[180px]">
              <div className="text-xs text-slate-400 truncate">{w.item.name}</div>
              {w.item.isLoyaltyPrice && (
                <span className="text-[10px] text-amber-500">Member price</span>
              )}
            </div>

            {/* Price */}
            <div className="text-right min-w-[72px]">
              <div className="font-bold text-amber-400 font-mono text-sm">${w.item.lineTotal.toFixed(2)}</div>
              <div className="text-xs text-slate-500">${w.item.unitPrice.toFixed(2)} ea</div>
            </div>

            {/* Shop link */}
            <div className="shrink-0 w-6">
              {(() => {
                const href = w.item.shopUrl ?? w.item.productUrl
                return href
                  ? <a href={href} target="_blank" rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex"
                      title="View product">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  : null
              })()}
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-500 italic">No match found</div>
        )}

        {/* Swap toggle */}
        <button
          onClick={onToggleSwap}
          title={eligibleCandidates.length > 0 ? `${eligibleCandidates.length} alternatives` : 'No alternatives'}
          className={[
            'shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors',
            eligibleCandidates.length > 0
              ? isSwapOpen
                ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600'
              : 'opacity-30 cursor-default bg-slate-800 text-slate-600 border border-slate-700'
          ].join(' ')}
          disabled={eligibleCandidates.length === 0}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Swap</span>
        </button>
      </div>

      {/* Inline swap selector */}
      {isSwapOpen && (
        <div className="px-4 pb-4 bg-slate-800 border-t border-slate-700">
          <ItemSwapSelector
            candidates={eligibleCandidates}
            currentWinner={displayedWinner}
            onSelect={onSwap}
            onClose={onCloseSwap}
          />
        </div>
      )}
    </div>
  )
}

const BestBasketList: React.FC<BestBasketListProps> = ({ winners, winnerOverrides, onSwap }) => {
  const [openSwapId, setOpenSwapId] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {winners.map(wr => {
        const specId = wr.spec.id
        const displayedWinner = specId in winnerOverrides
          ? winnerOverrides[specId]
          : wr.winner
        const isSwapOpen = openSwapId === specId

        return (
          <WinnerRow
            key={specId}
            winnerResult={wr}
            displayedWinner={displayedWinner}
            isSwapOpen={isSwapOpen}
            onToggleSwap={() => setOpenSwapId(isSwapOpen ? null : specId)}
            onSwap={(c: Candidate) => {
              onSwap(specId, c)
              setOpenSwapId(null)
            }}
            onCloseSwap={() => setOpenSwapId(null)}
          />
        )
      })}
    </div>
  )
}

export default BestBasketList
