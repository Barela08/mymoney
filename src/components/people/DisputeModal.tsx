import React, { useState } from 'react';
import {
  X,
  FileQuestion,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, UdharTransactionItem } from '../../lib/udharDeletionApi';
import { formatINR } from '../../lib/dateUtils';

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: UdharTransactionItem | null;
  onSuccess?: () => void;
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onSuccess,
}) => {
  const toast = useToast();
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Reason Required', 'Please enter why you are disputing this transaction.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await udharDeletionApi.disputeUdharTransaction(transaction.id, reason.trim());
      if (res.success) {
        toast.warning('Dispute Filed', 'Transaction marked as disputed. Both parties can review the details.');
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to dispute transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-6 sm:p-7 border border-rose-200 dark:border-rose-900 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800">
              <FileQuestion className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Dispute Transaction
              </h3>
              <p className="text-[11px] text-slate-500">Record a formal disagreement</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3.5 bg-amber-50/60 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-300 space-y-1">
          <p className="font-bold">Transaction Summary:</p>
          <p>• Person: {transaction.counterpart_name}</p>
          <p>• Amount: {formatINR(Number(transaction.original_amount) || 0)}</p>
          <p>• Type: {transaction.direction === 'gave' ? 'Money Lent (Given)' : 'Money Borrowed (Taken)'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Reason for Dispute <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              placeholder="e.g. Incorrect amount, already settled in cash yesterday, or not authorized by me."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-amber-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? <span>Marking Dispute...</span> : <span>Confirm Dispute</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
