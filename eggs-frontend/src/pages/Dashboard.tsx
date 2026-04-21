import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, useUser, UserButton } from '@clerk/clerk-react'
import {
  Plus, ChevronRight, Calendar, Users, DollarSign,
  Search, X, ShoppingCart, ListChecks, TrendingUp,
  Store, Zap, BarChart2
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { listEvents, listShoppingPlans, getMe } from '../lib/api'
import { getPlanTotal } from '../lib/planTotals'
import type { EggsEvent, UserProfile, ShoppingPlanRecord } from '../types'
import { getPlanTotal } from '../lib/planTotals'

// ─── Tier badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'pro') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#fbbf2420', color: '#fbbf24', border: '1px solid #fbbf2440' }}>
      <Zap className="w-2.5 h-2.5" /> PRO
    </span>
  )
  if (tier === 'team') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#60a5fa20', color: '#60a5fa', border: '1px solid #60a5fa40' }}>
      <Zap className="w-2.5 h-2.5" /> TEAM
    </span>
  )
  return (
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#94a3b820', color: '#94a3b8', border: '1px solid #94a3b840' }}>
      FREE
    </span>
  )
}

// ─── Event helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<EggsEvent['status'], { label: string; color: string }> = {
  planning:          { label: 'Draft',             color: '#94a3b8' },
  shopping:          { label: 'Shopping',          color: '#fbbf24' },
  reconcile_needed:  { label: 'Reconcile Needed',  color: '#f97316' },
  complete:          { label: 'Complete',           color: '#22c55e' }
}

