import React from 'react';
import { Egg } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  userProfile: UserProfile | null;
  onOpenProfile: () => void;
}

const Header: React.FC<HeaderProps> = ({ userProfile, onOpenProfile }) => {
  return (
    <header className="fixed top-0 w-full z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="bg-amber-400 p-1.5 rounded-lg">
            <Egg className="w-6 h-6 text-slate-900" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">
            The Price of <span className="text-amber-400">E.G.G.S.</span>
          </h1>
          <h1 className="text-xl font-bold tracking-tight text-white sm:hidden">
            <span className="text-amber-400">E.G.G.S.</span>
          </h1>
        </div>

        {/* User Profile Avatar Bubble */}
        <button 
          onClick={onOpenProfile}
          className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 rounded-full py-1.5 px-2 pr-4"
        >
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center border border-amber-400/50 text-xl overflow-hidden">
            {userProfile?.avatar || '👤'}
          </div>
          <div className="flex flex-col items-start">
             <span className="text-xs font-bold text-white leading-tight">
               {userProfile ? (userProfile.firstName || 'User') : 'Guest'}
             </span>
             <span className="text-[10px] text-slate-400 leading-tight">
               {userProfile ? 'View Profile' : 'Sign In'}
             </span>
          </div>
        </button>
      </div>
    </header>
  );
};

export default Header;