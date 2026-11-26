import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Smartphone,
  ShieldCheck,
  Building2,
  Tag,
  AlertCircle,
  BellRing,
} from 'lucide-react';
import { useUpiDetection } from '../../context/UpiDetectionContext';
import {
  UPI_EXPENSE_CATEGORIES,
  type UpiExpenseCategoryId,
} from '../../lib/upiDetectionEngine';
import { formatINR } from '../../lib/dateUtils';

export const InstantExpensePopupModal: React.FC = () => {
  const {
    activePopupTransaction,
    pendingTransactions,
    openPopupForDetected,
    closeActivePopup,
    saveCategorizedExpense,
    remindLaterDetectedTransaction,
    dismissDetectedTransaction,
  } = useUpiDetection();

  const [selectedCategory, setSelectedCategory] = useState<UpiExpenseCategoryId | ''>('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activePopupTransaction) {
      setSelectedCategory(activePopupTransaction.selectedCategory || 'Food');
      setDescription(activePopupTransaction.description || '');
      setErrorMsg(null);
      setIsSaving(false);
    }
  }, [activePopupTransaction]);

  // If no popup is active, check if there are pending transactions to show the pending indicator
  if (!activePopupTransaction) {
    if (pendingTransactions.length > 0) {
      return (
        <aside
          aria-label="Pending UPI Payments"
          className="fixed bottom-20 sm:bottom-6 right-3 sm:right-6 z-[70] pointer-events-auto"
        >
          <button
            type="button"
            onClick={() => openPopupForDetected(pendingTransactions[0])}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-950/20 text-xs font-bold transition-all cursor-pointer border border-emerald-500/50 animate-in fade-in slide-in-from-bottom-2 duration-300"
            title="Click to record pending UPI payment"
          >
            <BellRing className="w-3.5 h-3.5 animate-pulse text-emerald-200" />
            <span>
              {pendingTransactions.length} Pending UPI {pendingTransactions.length === 1 ? 'Payment' : 'Payments'}
            </span>
          </button>
        </aside>
      );
    }
    return null;
  }

  const tx = activePopupTransaction;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) {
      setErrorMsg('Please select a category for this expense.');
      return;
    }
    try {
      setIsSaving(true);
      setErrorMsg(null);
      await saveCategorizedExpense(tx, selectedCategory as UpiExpenseCategoryId, description);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save expense.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDismiss = async () => {
    // Preserve unsaved transaction in pending queue and close the floating popup
    await remindLaterDetectedTransaction(tx.id);
  };

  return (
    <aside
      aria-label="Automatic UPI Payment Quick Entry"
      className="fixed bottom-20 sm:bottom-6 right-3 sm:right-6 z-[80] w-[calc(100%-1.5rem)] sm:w-[390px] pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300 shadow-2xl"
    >
      <div className="bg-white dark:bg-slate-900 border-2 border-emerald-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-colors">
        {/* Compact Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-slate-900 border-b border-emerald-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-emerald-800 dark:text-emerald-300 truncate">
                Payment detected: {formatINR(tx.amountRupees, tx.amountPaise % 100 !== 0)}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Via {tx.sourceApp}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeActivePopup}
            aria-label="Close popup"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-4 space-y-3.5 text-xs">
          {/* Read-Only Details Card */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
            {tx.merchantName ? (
              <div className="flex items-start gap-2">
                <Building2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Receiver</span>
                  <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                    {tx.merchantName}
                  </p>
                </div>
              </div>
            ) : null}

            {(tx.utrNumber || tx.rrn || tx.upiTransactionId) && (
              <div className="flex items-start gap-2 pt-1 border-t border-slate-200 dark:border-slate-800/80">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400">
                    {tx.utrNumber ? 'UTR' : tx.rrn ? 'RRN' : 'Ref'}
                  </span>
                  <p className="font-mono text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                    {tx.utrNumber || tx.rrn || tx.upiTransactionId}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Field 1: Category Dropdown */}
          <div className="space-y-1">
            <label
              htmlFor="upi-popup-category-select"
              className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5"
            >
              <Tag className="w-3.5 h-3.5 text-emerald-600" />
              <span>Category</span>
              <span className="text-rose-500">*</span>
            </label>
            <select
              id="upi-popup-category-select"
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value as UpiExpenseCategoryId);
                setErrorMsg(null);
              }}
              className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="" disabled>
                Select Category
              </option>
              {UPI_EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.mappedCategory})
                </option>
              ))}
            </select>
          </div>

          {/* Field 2: What was this expense for? */}
          <div className="space-y-1">
            <label
              htmlFor="upi-popup-description"
              className="font-bold text-slate-800 dark:text-slate-200"
            >
              What was this expense for?
            </label>
            <input
              id="upi-popup-description"
              type="text"
              maxLength={120}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                tx.merchantName
                  ? `e.g. Lunch at ${tx.merchantName}`
                  : 'Enter description...'
              }
              className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {errorMsg && (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Actions: Save Expense & Dismiss */}
          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleDismiss}
              disabled={isSaving}
              className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer text-center"
            >
              Dismiss
            </button>

            <button
              type="submit"
              disabled={isSaving || !selectedCategory}
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Expense'}</span>
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
};
