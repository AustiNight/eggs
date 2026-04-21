/**
 * PlanResult — top-level results component.
 *
 * Routing:
 *   - plan.winners populated (SHOPPING_V2 plan) → new best-basket primary view
 *   - plan.winners absent/empty (legacy plan)   → LegacyPlanView (unchanged)
 *
 * State management for winner overrides lives here, initialised from plan.winners.
 * The displayed total is computed from overrides + plan.winners, not from plan.summary.
 */
import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, Activity, DollarSign, ArrowRight } from 'lucide-react'
import type { ShoppingPlan, WinnerResult, Candidate } from '../types'
import { updateEvent } from '../lib/api'
import { TAX_RATE, round2, computeDisplayedTotal } from '../lib/planTotalsView'
import LegacyPlanView from './LegacyPlanView'
import BestBasketList from './BestBasketList'
import PerStorePanels from './PerStorePanels'

interface PlanResultProps {
  plan: ShoppingPlan
  onReset: () => void
  /** Present when rendered from an event flow — enables "Mark Shopping Complete" button. */
  eventId?: string
  getToken?: () => Promise<string | null>
}

// ─── Mark Shopping Complete button ────────────────────────────────────────────

interface MarkShoppingCompleteButtonProps {
  eventId?: string
  getToken?: () => Promise<string | null>
}

function MarkShoppingCompleteButton({ eventId, getToken }: MarkShoppingCompleteButtonProps) {
  const navigate = useNavigate()

  if (!eventId || !getToken) return null

  return (
    <button
      onClick={async () => {
        const token = await getToken()
        if (!token) return
        await updateEvent(token, eventId, { status: 'reconcile_needed' })
        navigate(`/events/${eventId}`)
      }}
      className="w-full py-3 rounded-xl font-semibold text-sm"
      style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
    >
      Mark Shopping Complete →
    </button>
  )
}

// ─── Best-basket view ─────────────────────────────────────────────────────────

interface BestBasketViewProps {
  plan: ShoppingPlan
  winners: WinnerResult[]
  onReset: () => void
  eventId?: string
  getToken?: () => Promise<string | null>
}

