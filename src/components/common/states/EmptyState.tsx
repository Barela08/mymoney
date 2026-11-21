import React from 'react';
import {
  Inbox,
  PlusCircle,
  LucideIcon,
  ShoppingBag,
  Home,
  DoorOpen,
  Utensils,
  Users,
  Receipt,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  helpTip?: string;
  variant?: 'default' | 'home' | 'room' | 'food' | 'other' | 'people' | 'recycle' | 'reports';
  className?: string;
}

const variantStyles: Record<
  string,
  { bg: string; text: string; border: string; defaultIcon: LucideIcon }
> = {
  default: {
    bg: 'bg-slate-100 dark:bg-slate-800/80',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-800',
    defaultIcon: Inbox,
  },
  home: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/60',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    defaultIcon: Home,
  },
  room: {
    bg: 'bg-teal-50 dark:bg-teal-950/60',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-900/60',
    defaultIcon: DoorOpen,
  },
  food: {
    bg: 'bg-amber-50 dark:bg-amber-950/60',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-900/60',
    defaultIcon: Utensils,
  },
  other: {
    bg: 'bg-purple-50 dark:bg-purple-950/60',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-900/60',
    defaultIcon: ShoppingBag,
  },
  people: {
    bg: 'bg-blue-50 dark:bg-blue-950/60',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-900/60',
    defaultIcon: Users,
  },
  recycle: {
    bg: 'bg-rose-50 dark:bg-rose-950/60',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-200 dark:border-rose-900/60',
    defaultIcon: Trash2,
  },
  reports: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/60',
    text: 'text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-200 dark:border-indigo-900/60',
    defaultIcon: FileSpreadsheet,
  },
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  helpTip,
  variant = 'default',
  className = '',
}) => {
  const config = variantStyles[variant] || variantStyles.default;
  const IconComponent = icon || config.defaultIcon;

  return (
    <div
      role="status"
      aria-label={title}
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-2xl border-2 border-dashed ${config.border} bg-white/50 dark:bg-slate-900/40 backdrop-blur-sm transition-all duration-300 ${className}`}
    >
      <div
        className={`p-4 rounded-2xl ${config.bg} ${config.text} mb-4 shadow-sm ring-4 ring-white dark:ring-slate-900`}
      >
        <IconComponent className="w-8 h-8 sm:w-10 sm:h-10" aria-hidden="true" />
      </div>

      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 tracking-tight">
        {title}
      </h3>

      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
        {description}
      </p>

      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{actionLabel}</span>
            </button>
          )}

          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm rounded-xl transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
            >
              <span>{secondaryActionLabel}</span>
            </button>
          )}
        </div>
      )}

      {helpTip && (
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
          <span>💡 Tip:</span>
          <span>{helpTip}</span>
        </div>
      )}
    </div>
  );
};
