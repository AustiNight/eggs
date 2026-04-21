/**
 * PerStorePanels — collapsible per-store card grouping, shown below BestBasketList.
 *
 * Migrated from the legacy PlanResult per-store section. Each store card is
 * independently collapsible. The section as a whole is toggleable.
 */
import React, { useState } from 'react'
import { ShoppingCart, Car, ExternalLink, FileText, AlertCircle, Tag, ChevronDown, ChevronRight } from 'lucide-react'
import type { StorePlan, StoreItem } from '../types'

interface PerStorePanelsProps {
  stores: StorePlan[]
}

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
        {(() => {
          const href = item.shopUrl ?? item.productUrl
          return href
            ? <a href={href} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline">
                <ExternalLink className="w-3 h-3" />
              </a>
            : <span className="text-xs text-slate-700">—</span>
        })()}
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

function StoreCard({ store, idx }: { store: StorePlan; idx: number }) {
  const [expanded, setExpanded] = useState(false)

  const handleShopAll = () => {
    store.items.forEach(item => {
      if (item.notAvailable) return
      const href = item.shopUrl ?? item.productUrl
      if (href) window.open(href, '_blank')
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-md hover:border-slate-600 transition-colors">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full p-4 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center font-bold text-amber-400 text-base shrink-0">
            {idx + 1}
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">{store.storeName}</h4>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {store.storeType === 'physical' ? <Car className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
              <span>{store.storeType}</span>
              {store.distanceMiles != null && <span>· {store.distanceMiles.toFixed(1)} mi</span>}
              <span className={store.priceSource === 'ai_estimated' ? 'text-amber-400' : 'text-emerald-400'}>
                · {store.priceSource === 'kroger_api' ? 'Live API'
                  : store.priceSource === 'walmart_api' ? 'Live API'
                  : 'AI search'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block font-bold text-white text-base">${store.grandTotal.toFixed(2)}</span>
            <span className="text-xs text-slate-500">Includes est. tax</span>
          </div>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          }
        </div>
      </button>

      {expanded && (
        <>
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
            <button
              onClick={handleShopAll}
              className="flex items-center gap-2 text-sm font-bold bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2 rounded-lg transition-all hover:scale-105 active:scale-95"
            >
              <ExternalLink className="w-4 h-4" /> Shop All Items at Retailer
            </button>
            <span className="text-[10px] text-slate-500 max-w-xs text-right italic">
              Opens each item in tabs so you can add to cart and checkout.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const PerStorePanels: React.FC<PerStorePanelsProps> = ({ stores }) => {
  const [sectionOpen, setSectionOpen] = useState(false)

  return (
    <div className="mt-6">
      <button
        onClick={() => setSectionOpen(p => !p)}
        className="flex items-center gap-2 w-full py-3 px-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl text-sm font-semibold text-slate-300 transition-colors"
      >
        {sectionOpen
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />
        }
        <ShoppingCart className="w-4 h-4 text-amber-400" />
        All Stores ({stores.length})
        <span className="ml-auto text-xs text-slate-500 font-normal">
          {sectionOpen ? 'Hide' : 'Show full per-store breakdown'}
        </span>
      </button>

      {sectionOpen && (
        <div className="mt-4 space-y-4">
          {stores.map((store, idx) => (
            <StoreCard key={store.storeName + idx} store={store} idx={idx} />
          ))}
        </div>
      )}
    </div>
  )
}

export default PerStorePanels
