import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import {
  ChevronLeft, Calendar, Users, ChevronDown, ChevronUp,
  Trash2, Edit2, Check, X, Plus
} from 'lucide-react'
import { getEvent, updateEvent, deleteEvent, addDish, removeDish, getReconcile } from '../lib/api'
import type { EventDetail as EventDetailType, EggsEvent, Dish, ReconcileRecord } from '../types'
import { ApiError } from '../lib/api'

const STATUS_LABEL: Record<EggsEvent['status'], string> = {
  planning:          'Draft',
  shopping:          'Plan Ready',
  reconcile_needed:  'Reconcile Needed',
  complete:          'Complete'
}
const STATUS_COLOR: Record<EggsEvent['status'], string> = {
  planning:          '#94a3b8',
  shopping:          '#fbbf24',
  reconcile_needed:  '#fbbf24',
  complete:          '#22c55e'
}

interface EditForm {
  name: string
  client_name: string
  event_date: string
  headcount: string
  budget_mode: 'calculate' | 'ceiling'
  budget_ceiling: string
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState<EventDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showIngredients, setShowIngredients] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Edit event state
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Dish management state
  const [newDishName, setNewDishName] = useState('')
  const [newDishServings, setNewDishServings] = useState('')
  const [addingDish, setAddingDish] = useState(false)
  const [removingDishId, setRemovingDishId] = useState<string | null>(null)
  const [showAddDish, setShowAddDish] = useState(false)

  // Reconcile summary (for complete events)
  const [reconcile, setReconcile] = useState<ReconcileRecord | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      const token = await getToken()
      if (!token) return
      try {
        const data = await getEvent(token, id!)
        if (cancelled) return
        setDetail(data)
        if (data.event.status === 'complete') {
          getReconcile(token, id!).then(r => { if (!cancelled) setReconcile(r) }).catch(() => {})
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Failed to load event')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, getToken])

  const startEdit = () => {
    if (!detail) return
    const ev = detail.event
    setEditForm({
      name: ev.name,
      client_name: ev.client_name ?? '',
      event_date: ev.event_date ?? '',
      headcount: String(ev.headcount),
      budget_mode: ev.budget_mode,
      budget_ceiling: ev.budget_ceiling ? String(ev.budget_ceiling) : ''
    })
    setEditError(null)
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setEditForm(null); setEditError(null) }

  const saveEdit = async () => {
    if (!id || !editForm || !detail) return
    if (!editForm.name.trim()) { setEditError('Event name is required'); return }
    const headcount = parseInt(editForm.headcount)
    if (!headcount || headcount < 1) { setEditError('Headcount must be at least 1'); return }

    setSaving(true)
    setEditError(null)
    try {
      const token = await getToken()
      if (!token) return
      const updated = await updateEvent(token, id, {
        name: editForm.name.trim(),
        client_name: editForm.client_name.trim() || null,
        event_date: editForm.event_date || null,
        headcount,
        budget_mode: editForm.budget_mode,
        budget_ceiling: editForm.budget_mode === 'ceiling' && editForm.budget_ceiling
          ? parseFloat(editForm.budget_ceiling) : null
      })
      setDetail(prev => prev ? { ...prev, event: updated } : prev)
      setEditing(false)
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleAddDish = async () => {
    if (!id || !newDishName.trim()) return
    setAddingDish(true)
    try {
      const token = await getToken()
      if (!token) return
      const dish = await addDish(token, id, {
        name: newDishName.trim(),
        servings: newDishServings ? parseInt(newDishServings) : undefined
      })
      setDetail(prev => prev ? { ...prev, dishes: [...prev.dishes, dish as Dish] } : prev)
      setNewDishName('')
      setNewDishServings('')
      setShowAddDish(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add dish')
    } finally {
      setAddingDish(false)
    }
  }

  const handleRemoveDish = async (dishId: string) => {
    if (!id || !confirm('Remove this dish?')) return
    setRemovingDishId(dishId)
    try {
      const token = await getToken()
      if (!token) return
      await removeDish(token, id, dishId)
      setDetail(prev => prev ? { ...prev, dishes: prev.dishes.filter(d => d.id !== dishId) } : prev)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to remove dish')
    } finally {
      setRemovingDishId(null)
    }
  }

  const handleDelete = async () => {
    if (!id || !confirm('Delete this event? This cannot be undone.')) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await deleteEvent(token, id)
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0f172a' }}>
        <div className="text-sm" style={{ color: '#94a3b8' }}>Loading…</div>
      </div>
    )
  }

  if (error && !detail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0f172a' }}>
        <div className="text-center">
          <div className="text-white font-semibold mb-2">Something went wrong</div>
          <div className="text-sm mb-4" style={{ color: '#94a3b8' }}>{error}</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm" style={{ color: '#fbbf24' }}>← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0f172a' }}>
        <div className="text-white">Event not found</div>
      </div>
    )
  }

  const { event, dishes, ingredients, latestPlan } = detail
  const status = event.status
  const statusColor = STATUS_COLOR[status]

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <button onClick={() => navigate('/dashboard')} style={{ color: '#94a3b8' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white flex-1 truncate">{event.name}</span>
        {!editing && (
          <button onClick={startEdit} style={{ color: '#94a3b8' }} title="Edit event">
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        <button onClick={handleDelete} disabled={deleting} style={{ color: '#94a3b8' }} title="Delete event">
          <Trash2 className="w-4 h-4" />
        </button>
      </header>

      {error && (
        <div className="mx-4 mt-4 rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
          {error}
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Event details — view or edit mode */}
        {editing && editForm ? (
          <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #fbbf2440' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-white text-sm">Edit Event</span>
              <div className="flex gap-2">
                <button onClick={cancelEdit} style={{ color: '#94a3b8' }}><X className="w-4 h-4" /></button>
              </div>
            </div>
            {editError && (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>{editError}</div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Event Name *</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)}
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Client Name</label>
                <input
                  value={editForm.client_name}
                  onChange={e => setEditForm(f => f ? { ...f, client_name: e.target.value } : f)}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Event Date</label>
                <input
                  type="date" value={editForm.event_date}
                  onChange={e => setEditForm(f => f ? { ...f, event_date: e.target.value } : f)}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Headcount *</label>
                <input
                  type="number" min={1} value={editForm.headcount}
                  onChange={e => setEditForm(f => f ? { ...f, headcount: e.target.value } : f)}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Budget</label>
                <select
                  value={editForm.budget_mode}
                  onChange={e => setEditForm(f => f ? { ...f, budget_mode: e.target.value as 'calculate' | 'ceiling' } : f)}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                >
                  <option value="calculate">Calculate cost</option>
                  <option value="ceiling">Set ceiling</option>
                </select>
              </div>
            </div>
            {editForm.budget_mode === 'ceiling' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Budget Ceiling ($)</label>
                <input
                  type="number" min={0} step={0.01} value={editForm.budget_ceiling}
                  onChange={e => setEditForm(f => f ? { ...f, budget_ceiling: e.target.value } : f)}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                />
              </div>
            )}
            <button
              onClick={saveEdit} disabled={saving}
              className="w-full py-2.5 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </section>
        ) : (
          /* Status banner — view mode */
          <div className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: `1px solid ${statusColor}40` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: statusColor, backgroundColor: statusColor + '20' }}>
                {STATUS_LABEL[status]}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm" style={{ color: '#94a3b8' }}>
              {event.event_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" /> {event.headcount} guests
              </span>
              {event.client_name && <span>for {event.client_name}</span>}
              {event.budget_mode === 'ceiling' && event.budget_ceiling && (
                <span>${event.budget_ceiling} budget</span>
              )}
            </div>
          </div>
        )}

        {/* Primary action */}
        {!editing && status === 'planning' && (
          <Link
            to={`/events/${event.id}/shop`}
            className="block w-full text-center py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
          >
            Generate Shopping Plan →
          </Link>
        )}
        {!editing && status === 'shopping' && (
          <div className="space-y-2">
            <Link
              to={`/events/${event.id}/shop`}
              className="block w-full text-center py-3 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
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
              style={{ backgroundColor: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
            >
              Mark Shopping Complete
            </button>
          </div>
        )}
        {!editing && status === 'reconcile_needed' && (
          <div className="space-y-2">
            <Link
              to={`/events/${event.id}/reconcile`}
              className="block w-full text-center py-3 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
            >
              Begin Reconcile →
            </Link>
            <button
              onClick={async () => {
                const token = await getToken()
                if (!token) return
                await updateEvent(token, event.id, { status: 'shopping' })
                setDetail(prev => prev ? { ...prev, event: { ...prev.event, status: 'shopping' } } : prev)
              }}
              className="block w-full text-center py-2 rounded-xl text-xs"
              style={{ color: '#94a3b8' }}
            >
              ← Undo: back to shopping
            </button>
          </div>
        )}
        {!editing && status === 'complete' && (
          <Link
            to={`/events/${event.id}/reconcile`}
            className="block w-full text-center py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
          >
            View Report
          </Link>
        )}

        {/* Reconciliation summary (complete events) */}
        {status === 'complete' && reconcile?.summary && (
          <section className="rounded-xl p-4 space-y-2" style={{ backgroundColor: '#1e293b', border: '1px solid #22c55e40' }}>
            <div className="text-xs font-semibold mb-3" style={{ color: '#22c55e' }}>RECONCILIATION SUMMARY</div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Estimated</span>
              <span className="text-white">${reconcile.summary.estimatedTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Actual</span>
              <span className="text-white">${reconcile.summary.actualTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-2" style={{ borderTop: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8' }}>Variance</span>
              <span style={{ color: reconcile.summary.variance <= 0 ? '#22c55e' : '#ef4444' }}>
                ${Math.abs(reconcile.summary.variance).toFixed(2)} {reconcile.summary.variance <= 0 ? 'under' : 'over'} ({Math.abs(reconcile.summary.variancePct).toFixed(1)}%)
              </span>
            </div>
          </section>
        )}

        {/* Dishes */}
        <section className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#1e293b', borderBottom: dishes.length > 0 || showAddDish ? '1px solid #334155' : 'none' }}>
            <span className="font-semibold text-white text-sm">{dishes.length} {dishes.length === 1 ? 'Dish' : 'Dishes'}</span>
            <button
              onClick={() => setShowAddDish(p => !p)}
              className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
              style={{ color: '#fbbf24', backgroundColor: '#fbbf2420', border: '1px solid #fbbf2440' }}
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>

          {showAddDish && (
            <div className="px-4 py-3 flex gap-2" style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
              <input
                placeholder="Dish name"
                value={newDishName}
                onChange={e => setNewDishName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddDish()}
                className="flex-1 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                autoFocus
              />
              <input
                placeholder="Servings"
                type="number" min={1}
                value={newDishServings}
                onChange={e => setNewDishServings(e.target.value)}
                className="w-20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
              <button
                onClick={handleAddDish}
                disabled={addingDish || !newDishName.trim()}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#fbbf24', color: '#0f172a', opacity: !newDishName.trim() ? 0.5 : 1 }}
              >
                {addingDish ? '…' : <Check className="w-4 h-4" />}
              </button>
              <button onClick={() => { setShowAddDish(false); setNewDishName(''); setNewDishServings('') }} style={{ color: '#94a3b8' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {dishes.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}>No dishes added.</div>
          ) : (
            dishes.map((dish, i) => (
              <div
                key={dish.id}
                className="px-4 py-3 flex items-center justify-between text-sm"
                style={{
                  backgroundColor: '#1e293b',
                  borderBottom: i < dishes.length - 1 ? '1px solid #334155' : 'none',
                  color: '#cbd5e1'
                }}
              >
                <div>
                  <span className="font-medium">{dish.name}</span>
                  {dish.servings && <span className="ml-2" style={{ color: '#94a3b8' }}>· {dish.servings} servings</span>}
                </div>
                <button
                  onClick={() => handleRemoveDish(dish.id)}
                  disabled={removingDishId === dish.id}
                  style={{ color: '#94a3b8' }}
                  className="hover:text-red-400 transition-colors ml-3"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </section>

        {/* Ingredient pool */}
        {ingredients.length > 0 && (
          <section className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
            <button
              onClick={() => setShowIngredients(p => !p)}
              className="w-full px-4 py-3 flex items-center justify-between"
              style={{ backgroundColor: '#1e293b' }}
            >
              <span className="font-semibold text-white text-sm">{ingredients.length} Ingredients (scaled)</span>
              {showIngredients ? <ChevronUp className="w-4 h-4" style={{ color: '#94a3b8' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#94a3b8' }} />}
            </button>
            {showIngredients && ingredients.map((ing, i) => (
              <div
                key={ing.id}
                className="px-4 py-2.5 flex items-center justify-between text-sm"
                style={{ backgroundColor: '#1e293b', borderTop: '1px solid #334155', color: '#cbd5e1' }}
              >
                <span>{ing.clarifiedName ?? ing.name}</span>
                <span style={{ color: '#94a3b8' }}>{ing.quantity} {ing.unit}</span>
              </div>
            ))}
          </section>
        )}

        {latestPlan && (
          <p className="text-xs text-center" style={{ color: '#94a3b8' }}>
            Last plan generated {new Date(latestPlan.generated_at).toLocaleDateString()}
            {latestPlan.model_used && ` · ${latestPlan.model_used}`}
          </p>
        )}
      </main>
    </div>
  )
}
