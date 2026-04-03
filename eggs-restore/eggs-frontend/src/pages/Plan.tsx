import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft } from 'lucide-react'
import ShoppingListInput from '../components/ShoppingListInput'
import ClarificationModal from '../components/ClarificationModal'
import LoadingState, { PlanStatus } from '../components/LoadingState'
import PlanResult from '../components/PlanResult'
import SettingsPanel from '../components/SettingsPanel'
import { clarifyIngredients, generatePlan } from '../lib/api'
import { saveToHistory } from '../services/storageService'
import type { ShoppingPlan, PlanSettings, ClarificationRequest, IngredientLine } from '../types'

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
  const [plan, setPlan] = useState<ShoppingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleStartProcess = async () => {
    setError(null)
    setStatus('analyzing')

    try {
      const token = await getToken()
      if (!token) return

      const ingredients = itemsToIngredients(items)
      const result = await clarifyIngredients(token, ingredients)

      if (result.clarifications && result.clarifications.length > 0) {
        setClarifications(result.clarifications)
        setStatus('clarifying')
      } else {
        await runPlan(ingredients, token)
      }
    } catch (e) {
      setError('An error occurred while analyzing your list.')
      setStatus('error')
    }
  }

  const handleClarificationComplete = async (updates: Record<string, string>) => {
    setClarifications(null)
    const updatedItems = items.map(item =>
      updates[item.id] ? { ...item, clarifiedName: updates[item.id] } : item
    )
    setItems(updatedItems)

    const token = await getToken()
    if (!token) return
    await runPlan(itemsToIngredients(updatedItems), token)
  }

  const runPlan = async (ingredients: IngredientLine[], token: string) => {
    setStatus('searching')
    saveToHistory(items)

    let lat = DEFAULT_LOCATION.lat
    let lng = DEFAULT_LOCATION.lng
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* use default */ }

    await new Promise(r => setTimeout(r, 800))
    setStatus('optimizing')

    try {
      const result = await generatePlan(token, {
        ingredients,
        location: { lat, lng },
        settings
      })
      setPlan(result)
      setStatus('results')
    } catch (e) {
      setError('Failed to generate a shopping plan. Please try again.')
      setStatus('error')
    }
  }

  const reset = () => {
    setStatus('idle')
    setItems([])
    setPlan(null)
    setError(null)
    setClarifications(null)
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

        {error && (
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

        {(status === 'analyzing' || status === 'searching' || status === 'optimizing') && (
          <LoadingState status={status as PlanStatus} />
        )}

        {status === 'results' && plan && (
          <PlanResult plan={plan} onReset={reset} />
        )}

        {status === 'error' && (
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
