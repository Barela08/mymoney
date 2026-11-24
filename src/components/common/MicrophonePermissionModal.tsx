import React from 'react';
import { MicOff, X, RefreshCw } from 'lucide-react';

interface MicrophonePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry?: () => void;
}

export const MicrophonePermissionModal: React.FC<MicrophonePermissionModalProps> = ({
  isOpen,
  onClose,
  onRetry,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-permission-modal-title"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl relative text-left space-y-4">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <MicOff className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h3
              id="mic-permission-modal-title"
              className="text-base font-bold text-slate-900 dark:text-slate-100 leading-tight"
            >
              Microphone Permission Blocked
            </h3>
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
              माइक परमिशन की आवश्यकता है
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Aapke browser ne is website ke liye microphone access block kiya hua hai. Bolkar transaction add karne ya search karne ke liye bas yeh aasan steps follow karein:
        </p>

        <div className="space-y-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-4 text-xs text-slate-700 dark:text-slate-300">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
              1
            </span>
            <span>
              Browser ke address bar me URL ke baayein (left) side me <strong className="text-slate-900 dark:text-white">🔒 (Lock) / ⚙️ (Settings)</strong> icon par click karein.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
              2
            </span>
            <span>
              Wahan <strong className="text-slate-900 dark:text-white">Microphone</strong> option ko <strong className="text-emerald-600 dark:text-emerald-400">&quot;Allow&quot; (ON)</strong> kar dein.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
              3
            </span>
            <span>
              Neeche <strong className="text-emerald-600 dark:text-emerald-400">&quot;Try Again&quot;</strong> dabayein ya page Refresh karein.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          {onRetry && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRetry();
              }}
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
