import React from 'react';
import { Search, PlusCircle, RotateCcw, FolderOpen, LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  /** If true, renders the 'No Results State' for active search/filters; if false, renders the 'Empty State' */
  isFiltered?: boolean;
  /** Active search query or filter description for No Results State */
  searchQuery?: string;
  /** Title for empty state */
  title?: string;
  /** Explanatory description of what the section is for */
  description?: string;
  /** Primary call-to-action button label */
  actionLabel?: string;
  /** Primary CTA click handler */
  onAction?: () => void;
  /** Action button icon */
  actionIcon?: LucideIcon;
  /** Clear filters click handler (for No Results state) */
  onClearFilters?: () => void;
  /** Custom icon */
  icon?: LucideIcon;
  /** Extra children (e.g. suggestions list) */
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  isFiltered = false,
  searchQuery,
  title,
  description,
  actionLabel = '+ Add Transaction',
  onAction,
  actionIcon: ActionIcon = PlusCircle,
  onClearFilters,
  icon: CustomIcon,
  children,
}) => {
  // -------------------------------------------------------------
  // STATE 08: NO RESULTS STATE (Search / Filter mismatch)
  // -------------------------------------------------------------
  if (isFiltered) {
    return (
      <div className="py-12 px-4 text-center max-w-md mx-auto animate-fade-in">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center shadow-inner">
          <Search className="w-7 h-7" />
        </div>

        <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
          No matching records found
        </h4>

        {searchQuery ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            We found no transactions matching{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              "{searchQuery}"
            </span>
            . Try checking your spelling or clearing filters.
          </p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            No transactions match the selected filter combination.
          </p>
        )}

        <div className="mt-5 flex items-center justify-center gap-3">
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear search filters</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 01: EMPTY STATE (First time / No content yet)
  // -------------------------------------------------------------
  const Icon = CustomIcon || FolderOpen;

  return (
    <div className="py-12 sm:py-16 px-4 text-center max-w-md mx-auto animate-fade-in">
      <div className="w-16 h-16 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-slate-800 border border-emerald-200/60 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
        <Icon className="w-8 h-8" />
      </div>

      <h4 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
        {title || 'Nothing here yet'}
      </h4>

      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
        {description || 'Keep your finances organized. Start by recording your first entry below.'}
      </p>

      {onAction && (
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onAction}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/25 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <ActionIcon className="w-4 h-4" />
            <span>{actionLabel}</span>
          </button>
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
};
