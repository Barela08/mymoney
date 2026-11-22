import React from 'react';
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { formatINR } from '../../lib/dateUtils';

interface SettleUdharModalProps {
  isOpen: boolean;
  onClose: () => void;
  personName: string;
  balance: number;
  isLoading: boolean;
  onConfirm: () => void;
}

export const SettleUdharModal: React.FC<SettleUdharModalProps> = ({
  isOpen,
  onClose,
  personName,
  balance,
  isLoading,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const isPositive = balance > 0;
  const absBal = Math.abs(balance);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Settle Balance
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {personName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center space-y-1">
            <p className="text-slate-500 dark:text-slate-400 font-medium">Outstanding Amount</p>
            <p className={`text-2xl font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatINR(absBal)}
            </p>
            <p className="text-[11px] font-semibold text-slate-500">
              {isPositive ? `You will receive ${formatINR(absBal)}` : `You owe ${formatINR(absBal)}`}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed text-[11px]">
              Settling will record a balancing transaction to bring the outstanding amount with {personName} to ₹0. All past records remain permanently in your history.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Settling...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm Settlement</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
