import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, useUser, UserButton } from '@clerk/clerk-react'
import { Plus, Zap, ChevronRight, Calendar, Users, DollarSign } from 'lucide-react'
import { listEvents, getMe } from '../lib/api'
import type { EggsEvent, UserProfile } from '../types'

const STATUS_CONFIG: Record<EggsEvent['status'], { label: string; color: string }> = {
  planning:          { label: 'Draft',             color: '#8b949e' },
  shopping:          { label: 'Shopping',           color: '#f59e0b' },
  reconcile_needed:  { label: 'Reconcile Needed',   color: '#f59e0b' },
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
      style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}
      onClick={() => navigate(`/events/${event.id}`)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{event.name}</div>
          {event.client_name && (
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>for {event.client_name}</div>
          )}
        </div>
        <StatusPill status={event.status} />
      </div>

      <div className="flex items-center gap-4 text-xs mb-4" style={{ color: '#8b949e' }}>
        {event.event_date && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
        style={{ backgroundColor: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b40' }}
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

  const upcoming = events.filter(e => e.status !== 'complete')
  const past = events.filter(e => e.status === 'complete')
  const FREE_LIMIT = 3
  const currentMonth = new Date().toISOString().slice(0, 7)
  const eventsThisMonth = events.filter(e => e.created_at.startsWith(currentMonth)).length
  const isPro = profile?.subscription_tier === 'pro'

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0d1117' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#0d1117', borderBottom: '1px solid #30363d' }}>
        <span className="text-lg font-bold" style={{ color: '#f59e0b' }}>E.G.G.S.</span>
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-xs" style={{ color: '#8b949e' }}>Settings</Link>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-white">
            Hey{profile?.display_name ? ` ${profile.display_name}` : ''} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8b949e' }}>
            {upcoming.length === 0 ? "No upcoming events. Create one to get started." : `You have ${upcoming.length} upcoming event${upcoming.length !== 1 ? 's' : ''}.`}
          </p>
        </div>

        {/* Free tier usage */}
        {!isPro && (
          <div className="rounded-xl p-4" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white">Free Tier Usage</span>
              <button
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
              >
                Upgrade to Pro
              </button>
            </div>
            <div className="space-y-2">
              {(['events', 'plans'] as const).map(kind => (
                <div key={kind}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: '#8b949e' }}>
                    <span>{kind === 'events' ? 'Events' : 'Shopping Plans'} this month</span>
                    <span style={{ color: eventsThisMonth >= FREE_LIMIT ? '#ef4444' : '#f59e0b' }}>
                      {eventsThisMonth} / {FREE_LIMIT}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#30363d' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((eventsThisMonth / FREE_LIMIT) * 100, 100)}%`,
                        backgroundColor: eventsThisMonth >= FREE_LIMIT ? '#ef4444' : '#f59e0b'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/events/new')}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm"
            style={{ backgroundColor: '#f59e0b', color: '#0d1117' }}
          >
            <Plus className="w-4 h-4" /> New Event
          </button>
        </div>

        {/* Upcoming events */}
        {loading ? (
          <div className="text-center py-12" style={{ color: '#8b949e' }}>Loading…</div>
        ) : upcoming.length > 0 ? (
          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: '#8b949e' }}>UPCOMING EVENTS</h2>
            <div className="space-y-3">
              {upcoming.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          </section>
        ) : (
          <div className="rounded-xl p-8 text-center" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
            <div className="text-4xl mb-3">🍳</div>
            <div className="text-white font-semibold mb-1">No events yet</div>
            <div className="text-sm" style={{ color: '#8b949e' }}>Create your first event to start planning</div>
          </div>
        )}

        {/* Past events */}
        {past.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: '#8b949e' }}>PAST EVENTS</h2>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #30363d' }}>
              {past.slice(0, 5).map((e, i) => (
                <Link
                  key={e.id}
                  to={`/events/${e.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                  style={{ borderBottom: i < Math.min(past.length, 5) - 1 ? '1px solid #30363d' : 'none', backgroundColor: '#161b22' }}
                >
                  <div>
                    <div className="text-sm font-medium text-white">{e.name}</div>
                    {e.event_date && (
                      <div className="text-xs" style={{ color: '#8b949e' }}>
                        {new Date(e.event_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4" style={{ color: '#8b949e' }} />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
