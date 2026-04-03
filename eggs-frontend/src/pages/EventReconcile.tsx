import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ChevronLeft, CheckCircle } from 'lucide-react'
import { getEvent, saveReconcile } from '../lib/api'
import { ApiError } from '../lib/api'
import type { EventDetail } from '../types'

export default function EventReconcile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
    }).catch(e => {
      setError(e instanceof ApiError ? e.message : 'Failed to load event')
      setLoading(false)
    })
  }, [id, getToken])

  // Derive store names from the actual plan data
  const storeNames: string[] = detail?.latestPlan?.plan_data?.stores?.map(s => s.storeName) ?? []
  const estimatedByStore: Record<string, number> = {}
  detail?.latestPlan?.plan_data?.stores?.forEach(s => {
    estimatedByStore[s.storeName] = s.grandTotal
  })
  const estimatedTotal = detail?.latestPlan?.plan_data?.summary?.total ?? 0

  const actualTotal = Object.values(receiptTotals).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const variance = actualTotal - estimatedTotal
  const variancePct = estimatedTotal > 0 ? (variance / estimatedTotal) * 100 : 0

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !detail?.latestPlan) return
    setSaving(true)
    setError(null)

    const token = await getToken()
    if (!token) { setSaving(false); return }

    try {
      const totals = storeNames
        .filter(name => receiptTotals[name])
        .map(name => ({ storeName: name, receiptTotal: parseFloat(receiptTotals[name]) }))

      const result = await saveReconcile(token, id, {
        shoppingPlanId: detail.latestPlan!.id,
        mode: 'receipt',
        receiptTotals: totals
      })

      if (result.summary) setSummary(result.summary)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save reconciliation')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0f172a' }}>
        <div className="text-sm" style={{ color: '#94a3b8' }}>Loading…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0f172a' }}>
        <div className="text-center">
          <div className="text-white font-semibold mb-2">{error ?? 'Event not found'}</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm" style={{ color: '#fbbf24' }}>← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (summary) {
    const pos = summary.variance <= 0
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
        <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
          <button onClick={() => navigate(`/events/${id}`)} style={{ color: '#94a3b8' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-white">Event Complete</span>
        </header>
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-4" style={{ color: '#22c55e' }} />
          <h2 className="text-2xl font-bold text-white mb-2">Event Complete!</h2>
          <p className="text-sm mb-6" style={{ color: '#94a3b8' }}>{detail.event.name}</p>
          <div className="rounded-xl p-5 text-left space-y-3" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Estimated</span>
              <span className="text-white">${summary.estimatedTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Actual</span>
              <span className="text-white">${summary.actualTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t pt-3" style={{ borderColor: '#334155' }}>
              <span style={{ color: '#94a3b8' }}>Variance</span>
              <span style={{ color: pos ? '#22c55e' : '#ef4444' }}>
                ${Math.abs(summary.variance).toFixed(2)} {pos ? 'under' : 'over'} ({Math.abs(summary.variancePct).toFixed(1)}%)
              </span>
            </div>
          </div>
          <button
            onClick={() => navigate(`/events/${id}`)}
            className="mt-6 w-full py-3 rounded-xl font-bold text-sm"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
          >
            Back to Event
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <button onClick={() => navigate(`/events/${id}`)} style={{ color: '#94a3b8' }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold text-white truncate">Reconcile: {detail.event.name}</span>
      </header>

      <form onSubmit={handleSave} className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {error && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
            {error}
          </div>
        )}

        <div className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
          <p className="text-sm text-white font-medium mb-1">Enter receipt totals</p>
          <p className="text-xs" style={{ color: '#94a3b8' }}>Enter what you actually paid at each store.</p>
        </div>

        {detail.latestPlan ? (
          <>
            {storeNames.length > 0 ? storeNames.map(storeName => (
              <div key={storeName} className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-white">{storeName}</label>
                  {estimatedByStore[storeName] && (
                    <span className="text-xs" style={{ color: '#94a3b8' }}>
                      Est. ${estimatedByStore[storeName].toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-sm">$</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={receiptTotals[storeName] ?? ''}
                    onChange={e => setReceiptTotals(prev => ({ ...prev, [storeName]: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg pl-6 pr-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                  />
                </div>
                {receiptTotals[storeName] && estimatedByStore[storeName] && (
                  <div className="mt-2 text-xs" style={{
                    color: parseFloat(receiptTotals[storeName]) <= estimatedByStore[storeName] ? '#22c55e' : '#f87171'
                  }}>
                    {parseFloat(receiptTotals[storeName]) <= estimatedByStore[storeName]
                      ? `$${(estimatedByStore[storeName] - parseFloat(receiptTotals[storeName])).toFixed(2)} under estimate`
                      : `$${(parseFloat(receiptTotals[storeName]) - estimatedByStore[storeName]).toFixed(2)} over estimate`
                    }
                  </div>
                )}
              </div>
            )) : (
              <div className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
                <label className="block text-sm font-medium text-white mb-2">Total spent</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-sm">$</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={receiptTotals['total'] ?? ''}
                    onChange={e => setReceiptTotals({ total: e.target.value })}
                    placeholder="0.00"
                    className="w-full rounded-lg pl-6 pr-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                  />
                </div>
              </div>
            )}

            {/* Live summary */}
            <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#94a3b8' }}>Estimated total</span>
                <span className="text-white">${estimatedTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#94a3b8' }}>Actual total entered</span>
                <span className="font-bold text-white">${actualTotal.toFixed(2)}</span>
              </div>
              {actualTotal > 0 && (
                <div className="flex justify-between text-sm font-bold pt-2" style={{ borderTop: '1px solid #334155' }}>
                  <span style={{ color: '#94a3b8' }}>Variance</span>
                  <span style={{ color: variance <= 0 ? '#22c55e' : '#ef4444' }}>
                    {variance <= 0 ? '-' : '+'}${Math.abs(variance).toFixed(2)} ({Math.abs(variancePct).toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit" disabled={saving || actualTotal === 0}
              className="w-full py-4 rounded-xl font-bold text-sm transition-opacity"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)', opacity: (saving || actualTotal === 0) ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : 'Save & Complete Event'}
            </button>
          </>
        ) : (
          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <p className="text-white font-medium">No shopping plan found</p>
            <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>Generate a shopping plan first.</p>
            <button
              type="button"
              onClick={() => navigate(`/events/${id}/shop`)}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
            >
              Generate Plan
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
