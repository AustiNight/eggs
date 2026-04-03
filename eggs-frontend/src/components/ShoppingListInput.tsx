import React, { useState, useEffect } from 'react'
import { Plus, X, Search, History, CheckSquare, Square, Trash2 } from 'lucide-react'
import { ShoppingItem } from '../types'
import { getHistory, removeFromHistory } from '../services/storageService'

const generateId = () => Math.random().toString(36).substring(2, 9)

interface ShoppingListInputProps {
  items: ShoppingItem[]
  setItems: React.Dispatch<React.SetStateAction<ShoppingItem[]>>
  onStartSearch: () => void
}

const ShoppingListInput: React.FC<ShoppingListInputProps> = ({ items, setItems, onStartSearch }) => {
  const [inputValue, setInputValue] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [historyItems, setHistoryItems] = useState<ShoppingItem[]>([])
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (showHistory) setHistoryItems(getHistory())
  }, [showHistory])

  const handleAddItem = (e?: React.FormEvent, overrideName?: string, overrideQty?: number) => {
    if (e) e.preventDefault()
    const finalName = overrideName || inputValue
    if (!finalName.trim()) return

    const parts = finalName.trim().split(' ')
    let qty = overrideQty || 1
    let name = finalName.trim()

    if (!overrideQty && parts.length > 1 && !isNaN(Number(parts[0]))) {
      qty = Number(parts[0])
      name = parts.slice(1).join(' ')
    }

    setItems(prev => [...prev, { id: generateId(), name, quantity: qty }])
    if (!overrideName) setInputValue('')
  }

  const removeItem = (id: string) => setItems(items.filter(i => i.id !== id))

  const deleteFromHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setHistoryItems(removeFromHistory(id))
  }

  const toggleHistorySelection = (id: string) => {
    const newSet = new Set(selectedHistoryIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedHistoryIds(newSet)
  }

  const addSelectedHistory = () => {
    const selected = historyItems.filter(h => selectedHistoryIds.has(h.id))
    setItems(prev => [
      ...prev,
      ...selected.map(h => ({
        id: generateId(),
        name: h.clarifiedName || h.name,
        quantity: h.quantity,
        clarifiedName: h.clarifiedName
      }))
    ])
    setShowHistory(false)
    setSelectedHistoryIds(new Set())
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex gap-2">
        <form onSubmit={handleAddItem} className="relative grow">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Add item (e.g. '2 gallons of milk')..."
            className="w-full h-14 pl-5 pr-14 rounded-full bg-slate-800 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all text-lg"
          />
          <button
            type="submit"
            className="absolute right-2 top-2 h-10 w-10 bg-amber-400 hover:bg-amber-300 rounded-full flex items-center justify-center text-slate-900 transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        </form>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`px-4 rounded-xl border border-slate-700 flex items-center justify-center transition-colors ${showHistory ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          title="History"
        >
          <History className="w-6 h-6" />
        </button>
      </div>

      {showHistory && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-slideUp">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-white">Shopping History</h3>
            <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          {historyItems.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">No past items found.</p>
          ) : (
            <div className="space-y-4">
              <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                {historyItems.map(hItem => {
                  const isSelected = selectedHistoryIds.has(hItem.id)
                  return (
                    <div
                      key={hItem.id}
                      onClick={() => toggleHistorySelection(hItem.id)}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-colors group relative ${isSelected ? 'bg-blue-600/20 border-blue-500/50' : 'bg-slate-900/50 border-slate-800 hover:border-slate-600'}`}
                    >
                      {isSelected
                        ? <CheckSquare className="w-5 h-5 text-blue-400 shrink-0" />
                        : <Square className="w-5 h-5 text-slate-600 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 font-medium truncate">{hItem.clarifiedName || hItem.name}</div>
                        <div className="text-xs text-slate-500">
                          Last bought: {new Date(hItem.lastPurchased || '').toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={e => deleteFromHistory(e, hItem.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-2 transition-all absolute right-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button
                onClick={addSelectedHistory}
                disabled={selectedHistoryIds.size === 0}
                className={`w-full py-2 rounded-lg font-bold text-sm transition-colors ${selectedHistoryIds.size > 0 ? 'bg-amber-400 text-slate-900 hover:bg-amber-300' : 'bg-slate-700 text-slate-500'}`}
              >
                Add {selectedHistoryIds.size} Items
              </button>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-4 min-h-[100px] border border-slate-700/50">
          <div className="flex flex-wrap gap-2">
            {items.map(item => (
              <div
                key={item.id}
                className="group flex items-center gap-2 bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-600 hover:border-amber-400/50 transition-colors"
              >
                <span className="font-mono text-amber-400 font-bold">{item.quantity}x</span>
                <span>{item.clarifiedName || item.name}</span>
                <button
                  onClick={() => removeItem(item.id)}
                  className="ml-1 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center pt-4">
        <button
          onClick={onStartSearch}
          disabled={items.length === 0}
          className={`flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg shadow-lg shadow-amber-900/20 transform transition-all ${items.length === 0 ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 hover:scale-105 active:scale-95 hover:shadow-orange-500/20'}`}
        >
          <Search className="w-5 h-5" />
          Find Best Prices
        </button>
      </div>
    </div>
  )
}

export default ShoppingListInput
