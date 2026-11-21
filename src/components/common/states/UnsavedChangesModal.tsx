import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface UnsavedChangesModalProps {
  isOpen: boolean;
  onStay: () => void;
  onDiscard: () => void;
  title?: string;
  message?: string;
  documentName?: string;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  onStay,
  onDiscard,
  title = 'Unsaved Changes Detected',
  message,
  documentName,
}) => {
  if (!isOpen) return null;

  const displayMessage =
    message ||
    (documentName
      ? `You have unsaved changes in "${documentName}". If you close now, your edits will be permanently lost.`
      : 'You have unsaved changes in this form. If you close now, your edits will be permanently lost.');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden">
        <button
          onClick={onStay}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close dialog and stay"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3.5 mb-4">
          <div className="p-3 bg-amber-100 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 id="unsaved-modal-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {displayMessage}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onStay}
            className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Keep Editing & Stay
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full sm:w-auto px-4 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-semibold text-xs sm:text-sm rounded-xl border border-rose-200 dark:border-rose-900 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  );
};
