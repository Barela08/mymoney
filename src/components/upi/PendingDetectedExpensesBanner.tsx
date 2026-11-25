import React from 'react';
import { BellRing, ChevronRight } from 'lucide-react';
import { useUpiDetection } from '../../context/UpiDetectionContext';
import { formatINR } from '../../lib/dateUtils';

interface PendingDetectedExpensesBannerProps {
  onOpenDetectionSettings: () => void;
}

export const PendingDetectedExpensesBanner: React.FC<PendingDetectedExpensesBannerProps> = ({
  onOpenDetectionSettings,
}) => {
  const { pendingTransactions, openPopupForDetected } = useUpiDetection();

  if (pendingTransactions.length === 0) return null;

  const latest = pendingTransactions[0];
  const totalPendingAmount = pendingTransactions.reduce((sum, tx) => sum + tx.amountRupees, 0);

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/70 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
          <BellRing className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
            {pendingTransactions.length} Uncategorized UPI{' '}
            {pendingTransactions.length === 1 ? 'Expense' : 'Expenses'} (
            <span className="font-mono tabular-nums">{formatINR(totalPendingAmount)}</span>)
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            Latest: {formatINR(latest.amountRupees)}
            {latest.merchantName ? ` to ${latest.merchantName}` : ''} via {latest.sourceApp}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => openPopupForDetected(latest)}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
        >
          Categorize Now
        </button>
        <button
          type="button"
          onClick={onOpenDetectionSettings}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <span>Manage</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