function StatusPill({ status }: { status: EggsEvent['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
      style={{ color: cfg.color, backgroundColor: cfg.color + '20', border: `1px solid ${cfg.color}40` }}>
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
    <div className="rounded-xl p-4 cursor-pointer transition-colors hover:border-amber-500/40"
      style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
      onClick={() => navigate(`/events/${event.id}`)}>
      <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{event.name}</div>
          {event.client_name && (
            <div className="text-xs mt-0.5 truncate" style={{ color: '#94a3b8' }}>for {event.client_name}</div>
          )}
        </div>
        <StatusPill status={event.status} />
      </div>
      <div className="flex items-center gap-4 text-xs mb-4 flex-wrap" style={{ color: '#94a3b8' }}>
        {event.event_date && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 shrink-0" />
            {new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3 shrink-0" />
          {event.headcount} guests
        </span>
        {event.budget_ceiling && (
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3 shrink-0" />
            ${event.budget_ceiling} budget
          </span>
        )}
      </div>
      <button
        onClick={e => { e.stopPropagation(); navigate(actionPath[event.status]) }}
        className="w-full text-sm font-semibold py-2 rounded-lg transition-colors"
        style={{ backgroundColor: '#fbbf2420', color: '#fbbf24', border: '1px solid #fbbf2440' }}>
        {actionLabel[event.status]}
      </button>
    </div>
  )
}

// ─── Shopping plan card ───────────────────────────────────────────────────────

function PlanCard({ record }: { record: ShoppingPlanRecord }) {
  const navigate = useNavigate()
  const plan = record.plan_data
  const preview = plan.ingredients.slice(0, 3).map(i => i.name).join(', ')
  const more = plan.ingredients.length > 3 ? ` +${plan.ingredients.length - 3} more` : ''
  const liveCount = plan.summary.realPriceCount
  const totalItems = plan.summary.realPriceCount + plan.summary.estimatedPriceCount

  return (
    <div className="rounded-xl p-4 cursor-pointer transition-colors hover:border-amber-500/40"
      style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
      onClick={() => navigate('/plan')}>
      <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm truncate">
            {preview}{more}
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
            {new Date(record.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' · '}{plan.stores.length} store{plan.stores.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-amber-400">${getPlanTotal(record).toFixed(2)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
            {liveCount}/{totalItems} live
          </div>
        </div>
      </div>
      {plan.summary.narrative && (
        <p className="text-xs mt-2 line-clamp-2" style={{ color: '#64748b' }}>{plan.summary.narrative}</p>
      )}
    </div>
  )
}

// ─── Insight widgets ──────────────────────────────────────────────────────────

const CHART_COLORS = ['#fbbf24', '#f97316', '#34d399', '#60a5fa', '#a78bfa', '#f472b6']

function StatChip({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string; sub?: string
}) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3"
      style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#fbbf2415', border: '1px solid #fbbf2430' }}>
        <Icon className="w-4 h-4" style={{ color: '#fbbf24' }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: '#94a3b8' }}>{label}</div>
        <div className="font-bold text-white text-lg leading-tight">{value}</div>
        {sub && <div className="text-[10px]" style={{ color: '#64748b' }}>{sub}</div>}
      </div>
    </div>
  )
}

function SpendByStoreChart({ plans }: { plans: ShoppingPlanRecord[] }) {
  const data = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const rec of plans) {
      for (const store of rec.plan_data.stores) {
        const banner = store.storeBanner || store.storeName
        totals[banner] = (totals[banner] ?? 0) + store.subtotal
      }
    }
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [plans])

  if (data.length === 0) return null

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
      <div className="flex items-center gap-2 mb-4">
        <Store className="w-4 h-4" style={{ color: '#fbbf24' }} />
        <span className="text-sm font-semibold text-white">Spend by Store</span>
      </div>
      <div className="flex gap-4 items-center">
        <div className="w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={28} outerRadius={44}
                paddingAngle={3} dataKey="value" stroke="none">
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, 'Estimated']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {data.map((entry, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-slate-400 truncate">{entry.name}</span>
              </div>
              <span className="text-slate-300 font-mono shrink-0">${entry.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonthlyActivityChart({ plans, events }: { plans: ShoppingPlanRecord[]; events: EggsEvent[] }) {
  const data = useMemo(() => {
    const months: Record<string, { lists: number; spend: number }> = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = d.toISOString().slice(0, 7)
      months[key] = { lists: 0, spend: 0 }
    }
    for (const rec of plans) {
      const key = rec.generated_at.slice(0, 7)
      if (months[key]) {
        months[key].lists++
        months[key].spend += getPlanTotal(rec)
      }
    }
    return Object.entries(months).map(([key, v]) => ({
      month: new Date(key + '-01').toLocaleDateString('en-US', { month: 'short' }),
      lists: v.lists,
      spend: Math.round(v.spend)
    }))
  }, [plans, events])

  const hasAny = data.some(d => d.lists > 0)
  if (!hasAny) return null

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="w-4 h-4" style={{ color: '#fbbf24' }} />
        <span className="text-sm font-semibold text-white">Lists Run · Last 6 Months</span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={16}>
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={20} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
              formatter={(v: number, name: string) => [name === 'lists' ? `${v} list${v !== 1 ? 's' : ''}` : `$${v}`, name === 'lists' ? 'Searches' : 'Est. Spend']}
            />
            <Bar dataKey="lists" fill="#fbbf24" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Free tier usage bar ──────────────────────────────────────────────────────

function FreeTierBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min((used / limit) * 100, 100)
  const over = used >= limit
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-white">Free Plan · {used}/{limit} this month</span>
        <Link to="/settings"
          className="text-xs font-semibold px-3 py-1 rounded-full transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 14px rgba(251,191,36,0.35)' }}>
          Upgrade to Pro
        </Link>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#334155' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: over ? '#ef4444' : '#fbbf24' }} />
      </div>
      {over && (
        <p className="text-xs mt-2" style={{ color: '#f87171' }}>
          Limit reached — upgrade to keep shopping.
        </p>
      )}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [events, setEvents] = useState<EggsEvent[]>([])
  const [plans, setPlans] = useState<ShoppingPlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAllPast, setShowAllPast] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const token = await getToken()
      if (!token) return
      const [profileData, eventsData, plansData] = await Promise.all([
        getMe(token).catch(() => null),
        listEvents(token).catch(() => ({ events: [] as EggsEvent[] })),
        listShoppingPlans(token).catch(() => ({ plans: [] as ShoppingPlanRecord[] }))
      ])
      if (cancelled) return
      setProfile(profileData)
      setEvents(eventsData.events ?? [])
      setPlans(plansData.plans ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [getToken])

  const q = search.toLowerCase().trim()
  const filteredEvents = q
    ? events.filter(e => e.name.toLowerCase().includes(q) || (e.client_name ?? '').toLowerCase().includes(q))
    : events
  const filteredPlans = q
    ? plans.filter(p => p.plan_data.ingredients.some(i => i.name.toLowerCase().includes(q)))
    : plans

  const activeEvents = filteredEvents.filter(e => e.status !== 'complete')
  const pastEvents = filteredEvents.filter(e => e.status === 'complete')

  const isPro = profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'team' as string
  const FREE_LIMIT = 3
  const currentMonth = new Date().toISOString().slice(0, 7)
  const usageThisMonth = events.filter(e => e.created_at.startsWith(currentMonth)).length

  // Insight computations
  const totalTracked = plans.reduce((s, p) => s + getPlanTotal(p), 0)
  const uniqueStores = new Set(plans.flatMap(p => p.plan_data.stores.map(s => s.storeBanner || s.storeName))).size
  const totalItems = plans.reduce((s, p) => s + p.plan_data.ingredients.length, 0)
  const hasInsights = plans.length > 0 || events.length > 0

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0f172a' }}>

      {/* Header — responsive, nothing clips */}
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
        style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
        <span className="text-lg font-bold shrink-0" style={{ color: '#fbbf24' }}>E.G.G.S.</span>
        {profile && <TierBadge tier={profile.subscription_tier} />}
        <div className="flex-1" />
        <Link to="/settings" className="text-xs shrink-0" style={{ color: '#94a3b8' }}>Settings</Link>
        <div className="shrink-0">
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-white">
            Hey{profile?.display_name ? `, ${profile.display_name}` : ''} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            {loading ? 'Loading your dashboard…'
              : activeEvents.length > 0
                ? `${activeEvents.length} active event${activeEvents.length !== 1 ? 's' : ''} · ${plans.length} shopping list${plans.length !== 1 ? 's' : ''} run`
                : plans.length > 0
                  ? `${plans.length} shopping list${plans.length !== 1 ? 's' : ''} run — no active events.`
                  : 'Welcome to E.G.G.S. — start with a shopping list or a new event.'}
          </p>
        </div>

        {/* Free tier bar — only for free users */}
        {!isPro && !loading && (
          <FreeTierBar used={usageThisMonth} limit={FREE_LIMIT} />
        )}

        {/* Quick actions 2×2 */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/plan')}
            className="flex flex-col items-start gap-2 p-4 rounded-xl font-semibold text-sm text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ backgroundColor: '#fbbf24', color: '#0f172a', boxShadow: '0 0 24px rgba(251,191,36,0.3)' }}>
            <ShoppingCart className="w-5 h-5" />
            <span>New Shopping List</span>
          </button>

          <button
            onClick={() => navigate('/events/new')}
            className="flex flex-col items-start gap-2 p-4 rounded-xl font-semibold text-sm text-left transition-all hover:scale-[1.02] active:scale-[0.98] hover:border-amber-500/40"
            style={{ backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155' }}>
            <Calendar className="w-5 h-5 text-amber-400" />
            <span>New Event</span>
          </button>

          <button
            onClick={() => { document.getElementById('lists-section')?.scrollIntoView({ behavior: 'smooth' }) }}
            className="flex flex-col items-start gap-2 p-4 rounded-xl font-semibold text-sm text-left transition-all hover:scale-[1.02] active:scale-[0.98] hover:border-amber-500/40"
            style={{ backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155' }}>
            <ListChecks className="w-5 h-5 text-amber-400" />
            <span>Shopping Lists</span>
          </button>

          <button
            onClick={() => { document.getElementById('events-section')?.scrollIntoView({ behavior: 'smooth' }) }}
            className="flex flex-col items-start gap-2 p-4 rounded-xl font-semibold text-sm text-left transition-all hover:scale-[1.02] active:scale-[0.98] hover:border-amber-500/40"
            style={{ backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155' }}>
            <Calendar className="w-5 h-5 text-amber-400" />
            <span>Events</span>
          </button>
        </div>

        {/* Search — filters both sections */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#94a3b8' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events & shopping lists…"
            className="w-full rounded-xl pl-9 pr-8 py-3 text-sm text-white focus:outline-none"
            style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Insights — hidden until there's data */}
        {!loading && hasInsights && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatChip icon={DollarSign} label="Est. Tracked" value={`$${totalTracked < 1000 ? totalTracked.toFixed(0) : (totalTracked / 1000).toFixed(1) + 'k'}`} sub="across all lists" />
              <StatChip icon={Store} label="Stores Found" value={String(uniqueStores)} sub="unique banners" />
              <StatChip icon={TrendingUp} label="Items Priced" value={String(totalItems)} sub="total ingredients" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SpendByStoreChart plans={plans} />
              <MonthlyActivityChart plans={plans} events={events} />
            </div>
          </>
        )}

        {/* Shopping lists section */}
        <section id="lists-section">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>SHOPPING LISTS</h2>
            <button
              onClick={() => navigate('/plan')}
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: '#fbbf24' }}>
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8" style={{ color: '#94a3b8' }}>Loading…</div>
          ) : filteredPlans.length > 0 ? (
            <div className="space-y-3">
              {filteredPlans.slice(0, 5).map(p => <PlanCard key={p.id} record={p} />)}
              {filteredPlans.length > 5 && (
                <p className="text-xs text-center" style={{ color: '#64748b' }}>
                  + {filteredPlans.length - 5} more lists
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-8 text-center" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
              <div className="text-3xl mb-3">🛒</div>
              <div className="text-white font-semibold mb-1">No shopping lists yet</div>
              <div className="text-sm mb-4" style={{ color: '#94a3b8' }}>
                Enter your grocery list and we'll find the best prices across every nearby store.
              </div>
              <button onClick={() => navigate('/plan')}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ backgroundColor: '#fbbf2420', color: '#fbbf24', border: '1px solid #fbbf2440' }}>
                Start a Shopping List →
              </button>
            </div>
          )}
        </section>

        {/* Active events section */}
        <section id="events-section">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>ACTIVE EVENTS</h2>
            <button
              onClick={() => navigate('/events/new')}
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: '#fbbf24' }}>
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8" style={{ color: '#94a3b8' }}>Loading…</div>
          ) : activeEvents.length > 0 ? (
            <div className="space-y-3">
              {activeEvents.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          ) : (
            <div className="rounded-xl p-8 text-center" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>
              <div className="text-3xl mb-3">🍳</div>
              <div className="text-white font-semibold mb-1">No active events</div>
              <div className="text-sm mb-4" style={{ color: '#94a3b8' }}>
                Events are great for catering gigs — plan dishes, scale recipes, and optimize ingredient costs.
              </div>
              <button onClick={() => navigate('/events/new')}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ backgroundColor: '#fbbf2420', color: '#fbbf24', border: '1px solid #fbbf2440' }}>
                Create an Event →
              </button>
            </div>
          )}
        </section>

        {/* Past events */}
        {pastEvents.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>PAST EVENTS</h2>
              {pastEvents.length > 5 && (
                <button onClick={() => setShowAllPast(p => !p)} className="text-xs" style={{ color: '#fbbf24' }}>
                  {showAllPast ? 'Show less' : `Show all ${pastEvents.length}`}
                </button>
              )}
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #334155' }}>
              {(showAllPast ? pastEvents : pastEvents.slice(0, 5)).map((e, i, arr) => (
                <Link key={e.id} to={`/events/${e.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                  style={{ borderBottom: i < arr.length - 1 ? '1px solid #334155' : 'none', backgroundColor: '#1e293b' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{e.name}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: '#94a3b8' }}>
                      {e.client_name && `${e.client_name} · `}
                      {e.event_date
                        ? new Date(e.event_date + 'T00:00:00').toLocaleDateString()
                        : `Created ${new Date(e.created_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0 ml-2" style={{ color: '#94a3b8' }} />
                </Link>
              ))}
            </div>
          </section>
        )}

      </main>
    </div>
  )
}
