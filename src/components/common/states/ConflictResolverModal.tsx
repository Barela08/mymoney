import React from 'react';
import { GitCompare, Check, Cloud, Smartphone } from 'lucide-react';
import { Transaction } from '../../../types';
import { formatINR, formatDisplayDate, formatDisplayTime } from '../../../lib/dateUtils';

export interface ConflictResolverModalProps {
  isOpen: boolean;
  localRecord: Transaction;
  cloudRecord: Transaction;
  onKeepLocal: () => void;
  onKeepCloud: () => void;
  onSaveAsCopy: () => void;
  onCancel: () => void;
}

export const ConflictResolverModal: React.FC<ConflictResolverModalProps> = ({
  isOpen,
  localRecord,
  cloudRecord,
  onKeepLocal,
  onKeepCloud,
  onSaveAsCopy,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="p-3 bg-purple-100 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-900/50 rounded-2xl text-purple-600 dark:text-purple-400">
            <GitCompare className="w-6 h-6" />
          </div>
          <div>
            <h3 id="conflict-modal-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Data Conflict Detected
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This record was modified on another device or session. Compare the changes and choose how to proceed.
            </p>
          </div>
        </div>

        {/* Side-by-side comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4 overflow-y-auto flex-1 pr-1">
          {/* Local Version */}
          <div className="p-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-200 dark:border-emerald-800/60">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" />
                <span>Your Local Edits</span>
              </span>
              <span className="text-[10px] text-slate-400">This Device</span>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Title</p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{localRecord.title}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Amount</p>
              <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-sans">
                {formatINR(localRecord.amount)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Date & Time</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                {formatDisplayDate(localRecord.transaction_date)} {formatDisplayTime(localRecord.transaction_time)}
              </p>
            </div>
            {localRecord.notes && (
              <div>
                <p className="text-[11px] text-slate-400">Notes</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 italic">"{localRecord.notes}"</p>
              </div>
            )}
          </div>

          {/* Cloud Version */}
          <div className="p-4 rounded-2xl border-2 border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-blue-200 dark:border-blue-800/60">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                <Cloud className="w-4 h-4" />
                <span>Cloud Version</span>
              </span>
              <span className="text-[10px] text-slate-400">Supabase</span>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Title</p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{cloudRecord.title}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Amount</p>
              <p className="text-base font-extrabold text-blue-600 dark:text-blue-400 font-sans">
                {formatINR(cloudRecord.amount)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Date & Time</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                {formatDisplayDate(cloudRecord.transaction_date)} {formatDisplayTime(cloudRecord.transaction_time)}
              </p>
            </div>
            {cloudRecord.notes && (
              <div>
                <p className="text-[11px] text-slate-400">Notes</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 italic">"{cloudRecord.notes}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-4 py-2.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveAsCopy}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs rounded-xl"
          >
            Save Both as Copies
          </button>
          <button
            type="button"
            onClick={onKeepCloud}
            className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md"
          >
            Use Cloud Version
          </button>
          <button
            type="button"
            onClick={onKeepLocal}
            className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md"
          >
            Keep My Local Version
          </button>
        </div>
      </div>
    </div>
  );
};
