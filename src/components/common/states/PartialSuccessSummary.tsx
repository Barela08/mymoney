import React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';

export interface PartialSuccessSummaryProps {
  operationName?: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  failedItems?: { id?: string; name: string; reason: string }[];
  onRetryFailed?: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
}

export const PartialSuccessSummary: React.FC<PartialSuccessSummaryProps> = ({
  operationName = 'Batch Operation',
  totalCount,
  successCount,
  failedCount,
  failedItems = [],
  onRetryFailed,
  onDismiss,
  isRetrying = false,
}) => {
  return (
    <div
      role="status"
      className="p-5 sm:p-6 rounded-3xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 max-w-xl mx-auto my-4 backdrop-blur-sm shadow-md"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2.5 bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 rounded-xl">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
            {operationName}: Partial Success
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {successCount} of {totalCount} items completed successfully. {failedCount} item(s) require attention.
          </p>
        </div>
      </div>

      {/* Progress count pill */}
      <div className="grid grid-cols-2 gap-3 my-3">
        <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="text-[10px] text-slate-400">Successful</p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{successCount}</p>
          </div>
        </div>

        <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800/80 flex items-center gap-2.5">
          <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <div>
            <p className="text-[10px] text-slate-400">Failed</p>
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{failedCount}</p>
          </div>
        </div>
      </div>

      {/* Failed items list */}
      {failedItems.length > 0 && (
        <div className="my-3 max-h-40 overflow-y-auto space-y-1.5 p-2 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800">
          {failedItems.map((item, idx) => (
            <div key={idx} className="p-2 text-xs flex items-start justify-between gap-2 border-b last:border-0 border-slate-100 dark:border-slate-800">
              <span className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</span>
              <span className="text-[11px] text-rose-600 dark:text-rose-400 text-right">{item.reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-amber-200/60 dark:border-amber-900/40">
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-3.5 py-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Dismiss
          </button>
        )}
        {onRetryFailed && failedCount > 0 && (
          <button
            type="button"
            onClick={onRetryFailed}
            disabled={isRetrying}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>{isRetrying ? 'Retrying Failed...' : 'Retry Failed Items Only'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
