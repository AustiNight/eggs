import React, { useEffect, useState } from 'react';
import { Loader2, BrainCircuit } from 'lucide-react';
import { AppStatus } from '../types';

interface LoadingStateProps {
  status: AppStatus;
}

const LoadingState: React.FC<LoadingStateProps> = ({ status }) => {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let messages: string[] = [];
    
    if (status === AppStatus.ANALYZING) {
      messages = [
        "Reading shopping list...",
        "Identifying ambiguous items...",
        "Checking for unit specifications...",
        "Preparing clarification questions...",
        "Validating item categories...",
        "Cross-referencing common sizes..."
      ];
    } else {
      messages = [
        "Accessing Google Search...",
        "Locating stores within radius...",
        "Filtering 'Avoid' lists...",
        "Scanning 15+ local retailers...",
        "Checking Member/Loyalty pricing...",
        "Analyzing weekly flyers & digital coupons...",
        "Calculating taxes...",
        "Checking real-time inventory...",
        "Finding absolute lowest price per item...",
        "Optimizing delivery vs pickup routes...",
        "Finalizing The Price of E.G.G.S...."
      ];
    }
    
    let i = 0;
    setLogs([]); // Reset logs on status change
    
    const interval = setInterval(() => {
      // Strict check to prevent undefined
      if (i < messages.length) {
        const msg = messages[i];
        if (msg) {
          setLogs(prev => [msg, ...prev].slice(0, 5));
        }
        i++;
      } else {
        // Keep the last message visible or add a 'holding' message
        // Do not clear interval immediately if we want to keep showing static text
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [status]);

  const getStatusTitle = () => {
    switch(status) {
      case AppStatus.ANALYZING: return "Analyzing Requirements";
      case AppStatus.SEARCHING: return "Exploring the Market";
      case AppStatus.OPTIMIZING: return "Building Your Strategy";
      default: return "Processing";
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 animate-fadeIn">
      
      {/* Central Spinner/Icon */}
      <div className="relative mb-12">
        <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full" />
        <div className="relative bg-slate-800 w-32 h-32 rounded-full flex items-center justify-center border border-slate-700 shadow-2xl">
          {status === AppStatus.ANALYZING ? (
            <BrainCircuit className="w-12 h-12 text-amber-400 animate-pulse" />
          ) : (
            <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />
          )}
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 px-4 py-1 rounded-full border border-slate-700 text-xs text-amber-400 font-mono whitespace-nowrap flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          AI AGENT ACTIVE
        </div>
      </div>

      {/* Status Text */}
      <h2 className="text-2xl font-bold text-white mb-8 text-center">
        {getStatusTitle()}
      </h2>

      {/* Process Steps */}
      <div className="w-full max-w-md space-y-4">
        {/* Mock Terminal Output */}
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
  );
};

export default LoadingState;