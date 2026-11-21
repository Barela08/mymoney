import React from 'react';
import { ArrowUpCircle, RefreshCw, Sparkles } from 'lucide-react';

export interface UpdateRequiredModalProps {
  isOpen: boolean;
  currentVersion?: string;
  newVersion?: string;
  releaseNotes?: string[];
  isMandatory?: boolean;
  onUpdate: () => void;
  onDismiss?: () => void;
}

export const UpdateRequiredModal: React.FC<UpdateRequiredModalProps> = ({
  isOpen,
  currentVersion = '1.0.0',
  newVersion = '1.1.0',
  releaseNotes = [
    'Ultra-fast Supabase 0ms real-time synchronization',
    '35 complete UI/UX state implementations',
    'Enhanced offline transaction queue and recovery',
  ],
  isMandatory = false,
  onUpdate,
  onDismiss,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden text-center">
        <div className="p-3.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-2xl w-fit mx-auto mb-4">
          <ArrowUpCircle className="w-8 h-8" />
        </div>

        <span className="inline-block px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full mb-2">
          {isMandatory ? 'Mandatory Update' : 'New Version Available'}
        </span>

        <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">
          Update My Money App
        </h3>

        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Version {currentVersion} &rarr; <span className="font-bold text-emerald-600">{newVersion}</span>
        </p>

        {releaseNotes.length > 0 && (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-left text-xs mb-6 space-y-2">
            <p className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <span>What's new:</span>
            </p>
            <ul className="list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-400">
              {releaseNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
          {!isMandatory && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="w-full sm:w-auto px-4 py-2.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Later
            </button>
          )}

          <button
            type="button"
            onClick={onUpdate}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload & Apply Update</span>
          </button>
        </div>
      </div>
    </div>
  );
};
