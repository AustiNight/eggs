import React from 'react'
import { ShieldCheck } from 'lucide-react'
import type { StorePlan } from '../types'

export function splitTotals(stores: StorePlan[]) {
  let verified = 0, estimated = 0
  for (const s of stores) for (const it of s.items) {
    if (it.notAvailable) continue
    if (it.provenance === 'api' || it.provenance === 'store_page_verified') verified += it.lineTotal
    else estimated += it.lineTotal
  }
  return { verified, estimated }
}

const VerifiedTotals: React.FC<{ stores: StorePlan[] }> = ({ stores }) => {
  const { verified, estimated } = splitTotals(stores)
  if (verified === 0 && estimated === 0) return null
  return (
    <div className="mt-3 flex items-center gap-4 text-xs bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <ShieldCheck className="w-3.5 h-3.5" /> Verified prices: <span className="font-mono font-bold">${verified.toFixed(2)}</span>
      </span>
      {estimated > 0 && (
        <span className="text-slate-400">+ estimates: <span className="font-mono">${estimated.toFixed(2)}</span></span>
      )}
    </div>
  )
}
export default VerifiedTotals
