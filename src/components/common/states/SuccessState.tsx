import React from 'react';
import { CheckCircle2, ArrowRight, Download, Share2 } from 'lucide-react';

export interface SuccessStateProps {
  title: string;
  message: string;
  referenceId?: string;
  details?: { label: string; value: string }[];
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const SuccessState: React.FC<SuccessStateProps> = ({
  title,
  message,
  referenceId,
  details = [],
  primaryActionLabel = 'Continue',
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}) => {
  return (
    <div
      role="status"
      className={`p-6 sm:p-10 rounded-3xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/20 text-center max-w-lg mx-auto my-6 backdrop-blur-sm ${className}`}
    >
      <div className="p-4 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 rounded-2xl w-fit mx-auto mb-4 shadow-sm animate-bounce">
        <CheckCircle2 className="w-10 h-10" />
      </div>

      <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">
        {title}
      </h3>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
        {message}
      </p>

      {referenceId && (
        <div className="mb-5 inline-block px-3 py-1.5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 rounded-xl text-xs font-mono text-emerald-700 dark:text-emerald-300">
          Ref ID: <span className="font-bold">{referenceId}</span>
        </div>
      )}

      {details.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 text-left text-xs divide-y divide-slate-100 dark:divide-slate-800">
          {details.map((d, i) => (
            <div key={i} className="py-2 flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">{d.label}</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {primaryActionLabel && onPrimaryAction && (
          <button
            type="button"
            onClick={onPrimaryAction}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
          >
            <span>{primaryActionLabel}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
};
