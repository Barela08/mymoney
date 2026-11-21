import React from 'react';
import { SearchX, RotateCcw, Filter } from 'lucide-react';

export interface NoResultsStateProps {
  query?: string;
  activeFilters?: { label: string; value: string }[];
  onReset: () => void;
  suggestions?: string[];
  onSelectSuggestion?: (term: string) => void;
}

export const NoResultsState: React.FC<NoResultsStateProps> = ({
  query,
  activeFilters = [],
  onReset,
  suggestions = ['Gas', 'Grocery', 'Rent', 'Milk', 'Electricity', 'Shopping'],
  onSelectSuggestion,
}) => {
  return (
    <div
      role="status"
      aria-label="No matching search results"
      className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 backdrop-blur-sm"
    >
      <div className="p-3.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl w-fit mx-auto mb-4">
        <SearchX className="w-8 h-8" />
      </div>

      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">
        No Matching Transactions Found
      </h3>

      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
        We couldn't find any financial records matching your search or filters. Try adjusting keywords or clearing active filters.
      </p>

      {/* Applied Filters Summary */}
      {(query || activeFilters.length > 0) && (
        <div className="flex items-center justify-center gap-1.5 flex-wrap max-w-lg mx-auto mb-6">
          {query && (
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
              <span>Query:</span>
              <span className="font-mono font-bold">"{query}"</span>
            </span>
          )}
          {activeFilters.map((f, idx) => (
            <span
              key={idx}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1"
            >
              <Filter className="w-2.5 h-2.5 text-slate-400" />
              <span>{f.label}:</span>
              <span className="font-semibold">{f.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Reset Action */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Clear All Filters & Reset</span>
        </button>
      </div>

      {/* Search suggestions */}
      {suggestions.length > 0 && onSelectSuggestion && (
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800/80">
          <p className="text-xs text-slate-400 mb-2">Try searching for:</p>
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {suggestions.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => onSelectSuggestion(term)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
