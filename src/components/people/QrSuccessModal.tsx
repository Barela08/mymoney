import React from 'react';
import {
  CheckCircle2,
  Sparkles,
  Plus,
  X,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface QrSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectedPerson: {
    name: string;
    emailMasked?: string;
    avatarUrl?: string | null;
  };
  onViewProfile: (name: string) => void;
  onAddUdhar: (name: string) => void;
}

export const QrSuccessModal: React.FC<QrSuccessModalProps> = ({
  isOpen,
  onClose,
  connectedPerson,
  onViewProfile,
  onAddUdhar,
}) => {
  const { user } = useAuth();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-center">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Success Icon */}
        <div className="w-16 h-16 rounded-3xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20 border-2 border-emerald-500/30">
          <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
        </div>

        <div>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Sparkles className="w-3 h-3" />
            Connection Established
          </span>
          <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 mt-2">
            Connection Added Successfully
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            <strong>{connectedPerson.name}</strong> has been added to your Saved People.
          </p>
        </div>

        {/* Two-Way Connection Visualizer */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-around gap-2">
          {/* Current User */}
          <div className="text-center space-y-1">
            {(user?.avatar_url || user?.avatarUrl) ? (
              <img
                src={user?.avatar_url || user?.avatarUrl || ''}
                alt={user?.displayName || 'You'}
                className="w-12 h-12 rounded-2xl object-cover border-2 border-emerald-500/30 shadow-xs mx-auto"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-xs mx-auto">
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <p className="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate max-w-[90px]">
              {user?.displayName || 'You'}
            </p>
            <span className="text-xs text-emerald-600 font-medium">Connected</span>
          </div>

          {/* Sync arrows */}
          <div className="flex flex-col items-center justify-center text-emerald-500">
            <UserCheck className="w-5 h-5" />
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase mt-0.5">2-WAY</span>
          </div>

          {/* Connected Person */}
          <div className="text-center space-y-1">
            {connectedPerson.avatarUrl ? (
              <img
                src={connectedPerson.avatarUrl}
                alt={connectedPerson.name}
                className="w-12 h-12 rounded-2xl object-cover border-2 border-indigo-500/30 shadow-xs mx-auto"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-xs mx-auto">
                {connectedPerson.name.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate max-w-[90px]">
              {connectedPerson.name}
            </p>
            <span className="text-xs text-indigo-600 font-medium">Saved</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            onClick={() => {
              onClose();
              onAddUdhar(connectedPerson.name);
            }}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-2xl text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Udhar Transaction Now</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onViewProfile(connectedPerson.name);
            }}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
          >
            View Person Ledger &amp; Details
          </button>
        </div>
      </div>
    </div>
  );
};
