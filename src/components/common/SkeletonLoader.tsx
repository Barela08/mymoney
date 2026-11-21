import React from 'react';

/**
 * Skeleton Loader Components (State 02: Loading State)
 * Provides gentle shimmer placeholders matching the shape of incoming cards and text,
 * preventing layout shift when data arrives.
 */

export const StatCardSkeleton: React.FC = () => (
  <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse">
    <div className="flex items-center justify-between">
      <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded-md" />
      <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
    <div className="h-7 w-32 bg-slate-200 dark:bg-slate-800 rounded-lg mt-3" />
    <div className="h-2.5 w-24 bg-slate-200 dark:bg-slate-800 rounded-md mt-2" />
  </div>
);

export const TransactionCardSkeleton: React.FC = () => (
  <div className="py-3.5 px-3 flex items-center justify-between gap-3 animate-pulse">
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-800 shrink-0" />
      <div className="space-y-1.5 flex-1 min-w-0">
        <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded-md" />
        <div className="h-2.5 w-24 bg-slate-200 dark:bg-slate-800 rounded-md" />
      </div>
    </div>
    <div className="space-y-1.5 text-right">
      <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded-md ml-auto" />
      <div className="h-2.5 w-10 bg-slate-200 dark:bg-slate-800 rounded-md ml-auto" />
    </div>
  </div>
);

export const TransactionListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
    {Array.from({ length: count }).map((_, idx) => (
      <TransactionCardSkeleton key={idx} />
    ))}
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-pulse">
    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
      <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
      <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
    </div>
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="p-4 flex items-center justify-between gap-4">
          <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3.5 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3.5 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3.5 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  </div>
);
