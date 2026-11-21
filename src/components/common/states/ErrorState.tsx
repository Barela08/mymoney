import React from 'react';
import { AlertCircle, RefreshCw, HelpCircle, ArrowLeft } from 'lucide-react';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  technicalDetails?: string;
  onRetry?: () => void;
  onBack?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Unable to Load Financial Data',
  message = 'We encountered an unexpected problem while fetching your records. Your existing data remains safe.',
  technicalDetails,
  onRetry,
  onBack,
  className = '',
}) => {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div
      role="alert"
      className={`p-6 sm:p-10 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-center max-w-xl mx-auto my-6 backdrop-blur-sm ${className}`}
    >
      <div className="p-3.5 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-2xl w-fit mx-auto mb-4">
        <AlertCircle className="w-8 h-8" />
      </div>

      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
        {title}
      </h3>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
        {message}
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-rose-600/20 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
        )}

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </button>
        )}
      </div>

      {technicalDetails && (
        <div className="mt-6 pt-4 border-t border-rose-200/60 dark:border-rose-900/40 text-left">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] text-slate-500 dark:text-slate-400 underline hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer flex items-center gap-1"
          >
            <HelpCircle className="w-3 h-3" />
            <span>{showDetails ? 'Hide technical diagnostics' : 'Show technical diagnostics'}</span>
          </button>
          {showDetails && (
            <pre className="mt-2 p-3 bg-slate-900 text-slate-100 text-[11px] font-mono rounded-xl overflow-x-auto border border-slate-800 max-h-36">
              {technicalDetails}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
