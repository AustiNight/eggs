import React, { useState } from 'react'
import { HelpCircle, Check, CheckSquare, Square } from 'lucide-react'
import { ClarificationRequest } from '../types'

interface ClarificationModalProps {
  requests: ClarificationRequest[]
  onComplete: (updatedItems: Record<string, string>) => void
}

const ClarificationModal: React.FC<ClarificationModalProps> = ({ requests, onComplete }) => {
  const [selections, setSelections] = useState<Record<string, Set<string>>>({})

  const handleToggle = (itemId: string, option: string) => {
    setSelections(prev => {
      const itemSelections = new Set(prev[itemId] || [])
      if (itemSelections.has(option)) itemSelections.delete(option)
      else itemSelections.add(option)
      return { ...prev, [itemId]: itemSelections }
    })
  }

  const handleSubmit = () => {
    const answers: Record<string, string> = {}
    Object.entries(selections).forEach(([itemId, selectedSet]) => {
      if (selectedSet.size > 0) {
        const originalName = requests.find(r => r.itemId === itemId)?.originalName || ''
        const details = Array.from(selectedSet).join(', ')
        answers[itemId] = `${originalName} (${details})`
      }
    })
    onComplete(answers)
  }

  const isComplete = requests.every(req => {
    const itemSet = selections[req.itemId]
    return itemSet && itemSet.size > 0
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <div className="bg-blue-500/20 p-2 rounded-full">
            <HelpCircle className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Refine Your Search</h3>
            <p className="text-sm text-slate-400">Select all details that apply for the best price match.</p>
          </div>
        </div>

        <div className="space-y-8 overflow-y-auto pr-2 grow">
          {requests.map((req, idx) => (
            <div key={idx} className="space-y-3">
              <p className="text-md font-medium text-slate-200">
                <span className="text-slate-500 mr-2">#{idx + 1}</span>
                For <span className="text-amber-400 font-bold">"{req.originalName}"</span>: {req.question}
              </p>
              <div className="flex flex-wrap gap-2">
                {req.options.map(opt => {
                  const isSelected = selections[req.itemId]?.has(opt)
                  return (
                    <button
                      key={opt}
                      onClick={() => handleToggle(req.itemId, opt)}
                      className={`px-4 py-2.5 rounded-lg text-sm transition-all border flex items-center gap-2 ${isSelected ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                    >
                      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-slate-800 flex justify-between items-center shrink-0">
          <span className="text-xs text-slate-500">
            {Object.keys(selections).length} of {requests.length} items reviewed
          </span>
          <button
            onClick={handleSubmit}
            disabled={!isComplete}
            className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold transition-all ${isComplete ? 'bg-amber-400 text-slate-900 hover:bg-amber-300 hover:scale-105 shadow-lg shadow-amber-500/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
          >
            Find Deals <Check className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ClarificationModal
