import React, { useState, useEffect } from 'react';
import { User, X, LogIn, LogOut, MapPin, Save, Ban } from 'lucide-react';
import { UserProfile } from '../types';
import { saveProfile, clearProfile } from '../services/storageService';

interface UserProfileModalProps {
  currentProfile: UserProfile | null;
  onUpdate: (profile: UserProfile | null) => void;
  onClose: () => void;
}

const EMOJIS = ['👤', '👩', '👨', '🧑', '👵', '👴', '🕵️', '👷', '👸', '🦸', '🦹', '🧙', '🥚', '🦖', '🤖'];

const UserProfileModal: React.FC<UserProfileModalProps> = ({ currentProfile, onUpdate, onClose }) => {
  const [isLoginMode, setIsLoginMode] = useState(!currentProfile);
  const [formData, setFormData] = useState<UserProfile>(currentProfile || {
    firstName: '',
    lastName: '',
    email: '',
    address: '',
    avatar: '👤',
    avoidStores: [],
    avoidBrands: []
  });
  
  // Temp state for inputs
  const [avoidStoreInput, setAvoidStoreInput] = useState('');
  const [avoidBrandInput, setAvoidBrandInput] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail && loginPass) {
      // Simulate auth success
      const newProfile: UserProfile = {
        firstName: 'User',
        lastName: '',
        email: loginEmail,
        address: '',
        avatar: '👤',
        avoidStores: [],
        avoidBrands: []
      };
      setFormData(newProfile);
      setIsLoginMode(false);
      saveProfile(newProfile);
      onUpdate(newProfile);
    }
  };

  const handleLogout = () => {
    clearProfile();
    onUpdate(null);
    onClose();
  };

  const handleSave = () => {
    saveProfile(formData);
    onUpdate(formData);
    onClose();
  };

  const addAvoid = (type: 'store' | 'brand') => {
    if (type === 'store' && avoidStoreInput.trim()) {
      setFormData(prev => ({...prev, avoidStores: [...prev.avoidStores, avoidStoreInput.trim()]}));
      setAvoidStoreInput('');
    }
    if (type === 'brand' && avoidBrandInput.trim()) {
      setFormData(prev => ({...prev, avoidBrands: [...prev.avoidBrands, avoidBrandInput.trim()]}));
      setAvoidBrandInput('');
    }
  };

  const removeAvoid = (type: 'store' | 'brand', index: number) => {
    if (type === 'store') {
      setFormData(prev => ({...prev, avoidStores: prev.avoidStores.filter((_, i) => i !== index)}));
    } else {
      setFormData(prev => ({...prev, avoidBrands: prev.avoidBrands.filter((_, i) => i !== index)}));
    }
  };

  if (isLoginMode && !currentProfile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-fadeIn">
        <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <LogIn className="w-6 h-6 text-amber-400" /> Sign In
            </h2>
            <button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
              <input 
                type="email" 
                required
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white" 
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
              <input 
                type="password" 
                required
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white" 
              />
            </div>
            <button type="submit" className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold py-3 rounded-lg transition-colors">
              Login to Profile
            </button>
            <p className="text-xs text-center text-slate-500">
              (For this demo, enter any email/password)
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
          <div className="flex items-center gap-4">
            <div className="text-4xl bg-slate-700 rounded-full w-16 h-16 flex items-center justify-center border-2 border-amber-400">
              {formData.avatar}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Your Profile</h2>
              <p className="text-sm text-slate-400">{formData.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          
          {/* Avatar Selection */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300">Choose Avatar</label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map(e => (
                <button 
                  key={e} 
                  onClick={() => setFormData(prev => ({...prev, avatar: e}))}
                  className={`text-2xl w-10 h-10 rounded-lg hover:bg-slate-700 transition-colors ${formData.avatar === e ? 'bg-amber-400/20 border border-amber-400' : ''}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Personal Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">First Name</label>
              <input 
                type="text" 
                value={formData.firstName}
                onChange={e => setFormData(prev => ({...prev, firstName: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white" 
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Last Name</label>
              <input 
                type="text" 
                value={formData.lastName}
                onChange={e => setFormData(prev => ({...prev, lastName: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white" 
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Home Address (find the lowest prices near you!)
              </label>
              <input 
                type="text" 
                value={formData.address}
                onChange={e => setFormData(prev => ({...prev, address: e.target.value}))}
                placeholder="123 Main St, City, State, Zip"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white" 
              />
            </div>
          </div>

          {/* Avoid Lists */}
          <div className="space-y-4 pt-4 border-t border-slate-800">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" /> Preferences
            </h3>
            
            {/* Avoid Stores */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Avoid Stores (e.g. "Whole Foods")</label>
              <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={avoidStoreInput}
                  onChange={e => setAvoidStoreInput(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="Store name..."
                />
                <button onClick={() => addAvoid('store')} className="bg-slate-700 hover:bg-slate-600 text-white px-3 rounded-lg text-sm">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.avoidStores.map((store, i) => (
                  <span key={i} className="bg-red-900/30 text-red-300 px-2 py-1 rounded text-xs flex items-center gap-1 border border-red-900/50">
                    {store} <button onClick={() => removeAvoid('store', i)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </div>

            {/* Avoid Brands */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Avoid Brands (e.g. "Nestle")</label>
              <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={avoidBrandInput}
                  onChange={e => setAvoidBrandInput(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="Brand name..."
                />
                <button onClick={() => addAvoid('brand')} className="bg-slate-700 hover:bg-slate-600 text-white px-3 rounded-lg text-sm">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.avoidBrands.map((brand, i) => (
                  <span key={i} className="bg-red-900/30 text-red-300 px-2 py-1 rounded text-xs flex items-center gap-1 border border-red-900/50">
                    {brand} <button onClick={() => removeAvoid('brand', i)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-slate-800 bg-slate-800/50 flex justify-between items-center">
          <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-semibold">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
          <button onClick={handleSave} className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-slate-900 px-6 py-2 rounded-lg font-bold shadow-lg shadow-amber-900/20">
            <Save className="w-4 h-4" /> Save Profile
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserProfileModal;