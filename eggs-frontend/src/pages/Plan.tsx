import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, Zap, Check } from 'lucide-react'
import ShoppingListInput from '../components/ShoppingListInput'
import ClarificationModal from '../components/ClarificationModal'
import LoadingState, { PlanStatus } from '../components/LoadingState'
import PlanResult from '../components/PlanResult'
import SettingsPanel from '../components/SettingsPanel'
import { clarifyIngredients, generatePlan, ApiError } from '../lib/api'
import { saveToHistory } from '../services/storageService'
import type { ShoppingPlan, PlanSettings, ClarificationRequest, IngredientLine, ShoppableItemSpecMirror, ClarifiedAttributes } from '../types'

// Convert chef's raw shopping items into IngredientLine format for the API
function itemsToIngredients(items: ShoppingItem[]): IngredientLine[] {
  return items.map(item => ({
    id: item.id,
    name: item.clarifiedName || item.name,
    quantity: item.quantity,
    unit: item.unit || 'unit',
    category: '',
    sources: []
  }))
}

export interface ShoppingItem {
  id: string
  name: string
  quantity: number
  unit?: string
  clarifiedName?: string
  lastPurchased?: string
}

type PageStatus = 'idle' | PlanStatus | 'clarifying' | 'results' | 'error'

const DEFAULT_SETTINGS: PlanSettings = {
  radiusMiles: 10,
  maxStores: 3,
  includeDelivery: true,
  curbsideMaxMiles: 5
}

const DEFAULT_LOCATION = { lat: 32.7767, lng: -96.797 }

