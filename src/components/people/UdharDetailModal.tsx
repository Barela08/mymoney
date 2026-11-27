import React, { useState, useEffect } from 'react';
import {
  X,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Edit3,
  CreditCard,
  Banknote,
  Building,
  RotateCcw,
  Check,
  History,
  ShieldCheck,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharTransactionItem,
  UdharRepayment,
  UdharEditHistoryItem,
} from '../../lib/udharDeletionApi';
import { formatINR, formatDisplayDate } from '../../lib/dateUtils';
import {
  canAcceptUdhar,
  canCancelUdhar,
  canDeleteRepayment,
  canRejectUdhar,
  canSenderCancelUdhar,
  isActiveRepayment,
  getUdharSettlementStatus,
  normalizeUdharLifecycleStatus,
} from '../../lib/sharedUdharEngine';
import { ConfirmModal } from '../common/ConfirmModal';
import { EditUdharModal } from './EditUdharModal';
import { RepayUdharModal } from './RepayUdharModal';
import { SettleUdharModal } from './SettleUdharModal';

interface UdharDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: UdharTransactionItem | null;
  onRefreshUdhar?: () => void;
}

export const UdharDetailModal: React.FC<UdharDetailModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onRefreshUdhar,
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'repayments' | 'history'>('repayments');
  const [latestTransaction, setLatestTransaction] = useState<UdharTransactionItem | null>(transaction);
  const [historyList, setHistoryList] = useState<UdharEditHistoryItem[]>([]);
  const [repaymentsList, setRepaymentsList] = useState<UdharRepayment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Submodals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRepayModalOpen, setIsRepayModalOpen] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [isRejectRequestOpen, setIsRejectRequestOpen] = useState(false);
  const [isCancelRequestOpen, setIsCancelRequestOpen] = useState(false);
  const [requestRejectReason, setRequestRejectReason] = useState('');
  const [deletingRepayment, setDeletingRepayment] = useState<UdharRepayment | null>(null);
  const [isSettlingTx, setIsSettlingTx] = useState(false);

  // Reject dialog state
  const [rejectingRepaymentId, setRejectingRepaymentId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const activeTx = latestTransaction || transaction;

  const fetchDetails = async () => {
    if (!transaction) return;
    try {
      setIsLoadingHistory(true);
      const res = await udharDeletionApi.getUdharTransactionHistory(transaction.id);
      if (res.success) {
        if (res.transaction) setLatestTransaction(res.transaction);
        setHistoryList(res.editHistory || []);
        setRepaymentsList((res.repayments || []).filter((r) => isActiveRepayment(r)));
      }
    } catch (err: any) {
      console.warn('Could not fetch transaction history:', err.message);
      setLatestTransaction(transaction);
      setRepaymentsList((transaction.repayments || []).filter((r) => isActiveRepayment(r)));
      setHistoryList(transaction.edit_history || []);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    setLatestTransaction(transaction);
    if (isOpen && transaction) {
      fetchDetails();
    }
  }, [isOpen, transaction]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessingAction && !isSettlingTx) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isProcessingAction, isSettlingTx, onClose]);

  if (!isOpen || !activeTx) return null;

  const isLender = activeTx.direction === 'gave';
  const isTwoSided = Boolean(activeTx.counterpart_user_id);
  const canManageAsLender = !isTwoSided || isLender;
  const lifecycle = normalizeUdharLifecycleStatus(activeTx);
  const isPendingConfirm = lifecycle === 'pending_confirmation';
  const isRejectedOrCancelled = lifecycle === 'rejected' || lifecycle === 'cancelled';
  const statusInfo = getUdharSettlementStatus({
    status: activeTx.status,
    deleted_at: activeTx.deleted_at,
    notes: activeTx.notes,
    original_amount: activeTx.original_amount,
    current_balance: activeTx.current_balance,
    paid_amount: activeTx.paid_amount,
    repayments: repaymentsList.length > 0 ? repaymentsList : activeTx.repayments,
  });
  const currentBal = statusInfo.remainingAmount;
  const originalAmt = statusInfo.originalAmount;
  const paidAmt = statusInfo.paidAmount;
  const isSettled = statusInfo.isSettled;
  const isCancelled = lifecycle === 'cancelled' || lifecycle === 'deleted';
  const cancelGuard = canCancelUdhar({
    status: activeTx.status,
    deleted_at: activeTx.deleted_at,
    notes: activeTx.notes,
    direction: activeTx.direction,
    is_shared: isTwoSided,
    counterpart_user_id: activeTx.counterpart_user_id,
    original_amount: activeTx.original_amount,
    paid_amount: paidAmt,
    current_balance: activeTx.current_balance,
    settled_at: activeTx.settled_at,
    repayments: repaymentsList.length > 0 ? repaymentsList : activeTx.repayments,
  });
  const acceptGuard = canAcceptUdhar(activeTx, user?.id || user?.uid);
  const rejectGuard = canRejectUdhar(activeTx, user?.id || user?.uid);
  const senderCancelGuard = canSenderCancelUdhar(activeTx, user?.id || user?.uid);
  const todayStr = new Date().toISOString().split('T')[0];
  const isOverdue =
    Boolean(activeTx.due_date && activeTx.due_date < todayStr) &&
    !isSettled &&
    !isPendingConfirm &&
    !isRejectedOrCancelled &&
    !isCancelled &&
    currentBal > 0;

  const notifyUdharChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mymoney:udhar-updated'));
    }
    if (onRefreshUdhar) onRefreshUdhar();
  };

  const handleSettleTransaction = async (notes?: string) => {
    try {
      setIsSettlingTx(true);
      const res = await udharDeletionApi.settleUdharTransaction(activeTx.id, {
        notes: notes || 'Settled in full',
      });
      if (res.success) {
        toast.success('Udhar Settled', res.message || 'Transaction marked as settled.');
        setIsSettleModalOpen(false);
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Settlement Failed', err.message || 'Could not settle this transaction.');
    } finally {
      setIsSettlingTx(false);
    }
  };

  const handleCancelTransaction = async () => {
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.cancelUdharTransaction(activeTx.id);
      if (res.success) {
        toast.success('Udhar Deleted', res.message || 'Udhar entry deleted.');
        setIsCancelConfirmOpen(false);
        notifyUdharChanged();
        onClose();
      }
    } catch (err: any) {
      toast.error('Deletion Failed', err.message || 'Could not delete this transaction.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleDeleteRepaymentConfirm = async () => {
    if (!deletingRepayment) return;
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.deleteRepayment(deletingRepayment.id);
      if (res.success) {
        toast.success('Repayment Deleted', res.message);
        setDeletingRepayment(null);
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Deletion Failed', err.message || 'Could not delete this repayment.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleConfirmRepayment = async (repaymentId: string) => {
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.confirmRepayment(repaymentId);
      if (res.success) {
        toast.success('Repayment Confirmed', res.message);
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Confirmation Failed', err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleAcceptPendingRequest = async () => {
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.confirmUdharTransaction(activeTx.id);
      if (res.success) {
        toast.success('Request Accepted', res.message || 'Udhar confirmed on both accounts.');
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Confirmation Failed', err?.message || 'Could not accept this request.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleRejectPendingRequest = async () => {
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.rejectUdharTransaction(
        activeTx.id,
        requestRejectReason.trim() || undefined
      );
      if (res.success) {
        toast.info('Request Rejected', res.message || 'Udhar request marked as rejected.');
        setIsRejectRequestOpen(false);
        setRequestRejectReason('');
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Reject Failed', err?.message || 'Could not reject this request.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleSenderCancelPendingRequest = async () => {
    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.cancelUdharRequest(activeTx.id);
      if (res.success) {
        toast.info('Request Cancelled', res.message || 'Pending Udhar request cancelled.');
        setIsCancelRequestOpen(false);
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Cancel Failed', err?.message || 'Could not cancel this request.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleRejectRepayment = async (repaymentId: string) => {
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error('Reason Required', 'Please enter a reason for rejecting this payment.');
      return;
    }

    try {
      setIsProcessingAction(true);
      const res = await udharDeletionApi.rejectRepayment(repaymentId, reason);
      if (res.success) {
        toast.info('Repayment Rejected', res.message);
        setRejectingRepaymentId(null);
        setRejectionReason('');
        await fetchDetails();
        notifyUdharChanged();
      }
    } catch (err: any) {
      toast.error('Action Failed', err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              {activeTx.counterpart_avatar ? (
                <img
                  src={activeTx.counterpart_avatar}
                  alt={activeTx.counterpart_name}
                  className="w-11 h-11 rounded-2xl object-cover border-2 border-emerald-500/30 flex-shrink-0"
                />
              ) : (
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 ${
                    isLender
                      ? 'bg-gradient-to-tr from-emerald-600 to-teal-500'
                      : 'bg-gradient-to-tr from-rose-600 to-orange-500'
                  }`}
                >
                  {activeTx.counterpart_name.charAt(0).toUpperCase()}
                </div>
              )}

              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                    {activeTx.counterpart_name}
                  </h3>
                  {isTwoSided && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      Linked 2-Way
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                  {isLender ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                      <ArrowUpRight className="w-3.5 h-3.5" /> I Gave (Lent Money)
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-0.5">
                      <ArrowDownLeft className="w-3.5 h-3.5" /> I Borrowed (Borrowed Money)
                    </span>
                  )}
                  <span>•</span>
                  <span>{formatDisplayDate(activeTx.transaction_date)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Overdue Banner if applicable */}
          {isOverdue && activeTx.due_date && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-2.5 text-xs text-rose-800 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-600" />
              <span>
                <strong>Overdue!</strong> Due date was {formatDisplayDate(activeTx.due_date)}.
              </span>
            </div>
          )}

          {/* Financial Breakdown Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Amount
              </span>
              <p className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                {formatINR(originalAmt)}
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Repaid So Far
              </span>
              <p className="text-sm sm:text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatINR(paidAmt)}
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/50 text-center">
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">
                Balance Due
              </span>
              <p className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatINR(currentBal)}
              </p>
            </div>
          </div>

          {/* Details & Notes */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-500">
              <span>Status:</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isSettled
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : isRejectedOrCancelled || statusInfo.code === 'disputed'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      : isPendingConfirm
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                }`}
              >
                {statusInfo.lifecycleLabel}
              </span>
            </div>

            {isTwoSided && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Method:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {activeTx.creation_method === 'qr'
                    ? 'Instant via QR Scan'
                    : activeTx.creation_method === 'code'
                      ? 'Instant via Confirmation Code'
                      : 'Manual Entry (2-Way)'}
                </span>
              </div>
            )}

            {isPendingConfirm && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                {activeTx.is_initiator
                  ? 'Waiting for recipient confirmation. Not counted in confirmed totals yet.'
                  : 'New Udhar request awaiting your decision. Accepting will update both confirmed balances.'}
              </div>
            )}

            {isRejectedOrCancelled && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] font-semibold text-rose-800 dark:text-rose-200">
                {lifecycle === 'rejected'
                  ? `Request was rejected${activeTx.rejection_reason ? `: "${activeTx.rejection_reason}"` : '.'}`
                  : 'Request was cancelled by sender prior to confirmation.'}
              </div>
            )}

            <div className="flex items-center justify-between text-slate-500">
              <span>Transaction ID:</span>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 select-all">
                {activeTx.id}
              </span>
            </div>

            {activeTx.due_date && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Due Date:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {formatDisplayDate(activeTx.due_date)}
                </span>
              </div>
            )}

            {(activeTx.description || activeTx.notes) && (
              <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-400 block mb-0.5">Note:</span>
                <p className="font-medium text-slate-700 dark:text-slate-300 italic">
                  "{activeTx.description || activeTx.notes}"
                </p>
              </div>
            )}

            {activeTx.last_edited_at && (
              <p className="text-[10px] text-slate-400 pt-1">
                Last edited on {formatDisplayDate(activeTx.last_edited_at)}{' '}
                {activeTx.edit_reason ? `(${activeTx.edit_reason})` : ''}
              </p>
            )}
          </div>

          {/* Tabs: Repayments vs Edit History */}
          <div className="space-y-3">
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('repayments')}
                className={`py-2 px-3 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'repayments'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Repayment Log ({repaymentsList.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`py-2 px-3 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'history'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Audit History ({historyList.length})
              </button>
            </div>

            {/* Tab 1: Repayments */}
            {activeTab === 'repayments' && (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {repaymentsList.length === 0 ? (
                  <p className="text-xs text-center py-4 text-slate-400 italic">
                    No repayments recorded yet.
                  </p>
                ) : (
                  repaymentsList.map((rep) => {
                    const isPending = rep.status === 'pending_confirmation';
                    const isRejected = rep.status === 'rejected';
                    const repDeleteGuard = canDeleteRepayment({
                      isShared: isTwoSided,
                      direction: activeTx.direction,
                      actorUserId: user?.id || user?.uid,
                      repayment: rep,
                    });

                    return (
                      <div
                        key={rep.id}
                        className={`p-3 rounded-2xl border text-xs space-y-2 transition-colors ${
                          isPending
                            ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
                            : isRejected
                              ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60'
                              : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                              {formatINR(Number(rep.amount))}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              {rep.payment_method || 'UPI'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                isPending
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : isRejected
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {isPending
                                ? 'Pending Confirmation'
                                : isRejected
                                  ? 'Rejected'
                                  : 'Confirmed'}
                            </span>
                            {repDeleteGuard.allowed && (
                              <button
                                type="button"
                                disabled={isProcessingAction}
                                onClick={() => setDeletingRepayment(rep)}
                                data-testid={`modal-repayment-delete-btn-${rep.id}`}
                                className="p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
                                title="Delete this individual repayment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{formatDisplayDate(rep.repayment_date)}</span>
                          {rep.recorded_by_name && <span>By {rep.recorded_by_name}</span>}
                        </div>

                        {rep.notes && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                            "{rep.notes}"
                          </p>
                        )}

                        {rep.rejection_reason && (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                            Reason: {rep.rejection_reason}
                          </p>
                        )}

                        {/* Lender Actions for Pending Confirmation */}
                        {isLender && isPending && (
                          <div className="pt-2 border-t border-amber-200 dark:border-amber-800/60 flex items-center gap-2">
                            {rejectingRepaymentId === rep.id ? (
                              <div className="w-full space-y-2">
                                <input
                                  type="text"
                                  autoFocus
                                  placeholder="Enter reason for rejecting payment..."
                                  value={rejectionReason}
                                  onChange={(e) => setRejectionReason(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-rose-300 bg-white dark:bg-slate-800 font-medium"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setRejectingRepaymentId(null)}
                                    className="px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isProcessingAction}
                                    onClick={() => handleRejectRepayment(rep.id)}
                                    className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                                  >
                                    Confirm Reject
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={isProcessingAction}
                                  onClick={() => handleConfirmRepayment(rep.id)}
                                  className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm shadow-emerald-600/30"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Confirm Receipt</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isProcessingAction}
                                  onClick={() => {
                                    setRejectingRepaymentId(rep.id);
                                    setRejectionReason('');
                                  }}
                                  className="py-1.5 px-3 rounded-xl bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs font-bold transition-colors cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab 2: Audit History */}
            {activeTab === 'history' && (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {historyList.length === 0 ? (
                  <p className="text-xs text-center py-4 text-slate-400 italic">
                    No modifications recorded for this transaction.
                  </p>
                ) : (
                  historyList.map((hist) => (
                    <div
                      key={hist.id}
                      className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                        <span>
                          {formatINR(Number(hist.previous_amount))} &rarr;{' '}
                          {formatINR(Number(hist.new_amount))}
                        </span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {formatDisplayDate(hist.created_at)}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">
                        Reason: <strong>{hist.reason_for_edit || 'Details updated'}</strong>
                      </p>
                      {hist.edited_by_name && (
                        <p className="text-[10px] text-slate-400">Edited by {hist.edited_by_name}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            {isPendingConfirm && acceptGuard.allowed && (
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={handleAcceptPendingRequest}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{isProcessingAction ? 'Accepting...' : 'Accept Request'}</span>
              </button>
            )}

            {isPendingConfirm && rejectGuard.allowed && (
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={() => {
                  setRequestRejectReason('');
                  setIsRejectRequestOpen(true);
                }}
                className="py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold transition-colors cursor-pointer"
              >
                Reject Request
              </button>
            )}

            {isPendingConfirm && senderCancelGuard.allowed && (
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={() => setIsCancelRequestOpen(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel Request
              </button>
            )}

            {!isSettled && !isCancelled && !isPendingConfirm && !isRejectedOrCancelled && (
              <button
                type="button"
                onClick={() => setIsRepayModalOpen(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>Record Repayment</span>
              </button>
            )}

            {!isSettled && !isCancelled && !isPendingConfirm && !isRejectedOrCancelled && isLender && (
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="py-2.5 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}

            {!isSettled && !isCancelled && !isPendingConfirm && !isRejectedOrCancelled && canManageAsLender && activeTx.status !== 'disputed' && (
              <button
                type="button"
                onClick={() => setIsSettleModalOpen(true)}
                className="py-2.5 px-3.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Settle Full</span>
              </button>
            )}

            {!isCancelled && cancelGuard.allowed ? (
              <button
                type="button"
                onClick={() => setIsCancelConfirmOpen(true)}
                data-testid="modal-delete-udhar-btn"
                className="py-2.5 px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Entry</span>
              </button>
            ) : !isCancelled && isTwoSided && !isLender && activeTx.status !== 'disputed' ? (
              <div className="w-full pt-1 flex items-center justify-between gap-2">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  You can delete this transaction after it is fully settled.
                </p>
                <button
                  type="button"
                  disabled
                  data-testid="modal-delete-udhar-disabled-btn"
                  className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed opacity-75 shrink-0"
                  title="You can delete this transaction after it is fully settled."
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Entry</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Submodals */}
      {isEditModalOpen && (
        <EditUdharModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          transaction={activeTx}
          onSuccess={async () => {
            setIsEditModalOpen(false);
            await fetchDetails();
            if (onRefreshUdhar) onRefreshUdhar();
          }}
        />
      )}

      {isRepayModalOpen && (
        <RepayUdharModal
          isOpen={isRepayModalOpen}
          onClose={() => setIsRepayModalOpen(false)}
          transaction={activeTx}
          onSuccess={async () => {
            setIsRepayModalOpen(false);
            await fetchDetails();
            if (onRefreshUdhar) onRefreshUdhar();
          }}
        />
      )}

      {isSettleModalOpen && (
        <SettleUdharModal
          isOpen={isSettleModalOpen}
          personName={activeTx.counterpart_name}
          outstandingBalance={currentBal}
          isLoading={isSettlingTx}
          onClose={() => setIsSettleModalOpen(false)}
          onConfirm={handleSettleTransaction}
        />
      )}

      <ConfirmModal
        isOpen={isRejectRequestOpen}
        title="Are you sure you want to reject this Udhaar request?"
        subtitle={`Manual request of ${formatINR(originalAmt)} from ${activeTx.counterpart_name}`}
        message="This request will remain visible as Rejected in request history and will never affect your confirmed Udhar balances."
        confirmLabel="Confirm Reject"
        isDestructive={true}
        isLoading={isProcessingAction}
        onConfirm={handleRejectPendingRequest}
        onCancel={() => !isProcessingAction && setIsRejectRequestOpen(false)}
      />

      <ConfirmModal
        isOpen={isCancelRequestOpen}
        title="Cancel Pending Udhar Request?"
        subtitle={`Waiting for ${activeTx.counterpart_name}`}
        message={`Cancel your pending Udhar request of ${formatINR(originalAmt)} with ${activeTx.counterpart_name}?`}
        confirmLabel="Cancel Request"
        isDestructive={true}
        isLoading={isProcessingAction}
        onConfirm={handleSenderCancelPendingRequest}
        onCancel={() => !isProcessingAction && setIsCancelRequestOpen(false)}
      />

      <ConfirmModal
        isOpen={isCancelConfirmOpen}
        title="Delete This Udhar Entry?"
        subtitle="Only this Udhar entry and its repayments will be removed; other entries stay untouched."
        message={`Delete this individual Udhar entry of ${formatINR(originalAmt)} with ${activeTx.counterpart_name}${
          activeTx.description || activeTx.notes ? ` ("${activeTx.description || activeTx.notes}")` : ''
        }? All totals across People, Dashboard, and Reports will recalculate immediately.`}
        confirmLabel="Delete Entry"
        isDestructive={true}
        isLoading={isProcessingAction}
        onConfirm={handleCancelTransaction}
        onCancel={() => !isProcessingAction && setIsCancelConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={Boolean(deletingRepayment)}
        title="Delete This Repayment?"
        subtitle="Only this repayment is deleted; the parent Udhar remains and its balance recalculates automatically."
        message={
          deletingRepayment
            ? `Delete repayment of ${formatINR(Number(deletingRepayment.amount) || 0)} for ${activeTx.counterpart_name}${
                deletingRepayment.notes ? ` ("${deletingRepayment.notes}")` : ''
              }?${
                deletingRepayment.status === 'confirmed'
                  ? ` Remaining balance will recalculate to ${formatINR(
                      Math.min(originalAmt, currentBal + (Number(deletingRepayment.amount) || 0))
                    )}.`
                  : ''
              }`
            : ''
        }
        confirmLabel="Delete Repayment"
        isDestructive={true}
        isLoading={isProcessingAction}
        onConfirm={handleDeleteRepaymentConfirm}
        onCancel={() => !isProcessingAction && setDeletingRepayment(null)}
      />
    </>
  );
};
