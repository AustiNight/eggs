import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import SettingsPanel from './components/SettingsPanel';
import ShoppingListInput from './components/ShoppingListInput';
import ClarificationModal from './components/ClarificationModal';
import PlanResult from './components/PlanResult';
import LoadingState from './components/LoadingState';
import UserProfileModal from './components/UserProfileModal';
import { AppStatus, AppSettings, ShoppingItem, ShoppingPlan, GeoLocation, ClarificationRequest, UserProfile } from './types';
import { DEFAULT_SETTINGS, DEFAULT_LOCATION } from './constants';
import { analyzeShoppingList, generateShoppingPlan } from './services/geminiService';
import { saveToHistory, getProfile } from './services/storageService';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [clarifications, setClarifications] = useState<ClarificationRequest[] | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // User Profile State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Initial Load
  useEffect(() => {
    // Load profile
    const savedProfile = getProfile();
    if (savedProfile) setUserProfile(savedProfile);

    // Load geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (err) => {
          console.warn("Geolocation failed, using default", err);
          setLocation(DEFAULT_LOCATION);
        }
      );
    } else {
      setLocation(DEFAULT_LOCATION);
    }
  }, []);

  const handleStartProcess = async () => {
    setError(null);
    setStatus(AppStatus.ANALYZING);

    try {
      // Step 1: Check for ambiguities
      const needsClarification = await analyzeShoppingList(items);

      if (needsClarification) {
        setClarifications(needsClarification);
        setStatus(AppStatus.CLARIFYING);
      } else {
        // No clarification needed, proceed to search
        executeSearchAndPlan(items);
      }
    } catch (e) {
      console.error(e);
      setError("An error occurred while analyzing your list.");
      setStatus(AppStatus.IDLE);
    }
  };

  const handleClarificationComplete = (updates: Record<string, string>) => {
    // Update items with clarifications
    const updatedItems = items.map(item => {
      if (updates[item.id]) { 
        return { ...item, clarifiedName: updates[item.id] };
      }
      return item;
    });
    
    setItems(updatedItems);
    setClarifications(null);
    executeSearchAndPlan(updatedItems);
  };

  const executeSearchAndPlan = async (finalItems: ShoppingItem[]) => {
    setStatus(AppStatus.SEARCHING);
    const loc = location || DEFAULT_LOCATION;

    try {
      // Save finalized list to history immediately so user doesn't lose it if flow breaks
      saveToHistory(finalItems);

      // We wait a bit to show the "Searching" state (UX)
      await new Promise(r => setTimeout(r, 1000));
      
      setStatus(AppStatus.OPTIMIZING);
      // Pass user profile for addresses and exclusion lists
      const result = await generateShoppingPlan(finalItems, loc, settings, userProfile);
      setPlan(result);
      setStatus(AppStatus.RESULTS);
    } catch (e) {
      console.error(e);
      setError("Failed to generate a shopping plan. Please try again later.");
      setStatus(AppStatus.IDLE);
    }
  };

  const resetApp = () => {
    setStatus(AppStatus.IDLE);
    setItems([]);
    setPlan(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-amber-500/30">
      <Header 
        userProfile={userProfile} 
        onOpenProfile={() => setShowProfileModal(true)} 
      />
      
      {showProfileModal && (
        <UserProfileModal 
          currentProfile={userProfile}
          onUpdate={setUserProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}
      
      <main className="pt-24 px-4 pb-12 max-w-4xl mx-auto">
        
        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-lg mb-6 animate-fadeIn">
            {error}
          </div>
        )}

        {/* Input Phase */}
        {status === AppStatus.IDLE && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center mb-10">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                Smart Grocery Savings.
              </h2>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                Enter your list. We'll <span className="text-amber-400">e</span>xplore the web, <span className="text-amber-400">g</span>ather deals, and <span className="text-amber-400">g</span>roup your carts to <span className="text-amber-400">s</span>ave on the price of eggs (and everything else).
              </p>
            </div>

            <SettingsPanel settings={settings} onUpdate={setSettings} />
            <ShoppingListInput 
              items={items} 
              setItems={setItems} 
              onStartSearch={handleStartProcess} 
            />
          </div>
        )}

        {/* Clarification Phase (Modal) */}
        {status === AppStatus.CLARIFYING && clarifications && (
          <ClarificationModal 
            requests={clarifications} 
            onComplete={handleClarificationComplete} 
          />
        )}

        {/* Loading / Processing Phase */}
        {(status === AppStatus.SEARCHING || status === AppStatus.OPTIMIZING || status === AppStatus.ANALYZING) && (
          <LoadingState status={status} />
        )}

        {/* Results Phase */}
        {status === AppStatus.RESULTS && plan && (
          <PlanResult plan={plan} onReset={resetApp} />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-auto py-8 text-center text-slate-600 text-sm">
        <p>&copy; {new Date().getFullYear()} The Price of E.G.G.S. AI Tool</p>
        <p className="mt-1">Powered by Google Gemini</p>
      </footer>
    </div>
  );
};

export default App;