export default function Plan() {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [status, setStatus] = useState<PageStatus>('idle')
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS)
  const [clarifications, setClarifications] = useState<ClarificationRequest[] | null>(null)
  const [resolvedSpecs, setResolvedSpecs] = useState<ShoppableItemSpecMirror[] | undefined>(undefined)
  const [plan, setPlan] = useState<ShoppingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)

  const handleStartProcess = async () => {
    setError(null)
    setStatus('analyzing')

    try {
      const token = await getToken()
      if (!token) return

      const ingredients = itemsToIngredients(items)
      const result = await clarifyIngredients(token, ingredients)

      // Capture any specs the clarify route already resolved (M6+)
      const specsFromClarify = result.specs
        ? (Object.values(result.specs) as ShoppableItemSpecMirror[])
        : undefined

      if (result.clarifications && result.clarifications.length > 0) {
        setResolvedSpecs(specsFromClarify)
        setClarifications(result.clarifications)
        setStatus('clarifying')
      } else {
        await runPlan(ingredients, token, specsFromClarify)
      }
    } catch (e) {
      setError('An error occurred while analyzing your list.')
      setStatus('error')
    }
  }

  const handleClarificationComplete = async (answers: Record<string, ClarifiedAttributes>) => {
    setClarifications(null)
    const updatedItems = items.map(item =>
      answers[item.id]
        ? { ...item, clarifiedName: `${item.name} (${answers[item.id].selectedOptions.join(', ')})` }
        : item
    )
    setItems(updatedItems)

    const token = await getToken()
    if (!token) return
    // Pass structured clarifications to the plan API for clean query composition
    await runPlan(itemsToIngredients(updatedItems), token, resolvedSpecs, answers)
  }

  const runPlan = async (
    ingredients: IngredientLine[],
    token: string,
    specs?: ShoppableItemSpecMirror[],
    resolvedClarifications?: Record<string, ClarifiedAttributes>
  ) => {
    saveToHistory(items)

    // Phase 1: Geolocate + show store discovery state
    setStatus('discovering')
    let lat = DEFAULT_LOCATION.lat
    let lng = DEFAULT_LOCATION.lng
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* use default */ }

    // Phase 2: Show parallel search state
    await new Promise(r => setTimeout(r, 900))
    setStatus('searching')

    // Phase 3: Show optimizing while backend finalizes
    // (Backend runs store discovery + parallel API+AI search + assembly)
    // We transition to 'optimizing' after a short delay to reflect the backend phases
    const optimizingTimer = setTimeout(() => setStatus('optimizing'), 4000)

    try {
      const result = await generatePlan(token, {
        ingredients,
        location: { lat, lng },
        settings,
        ...(specs && specs.length > 0 ? { resolvedSpecs: specs } : {}),
        ...(resolvedClarifications ? { resolvedClarifications } : {})
      })
      clearTimeout(optimizingTimer)
      setPlan(result)
      setStatus('results')
    } catch (e) {
      clearTimeout(optimizingTimer)
      if (e instanceof ApiError && e.status === 403) {
        setLimitReached(true)
      } else {
        setError('Failed to generate a shopping plan. Please try again.')
      }
      setStatus('error')
    }
  }

  const reset = () => {
    setStatus('idle')
    setItems([])
    setPlan(null)
    setError(null)
    setLimitReached(false)
    setClarifications(null)
    setResolvedSpecs(undefined)
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-white">The Price of</span>
            <span className="text-xl font-bold">
              <span className="text-amber-400">E</span>
              <span className="text-white">.</span>
              <span className="text-amber-400">G</span>
              <span className="text-white">.</span>
              <span className="text-amber-400">G</span>
              <span className="text-white">.</span>
              <span className="text-amber-400">S</span>
              <span className="text-white">.</span>
            </span>
          </div>
        </div>
      </header>

      <main className="pt-24 px-4 pb-12 max-w-4xl mx-auto">

        {error && !limitReached && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {status === 'idle' && (
          <div className="space-y-8">
            <div className="text-center mb-10">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                Smart Grocery Savings.
              </h2>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                Enter your list. We'll{' '}
                <span className="text-amber-400">e</span>xplore the web,{' '}
                <span className="text-amber-400">g</span>ather deals, and{' '}
                <span className="text-amber-400">g</span>roup your carts to{' '}
                <span className="text-amber-400">s</span>ave on the price of eggs (and everything else).
              </p>
            </div>
            <SettingsPanel settings={settings} onUpdate={setSettings} />
            <ShoppingListInput items={items} setItems={setItems} onStartSearch={handleStartProcess} />
          </div>
        )}

        {status === 'clarifying' && clarifications && (
          <ClarificationModal requests={clarifications} onComplete={handleClarificationComplete} />
        )}

        {(status === 'analyzing' || status === 'discovering' || status === 'searching' || status === 'optimizing') && (
          <LoadingState status={status as PlanStatus} />
        )}

        {status === 'results' && plan && (
          <PlanResult plan={plan} onReset={reset} />
        )}

        {status === 'error' && limitReached && (
          <div className="max-w-md mx-auto pt-8 space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ backgroundColor: '#fbbf2420', border: '1px solid #fbbf2440' }}>
                <Zap className="w-7 h-7" style={{ color: '#fbbf24' }} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">You've hit your free limit</h2>
              <p className="text-slate-400 text-sm">
                Free accounts get 3 shopping plans per month. Upgrade to Pro for unlimited plans and priority pricing.
              </p>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
              <div className="grid grid-cols-2">
                <div className="p-4" style={{ backgroundColor: '#1e293b' }}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Free</p>
                  {['3 plans / month', '3 lists / month', 'Kroger + AI pricing', 'Basic support'].map(f => (
                    <div key={f} className="flex items-center gap-2 mb-2">
                      <Check className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="text-xs text-slate-400">{f}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4" style={{ backgroundColor: '#1a1f0a', borderLeft: '1px solid #fbbf2430' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#fbbf24' }}>Pro</p>
                  {['Unlimited plans', 'Unlimited lists', 'All store integrations', 'Priority support'].map(f => (
                    <div key={f} className="flex items-center gap-2 mb-2">
                      <Check className="w-3.5 h-3.5 shrink-0" style={{ color: '#fbbf24' }} />
                      <span className="text-xs text-white">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate('/settings')}
              className="w-full py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 24px rgba(251,191,36,0.3)' }}
            >
              Upgrade to Pro
            </button>

            <button onClick={reset} className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors">
              ← Back to my list
            </button>
          </div>
        )}

        {status === 'error' && !limitReached && (
          <div className="text-center pt-12">
            <button onClick={reset} className="text-sm text-slate-400 hover:text-white underline">
              ← Try again
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 py-8 text-center text-slate-600 text-sm">
        <p>&copy; {new Date().getFullYear()} The Price of E.G.G.S.</p>
      </footer>
    </div>
  )
}
