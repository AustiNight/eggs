import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, AlertTriangle, CheckCircle } from 'lucide-react'
import { getEvent, scaleRecipes, clarifyIngredients, generatePlan } from '../lib/api'
import PlanResult from '../components/PlanResult'
import type {
  ShoppingPlan, IngredientLine,
  ClarificationRequest, PlanSettings, ShopStatus, Confidence,
  ShoppableItemSpecMirror
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
  const [pendingSpecs, setPendingSpecs] = useState<ShoppableItemSpecMirror[] | undefined>(undefined)
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
    resolvedClarifications?: Record<string, string>,
    specs?: ShoppableItemSpecMirror[]
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
        headcount: locationState?.headcount,
        ...(specs && specs.length > 0 ? { resolvedSpecs: specs } : {})
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

        // Capture any pre-resolved specs (M6+)
        const specsFromClarify = clarifyResult.specs
          ? (Object.values(clarifyResult.specs) as ShoppableItemSpecMirror[])
          : undefined

        if (clarifyResult.clarifications && clarifyResult.clarifications.length > 0) {
          setPendingSpecs(specsFromClarify)
          setClarifications(clarifyResult.clarifications)
          setShopStatus('clarifying')
          // Wait for user to answer — runPipeline called from ClarificationModal onComplete
          return
        }

        // No clarifications needed — pass ingredients + specs to avoid stale closure
        await runPipeline(scaleResult.ingredients, undefined, specsFromClarify)
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
    runPipeline(undefined, resolved, pendingSpecs)
  }

  const handleReset = () => {
    setShopStatus('idle')
    setClarifications(null)
    setPendingSpecs(undefined)
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
        <PlanResult plan={plan} onReset={handleReset} eventId={id} getToken={getToken} />
      )}
    </div>
  )
}
