/**
 * ItemSwapSelector — shows eligibleCandidates for a given item row.
 *
 * Controlled component: receives candidates + currently-selected winner,
 * calls onSelect when the user picks a different candidate.
 * Rendered inline (dropdown-style) below the triggering row in BestBasketList.
 */
import React from 'react'
import { ExternalLink, CheckCircle } from 'lucide-react'
import type { Candidate } from '../types'

interface ItemSwapSelectorProps {
  candidates: Candidate[]
  currentWinner: Candidate | null
  onSelect: (candidate: Candidate) => void
  onClose: () => void
}

function pricePerBaseLabel(ppb: number | null): string {
  if (ppb === null) return ''
  // ppb is price per base unit (g / ml / count). Show 2 sig figs for readability.
  return `$${ppb.toFixed(4)}/base`
}

const ItemSwapSelector: React.FC<ItemSwapSelectorProps> = ({
  candidates,
  currentWinner,
  onSelect,
  onClose
}) => {
  if (candidates.length === 0) {
    return (
      <div className="mt-2 p-4 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-400">
        No alternative candidates available for this item.
        <button onClick={onClose} className="ml-3 text-slate-500 hover:text-slate-300 underline text-xs">
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 bg-slate-900 border border-slate-600 rounded-xl overflow-hidden shadow-xl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-800/80">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Choose a different source ({candidates.length} available)
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-xs px-2 py-0.5 rounded hover:bg-slate-700 transition-colors"
        >
          Close
        </button>
      </div>

      <div className="divide-y divide-slate-800 max-h-72 overflow-y-auto">
        {candidates.map((c, idx) => {
          const isSelected = currentWinner
            ? c.storeName === currentWinner.storeName &&
              c.item.ingredientId === currentWinner.item.ingredientId &&
              c.item.unitPrice === currentWinner.item.unitPrice
            : false

          const href = c.item.shopUrl ?? c.item.productUrl

          return (
            <button
              key={idx}
              onClick={() => { onSelect(c); onClose() }}
              className={[
                'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
                isSelected
                  ? 'bg-amber-500/10 border-l-2 border-amber-400'
                  : 'hover:bg-slate-800/80'
              ].join(' ')}
            >
              {/* Selection indicator */}
              <div className="mt-0.5 shrink-0">
                {isSelected
                  ? <CheckCircle className="w-4 h-4 text-amber-400" />
                  : <div className="w-4 h-4 rounded-full border border-slate-600" />
                }
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm text-white">{c.storeName}</span>
                  {c.distanceMiles !== undefined && (
                    <span className="text-xs text-slate-500">{c.distanceMiles.toFixed(1)} mi</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">{c.item.name}</div>
                {c.parsedSize && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Package: {c.parsedSize.quantity} {c.parsedSize.unit}
                    {c.pricePerBase !== null && (
                      <span className="ml-2 text-slate-600">{pricePerBaseLabel(c.pricePerBase)}</span>
                    )}
                  </div>
                )}
                {c.item.isLoyaltyPrice && (
                  <span className="inline-block mt-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                    Member Price
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="text-right shrink-0">
                <div className="font-bold text-amber-400 font-mono text-sm">
                  ${c.item.lineTotal.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500">
                  ${c.item.unitPrice.toFixed(2)} ea
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    <ExternalLink className="w-2.5 h-2.5" /> View
                  </a>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ItemSwapSelector
