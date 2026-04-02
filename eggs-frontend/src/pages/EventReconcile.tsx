import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, CheckCircle } from 'lucide-react'
import { getEvent, saveReconcile } from '../lib/api'
import type { EggsEvent, EventDetail } from '../types'

export default function EventReconcile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode] = useState<'receipt'>('receipt') // Pro: 'detailed'
  const [receiptTotals, setReceiptTotals] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<{
    estimatedTotal: number; actualTotal: number; variance: number; variancePct: number
  } | null>(null)

  useEffect(() => {
    if (!id) return
    getToken().then(token => {
      if (!token) return
      return getEvent(token, id)
    }).then(d => {
      if (d) setDetail(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id, getToken])

  const plan = null // Would load from detail.latestPlan in full impl

  // Derive stores from the latest plan if available
  const storeNames: string[] = detail?.latestPlan ? ['Store 1', 'Store 2'] : []

  const estimatedTotal = Object.values(receiptTotals).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !detail?.latestPlan) return
    setSaving(true)

    const token = await getToken()
    if (!token) { setSaving(false); return }

    try {
      const totals = Object.entries(receiptTotals)
        .filter(([, v]) => v)
        .map(([storeName, receiptTotal]) => ({ storeName, receiptTotal: parseFloat(receiptTotal) }))

      const result = await saveReconcile(token, id, {
        shoppingPlanId: detail.latestPlan.id,
        mode: 'receipt',
        receiptTotals: totals
      })

      if (result.summary) setSummary(result.summary)
      // Redirect to event detail after short delay
      setTimeout(() => navigate(`/events/${id}`), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
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

  if (summary) {
    const pos = summary.variance <= 0
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0d1117' }}>
        <div className="max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-4" style={{ color: '#22c55e' }} />
          <h2 className="text-2xl font-bold text-white mb-2">Event Complete!</h2>
          <div className="rounded-xl p-5 text-left space-y-3 mt-6" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#8b949e' }}>Estimated</span>
              <span className="text-white">${summary.estimatedTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#8b949e' }}>Actual</span>
              <span className="text-white">${summary.actualTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t pt-3" style={{ borderColor: '#30363d' }}>
              <span style={{ color: '#8b949e' }}>Variance</span>
              <span style={{ color: pos ? '#22c55e' : '#ef4444' }}>
                {pos ? '-' : '+'}${Math.abs(summary.variance).toFixed(2)} ({Math.abs(summary.variancePct).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0d1117' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0d1117', borderBottom: '1px solid #30363d' }}>
        <button onClick={() => navigate(`/events/${id}`)} style={{ color: '#8b949e' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white">Reconcile: {detail.event.name}</span>
      </header>

      <form onSubmit={handleSave} className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="rounded-xl p-4" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
          <p className="text-sm text-white font-medium mb-1">Receipt Totals Mode</p>
          <p className="text-xs" style={{ color: '#8b949e' }}>Enter what you actually paid at each store.</p>
        </div>

        {detail.latestPlan ? (
          <>
            {/* We'd iterate over stores from the plan — using placeholder for now */}
            {['Store totals'].map((label, i) => (
              <div key={i} className="rounded-xl p-4" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
                <label className="block text-sm font-medium text-white mb-2">{label}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white">$</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={receiptTotals[label] ?? ''}
                    onChange={e => setReceiptTotals(prev => ({ ...prev, [label]: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg pl-6 pr-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}
                  />
                </div>
              </div>
            ))}

            {/* Live summary */}
            <div className="rounded-xl p-4" style={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#8b949e' }}>Actual total entered</span>
                <span className="font-bold text-white">${estimatedTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              type="submit" disabled={saving || estimatedTotal === 0}
              className="w-full py-4 rounded-xl font-bold text-sm transition-opacity"
              style={{ backgroundColor: '#f59e0b', color: '#0d1117', opacity: (saving || estimatedTotal === 0) ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : 'Save & Complete Event'}
            </button>
          </>
        ) : (
          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
            <p className="text-white font-medium">No shopping plan found</p>
            <p className="text-sm mt-1" style={{ color: '#8b949e' }}>Generate a shopping plan first.</p>
            <button
              type="button"
              onClick={() => navigate(`/events/${id}/shop`)}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
            >
              Generate Plan
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
