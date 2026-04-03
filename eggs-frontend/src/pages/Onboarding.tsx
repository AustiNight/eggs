import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useUser } from '@clerk/clerk-react'
import { MapPin, ChevronRight } from 'lucide-react'
import { syncUser, updateMe } from '../lib/api'

export default function Onboarding() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { user } = useUser()

  const [displayName, setDisplayName] = useState(
    user?.fullName ?? user?.firstName ?? ''
  )
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState(10)
  const [maxStores, setMaxStores] = useState(3)
  const [avoidStore, setAvoidStore] = useState('')
  const [avoidStores, setAvoidStores] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) return

      // Sync user record first (creates row if first login)
      await syncUser(token, user?.primaryEmailAddress?.emailAddress ?? '', displayName)

      // Save onboarding preferences
      await updateMe(token, {
        display_name: displayName,
        default_location_label: location || undefined,
        default_settings: { radiusMiles: radius, maxStores },
        avoid_stores: avoidStores
      } as Parameters<typeof updateMe>[1])

      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen px-4 py-12" style={{ backgroundColor: '#0f172a' }}>
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-10">
          <div className="text-4xl font-bold mb-2" style={{ color: '#fbbf24' }}>Welcome 👋</div>
          <p className="text-white text-lg font-semibold">Let's set up your chef profile</p>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>Takes 60 seconds. Used to find prices near you.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-xl p-6 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#94a3b8' }}>Your Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Margaret"
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#94a3b8' }}>
                <MapPin className="inline w-3 h-3 mr-1" />
                Your City or Address
              </label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Dallas, TX or 1234 Main St, Dallas TX"
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
              <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>Used as default location for all shopping plans</p>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#94a3b8' }}>
                Default Search Radius: <span style={{ color: '#fbbf24' }}>{radius} mi</span>
              </label>
              <input
                type="range" min={1} max={50} value={radius}
                onChange={e => setRadius(parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{ accentColor: '#fbbf24' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#94a3b8' }}>
                Default Max Stores: <span style={{ color: '#fbbf24' }}>{maxStores}</span>
              </label>
              <input
                type="range" min={1} max={5} value={maxStores}
                onChange={e => setMaxStores(parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{ accentColor: '#fbbf24' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#94a3b8' }}>Stores to Avoid (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={avoidStore}
                  onChange={e => setAvoidStore(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (avoidStore.trim()) {
                        setAvoidStores(prev => [...prev, avoidStore.trim()])
                        setAvoidStore('')
                      }
                    }
                  }}
                  placeholder="Store name… press Enter"
                  className="flex-1 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {avoidStores.map((s, i) => (
                  <span
                    key={i}
                    onClick={() => setAvoidStores(prev => prev.filter((_, j) => j !== i))}
                    className="text-xs px-2 py-1 rounded cursor-pointer"
                    style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}
                  >
                    {s} ×
                  </span>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : <>Get Started <ChevronRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>
    </div>
  )
}
