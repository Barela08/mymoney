import React, { useState } from 'react';
import {
  X,
  Edit3,
  Trash2,
  Copy,
  Share2,
  Calendar,
  Clock,
  ArrowDownLeft,
  CheckCircle2,
  Building,
  CreditCard,
  FileText,
  Landmark,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { Transaction } from '../../types';
import {
  getReceivedCategoryConfig,
  classifyFinancialTransaction,
  PAYMENT_METHODS,
} from '../../lib/receivedMoneyCategories';
import { formatINR, formatDisplayDate, formatDisplayTime, getCurrentISTDate, getCurrentISTTime } from '../../lib/dateUtils';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../common/ConfirmModal';

interface ReceivedTransactionDetailModalProps {
  transaction: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
}

export const ReceivedTransactionDetailModal: React.FC<ReceivedTransactionDetailModalProps> = ({
  transaction,
  isOpen,
  onClose,
  onEdit,
}) => {
  const { deleteTransaction, addTransaction } = useExpense();
  const toast = useToast();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  if (!isOpen || !transaction) return null;

  const categoryConfig = getReceivedCategoryConfig(transaction.subcategory);
  const classification = classifyFinancialTransaction(transaction.subcategory);
  const Icon = categoryConfig.icon;

  const paymentMethodConfig = PAYMENT_METHODS.find(
    (pm) => pm.id === transaction.metadata?.payment_method
  ) || { label: transaction.metadata?.payment_method ? String(transaction.metadata.payment_method).toUpperCase() : 'Not Specified', icon: CreditCard };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteTransaction(transaction.id);
      toast.success('Moved to Recycle Bin', 'Received money transaction was moved to Recycle Bin.');
      setShowDeleteConfirm(false);
      onClose();
    } catch (err: any) {
      toast.error('Delete Failed', err.message || 'Could not delete transaction.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      setIsDuplicating(true);
      await addTransaction({
        category: transaction.category,
        subcategory: transaction.subcategory,
        transaction_type: 'income',
        amount: transaction.amount,
        title: transaction.title,
        description: transaction.description,
        person_name: transaction.person_name,
        transaction_date: getCurrentISTDate(),
        transaction_time: getCurrentISTTime(),
        notes: transaction.notes,
        metadata: {
          ...transaction.metadata,
          duplicated_from: transaction.id,
        },
      });
      toast.success('Transaction Duplicated', 'Created a duplicate entry for today.');
      onClose();
    } catch (err: any) {
      toast.error('Duplicate Failed', err.message || 'Could not duplicate transaction.');
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleShare = async () => {
    const text = `💰 Received Money: ${formatINR(transaction.amount)}\nCategory: ${categoryConfig.label}\nFrom: ${transaction.person_name || transaction.metadata?.received_from || 'Direct'}\nFor: ${transaction.title}\nDate: ${formatDisplayDate(transaction.transaction_date)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Received Money Receipt', text });
      } catch {
        // Ignored if cancelled
      }
    } else {
      navigator.clipboard.writeText(text);
      toast.info('Copied to Clipboard', 'Transaction summary copied to clipboard.');
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="received-detail-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      >
        <div
          className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${categoryConfig.color.iconBg}`}>
                <Icon className="w-5 h-5 stroke-[2]" />
              </div>
              <div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryConfig.color.badge}`}>
                  {categoryConfig.label}
                </span>
                <h2 id="received-detail-title" className="text-xl font-black text-slate-900 dark:text-white mt-1">
                  {formatINR(transaction.amount)}
                </h2>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details Body */}
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs sm:text-sm">
            {/* Classification banner */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Financial Classification</span>
              </div>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  classification === 'earned_income'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'
                    : classification === 'borrowed'
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300'
                    : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300'
                }`}
              >
                {classification === 'earned_income' ? 'Earned Income' : classification === 'borrowed' ? 'Borrowed Money (Liability)' : 'Other Inflow'}
              </span>
            </div>

            {/* Source and Purpose */}
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Received From / Source</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {transaction.person_name || transaction.metadata?.received_from || 'Direct Inflow'}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Title / Description</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                  {transaction.title}
                </p>
                {transaction.description && transaction.description !== transaction.title && (
                  <p className="text-xs text-slate-500 mt-0.5">{transaction.description}</p>
                )}
              </div>
            </div>

            <div className="h-px bg-slate-100 dark:bg-slate-800" />

            {/* Payment Method & UTR */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Payment Method</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{paymentMethodConfig.label}</span>
                </p>
              </div>

              {transaction.metadata?.utr && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">UTR / Reference</p>
                  <p className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300 mt-0.5 truncate">
                    {transaction.metadata.utr}
                  </p>
                </div>
              )}

              {transaction.metadata?.account_reference && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Account Reference</p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5 truncate">
                    {transaction.metadata.account_reference}
                  </p>
                </div>
              )}
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Transaction Date</p>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{formatDisplayDate(transaction.transaction_date)}</span>
                </p>
              </div>

              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</p>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>{formatDisplayTime(transaction.transaction_time)}</span>
                </p>
              </div>
            </div>

            {/* Notes if present */}
            {transaction.notes && (
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Private Notes</p>
                <div className="mt-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border border-slate-100 dark:border-slate-800">
                  {transaction.notes}
                </div>
              </div>
            )}

            {/* System ID */}
            <div className="pt-2">
              <p className="text-[10px] font-mono text-slate-400">
                Transaction ID: {transaction.id}
              </p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(transaction);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Duplicate</span>
              </button>

              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 text-xs font-bold transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Move to Recycle Bin?"
        message="Are you sure you want to delete this received money transaction? It will be safely stored in the Recycle Bin for 30 days."
        confirmLabel={isDeleting ? 'Moving...' : 'Move to Recycle Bin'}
        itemDetails={{
          title: transaction.title,
          amount: formatINR(transaction.amount),
          date: `${formatDisplayDate(transaction.transaction_date)} at ${formatDisplayTime(transaction.transaction_time)}`,
        }}
        isLoading={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
};
