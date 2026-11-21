import React from 'react';

export const SkeletonShimmer: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-slate-200/80 dark:bg-slate-800/80 rounded-xl ${className}`}
    aria-hidden="true"
  />
);

export const SkeletonCard: React.FC = () => (
  <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
    <div className="flex items-center justify-between">
      <SkeletonShimmer className="w-9 h-9 rounded-xl" />
      <SkeletonShimmer className="w-16 h-4 rounded-md" />
    </div>
    <div className="space-y-1.5 pt-1">
      <SkeletonShimmer className="w-24 h-3.5 rounded" />
      <SkeletonShimmer className="w-36 h-6 rounded-md" />
    </div>
    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
      <SkeletonShimmer className="w-28 h-3 rounded" />
    </div>
  </div>
);

export const SkeletonCardsGrid: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" role="status" aria-label="Loading statistics">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const SkeletonRow: React.FC = () => (
  <div className="py-3.5 px-3 flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 animate-pulse">
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <SkeletonShimmer className="w-10 h-10 rounded-xl shrink-0" />
      <div className="space-y-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <SkeletonShimmer className="w-32 h-4 rounded" />
          <SkeletonShimmer className="w-14 h-4 rounded" />
        </div>
        <SkeletonShimmer className="w-48 h-3 rounded" />
      </div>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      <SkeletonShimmer className="w-20 h-5 rounded" />
      <div className="flex gap-1">
        <SkeletonShimmer className="w-7 h-7 rounded-lg" />
        <SkeletonShimmer className="w-7 h-7 rounded-lg" />
      </div>
    </div>
  </div>
);

export const SkeletonTable: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3" role="status" aria-label="Loading records">
    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
      <SkeletonShimmer className="w-36 h-5 rounded" />
      <SkeletonShimmer className="w-24 h-4 rounded" />
    </div>
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  </div>
);

export const SkeletonChart: React.FC<{ height?: string; className?: string }> = ({
  height = 'h-64',
  className = '',
}) => (
  <div className={`p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4 ${className}`} role="status" aria-label="Loading charts">
    <div className="flex items-center justify-between">
      <SkeletonShimmer className="w-40 h-5 rounded" />
      <div className="flex gap-2">
        <SkeletonShimmer className="w-16 h-7 rounded-xl" />
        <SkeletonShimmer className="w-16 h-7 rounded-xl" />
      </div>
    </div>
    <SkeletonShimmer className={`w-full ${height} rounded-xl`} />
  </div>
);
