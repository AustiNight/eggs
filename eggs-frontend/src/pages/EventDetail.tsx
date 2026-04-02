import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, Calendar, Users, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { getEvent, updateEvent, deleteEvent } from '../lib/api'
import type { EventDetail as EventDetailType, EggsEvent } from '../types'

const STATUS_LABEL: Record<EggsEvent['status'], string> = {
  planning:          'Draft',
  shopping:          'Plan Ready',
  reconcile_needed:  'Reconcile Needed',
  complete:          'Complete'
}
const STATUS_COLOR: Record<EggsEvent['status'], string> = {
  planning:          '#8b949e',
  shopping:          '#f59e0b',
  reconcile_needed:  '#f59e0b',
  complete:          '#22c55e'
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState<EventDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [showIngredients, setShowIngredients] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getToken().then(token => {
      if (!token) return
      return getEvent(token, id)
    }).then(data => {
      if (!cancelled && data) setDetail(data)
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [id, getToken])

  const handleDelete = async () => {
    if (!id || !confirm('Delete this event? This cannot be undone.')) return
    setDeleting(true)
    const token = await getToken()
    if (!token) return
    await deleteEvent(token, id)
    navigate('/dashboard')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0d1117' }}>
        <div className="text-sm" style={{ color: '#8b949e' }}>Loading…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0d1117' }}>
        <div className="text-white">Event not found</div>
      </div>
    )
  }

  const { event, dishes, ingredients, latestPlan } = detail
  const status = event.status
  const statusColor = STATUS_COLOR[status]

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0d1117' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0d1117', borderBottom: '1px solid #30363d' }}>
        <button onClick={() => navigate('/dashboard')} style={{ color: '#8b949e' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white flex-1 truncate">{event.name}</span>
        <button onClick={handleDelete} disabled={deleting} style={{ color: '#8b949e' }}>
          <Trash2 className="w-4 h-4" />
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Status banner */}
        <div className="rounded-xl p-4" style={{ backgroundColor: '#161b22', border: `1px solid ${statusColor}40` }}>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ color: statusColor, backgroundColor: statusColor + '20' }}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm" style={{ color: '#8b949e' }}>
            {event.event_date && (
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="w-4 h-4" /> {event.headcount} guests
            </span>
            {event.client_name && <span>for {event.client_name}</span>}
          </div>
        </div>

        {/* Primary action */}
        {status === 'planning' && (
          <Link
            to={`/events/${event.id}/shop`}
            className="block w-full text-center py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
          >
            Generate Shopping Plan →
          </Link>
        )}
        {status === 'shopping' && (
          <div className="space-y-2">
            <Link
              to={`/events/${event.id}/shop`}
              className="block w-full text-center py-3 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
            >
              View Shopping Plan
            </Link>
            <button
              onClick={async () => {
                const token = await getToken()
                if (!token) return
                await updateEvent(token, event.id, { status: 'reconcile_needed' })
                setDetail(prev => prev ? { ...prev, event: { ...prev.event, status: 'reconcile_needed' } } : prev)
              }}
              className="block w-full text-center py-3 rounded-xl text-sm font-medium"
              style={{ backgroundColor: '#161b22', color: '#8b949e', border: '1px solid #30363d' }}
            >
              Mark Shopping Complete
            </button>
          </div>
        )}
        {status === 'reconcile_needed' && (
          <Link
            to={`/events/${event.id}/reconcile`}
            className="block w-full text-center py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
          >
            Begin Reconcile →
          </Link>
        )}
        {status === 'complete' && (
          <Link
            to={`/events/${event.id}/reconcile`}
            className="block w-full text-center py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
          >
            View Report
          </Link>
        )}

        {/* Dishes */}
        <section className="rounded-xl overflow-hidden" style={{ border: '1px solid #30363d' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#161b22', borderBottom: '1px solid #30363d' }}>
            <span className="font-semibold text-white text-sm">{dishes.length} {dishes.length === 1 ? 'Dish' : 'Dishes'}</span>
          </div>
          {dishes.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ backgroundColor: '#161b22', color: '#8b949e' }}>No dishes added.</div>
          ) : (
            dishes.map((dish, i) => (
              <div
                key={dish.id}
                className="px-4 py-3 text-sm"
                style={{
                  backgroundColor: '#161b22',
                  borderBottom: i < dishes.length - 1 ? '1px solid #30363d' : 'none',
                  color: '#c9d1d9'
                }}
              >
                <span className="font-medium">{dish.name}</span>
                {dish.servings && <span className="ml-2" style={{ color: '#8b949e' }}>· {dish.servings} servings</span>}
              </div>
            ))
          )}
        </section>

        {/* Ingredient pool */}
        {ingredients.length > 0 && (
          <section className="rounded-xl overflow-hidden" style={{ border: '1px solid #30363d' }}>
            <button
              onClick={() => setShowIngredients(p => !p)}
              className="w-full px-4 py-3 flex items-center justify-between"
              style={{ backgroundColor: '#161b22' }}
            >
              <span className="font-semibold text-white text-sm">{ingredients.length} Ingredients</span>
              {showIngredients ? <ChevronUp className="w-4 h-4" style={{ color: '#8b949e' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#8b949e' }} />}
            </button>
            {showIngredients && ingredients.map((ing, i) => (
              <div
                key={ing.id}
                className="px-4 py-2.5 flex items-center justify-between text-sm"
                style={{
                  backgroundColor: '#161b22',
                  borderTop: '1px solid #30363d',
                  color: '#c9d1d9'
                }}
              >
                <span>{ing.clarifiedName ?? ing.name}</span>
                <span style={{ color: '#8b949e' }}>{ing.quantity} {ing.unit}</span>
              </div>
            ))}
          </section>
        )}

        {latestPlan && (
          <p className="text-xs text-center" style={{ color: '#8b949e' }}>
            Last plan generated {new Date(latestPlan.generated_at).toLocaleDateString()}
          </p>
        )}
      </main>
    </div>
  )
}
