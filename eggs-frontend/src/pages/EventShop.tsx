import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, ExternalLink, ShoppingCart, AlertTriangle, CheckCircle } from 'lucide-react'
import { getEvent, scaleRecipes, clarifyIngredients, generatePlan, updateEvent } from '../lib/api'
import type {
  ShoppingPlan, StorePlan, StoreItem, IngredientLine,
  ClarificationRequest, PlanSettings, ShopStatus, Confidence
} from '../types'

// ─── Source badge ─────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence, proofUrl }: { confidence: Confidence; proofUrl?: string }) {
  if (confidence === 'real') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
        style={{ color: '#22c55e', backgroundColor: '#22c55e20', border: '1px solid #22c55e40' }}>
        <CheckCircle className="w-3 h-3" /> Kroger API
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color: '#fbbf24', backgroundColor: '#fbbf2420', border: '1px solid #fbbf2440' }}>
      <AlertTriangle className="w-3 h-3" /> AI Estimated
      {proofUrl && (
        <a href={proofUrl} target="_blank" rel="noopener noreferrer"
          className="ml-1 underline" style={{ color: '#fbbf24' }}
          onClick={e => e.stopPropagation()}>
          Source ↗
        </a>
      )}
    </span>
  )
}

// ─── Loading screen ───────────────────────────────────────────────────────────

const STATUS_MESSAGES: Record<ShopStatus, string[]> = {
  idle: [],
  scaling:    ['Scaling your menu to {event}…', 'Calculating ingredient quantities…', 'Merging shared ingredients…'],
  clarifying: ['Checking ingredient specs…'],
  searching:  ['Searching nearby stores…', 'Checking Kroger prices…', 'Looking up loyalty card pricing…'],
  optimizing: ['Optimizing your shopping plan…', 'Finding lowest total cost…', 'Building multi-store split…'],
  results:    [],
  error:      []
}

function LoadingState({ status, eventName }: { status: ShopStatus; eventName?: string }) {
  const [msgIdx, setMsgIdx] = useState(0)
  const msgs = STATUS_MESSAGES[status].map(m => m.replace('{event}', eventName ?? 'your event'))

  useEffect(() => {
    if (!msgs.length) return
    const t = setInterval(() => setMsgIdx(i => (i + 1) % msgs.length), 2500)
    return () => clearInterval(t)
  }, [status])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="relative w-16 h-16 mb-6">
        <div className="absolute inset-0 rounded-full border-4 animate-spin"
          style={{ borderColor: '#fbbf24 transparent transparent transparent' }} />
        <div className="absolute inset-3 rounded-full" style={{ backgroundColor: '#fbbf2420' }} />
      </div>
      <div className="text-white font-semibold text-lg mb-2">
        {status === 'scaling' && 'Scaling Recipes'}
        {status === 'clarifying' && 'Checking Ingredients'}
        {status === 'searching' && 'Finding Prices'}
        {status === 'optimizing' && 'Building Plan'}
      </div>
      {msgs.length > 0 && (
        <p className="text-sm max-w-xs" style={{ color: '#94a3b8' }}>{msgs[msgIdx]}</p>
      )}
    </div>
  )
}

// ─── Clarification modal ──────────────────────────────────────────────────────

