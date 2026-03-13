import React, { useEffect } from 'react';
import { Settings, MapPin, Truck, ShoppingBag, AlertCircle } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdate: (newSettings: AppSettings) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onUpdate }) => {
  
  // Logic: Ensure logical consistency between radius and curbside
  const handleChange = (key: keyof AppSettings, value: number | boolean) => {
    let newSettings = { ...settings, [key]: value };

    if (key === 'radius') {
      const r = value as number;
      // If radius decreases below curbside, clamp curbside down
      if (newSettings.curbsideDistance > r) {
        newSettings.curbsideDistance = r;
      }
      // If radius is wider than curbside, we might need delivery
      if (r > newSettings.curbsideDistance) {
        // We don't force it here immediately to avoid annoyance, 
        // but we visualize the requirement below
      }
    }

    if (key === 'curbsideDistance') {
      const c = value as number;
      // Curbside cannot exceed search radius
      if (c > newSettings.radius) {
        newSettings.radius = c;
      }
    }

    // Force delivery if gap exists
    if (newSettings.radius > newSettings.curbsideDistance && !newSettings.includeDelivery) {
       newSettings.includeDelivery = true;
    }

    onUpdate(newSettings);
  };

  const isDeliveryForced = settings.radius > settings.curbsideDistance;

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg mb-8">
      <div className="flex items-center space-x-2 mb-6">
        <Settings className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Trip Preferences</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Radius */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Search Radius
            </span>
            <span className="font-mono text-amber-400">{settings.radius} mi</span>
          </div>
          <input 
            type="range" min="1" max="50" step="1"
            value={settings.radius}
            onChange={(e) => handleChange('radius', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Max Stores */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" /> Max Stores
            </span>
            <span className="font-mono text-amber-400">{settings.maxStores}</span>
          </div>
          <input 
            type="range" min="1" max="5" step="1"
            value={settings.maxStores}
            onChange={(e) => handleChange('maxStores', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Curbside Distance */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300 flex items-center gap-2">
              <Truck className="w-4 h-4" /> Curbside Max Dist
            </span>
            <span className="font-mono text-amber-400">{settings.curbsideDistance} mi</span>
          </div>
          <input 
            type="range" min="1" max={settings.radius} step="1"
            value={settings.curbsideDistance}
            onChange={(e) => handleChange('curbsideDistance', parseInt(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
          <p className="text-xs text-slate-500">Cannot exceed Search Radius</p>
        </div>

        {/* Toggle */}
        <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${isDeliveryForced ? 'bg-slate-900/50 border-amber-500/30' : 'bg-slate-700/50 border-transparent'}`}>
          <div className="flex flex-col">
            <span className="text-sm text-slate-300">Include Delivery Options</span>
            {isDeliveryForced && (
               <span className="text-xs text-amber-500 flex items-center gap-1 mt-1">
                 <AlertCircle className="w-3 h-3" /> Required (Radius {'>'} Curbside)
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
  );
};

export default SettingsPanel;