import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  Receipt,
  AlertCircle,
  CreditCard,
  Banknote,
  Building,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharTransactionItem,
} from '../../lib/udharDeletionApi';
import { formatINR, getCurrentISTDate } from '../../lib/dateUtils';

interface RepayUdharModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: UdharTransactionItem | null;
  onSuccess?: () => void;
}

export const RepayUdharModal: React.FC<RepayUdharModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onSuccess,
}) => {
  const toast = useToast();

  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Cash' | 'Bank Transfer'>('UPI');
  const [repayDate, setRepayDate] = useState<string>(getCurrentISTDate());
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !transaction) return;
    setAmount('');
    setPaymentMethod('UPI');
    setRepayDate(getCurrentISTDate());
    setNotes('');
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, transaction?.id, isSubmitting, onClose]);

  if (!isOpen || !transaction) return null;

  const currentBal = parseFloat(String(transaction.current_balance)) || 0;
  const originalAmt = parseFloat(String(transaction.original_amount)) || 0;
  const isTwoSided = Boolean(transaction.counterpart_user_id);
  const isBorrower = transaction.direction === 'took';

  const handleSetFullSettlement = () => {
    setAmount(String(currentBal));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const repayVal = parseFloat(amount);
    if (isNaN(repayVal) || repayVal <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid repayment amount greater than ₹0.');
      return;
    }

    if (repayVal > currentBal + 0.05) {
      toast.error('Exceeds Balance', `Amount cannot exceed remaining balance (${formatINR(currentBal)}).`);
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await udharDeletionApi.repayUdharTransaction(transaction.id, {
        amount: repayVal,
        repayment_date: repayDate,
        payment_method: paymentMethod,
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        toast.success(
          res.isPendingConfirmation
            ? 'Submitted for Confirmation'
            : res.isSettled
              ? 'Account Settled!'
              : 'Repayment Logged',
          res.message
        );
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err: any) {
      toast.error('Repayment Error', err.message || 'Failed to record repayment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm sm:max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Record Repayment
              </h3>
              <p className="text-[11px] text-slate-500">
                With {transaction.counterpart_name} ({transaction.direction === 'gave' ? 'You Lent' : 'You Borrowed'})
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

        {/* Current Balance Overview */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Remaining Balance
            </span>
            <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-sans">
              {formatINR(currentBal)}
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Original Amount
            </span>
            <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {formatINR(originalAmt)}
            </div>
          </div>
        </div>

        {/* Notice for 2-way connected borrowers */}
        {isTwoSided && isBorrower && (
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Mutual Confirmation System</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                Since {transaction.counterpart_name} is a connected user, this repayment will be sent to them to confirm receipt before the debt is marked settled.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                Repayment Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleSetFullSettlement}
                className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Pay Full ({formatINR(currentBal)})
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-2.5 font-bold text-slate-400">₹</span>
              <input
                type="number"
                step="any"
                min="1"
                max={currentBal}
                required
                placeholder={`Up to ${currentBal}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('UPI')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'UPI'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>UPI</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('Cash')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'Cash'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Cash</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('Bank Transfer')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'Bank Transfer'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Building className="w-3.5 h-3.5" />
                <span>Bank</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Repayment Date
            </label>
            <input
              type="date"
              required
              value={repayDate}
              onChange={(e) => setRepayDate(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Payment Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Paid via Google Pay, transaction ref #1234"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
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
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <span>Recording...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Submit Repayment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
