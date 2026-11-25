import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Clock,
  Smartphone,
  ShieldCheck,
  Hash,
  Building2,
  Calendar,
  Tag,
  AlertCircle,
} from 'lucide-react';
import { useUpiDetection } from '../../context/UpiDetectionContext';
import {
  UPI_EXPENSE_CATEGORIES,
  type UpiExpenseCategoryId,
} from '../../lib/upiDetectionEngine';
import { formatINR } from '../../lib/dateUtils';

function formatDetectedDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export const InstantExpensePopupModal: React.FC = () => {
  const {
    activePopupTransaction,
    closeActivePopup,
    saveCategorizedExpense,
    remindLaterDetectedTransaction,
    dismissDetectedTransaction,
  } = useUpiDetection();

  const [selectedCategory, setSelectedCategory] = useState<UpiExpenseCategoryId | null>(null);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activePopupTransaction) {
      setSelectedCategory(activePopupTransaction.selectedCategory || null);
      setDescription(activePopupTransaction.description || '');
      setErrorMsg(null);
      setIsSaving(false);
    }
  }, [activePopupTransaction]);

  if (!activePopupTransaction) return null;

  const tx = activePopupTransaction;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) {
      setErrorMsg('Please select an expense category before saving.');
      return;
    }
    try {
      setIsSaving(true);
      setErrorMsg(null);
      await saveCategorizedExpense(tx, selectedCategory, description);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save expense right now.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemindLater = async () => {
    await remindLaterDetectedTransaction(tx.id);
  };

  const handleDismiss = async () => {
    await dismissDetectedTransaction(tx.id);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upi-instant-popup-title"
    >
      <div className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Top Bar */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h2
                id="upi-instant-popup-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate"
              >
                Automatic Expense Detected
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tx.isTestSample
                ? 'Parser Test Sample · Confirm category to test ledger sync'
                : 'Select a category to record this outgoing UPI payment'}
            </p>
          </div>
          <button
            type="button"
            onClick={closeActivePopup}
            aria-label="Close popup"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSave} className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Extracted Payment Summary */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Paid Amount
                </p>
                <p className="text-2xl font-semibold text-slate-950 dark:text-white tabular-nums font-mono">
                  {formatINR(tx.amountRupees, tx.amountPaise % 100 !== 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Payment App
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {tx.sourceApp}
                </p>
              </div>
            </div>

            {/* Structured Extracted Fields (Missing values are never fabricated) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
              {tx.merchantName && (
                <div className="flex items-start gap-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Merchant / Receiver
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 break-words">
                      {tx.merchantName}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Date &amp; Time
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatDetectedDateTime(tx.transactionTimestamp)}
                  </span>
                </div>
              </div>

              {tx.upiTransactionId && (
                <div className="flex items-start gap-2">
                  <Hash className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      UPI Transaction ID
                    </span>
                    <span className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100 break-all">
                      {tx.upiTransactionId}
                    </span>
                  </div>
                </div>
              )}

              {(tx.utrNumber || tx.rrn) && (
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      {tx.utrNumber ? 'UTR Number' : 'RRN Number'}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100 break-all">
                      {tx.utrNumber || tx.rrn}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 13 Category Selection Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Select Expense Category</span>
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Required</span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {UPI_EXPENSE_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setErrorMsg(null);
                    }}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:text-slate-950 dark:border-emerald-500 font-semibold'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="upi-popup-description"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Description <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </label>
            <input
              id="upi-popup-description"
              type="text"
              maxLength={180}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                tx.merchantName
                  ? `e.g., Lunch order from ${tx.merchantName}`
                  : 'Add a short note for this expense'
              }
              className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Action Bar */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 order-2 sm:order-1">
              <button
                type="button"
                onClick={handleRemindLater}
                disabled={isSaving}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Remind Me Later</span>
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                disabled={isSaving}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>

            <button
              type="submit"
              disabled={isSaving || !selectedCategory}
              className="order-1 sm:order-2 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Expense'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
