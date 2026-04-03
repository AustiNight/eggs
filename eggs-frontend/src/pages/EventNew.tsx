import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { createEvent, addDish } from '../lib/api'

interface DishInput { id: string; name: string; servings: string }

export default function EventNew() {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  // Section 1: Event details
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [headcount, setHeadcount] = useState('20')
  const [budgetMode, setBudgetMode] = useState<'calculate' | 'ceiling'>('calculate')
  const [budgetCeiling, setBudgetCeiling] = useState('')

  // Section 2: Menu
  const [dishes, setDishes] = useState<DishInput[]>([{ id: crypto.randomUUID(), name: '', servings: '' }])

  // Section 3: Preferences
  const [radius, setRadius] = useState(10)
  const [maxStores, setMaxStores] = useState(3)
  const [includeDelivery, setIncludeDelivery] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addDishRow = () =>
    setDishes(prev => [...prev, { id: crypto.randomUUID(), name: '', servings: '' }])

  const removeDishRow = (id: string) =>
    setDishes(prev => prev.filter(d => d.id !== id))

  const updateDish = (id: string, field: keyof DishInput, val: string) =>
    setDishes(prev => prev.map(d => d.id === id ? { ...d, [field]: val } : d))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const filledDishes = dishes.filter(d => d.name.trim())
    if (!name.trim()) { setError('Event name is required'); return }
    if (!headcount || parseInt(headcount) < 1) { setError('Headcount must be at least 1'); return }
    if (filledDishes.length === 0) { setError('Add at least one dish'); return }
    setError(null)
    setSaving(true)

    try {
      const token = await getToken()
      if (!token) return

      const event = await createEvent(token, {
        name: name.trim(),
        client_name: clientName.trim() || undefined,
        event_date: eventDate || undefined,
        headcount: parseInt(headcount),
        budget_mode: budgetMode,
        budget_ceiling: budgetMode === 'ceiling' && budgetCeiling ? parseFloat(budgetCeiling) : undefined
      })

      await Promise.all(
        filledDishes.map(d =>
          addDish(token, event.id, {
            name: d.name.trim(),
            servings: d.servings ? parseInt(d.servings) : undefined
          })
        )
      )

      // Navigate directly to shop so AI pipeline runs immediately
      navigate(`/events/${event.id}/shop`, {
        state: {
          headcount: parseInt(headcount),
          settings: { radiusMiles: radius, maxStores, includeDelivery, curbsideMaxMiles: radius }
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <button onClick={() => navigate('/dashboard')} style={{ color: '#94a3b8' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white">New Event</span>
      </header>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
            {error}
          </div>
        )}

        {/* Event Details */}
        <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
          <h2 className="font-semibold text-white">Event Details</h2>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Event Name *</label>
            <input
              type="text" required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Johnson Wedding Reception"
              className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Client Name</label>
              <input
                type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Event Date</label>
              <input
                type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Headcount *</label>
            <input
              type="number" required min={1} value={headcount}
              onChange={e => setHeadcount(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: '#94a3b8' }}>Budget</label>
            <div className="flex gap-2 mb-3">
              {(['calculate', 'ceiling'] as const).map(mode => (
                <button
                  key={mode} type="button"
                  onClick={() => setBudgetMode(mode)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: budgetMode === mode ? '#fbbf2420' : '#0f172a',
                    color: budgetMode === mode ? '#fbbf24' : '#94a3b8',
                    border: `1px solid ${budgetMode === mode ? '#fbbf2460' : '#334155'}`
                  }}
                >
                  {mode === 'calculate' ? 'Calculate my cost' : 'I have a ceiling'}
                </button>
              ))}
            </div>
            {budgetMode === 'ceiling' && (
              <input
                type="number" min={0} step={0.01} value={budgetCeiling}
                onChange={e => setBudgetCeiling(e.target.value)}
                placeholder="Budget ceiling ($)"
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            )}
          </div>
        </section>

        {/* Menu */}
        <section className="rounded-xl p-5 space-y-3" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
          <h2 className="font-semibold text-white">Menu</h2>
          <p className="text-xs" style={{ color: '#94a3b8' }}>Just type the dish name — AI handles the rest.</p>
          {dishes.map((dish, i) => (
            <div key={dish.id} className="flex gap-2 items-center">
              <input
                type="text" value={dish.name}
                onChange={e => updateDish(dish.id, 'name', e.target.value)}
                placeholder={`Dish ${i + 1} (e.g. Chicken Marsala)`}
                className="flex-1 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
              <input
                type="number" min={1} value={dish.servings}
                onChange={e => updateDish(dish.id, 'servings', e.target.value)}
                placeholder="servings"
                className="w-24 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
              {dishes.length > 1 && (
                <button type="button" onClick={() => removeDishRow(dish.id)} style={{ color: '#94a3b8' }}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button" onClick={addDishRow}
            className="flex items-center gap-1 text-sm font-medium"
            style={{ color: '#fbbf24' }}
          >
            <Plus className="w-4 h-4" /> Add another dish
          </button>
        </section>

        {/* Shopping Preferences */}
        <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
          <h2 className="font-semibold text-white">Shopping Preferences</h2>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: '#94a3b8' }}>Search Radius</span>
              <span style={{ color: '#fbbf24' }}>{radius} mi</span>
            </div>
            <input type="range" min={1} max={50} value={radius} onChange={e => setRadius(parseInt(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer" style={{ accentColor: '#fbbf24' }} />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: '#94a3b8' }}>Max Stores</span>
              <span style={{ color: '#fbbf24' }}>{maxStores}</span>
            </div>
            <input type="range" min={1} max={5} value={maxStores} onChange={e => setMaxStores(parseInt(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer" style={{ accentColor: '#fbbf24' }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: '#94a3b8' }}>Include Delivery</span>
            <button
              type="button"
              onClick={() => setIncludeDelivery(p => !p)}
              className="w-10 h-5 rounded-full relative transition-colors"
              style={{ backgroundColor: includeDelivery ? '#fbbf24' : '#334155' }}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${includeDelivery ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </section>

        <button
          type="submit" disabled={saving}
          className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity"
          style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Creating…' : <>Generate Shopping Plan <ChevronRight className="w-4 h-4" /></>}
        </button>
      </form>
    </div>
  )
}
