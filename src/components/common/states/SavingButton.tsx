import React from 'react';
import { Loader2, LucideIcon } from 'lucide-react';

export interface SavingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  loadingText?: string;
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabledReason?: string;
}

export const SavingButton: React.FC<SavingButtonProps> = ({
  children,
  isLoading = false,
  loadingText = 'Saving...',
  icon: Icon,
  variant = 'primary',
  disabled,
  disabledReason,
  className = '',
  ...props
}) => {
  const variantStyles = {
    primary:
      'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 active:scale-95 disabled:bg-emerald-400 dark:disabled:bg-emerald-800 disabled:cursor-not-allowed disabled:shadow-none',
    secondary:
      'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
    danger:
      'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 active:scale-95 disabled:bg-rose-400 dark:disabled:bg-rose-800 disabled:cursor-not-allowed disabled:shadow-none',
    ghost:
      'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed',
  };

  const isDisabled = disabled || isLoading;

  return (
    <div className="relative group inline-block w-full sm:w-auto">
      <button
        {...props}
        disabled={isDisabled}
        aria-busy={isLoading}
        className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none cursor-pointer ${
          variantStyles[variant]
        } ${className}`}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{loadingText}</span>
          </>
        ) : (
          <>
            {Icon && <Icon className="w-4 h-4 shrink-0" />}
            <span>{children}</span>
          </>
        )}
      </button>

      {/* Inline guidance when disabled with reason */}
      {disabled && disabledReason && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
          <div className="px-2.5 py-1 text-[11px] font-medium text-white bg-slate-900 dark:bg-slate-800 rounded-lg shadow-xl whitespace-nowrap border border-slate-700">
            {disabledReason}
          </div>
        </div>
      )}
    </div>
  );
};
