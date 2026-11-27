import React, { useState, useEffect } from 'react';
import {
  X,
  Edit3,
  ShieldAlert,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharTransactionItem,
} from '../../lib/udharDeletionApi';
import { formatINR } from '../../lib/dateUtils';

interface EditUdharModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: UdharTransactionItem | null;
  onSuccess?: () => void;
}

export const EditUdharModal: React.FC<EditUdharModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onSuccess,
}) => {
  const toast = useToast();

  const [amount, setAmount] = useState<string>(
    transaction ? String(transaction.original_amount) : ''
  );
  const [txDate, setTxDate] = useState<string>(
    transaction ? transaction.transaction_date.split('T')[0] : ''
  );
  const [dueDate, setDueDate] = useState<string>(
    transaction?.due_date ? transaction.due_date.split('T')[0] : ''
  );
  const [notes, setNotes] = useState<string>(transaction?.notes || '');
  const [editReason, setEditReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !transaction) return;
    setAmount(String(transaction.original_amount));
    setTxDate(transaction.transaction_date ? transaction.transaction_date.split('T')[0] : '');
    setDueDate(transaction.due_date ? transaction.due_date.split('T')[0] : '');
    setNotes(transaction.notes || '');
    setEditReason('');
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, transaction?.id, isSubmitting, onClose]);

  if (!isOpen || !transaction) return null;

  const currentBal = parseFloat(String(transaction.current_balance)) || 0;
  const originalAmt = parseFloat(String(transaction.original_amount)) || 0;
  const totalRepaid = Math.max(0, originalAmt - currentBal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newAmt = parseFloat(amount);
    if (isNaN(newAmt) || newAmt <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than ₹0.');
      return;
    }

    if (newAmt < totalRepaid) {
      toast.error(
        'Invalid Amount',
        `New amount cannot be less than already repaid amount (${formatINR(totalRepaid)}).`
      );
      return;
    }

    const cleanReason = editReason.trim();
    if (!cleanReason || cleanReason.length < 3) {
      toast.error('Reason Required', 'Please provide a clear reason for modifying this Udhar record.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await udharDeletionApi.editUdharTransaction(transaction.id, {
        amount: newAmt,
        notes: notes.trim() || undefined,
        transaction_date: txDate,
        due_date: dueDate || null,
        reason_for_edit: cleanReason,
      });

      if (res.success) {
        toast.success('Udhar Updated', res.message);
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err: any) {
      toast.error('Update Failed', err.message || 'Could not update transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Edit Udhar Details
              </h3>
              <p className="text-[11px] text-slate-500">
                Record with {transaction.counterpart_name}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Repayment Preservation Banner */}
        {totalRepaid > 0 && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <ShieldAlert className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Repayments Preserved</p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                {formatINR(totalRepaid)} has already been repaid towards this record. Editing the total amount will safely recalculate remaining balance without resetting your repayment history.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Total Amount (₹) *
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 font-bold text-slate-400">₹</span>
              <input
                type="number"
                step="any"
                min={totalRepaid > 0 ? totalRepaid : 1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Transaction Date *
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Due Date (Optional)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason or description of the Udhar"
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Reason for Edit * <span className="text-slate-400 font-normal">(Visible in audit history)</span>
            </label>
            <input
              type="text"
              required
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. Corrected typo in amount, extended due date"
              className="w-full px-3.5 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/20 font-medium focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? 'Saving Changes...' : 'Save & Sync'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