function BestBasketView({ plan, winners, onReset, eventId, getToken }: BestBasketViewProps) {
  // winnerOverrides: spec.id → user-selected Candidate (overrides the server winner).
  // Key is deleted (not set to null) when the user swaps back to the original winner.
  const [winnerOverrides, setWinnerOverrides] = useState<Record<string, Candidate>>({})

  const handleSwap = (specId: string, candidate: Candidate) => {
    const winnerResult = winners.find(w => w.spec.id === specId)
    const isOriginalWinner = winnerResult?.winner && candidate === winnerResult.winner
    setWinnerOverrides((prev) => {
      const next = { ...prev }
      if (isOriginalWinner) {
        delete next[specId]
      } else {
        next[specId] = candidate
      }
      return next
    })
  }

  // Compute displayed total from current overrides
  const displayedTotal = useMemo(
    () => computeDisplayedTotal(winners, winnerOverrides),
    [winnerOverrides, winners]
  )

  const savings = plan.summary.estimatedSavings ?? 0

  return (
    <div className="space-y-6 pb-20 animate-slideUp">

      {/* Stats bar */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-6 items-center justify-center text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          <span>Queried <strong className="text-white">{plan.meta.storesQueried.length}</strong> stores</span>
        </div>
        <div className="w-px h-4 bg-slate-700 hidden sm:block" />
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>
            <strong className="text-white">{plan.summary.realPriceCount}</strong> live prices
            {plan.summary.estimatedPriceCount > 0 && (
              <> · <strong className="text-amber-400">{plan.summary.estimatedPriceCount}</strong> estimated</>
            )}
          </span>
        </div>
      </div>

      {/* Hero total */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-1">Best Basket</h2>
            <p className="text-slate-400 text-sm">
              Lowest-cost combination across all searched stores.
              {Object.keys(winnerOverrides).length > 0 && (
                <> · <span className="text-amber-400">{Object.keys(winnerOverrides).length} item{Object.keys(winnerOverrides).length !== 1 ? 's' : ''} swapped</span></>
              )}
            </p>
            {plan.summary.narrative && (
              <p className="text-slate-400 text-xs mt-2 leading-relaxed max-w-xl">{plan.summary.narrative}</p>
            )}
          </div>
          <div className="flex items-end flex-col min-w-[140px] shrink-0">
            {savings > 0 && (
              <span className="text-sm text-emerald-400 font-mono mb-1">Savings: ${savings.toFixed(2)}</span>
            )}
            <div className="text-4xl font-bold text-white tracking-tighter">${displayedTotal.toFixed(2)}</div>
            <span className="text-xs text-slate-500 uppercase tracking-widest mt-1">Total w/ Tax</span>
            <span className="text-[10px] text-slate-600">
              Subtotal: ${round2(displayedTotal / (1 + TAX_RATE)).toFixed(2)}
            </span>
            {plan.meta.budgetExceeded && (
              <span className="mt-2 text-xs font-semibold px-2 py-1 rounded-full text-red-400 bg-red-400/10 border border-red-400/20">
                Over Budget
              </span>
            )}
          </div>
        </div>
        {plan.instacartUrl && (
          <div className="mt-4 relative z-10">
            <a
              href={plan.instacartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#43B02A] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a9a24] transition"
            >
              <span>🛒</span>
              Shop this list on Instacart
            </a>
          </div>
        )}
      </div>

      {/* Best basket list */}
      <div>
        <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-400" />
          Item-by-item winners
          <span className="text-xs text-slate-500 font-normal ml-1">— tap Swap to choose a different source</span>
        </h3>
        <BestBasketList
          winners={winners}
          winnerOverrides={winnerOverrides}
          onSwap={handleSwap}
        />
      </div>

      {/* Strategy report */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h4 className="text-sm font-semibold text-slate-300 mb-3">E.G.G.S. Strategy Report</h4>
        <ul className="space-y-2.5 text-sm text-slate-400">
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
            <span>Visited {plan.stores.length} distinct location{plan.stores.length !== 1 ? 's' : ''}.</span>
          </li>
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
            <span>Best basket picks the cheapest per-item winner across all stores, respecting your brand preferences.</span>
          </li>
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
            <span>
              {(() => {
                const apiSources = plan.meta.storesQueried
                  .filter(s => s.source !== 'ai_estimated')
                  .map(s => {
                    if (s.source === 'kroger_api') return 'Kroger'
                    if (s.source === 'walmart_api') return 'Walmart'
                    return s.source.replace('_api', '')
                  })
                const apiList = [...new Set(apiSources)].join(' + ')
                const source = apiList || 'direct APIs'
                return `${plan.summary.realPriceCount} live price${plan.summary.realPriceCount !== 1 ? 's' : ''} from ${source}.`
              })()}
              {plan.summary.estimatedPriceCount > 0 && ` ${plan.summary.estimatedPriceCount} AI estimated.`}
            </span>
          </li>
          {plan.meta.budgetMode === 'ceiling' && plan.meta.budgetCeiling && (
            <li className="flex items-start gap-2">
              <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <span>
                Budget ceiling: ${plan.meta.budgetCeiling.toFixed(2)}.{' '}
                {plan.meta.budgetExceeded
                  ? <span className="text-red-400">Plan exceeded budget.</span>
                  : <span className="text-emerald-400">Came in under budget.</span>}
              </span>
            </li>
          )}
        </ul>
      </div>

      {/* Per-store panels (collapsible) */}
      <PerStorePanels stores={plan.stores} />

      <MarkShoppingCompleteButton eventId={eventId} getToken={getToken} />

      <button
        onClick={onReset}
        className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors border border-slate-600"
      >
        Start New List
      </button>
    </div>
  )
}

// ─── Top-level conditional ────────────────────────────────────────────────────

const PlanResult: React.FC<PlanResultProps> = ({ plan, onReset, eventId, getToken }) => {
  const winners = plan.winners

  if (winners && winners.length > 0) {
    return <BestBasketView plan={plan} winners={winners} onReset={onReset} eventId={eventId} getToken={getToken} />
  }

  // Legacy path — SHOPPING_V2 off or old plan without winners
  return <LegacyPlanView plan={plan} onReset={onReset} eventId={eventId} getToken={getToken} />
}

export default PlanResult
