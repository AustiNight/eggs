import React, { useEffect, useState } from 'react'
import { Loader2, BrainCircuit, MapPin } from 'lucide-react'

export type PlanStatus = 'analyzing' | 'discovering' | 'searching' | 'optimizing'

interface LoadingStateProps {
  status: PlanStatus
}

// Per-phase scripted lines. These are intentionally long and reference the real
// pipeline (Kroger/Walmart APIs, Serper → Tavily → Firecrawl discovery, size
// resolution, grading, verification) so the terminal feels like live work.
const MESSAGES: Record<PlanStatus, string[]> = {
  analyzing: [
    'Reading shopping list...',
    'Tokenizing ingredient lines...',
    'Identifying ambiguous items...',
    'Checking for unit specifications...',
    'Normalizing quantities and units...',
    'Cross-referencing canonical package sizes...',
    'Detecting brand vs. generic preferences...',
    'Validating item categories...',
    'Merging duplicate ingredients...',
    'Preparing clarification questions...',
  ],
  discovering: [
    'Reading chef location...',
    'Locating stores within radius...',
    'Filtering avoided stores & brands...',
    'Connecting to Kroger API...',
    'Authenticating Walmart affiliate API...',
    'Mapping nearby retailers...',
    'Resolving store banners near you...',
    'Checking store coverage...',
    'Selecting candidate stores to compare...',
    'Locking in the store lineup...',
  ],
  searching: [
    'Launching parallel price search...',
    'Kroger API: querying live prices...',
    'Walmart API: querying live prices...',
    'Checking member / loyalty pricing...',
    'Serper: searching Google Shopping for matches...',
    'Tavily: resolving merchant product pages...',
    'Firecrawl: fetching retailer product pages...',
    'Verifying the price appears on the source page...',
    'Confirming product names match your items...',
    'Checking store-specific availability...',
    'Resolving package sizes (USDA FoodData Central)...',
    'Cross-referencing Open Food Facts...',
    'Grading candidate matches (exact / substitute)...',
    'Validating product links resolve...',
    'Tagging confidence: verified / online / estimate...',
    'Pulling prices from additional banners...',
    'Collecting all price data...',
  ],
  optimizing: [
    'Comparing prices across all sources...',
    'Computing price-per-unit for each item...',
    'Calculating estimated taxes...',
    'Selecting the best value per item...',
    'Applying brand & avoid rules...',
    'Building per-store item lists...',
    'Evaluating multi-store vs. single-store...',
    'Splitting your basket for max savings...',
    'Separating verified vs. estimated totals...',
    'Finalizing The Price of E.G.G.S....',
  ],
}

// Evergreen lines that cycle indefinitely once a phase's scripted lines run out,
// so the terminal keeps scrolling no matter how long the search takes.
const EVERGREEN: string[] = [
  'Still comparing live prices...',
  'Waiting on retailer responses...',
  'Verifying additional product pages...',
  'Double-checking package sizes...',
  'Reconciling prices across stores...',
  'Re-checking item availability...',
  'Confirming the best per-store split...',
  'Optimizing your basket...',
  'Tidying up the numbers...',
  'Almost there — finalizing matches...',
]

const TITLES: Record<PlanStatus, string> = {
  analyzing: 'Analyzing Requirements',
  discovering: 'Finding Nearby Stores',
  searching: 'Searching All Sources',
  optimizing: 'Building Your Strategy',
}

interface LogLine {
  text: string
  ts: string // frozen at the moment the line was added
}

const VISIBLE = 6

const LoadingState: React.FC<LoadingStateProps> = ({ status }) => {
  const [logs, setLogs] = useState<LogLine[]>([])

  useEffect(() => {
    let i = 0
    setLogs([])
    const scripted = MESSAGES[status]

    const push = () => {
      // Scripted lines first; then cycle the evergreen pool forever.
      const text = i < scripted.length
        ? scripted[i]
        : EVERGREEN[(i - scripted.length) % EVERGREEN.length]
      i++
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
      setLogs(prev => [{ text: text as string, ts }, ...prev].slice(0, VISIBLE))
    }

    push() // first line immediately
    // Slightly varied cadence (900–1300ms) feels more organic than a fixed beat.
    const interval = setInterval(push, 1100)
    return () => clearInterval(interval)
  }, [status])

  const icon = () => {
    if (status === 'analyzing') return <BrainCircuit className="w-12 h-12 text-amber-400 animate-pulse" />
    if (status === 'discovering') return <MapPin className="w-12 h-12 text-amber-400 animate-pulse" />
    return <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 animate-fadeIn">
      <div className="relative mb-12">
        <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full" />
        <div className="relative bg-slate-800 w-32 h-32 rounded-full flex items-center justify-center border border-slate-700 shadow-2xl">
          {icon()}
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 px-4 py-1 rounded-full border border-slate-700 text-xs text-amber-400 font-mono whitespace-nowrap flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          AI AGENT ACTIVE
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-8 text-center">{TITLES[status]}</h2>

      <div className="w-full max-w-md">
        <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs border border-slate-800 shadow-inner h-40 overflow-hidden flex flex-col-reverse">
          {logs.map((log, i) => (
            <div key={`${log.ts}-${i}`} className="text-emerald-500/80 mb-1 flex items-start">
              <span className="text-slate-600 mr-2 shrink-0">{log.ts}</span>
              <span>{`> ${log.text}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LoadingState
