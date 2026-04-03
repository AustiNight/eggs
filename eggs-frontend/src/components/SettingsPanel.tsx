import React from 'react'
import { Settings, MapPin, Truck, ShoppingBag, AlertCircle } from 'lucide-react'
import { PlanSettings } from '../types'

interface SettingsPanelProps {
  settings: PlanSettings
  onUpdate: (s: PlanSettings) => void
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onUpdate }) => {
  const handleChange = (key: keyof PlanSettings, value: number | boolean) => {
    let updated = { ...settings, [key]: value }

    if (key === 'radiusMiles') {
      const r = value as number
      if ((updated.curbsideMaxMiles ?? 5) > r) updated.curbsideMaxMiles = r
    }
    if (key === 'curbsideMaxMiles') {
      const c = value as number
      if (c > updated.radiusMiles) updated.radiusMiles = c
    }
    if (updated.radiusMiles > (updated.curbsideMaxMiles ?? 5) && !updated.includeDelivery) {
      updated.includeDelivery = true
    }

    onUpdate(updated)
  }

  const isDeliveryForced = settings.radiusMiles > (settings.curbsideMaxMiles ?? 5)

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg mb-8">
      <div className="flex items-center space-x-2 mb-6">
        <Settings className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Trip Preferences</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Search Radius
            </span>
            <span className="font-mono text-amber-400">{settings.radiusMiles} mi</span>
          </div>
          <input
            type="range" min={1} max={50} step={1}
            value={settings.radiusMiles}
            onChange={e => handleChange('radiusMiles', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" /> Max Stores
            </span>
            <span className="font-mono text-amber-400">{settings.maxStores}</span>
          </div>
          <input
            type="range" min={1} max={5} step={1}
            value={settings.maxStores}
            onChange={e => handleChange('maxStores', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <Truck className="w-4 h-4" /> Curbside Max Dist
            </span>
            <span className="font-mono text-amber-400">{settings.curbsideMaxMiles ?? 5} mi</span>
          </div>
          <input
            type="range" min={1} max={settings.radiusMiles} step={1}
            value={settings.curbsideMaxMiles ?? 5}
            onChange={e => handleChange('curbsideMaxMiles', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
          <p className="text-xs text-slate-500">Cannot exceed Search Radius</p>
        </div>

        <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${isDeliveryForced ? 'bg-slate-900/50 border-amber-500/30' : 'bg-slate-700/50 border-transparent'}`}>
          <div className="flex flex-col">
            <span className="text-sm text-slate-300">Include Delivery Options</span>
            {isDeliveryForced && (
              <span className="text-xs text-amber-500 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3" /> Required (Radius &gt; Curbside)
              </span>
            )}
          </div>
          <button
            onClick={() => !isDeliveryForced && handleChange('includeDelivery', !settings.includeDelivery)}
            disabled={isDeliveryForced}
            className={`w-12 h-6 rounded-full transition-colors relative ${settings.includeDelivery ? 'bg-amber-500' : 'bg-slate-600'} ${isDeliveryForced ? 'opacity-80 cursor-not-allowed' : ''}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.includeDelivery ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
