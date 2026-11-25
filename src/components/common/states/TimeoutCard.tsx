import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';

export interface TimeoutCardProps {
  operationName?: string;
  referenceId?: string;
  onVerifyStatus?: () => void;
  onRetry?: () => void;
  isVerifying?: boolean;
}

export const TimeoutCard: React.FC<TimeoutCardProps> = ({
  operationName = 'Transaction Sync',
  referenceId,
  onVerifyStatus,
  onRetry,
  isVerifying = false,
}) => {
  return (
    <div
      role="alert"
      className="p-6 sm:p-8 rounded-3xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-center max-w-lg mx-auto my-6 backdrop-blur-sm shadow-lg"
    >
      <div className="p-3.5 bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 rounded-2xl w-fit mx-auto mb-4">
        <Clock className="w-8 h-8" />
      </div>

      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">
        Operation Timed Out: {operationName}
      </h3>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
        The network connection took longer than expected. To prevent duplicate records or payments, we recommend verifying the current database status before submitting again.
      </p>

      {referenceId && (
        <div className="mb-5 inline-block px-3 py-1.5 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-mono text-amber-800 dark:text-amber-200">
          Tracking ID: <span className="font-bold">{referenceId}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {onVerifyStatus && (
          <button
            type="button"
            onClick={onVerifyStatus}
            disabled={isVerifying}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-60 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isVerifying ? 'animate-spin' : ''}`} />
            <span>{isVerifying ? 'Checking Status...' : 'Verify Database Status'}</span>
          </button>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <span>Safe Retry</span>
          </button>
        )}
      </div>
    </div>
  );
};
