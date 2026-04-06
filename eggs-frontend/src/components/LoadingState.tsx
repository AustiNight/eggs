import React, { useEffect, useState } from 'react'
import { Loader2, BrainCircuit, MapPin } from 'lucide-react'

export type PlanStatus = 'analyzing' | 'discovering' | 'searching' | 'optimizing'

interface LoadingStateProps {
  status: PlanStatus
}

const MESSAGES: Record<PlanStatus, string[]> = {
  analyzing: [
    'Reading shopping list...',
    'Identifying ambiguous items...',
    'Checking for unit specifications...',
    'Preparing clarification questions...',
    'Validating item categories...',
    'Cross-referencing common sizes...'
  ],
  discovering: [
    'Locating stores within radius...',
    'Filtering avoid lists...',
    'Connecting to Kroger API...',
    'Checking store availability...',
    'Mapping nearby retailers...',
    'Confirming store coverage...'
  ],
  searching: [
    'Launching parallel price search...',
    'Kroger API: querying live prices...',
    'AI agent: scanning non-API stores...',
    'Checking member/loyalty pricing...',
    'Analyzing weekly flyers & digital coupons...',
    'Searching delivery & curbside options...',
    'Cross-checking item availability...',
    'Collecting all price data...'
  ],
  optimizing: [
    'Comparing prices across all sources...',
    'Calculating taxes...',
    'Sorting by lowest total cost...',
    'Building per-store item lists...',
    'Evaluating multi-store vs single-store...',
    'Finalizing The Price of E.G.G.S....'
  ]
}

const TITLES: Record<PlanStatus, string> = {
  analyzing: 'Analyzing Requirements',
  discovering: 'Finding Nearby Stores',
  searching: 'Searching All Sources',
  optimizing: 'Building Your Strategy'
}

const LoadingState: React.FC<LoadingStateProps> = ({ status }) => {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    let i = 0
    setLogs([])
    const messages = MESSAGES[status]

    const interval = setInterval(() => {
      if (i < messages.length) {
        const msg = messages[i]
        if (msg) setLogs(prev => [msg, ...prev].slice(0, 5))
        i++
      }
    }, 1200)

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
            <div key={i} className="text-emerald-500/80 mb-1 flex items-start">
              <span className="text-slate-600 mr-2 shrink-0">{new Date().toLocaleTimeString().split(' ')[0]}</span>
              <span>{`> ${log}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LoadingState
