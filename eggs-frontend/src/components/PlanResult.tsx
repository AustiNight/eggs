import React from 'react'
import { ShoppingPlan, StorePlan, StoreItem } from '../types'
import { ShoppingCart, Car, DollarSign, ArrowRight, Activity, Globe, Tag, ExternalLink, FileText, AlertCircle } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface PlanResultProps {
  plan: ShoppingPlan
  onReset: () => void
}

const COLORS = ['#fbbf24', '#f97316', '#34d399', '#60a5fa', '#a78bfa']

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  real:                   { label: 'Live',      color: '#34d399' },
  estimated_with_source:  { label: 'Sourced',   color: '#fbbf24' },
  estimated:              { label: 'Est.',       color: '#94a3b8' }
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const { label, color } = SOURCE_LABELS[confidence] ?? SOURCE_LABELS.estimated
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}30` }}>
      {label}
    </span>
  )
}

function ItemRow({ item }: { item: StoreItem }) {
  if (item.notAvailable) {
    return (
      <tr className="opacity-40">
        <td className="py-2.5 text-slate-400 italic">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 text-slate-600 shrink-0" />
            <span>{item.name}</span>
          </div>
        </td>
        <td className="py-2.5 text-center text-slate-600 text-xs">—</td>
        <td className="py-2.5 text-right text-slate-600 text-xs">Not carried</td>
        <td className="py-2.5 text-center text-slate-600 text-xs">—</td>
        <td className="py-2.5 text-right text-slate-600 text-xs">—</td>
        <td className="py-2.5 text-right text-slate-600 text-xs">—</td>
      </tr>
    )
  }

  return (
    <tr className="group">
      <td className="py-3 text-slate-300 group-hover:text-white transition-colors">
        <div className="flex flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          {item.isLoyaltyPrice && (
            <span className="inline-flex w-fit items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
              <Tag className="w-3 h-3" /> Member Price
              {item.nonMemberPrice && item.nonMemberPrice > item.unitPrice && (
                <span className="line-through text-slate-600 ml-1">${item.nonMemberPrice.toFixed(2)}</span>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="py-3 text-center text-slate-400">
        {item.quantity} <span className="text-slate-600 text-xs">{item.unit}</span>
      </td>
      <td className="py-3 text-right font-mono text-amber-400/90 font-bold">
        ${item.unitPrice.toFixed(2)}
      </td>
      <td className="py-3 text-center">
        <ConfidenceBadge confidence={item.confidence} />
      </td>
      <td className="py-3 text-right">
        {item.productUrl
          ? <a href={item.productUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline">
              <ExternalLink className="w-3 h-3" />
            </a>
          : <span className="text-xs text-slate-700">—</span>}
      </td>
      <td className="py-3 text-right">
        {item.proofUrl
          ? <a href={item.proofUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-xs text-slate-300 transition-colors">
              <FileText className="w-3 h-3" />
            </a>
          : <span className="text-xs text-slate-700">—</span>}
      </td>
    </tr>
  )
}

const PlanResult: React.FC<PlanResultProps> = ({ plan, onReset }) => {
  const data = plan.stores.map(s => ({ name: s.storeName, value: s.subtotal }))
  const handleShopAll = (store: StorePlan) => {
    store.items.forEach(item => { if (item.productUrl) window.open(item.productUrl, '_blank') })
  }
  const total = plan.summary.total
  const savings = plan.summary.estimatedSavings ?? 0

  return (
    <div className="space-y-8 pb-20 animate-slideUp">

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-6 items-center justify-center text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          <span>Queried <strong className="text-white">{plan.meta.storesQueried.length}</strong> stores</span>
        </div>
        <div className="w-px h-4 bg-slate-700 hidden sm:block" />
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>
            <strong className="text-white">{plan.summary.realPriceCount}</strong> live prices
            {plan.summary.estimatedPriceCount > 0 && <> · <strong className="text-amber-400">{plan.summary.estimatedPriceCount}</strong> estimated</>}
          </span>
        </div>
      </div>

      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-3">Shopping Plan Ready</h2>
            {plan.summary.narrative && (
              <p className="text-slate-300 text-sm leading-relaxed max-w-xl">{plan.summary.narrative}</p>
            )}
          </div>
          <div className="flex items-end flex-col min-w-[140px] shrink-0">
            {savings > 0 && <span className="text-sm text-emerald-400 font-mono mb-1">Savings: ${savings.toFixed(2)}</span>}
            <div className="text-4xl font-bold text-white tracking-tighter">${total.toFixed(2)}</div>
            <span className="text-xs text-slate-500 uppercase tracking-widest mt-1">Total w/ Tax</span>
            <span className="text-[10px] text-slate-600">Subtotal: ${plan.summary.subtotal.toFixed(2)}</span>
            {plan.meta.budgetExceeded && (
              <span className="mt-2 text-xs font-semibold px-2 py-1 rounded-full text-red-400 bg-red-400/10 border border-red-400/20">Over Budget</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-400" /> Your Carts
          </h3>
          {plan.stores.map((store, idx) => (
            <div key={idx} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-md hover:border-slate-600 transition-colors">
              <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-amber-400 text-lg">{idx + 1}</div>
                  <div>
                    <h4 className="font-bold text-white">{store.storeName}</h4>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      {store.storeType === 'physical' ? <Car className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                      <span>{store.storeType}</span>
                      {store.distanceMiles != null && <span>· {store.distanceMiles.toFixed(1)} mi</span>}
                      <span className={store.priceSource === 'ai_estimated' ? 'text-amber-400' : 'text-emerald-400'}>
                        · {store.priceSource === 'kroger_api' ? 'Live API'
                          : store.priceSource === 'walmart_api' ? 'Live API'
                          : store.priceSource === 'walgreens_api' ? 'Live API'
                          : 'AI search'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="block font-bold text-white text-lg">${store.grandTotal.toFixed(2)}</span>
                  <span className="text-xs text-slate-500">Includes est. tax</span>
                </div>
              </div>
              <div className="p-4 bg-slate-900/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800 text-xs uppercase tracking-wide">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 font-medium text-center w-16">Qty</th>
                      <th className="pb-2 font-medium text-right w-24">Unit Price</th>
                      <th className="pb-2 font-medium text-center w-20">Source</th>
                      <th className="pb-2 font-medium text-right w-20">Shop</th>
                      <th className="pb-2 font-medium text-right w-20">Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {store.items.map((item, i) => (
                      <ItemRow key={i} item={item} />
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-700/50">
                    <tr>
                      <td colSpan={5} className="pt-3 text-right text-xs text-slate-500">Subtotal</td>
                      <td className="pt-3 text-right text-xs text-slate-500 font-mono">${store.subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="pt-1 text-right text-xs text-slate-500">Est. Tax (8.25%)</td>
                      <td className="pt-1 text-right text-xs text-slate-500 font-mono">${store.estimatedTax.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="p-4 bg-slate-800 flex flex-col items-end gap-2 border-t border-slate-700">
                <button onClick={() => handleShopAll(store)} className="flex items-center gap-2 text-sm font-bold bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2 rounded-lg transition-all hover:scale-105 active:scale-95">
                  <ExternalLink className="w-4 h-4" /> Shop All Items at Retailer
                </button>
                <span className="text-[10px] text-slate-500 max-w-xs text-right italic">Opens each item in tabs so you can add to cart and checkout.</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" /> Cost Breakdown
          </h3>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                    {data.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: number) => `$${value.toFixed(2)}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-1">
              {data.map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 truncate">{entry.name}</span>
                  </div>
                  <span className="text-slate-300 font-mono ml-2">${entry.value.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-3 text-center">Spend per store</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h4 className="text-sm font-semibold text-slate-300 mb-4">E.G.G.S. Strategy Report</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>Visited {plan.stores.length} distinct location{plan.stores.length !== 1 ? 's' : ''}.</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>Prioritized lowest price. No artificial merging.</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>
                  {plan.summary.realPriceCount} live price{plan.summary.realPriceCount !== 1 ? 's' : ''} from Kroger API.
                  {plan.summary.estimatedPriceCount > 0 && ` ${plan.summary.estimatedPriceCount} AI estimated.`}
                </span>
              </li>
              {plan.meta.budgetMode === 'ceiling' && plan.meta.budgetCeiling && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>
                    Budget ceiling: ${plan.meta.budgetCeiling.toFixed(2)}.{' '}
                    {plan.meta.budgetExceeded
                      ? <span className="text-red-400">Plan exceeded budget.</span>
                      : <span className="text-emerald-400">Came in under budget.</span>}
                  </span>
                </li>
              )}
            </ul>
          </div>
          <button onClick={onReset} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors border border-slate-600">
            Start New List
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlanResult
