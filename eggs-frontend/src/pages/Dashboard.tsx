import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, useUser, UserButton } from '@clerk/clerk-react'
import { Plus, ChevronRight, Calendar, Users, DollarSign, Search, X } from 'lucide-react'
import { listEvents, getMe } from '../lib/api'
import type { EggsEvent, UserProfile } from '../types'

const STATUS_CONFIG: Record<EggsEvent['status'], { label: string; color: string }> = {
  planning:          { label: 'Draft',             color: '#94a3b8' },
  shopping:          { label: 'Shopping',           color: '#fbbf24' },
  reconcile_needed:  { label: 'Reconcile Needed',   color: '#fbbf24' },
  complete:          { label: 'Complete',           color: '#22c55e' }
}

function StatusPill({ status }: { status: EggsEvent['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, backgroundColor: cfg.color + '20', border: `1px solid ${cfg.color}40` }}
    >
      {cfg.label}
    </span>
  )
}

function EventCard({ event }: { event: EggsEvent }) {
  const navigate = useNavigate()
  const actionLabel: Record<EggsEvent['status'], string> = {
    planning:         'Generate Plan →',
    shopping:         'View Plan →',
    reconcile_needed: 'Reconcile →',
    complete:         'View Report →'
  }
  const actionPath: Record<EggsEvent['status'], string> = {
    planning:         `/events/${event.id}/shop`,
    shopping:         `/events/${event.id}`,
    reconcile_needed: `/events/${event.id}/reconcile`,
    complete:         `/events/${event.id}`
  }

  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-colors hover:border-amber-500/40"
      style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
      onClick={() => navigate(`/events/${event.id}`)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{event.name}</div>
          {event.client_name && (
            <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>for {event.client_name}</div>
          )}
        </div>
        <StatusPill status={event.status} />
      </div>

      <div className="flex items-center gap-4 text-xs mb-4" style={{ color: '#94a3b8' }}>
        {event.event_date && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {event.headcount} guests
        </span>
        {event.budget_ceiling && (
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            ${event.budget_ceiling} budget
          </span>
        )}
      </div>

      <button
        onClick={e => { e.stopPropagation(); navigate(actionPath[event.status]) }}
        className="w-full text-sm font-semibold py-2 rounded-lg transition-colors"
        style={{ backgroundColor: '#fbbf2420', color: '#fbbf24', border: '1px solid #fbbf2440' }}
      >
        {actionLabel[event.status]}
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [events, setEvents] = useState<EggsEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAllPast, setShowAllPast] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const token = await getToken()
      if (!token) return
      const [profileData, eventsData] = await Promise.all([
        getMe(token).catch(() => null),
        listEvents(token).catch(() => ({ events: [] }))
      ])
      if (cancelled) return
      setProfile(profileData)
      setEvents(eventsData.events ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [getToken])

  const q = search.toLowerCase().trim()
  const filtered = q
    ? events.filter(e => e.name.toLowerCase().includes(q) || (e.client_name ?? '').toLowerCase().includes(q))
    : events
  const upcoming = filtered.filter(e => e.status !== 'complete')
  const past = filtered.filter(e => e.status === 'complete')
  const FREE_LIMIT = 3
  const currentMonth = new Date().toISOString().slice(0, 7)
  const eventsThisMonth = events.filter(e => e.created_at.startsWith(currentMonth)).length
  const isPro = profile?.subscription_tier === 'pro'

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <span className="text-lg font-bold" style={{ color: '#fbbf24' }}>E.G.G.S.</span>
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-xs" style={{ color: '#94a3b8' }}>Settings</Link>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-white">
            Hey{profile?.display_name ? ` ${profile.display_name}` : ''} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            {upcoming.length === 0 ? "No upcoming events. Create one to get started." : `You have ${upcoming.length} upcoming event${upcoming.length !== 1 ? 's' : ''}.`}
          </p>
        </div>

        {/* Free tier usage */}
        {!isPro && (
          <div className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white">Free Tier Usage</span>
              <button
                onClick={() => alert('Pro subscriptions coming soon!')}
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
              >
                Upgrade to Pro
              </button>
            </div>
            <div className="space-y-2">
              {(['events'] as const).map(kind => (
                <div key={kind}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: '#94a3b8' }}>
                    <span>Events this month</span>
                    <span style={{ color: eventsThisMonth >= FREE_LIMIT ? '#ef4444' : '#fbbf24' }}>
                      {eventsThisMonth} / {FREE_LIMIT}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#334155' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((eventsThisMonth / FREE_LIMIT) * 100, 100)}%`,
                        backgroundColor: eventsThisMonth >= FREE_LIMIT ? '#ef4444' : '#fbbf24'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search + new event */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#94a3b8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search events…"
              className="w-full rounded-xl pl-9 pr-8 py-3 text-sm text-white focus:outline-none"
              style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => navigate('/events/new')}
            className="flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm whitespace-nowrap"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 18px rgba(251,191,36,0.45)' }}
          >
            <Plus className="w-4 h-4" /> New Event
          </button>
        </div>

        {/* Upcoming events */}
        {loading ? (
          <div className="text-center py-12" style={{ color: '#94a3b8' }}>Loading…</div>
        ) : upcoming.length > 0 ? (
          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: '#94a3b8' }}>UPCOMING EVENTS</h2>
            <div className="space-y-3">
              {upcoming.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          </section>
        ) : (
          <div className="rounded-xl p-8 text-center" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
            <div className="text-4xl mb-3">🍳</div>
            <div className="text-white font-semibold mb-1">No events yet</div>
            <div className="text-sm" style={{ color: '#94a3b8' }}>Create your first event to start planning</div>
          </div>
        )}

        {/* Past events */}
        {past.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>PAST EVENTS</h2>
              {past.length > 5 && (
                <button onClick={() => setShowAllPast(p => !p)} className="text-xs" style={{ color: '#fbbf24' }}>
                  {showAllPast ? 'Show less' : `Show all ${past.length}`}
                </button>
              )}
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
              {(showAllPast ? past : past.slice(0, 5)).map((e, i, arr) => (
                <Link
                  key={e.id}
                  to={`/events/${e.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                  style={{ borderBottom: i < arr.length - 1 ? '1px solid #334155' : 'none', backgroundColor: '#1e293b' }}
                >
                  <div>
                    <div className="text-sm font-medium text-white">{e.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
                      {e.client_name && `${e.client_name} · `}
                      {e.event_date ? new Date(e.event_date + 'T00:00:00').toLocaleDateString() : `Created ${new Date(e.created_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4" style={{ color: '#94a3b8' }} />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
