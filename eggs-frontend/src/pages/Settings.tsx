import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, UserButton } from '@clerk/clerk-react'
import { ChevronLeft, X, Save } from 'lucide-react'
import { getMe, updateMe } from '../lib/api'
import type { UserProfile } from '../types'

export default function Settings() {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState(10)
  const [maxStores, setMaxStores] = useState(3)
  const [avoidStoreInput, setAvoidStoreInput] = useState('')
  const [avoidStores, setAvoidStores] = useState<string[]>([])
  const [avoidBrandInput, setAvoidBrandInput] = useState('')
  const [avoidBrands, setAvoidBrands] = useState<string[]>([])

  useEffect(() => {
    getToken().then(token => {
      if (!token) return
      return getMe(token)
    }).then(p => {
      if (!p) return
      setProfile(p)
      setDisplayName(p.display_name ?? '')
      setLocation(p.default_location_label ?? '')
      setRadius((p.default_settings?.radiusMiles as number) ?? 10)
      setMaxStores((p.default_settings?.maxStores as number) ?? 3)
      setAvoidStores(p.avoid_stores ?? [])
      setAvoidBrands(p.avoid_brands ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [getToken])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const token = await getToken()
    if (!token) { setSaving(false); return }
    try {
      await updateMe(token, {
        display_name: displayName,
        default_location_label: location || undefined,
        default_settings: { radiusMiles: radius, maxStores },
        avoid_stores: avoidStores,
        avoid_brands: avoidBrands
      } as Parameters<typeof updateMe>[1])
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} style={{ color: '#94a3b8' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-white">Settings</span>
        </div>
        <UserButton afterSignOutUrl="/sign-in" />
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20" style={{ color: '#94a3b8' }}>Loading…</div>
      ) : (
        <form onSubmit={handleSave} className="max-w-lg mx-auto px-4 py-6 space-y-5">
          {/* Account */}
          <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <h2 className="font-semibold text-white text-sm">Account</h2>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Display Name</label>
              <input
                type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>
            {profile && (
              <div>
                <span className="text-xs" style={{ color: '#94a3b8' }}>Tier: </span>
                <span className="text-xs font-semibold" style={{ color: profile.subscription_tier === 'pro' ? '#22c55e' : '#fbbf24' }}>
                  {profile.subscription_tier === 'pro' ? 'Pro' : 'Free'}
                </span>
                {profile.subscription_tier === 'free' && (
                  <button type="button" onClick={() => alert('Pro subscriptions coming soon!')} className="ml-3 text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}>
                    Upgrade to Pro
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Location & Defaults */}
          <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <h2 className="font-semibold text-white text-sm">Shopping Defaults</h2>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Default Location</label>
              <input
                type="text" value={location} onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Dallas, TX"
                className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
              />
            </div>
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
          </section>

          {/* Avoid lists */}
          <section className="rounded-xl p-5 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <h2 className="font-semibold text-white text-sm">Preferences</h2>
            {([
              { label: 'Avoid Stores', input: avoidStoreInput, setInput: setAvoidStoreInput, list: avoidStores, setList: setAvoidStores },
              { label: 'Avoid Brands', input: avoidBrandInput, setInput: setAvoidBrandInput, list: avoidBrands, setList: setAvoidBrands }
            ] as const).map(({ label, input, setInput, list, setList }) => (
              <div key={label}>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>{label}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text" value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (input.trim()) { setList(p => [...p, input.trim()]); setInput('') }
                      }
                    }}
                    placeholder="Type and press Enter"
                    className="flex-1 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {list.map((item, i) => (
                    <span key={i}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                      style={{ backgroundColor: '#1f0000', color: '#f87171', border: '1px solid #450a0a' }}>
                      {item}
                      <button type="button" onClick={() => setList(p => p.filter((_, j) => j !== i))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <button
            type="submit" disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity"
            style={{ backgroundColor: saved ? '#22c55e' : '#fbbf24', color: '#0f172a', opacity: saving ? 0.7 : 1 }}
          >
            <Save className="w-4 h-4" />
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </button>
        </form>
      )}
    </div>
  )
}