function ClarificationModal({
  clarifications,
  onComplete
}: {
  clarifications: ClarificationRequest[]
  onComplete: (resolved: Record<string, string>) => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})

  const allAnswered = clarifications.every(c => selections[c.itemId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onComplete(selections)
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h2 className="text-xl font-bold text-white mb-1">A few quick questions</h2>
      <p className="text-sm mb-6" style={{ color: '#94a3b8' }}>Help us find the exact products and best prices.</p>
      <form onSubmit={handleSubmit} className="space-y-5">
        {clarifications.map(c => (
          <div key={`${c.itemId}-${c.question}`} className="rounded-xl p-4"
            style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <p className="text-sm font-medium text-white mb-3">{c.originalName} — {c.question}</p>
            <div className="flex flex-wrap gap-2">
              {c.options.map(opt => (
                <button
                  key={opt} type="button"
                  onClick={() => setSelections(prev => ({ ...prev, [c.itemId]: opt }))}
                  className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                  style={{
                    backgroundColor: selections[c.itemId] === opt ? '#fbbf2420' : '#0f172a',
                    color: selections[c.itemId] === opt ? '#fbbf24' : '#cbd5e1',
                    border: `1px solid ${selections[c.itemId] === opt ? '#fbbf2460' : '#334155'}`
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="submit" disabled={!allAnswered}
          className="w-full py-3 rounded-xl font-bold text-sm transition-opacity"
          style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)', opacity: allAnswered ? 1 : 0.4 }}
        >
          Find Best Prices →
        </button>
        <button
          type="button"
          onClick={() => onComplete(selections)}
          className="w-full py-2 text-sm"
          style={{ color: '#94a3b8' }}
        >
          Skip — use best estimates for unanswered questions
        </button>
      </form>
    </div>
  )
}

// ─── Results ──────────────────────────────────────────────────────────────────

function StoreCard({ store }: { store: StorePlan }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full px-4 py-4 flex items-center justify-between text-left"
        style={{ backgroundColor: '#1e293b' }}
      >
        <div>
          <div className="font-semibold text-white">{store.storeName}</div>
          <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
            {store.storeAddress}
            {store.distanceMiles ? ` · ${store.distanceMiles.toFixed(1)} mi` : ''}
            {' · '}
            <span style={{ color: store.priceSource === 'kroger_api' ? '#22c55e' : '#fbbf24' }}>
              {store.priceSource === 'kroger_api' ? 'Live prices' : 'AI estimated'}
            </span>
          </div>
        </div>
        <div className="text-right ml-4">
          <div className="font-bold text-white">${store.grandTotal.toFixed(2)}</div>
          <div className="text-xs" style={{ color: '#94a3b8' }}>{store.items.length} items</div>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #334155' }}>
          {store.items.map((item, i) => (
            <div
              key={item.ingredientId + i}
              className="px-4 py-3 flex items-start justify-between gap-3"
              style={{
                backgroundColor: '#0f172a',
                borderBottom: i < store.items.length - 1 ? '1px solid #334155' : 'none'
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{item.name}</div>
                <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
                  {item.quantity} {item.unit}
                  {item.isLoyaltyPrice && item.nonMemberPrice && (
                    <span className="ml-2 line-through">${item.nonMemberPrice.toFixed(2)}</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <ConfidenceBadge confidence={item.confidence} proofUrl={item.proofUrl} />
                  {item.confidence === 'real' && item.productUrl && (
                    <a
                      href={item.productUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs"
                      style={{ color: '#60a5fa' }}
                    >
                      <ShoppingCart className="w-3 h-3" /> Shop Link
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-white text-sm">${item.lineTotal.toFixed(2)}</div>
                <div className="text-xs" style={{ color: '#94a3b8' }}>${item.unitPrice.toFixed(2)} ea</div>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#1e293b' }}>
            <span className="text-xs" style={{ color: '#94a3b8' }}>Subtotal · Tax (est. 8.25%)</span>
            <span className="text-sm font-medium text-white">${store.subtotal.toFixed(2)} · ${store.estimatedTax.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanResults({
  plan,
  onReset,
  eventId,
  getToken
}: {
  plan: ShoppingPlan
  onReset: () => void
  eventId?: string
  getToken: () => Promise<string | null>
}) {
  const navigate = useNavigate()
  const { realPriceCount, estimatedPriceCount, total } = plan.summary

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Summary */}
      <div className="rounded-xl p-5" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-3xl font-bold text-white">${total.toFixed(2)}</div>
            <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>estimated total with tax</div>
          </div>
          {plan.meta.budgetExceeded && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full"
              style={{ color: '#ef4444', backgroundColor: '#ef444420' }}>
              Over Budget
            </span>
          )}
        </div>
        <div className="flex gap-4 text-xs" style={{ color: '#94a3b8' }}>
          <span>{plan.stores.length} store{plan.stores.length !== 1 ? 's' : ''}</span>
          <span style={{ color: '#22c55e' }}>{realPriceCount} live prices</span>
          {estimatedPriceCount > 0 && <span style={{ color: '#fbbf24' }}>{estimatedPriceCount} estimated</span>}
        </div>
      </div>

      {plan.stores.map((store, i) => <StoreCard key={store.storeName + i} store={store} />)}

      <div className="flex gap-3 pt-2">
        {eventId && (
          <button
            onClick={async () => {
              const token = await getToken()
              if (!token) return
              await updateEvent(token, eventId, { status: 'reconcile_needed' })
              navigate(`/events/${eventId}`)
            }}
            className="flex-1 py-3 rounded-xl font-semibold text-sm"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
          >
            Mark Shopping Complete →
          </button>
        )}
        <button
          onClick={onReset}
          className="py-3 px-4 rounded-xl text-sm font-medium"
          style={{ backgroundColor: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
        >
          Regenerate
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EventShop() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()

  const locationState = location.state as {
    headcount?: number
    settings?: Partial<PlanSettings>
  } | null

  const [shopStatus, setShopStatus] = useState<ShopStatus>('idle')
  const [eventName, setEventName] = useState<string>()
  const [ingredients, setIngredients] = useState<IngredientLine[]>([])
  const [clarifications, setClarifications] = useState<ClarificationRequest[] | null>(null)
  const [plan, setPlan] = useState<ShoppingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultSettings: PlanSettings = {
    radiusMiles: locationState?.settings?.radiusMiles ?? 10,
    maxStores: locationState?.settings?.maxStores ?? 3,
    includeDelivery: locationState?.settings?.includeDelivery ?? true,
    curbsideMaxMiles: locationState?.settings?.curbsideMaxMiles ?? 5,
    avoidStores: [],
    avoidBrands: []
  }

  const runPipeline = useCallback(async (
    ingredientsList?: IngredientLine[],
    resolvedClarifications?: Record<string, string>
  ) => {
    if (!id) return
    const token = await getToken()
    if (!token) return

    // Use passed ingredients (avoids stale closure), fall back to state
    const finalIngredients = ingredientsList ?? ingredients

    try {
      setShopStatus('searching')

      // Get user location
      let lat = 32.7767, lng = -96.797 // Dallas default
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch { /* use default */ }

      setShopStatus('optimizing')
      const result = await generatePlan(token, {
        ingredients: finalIngredients,
        resolvedClarifications,
        location: { lat, lng },
        settings: {
          radiusMiles: locationState?.settings?.radiusMiles ?? 10,
          maxStores: locationState?.settings?.maxStores ?? 3,
          includeDelivery: locationState?.settings?.includeDelivery ?? true,
          curbsideMaxMiles: locationState?.settings?.curbsideMaxMiles ?? 5,
          avoidStores: [],
          avoidBrands: []
        },
        eventId: id,
        eventName,
        headcount: locationState?.headcount
      })

      setPlan(result)
      setShopStatus('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan')
      setShopStatus('error')
    }
  }, [id, getToken, ingredients, eventName, locationState])

  // Auto-run pipeline on mount
  useEffect(() => {
    if (!id || shopStatus !== 'idle') return
    let cancelled = false

    async function run() {
      const token = await getToken()
      if (!token || cancelled) return

      try {
        // Load event + dishes
        const detail = await getEvent(token, id!)
        if (cancelled) return
        setEventName(detail.event.name)

        const dishes = detail.dishes
        if (!dishes.length) {
          setError('No dishes found. Go back and add dishes first.')
          setShopStatus('error')
          return
        }

        // Scale recipes
        setShopStatus('scaling')
        const headcount = locationState?.headcount ?? detail.event.headcount ?? 20
        const scaleResult = await scaleRecipes(
          token,
          dishes.map(d => ({ id: d.id, name: d.name, servings: d.servings ?? headcount })),
          id,
          true
        )
        if (cancelled) return
        setIngredients(scaleResult.ingredients)

        // Clarify
        setShopStatus('clarifying')
        const clarifyResult = await clarifyIngredients(token, scaleResult.ingredients)
        if (cancelled) return

        if (clarifyResult.clarifications && clarifyResult.clarifications.length > 0) {
          setClarifications(clarifyResult.clarifications)
          setShopStatus('clarifying')
          // Wait for user to answer — runPipeline called from ClarificationModal onComplete
          return
        }

        // No clarifications needed — pass ingredients directly to avoid stale closure
        await runPipeline(scaleResult.ingredients)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong')
          setShopStatus('error')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClarificationComplete = (resolved: Record<string, string>) => {
    setClarifications(null)
    runPipeline(undefined, resolved)
  }

  const handleReset = () => {
    setShopStatus('idle')
    setClarifications(null)
    setPlan(null)
    setError(null)
    setIngredients([])
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <button onClick={() => navigate(id ? `/events/${id}` : '/dashboard')} style={{ color: '#94a3b8' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white flex-1 truncate">
          {eventName ? `Plan: ${eventName}` : 'Shopping Plan'}
        </span>
      </header>

      {error && (
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="rounded-lg px-4 py-3 text-sm mb-4"
            style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
            {error}
          </div>
          <button
            onClick={() => navigate(id ? `/events/${id}` : '/dashboard')}
            className="text-sm" style={{ color: '#94a3b8' }}
          >
            ← Back
          </button>
        </div>
      )}

      {(shopStatus === 'scaling' || shopStatus === 'searching' || shopStatus === 'optimizing') && (
        <LoadingState status={shopStatus} eventName={eventName} />
      )}

      {shopStatus === 'clarifying' && clarifications && (
        <ClarificationModal
          clarifications={clarifications}
          onComplete={handleClarificationComplete}
        />
      )}

      {shopStatus === 'results' && plan && (
        <PlanResults plan={plan} onReset={handleReset} eventId={id} getToken={getToken} />
      )}
    </div>
  )
}
