import React, { useState, useMemo } from 'react';
import {
  QrCode,
  ArrowLeft,
  Phone,
  Mail,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Clock,
  Plus,
  CheckCircle2,
  Trash2,
  Edit3,
  Search,
  Receipt,
  RotateCcw,
  Sparkles,
  Send,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatINR, formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { PersonSummary, Transaction } from '../../types';
import {
  udharDeletionApi,
  UdharTransactionItem,
  UdharRepayment,
} from '../../lib/udharDeletionApi';
import {
  calculatePersonLedgerSummary,
  canAcceptUdhar,
  canCancelUdhar,
  canDeleteRepayment,
  canRejectUdhar,
  canSenderCancelUdhar,
  getUdharSettlementStatus,
  normalizeUdharLifecycleStatus,
} from '../../lib/sharedUdharEngine';
import { SettleUdharModal } from './SettleUdharModal';
import { RepayUdharModal } from './RepayUdharModal';
import { UdharDetailModal } from './UdharDetailModal';
import { PersonUpiQrModal } from './PersonUpiQrModal';

interface PersonDetailsViewProps {
  person: PersonSummary;
  onBack: () => void;
  onOpenAddModal: (category?: any, subcategory?: any, personName?: string) => void;
  onEditPerson?: (personName: string) => void;
  onDeletePerson?: (personName: string) => void;
  udharTransactions?: UdharTransactionItem[];
  udharLoaded?: boolean;
  onRefreshUdhar?: () => Promise<void>;
}

export const PersonDetailsView: React.FC<PersonDetailsViewProps> = ({
  person,
  onBack,
  onOpenAddModal,
  onEditPerson,
  onDeletePerson,
  udharTransactions = [],
  udharLoaded = false,
  onRefreshUdhar,
}) => {
  const { settlePersonUdhar, deleteTransaction, permanentDeletePersonTransactions, refreshTransactions, refreshNotifications } = useExpense();
  const { user } = useAuth();
  const toast = useToast();

  const [searchHistory, setSearchHistory] = useState('');
  const [filterType, setFilterType] = useState<
    'all' | 'pending' | 'confirmed' | 'rejected' | 'settled' | 'given' | 'received'
  >('all');
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [isUpiQrModalOpen, setIsUpiQrModalOpen] = useState(false);
  const [selectedTxForRepay, setSelectedTxForRepay] = useState<UdharTransactionItem | null>(null);
  const [selectedTxForDetail, setSelectedTxForDetail] = useState<UdharTransactionItem | null>(null);
  const [expandedRepayments, setExpandedRepayments] = useState<Record<string, boolean>>({});
  const [isInviting, setIsInviting] = useState(false);
  const [busyTxId, setBusyTxId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');
  const [pendingConfirmAction, setPendingConfirmAction] = useState<
    | { type: 'settle_single'; tx: UdharTransactionItem }
    | { type: 'delete_single'; tx: UdharTransactionItem }
    | { type: 'delete_manual_tx'; tx: Transaction }
    | { type: 'delete_repayment'; tx: UdharTransactionItem; rep: UdharRepayment }
    | { type: 'reject_request'; tx: UdharTransactionItem }
    | { type: 'cancel_request'; tx: UdharTransactionItem }
    | { type: 'delete_history' }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Filter Udhar Transactions specifically for this person
  const personUdharTxs = useMemo(() => {
    const pName = person.name.toLowerCase().trim();
    return udharTransactions.filter(
      (t) =>
        t.counterpart_name.toLowerCase().trim() === pName ||
        (person.linkedUserId && t.counterpart_user_id === person.linkedUserId)
    );
  }, [udharTransactions, person.name, person.linkedUserId]);

  // Combined transactions filter
  const filteredTxs = useMemo(() => {
    let list = person.transactions || [];
    if (searchHistory.trim()) {
      const q = searchHistory.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          String(t.amount).includes(q)
      );
    }
    if (filterType === 'given') {
      list = list.filter((t) => t.subcategory === 'money_given');
    } else if (filterType === 'received') {
      list = list.filter((t) => t.subcategory === 'money_received');
    }
    return list;
  }, [person.transactions, searchHistory, filterType]);

  const filteredUdharTxs = useMemo(() => {
    let list = personUdharTxs;
    if (searchHistory.trim()) {
      const q = searchHistory.toLowerCase().trim();
      list = list.filter(
        (t) =>
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          String(t.id).toLowerCase().includes(q) ||
          String(t.original_amount).includes(q) ||
          String(t.current_balance).includes(q)
      );
    }
    if (filterType === 'given') {
      list = list.filter((t) => t.direction === 'gave');
    } else if (filterType === 'received') {
      list = list.filter((t) => t.direction === 'took');
    } else if (filterType === 'pending') {
      list = list.filter((t) => normalizeUdharLifecycleStatus(t) === 'pending_confirmation');
    } else if (filterType === 'confirmed') {
      list = list.filter((t) => {
        const lc = normalizeUdharLifecycleStatus(t);
        return lc === 'confirmed' || lc === 'disputed';
      });
    } else if (filterType === 'rejected') {
      list = list.filter((t) => {
        const lc = normalizeUdharLifecycleStatus(t);
        return lc === 'rejected' || lc === 'cancelled';
      });
    } else if (filterType === 'settled') {
      list = list.filter((t) => getUdharSettlementStatus(t).isSettled);
    }
    return list;
  }, [personUdharTxs, searchHistory, filterType]);

  const useCanonicalUdhar = udharLoaded || personUdharTxs.length > 0;
  const ledgerBreakdown = useMemo(() => calculatePersonLedgerSummary(personUdharTxs), [personUdharTxs]);
  const balance = useCanonicalUdhar ? ledgerBreakdown.netBalance : person.outstandingBalance;
  const pendingTotal = useCanonicalUdhar
    ? Math.round((ledgerBreakdown.youWillReceive + ledgerBreakdown.youWillPay) * 100) / 100
    : Math.abs(person.outstandingBalance);
  const settledTotal = useCanonicalUdhar
    ? ledgerBreakdown.settledAmount
    : Math.max(0, Math.round((person.totalGiven + person.totalReceived - Math.abs(person.outstandingBalance)) * 100) / 100);
  const isSettled = Math.abs(balance) < 0.01;
  const isOwedToYou = balance > 0; // You will get

  const resolvedTargetUserId = useMemo(() => {
    if (person.linkedUserId) return person.linkedUserId;
    const found = personUdharTxs.find(
      (t) =>
        t.counterpart_user_id ||
        (t.lender_user_id !== user?.id ? t.lender_user_id : t.borrower_user_id !== user?.id ? t.borrower_user_id : null)
    );
    if (found) {
      if (found.counterpart_user_id) return found.counterpart_user_id;
      return found.lender_user_id !== user?.id ? found.lender_user_id : found.borrower_user_id;
    }
    return null;
  }, [person.linkedUserId, personUdharTxs, user?.id]);

  const suggestedPaymentAmount = useMemo(() => {
    if (!isOwedToYou && !isSettled && Math.abs(balance) > 0.01) {
      return Math.abs(balance);
    }
    return null;
  }, [isOwedToYou, isSettled, balance]);

  const handleSettleConfirm = async (notes?: string) => {
    try {
      setIsSettling(true);
      await settlePersonUdhar(person.name, notes);
      toast.success('Udhar Settled', `All pending balance with ${person.name} is now cleared (₹0).`);
      setIsSettleModalOpen(false);
      if (onRefreshUdhar) await onRefreshUdhar();
      await refreshTransactions();
    } catch (err: any) {
      toast.error('Settlement Failed', err.message);
    } finally {
      setIsSettling(false);
    }
  };

  const handleSettleSingleTx = (tx: UdharTransactionItem) => {
    setPendingConfirmAction({ type: 'settle_single', tx });
  };

  const handleDeleteSingleTx = (tx: UdharTransactionItem) => {
    setPendingConfirmAction({ type: 'delete_single', tx });
  };

  const handleDeleteHistory = () => {
    setPendingConfirmAction({ type: 'delete_history' });
  };

  const handleAcceptRequest = async (tx: UdharTransactionItem) => {
    if (busyTxId) return;
    setBusyTxId(tx.id);
    try {
      const res = await udharDeletionApi.confirmUdharTransaction(tx.id);
      if (res.success) {
        toast.success('Request Accepted', `Udhar of ${formatINR(Number(tx.original_amount) || 0)} confirmed.`);
        if (onRefreshUdhar) await onRefreshUdhar();
        await refreshTransactions();
        await refreshNotifications();
      }
    } catch (err: any) {
      toast.error('Confirmation Failed', err?.message || 'Could not confirm this request.');
    } finally {
      setBusyTxId(null);
    }
  };

  const executePendingConfirmAction = async () => {
    if (!pendingConfirmAction || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (pendingConfirmAction.type === 'settle_single') {
        const res = await udharDeletionApi.settleUdharTransaction(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.success('Transaction Settled', res.message || 'This Udhar entry is now marked settled.');
          if (onRefreshUdhar) await onRefreshUdhar();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'delete_single') {
        const res = await udharDeletionApi.cancelUdharTransaction(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.success('Transaction Deleted', res.message || 'Udhar entry deleted and totals recalculated.');
          setPendingConfirmAction(null);
          void Promise.all([
            onRefreshUdhar ? onRefreshUdhar() : Promise.resolve(),
            refreshTransactions(),
            refreshNotifications(),
          ]);
          return;
        }
      } else if (pendingConfirmAction.type === 'delete_repayment') {
        const res = await udharDeletionApi.deleteRepayment(pendingConfirmAction.rep.id);
        if (res.success) {
          toast.success('Repayment Deleted', res.message || 'Repayment deleted and Udhar balance recalculated.');
          setPendingConfirmAction(null);
          void Promise.all([
            onRefreshUdhar ? onRefreshUdhar() : Promise.resolve(),
            refreshTransactions(),
            refreshNotifications(),
          ]);
          return;
        }
      } else if (pendingConfirmAction.type === 'reject_request') {
        const res = await udharDeletionApi.rejectUdharTransaction(
          pendingConfirmAction.tx.id,
          rejectReasonInput.trim() || undefined
        );
        if (res.success) {
          toast.info('Request Rejected', res.message || 'Udhar request rejected.');
          setRejectReasonInput('');
          if (onRefreshUdhar) await onRefreshUdhar();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'cancel_request') {
        const res = await udharDeletionApi.cancelUdharRequest(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.info('Request Cancelled', res.message || 'Pending Udhar request cancelled.');
          if (onRefreshUdhar) await onRefreshUdhar();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'delete_manual_tx') {
        const deleted = await deleteTransaction(pendingConfirmAction.tx.id);
        if (deleted) {
          toast.success('Entry Deleted', 'Ledger transaction removed and balance recalculated.');
          if (onRefreshUdhar) await onRefreshUdhar();
          await refreshTransactions();
        }
      } else if (pendingConfirmAction.type === 'delete_history') {
        await permanentDeletePersonTransactions(person.name);
        toast.success('Records Cleared', `All transactions with ${person.name} have been permanently removed.`);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mymoney:udhar-updated'));
        setPendingConfirmAction(null);
        onBack();
        return;
      }
      setPendingConfirmAction(null);
    } catch (err: any) {
      toast.error('Action Failed', err?.message || 'Unable to complete this action.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleSendInvite = async () => {
    if (!person.email) {
      toast.info('No Email Found', 'Please edit this contact to add their email address before sending an invitation.');
      return;
    }
    try {
      setIsInviting(true);
      const contactsRes = await udharDeletionApi.getContacts();
      const match = contactsRes.contacts?.find(
        (c) => c.name.toLowerCase() === person.name.toLowerCase()
      );
      if (match) {
        const invRes = await udharDeletionApi.inviteContact(match.id);
        if (invRes.success) {
          toast.success('Invitation Sent', `Invitation email dispatched to ${person.email}.`);
        } else {
          toast.error('Invitation Failed', invRes.message);
        }
      } else {
        toast.error('Contact Not Found', 'Could not locate contact record to send invitation.');
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsInviting(false);
    }
  };

  const toggleRepayments = (txId: string) => {
    setExpandedRepayments((prev) => ({ ...prev, [txId]: !prev[txId] }));
  };

  return (
    <div className="space-y-6 pb-20 max-w-4xl mx-auto animate-fade-in">
      {/* Top Header Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to People</span>
        </button>

        <div className="flex items-center gap-2">
          {person.email && !person.isRegisteredUser && (
            <button
              onClick={handleSendInvite}
              disabled={isInviting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold transition-colors cursor-pointer"
              title="Send App Invitation"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isInviting ? 'Sending...' : 'Invite to App'}</span>
            </button>
          )}

          {onEditPerson && (
            <button
              onClick={() => onEditPerson(person.name)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              title="Edit Contact"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={handleDeleteHistory}
            className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
            title="Delete History with Person"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Person Profile Banner */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-emerald-950/10 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {person.avatarUrl ? (
                <img
                  src={person.avatarUrl}
                  alt={person.name}
                  className="w-16 h-16 rounded-2xl object-cover border-2 border-white/40 shadow-md"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-2xl font-black shadow-md border-2 border-white/30">
                  {person.name.charAt(0).toUpperCase()}
                </div>
              )}
              {person.isRegisteredUser && (
                <span
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] shadow border-2 border-slate-900"
                  title="Verified App User"
                >
                  ✓
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-extrabold">{person.name}</h2>
                {person.isRegisteredUser && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                    2-Way Linked
                  </span>
                )}
                {isSettled ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-white/20 text-emerald-200">
                    Settled (₹0)
                  </span>
                ) : (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    isOwedToYou ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'
                  }`}>
                    {isOwedToYou ? 'You will get' : 'You will give'}
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-100 mt-1 flex items-center gap-2 flex-wrap">
                {person.phone && <span>📞 {person.phone}</span>}
                {person.email && <span>✉️ {person.email}</span>}
                <span>· Last updated: {formatDisplayDate(person.lastTransactionDate)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={() => onOpenAddModal('people', isOwedToYou ? 'money_given' : 'money_received', person.name)}
              className="px-4 py-2.5 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Udhar</span>
            </button>

            <button
              onClick={() => setIsUpiQrModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-white active:scale-95 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title={`View ${person.name}'s UPI QR code and pay directly`}
            >
              <QrCode className="w-4 h-4" />
              <span>UPI QR</span>
            </button>
{!isSettled && isOwedToYou && (
<button
onClick={() => setIsSettleModalOpen(true)}
className="px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-white active:scale-95 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
>
<CheckCircle2 className="w-4 h-4" />
<span>Settle Full (हिसाब चुकता)</span>
</button>
)}
          </div>
        </div>

        {/* Metric Summary Cards: Total Given, Total Received, Pending, Settled */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 pt-2">
          <div className="p-3 sm:p-4 rounded-2xl bg-white/10 backdrop-blur-md space-y-1">
            <span className="text-[10px] uppercase font-bold text-emerald-200 block">Total You Gave</span>
            <span className="text-sm sm:text-lg font-black font-sans">{formatINR(useCanonicalUdhar ? ledgerBreakdown.totalGiven : person.totalGiven)}</span>
          </div>

          <div className="p-3 sm:p-4 rounded-2xl bg-white/10 backdrop-blur-md space-y-1">
            <span className="text-[10px] uppercase font-bold text-emerald-200 block">Total You Received</span>
            <span className="text-sm sm:text-lg font-black font-sans">{formatINR(useCanonicalUdhar ? ledgerBreakdown.totalTaken : person.totalReceived)}</span>
          </div>

          <div className="p-3 sm:p-4 rounded-2xl bg-white/15 backdrop-blur-md space-y-1">
            <span className="text-[10px] uppercase font-bold text-amber-200 block">Pending Amount</span>
            <span className={`text-sm sm:text-lg font-black font-sans ${
              isSettled ? 'text-white' : isOwedToYou ? 'text-emerald-300' : 'text-rose-300'
            }`}>
              {formatINR(pendingTotal)}
            </span>
          </div>

          <div className="p-3 sm:p-4 rounded-2xl bg-white/10 backdrop-blur-md space-y-1">
            <span className="text-[10px] uppercase font-bold text-emerald-200 block">Settled Amount</span>
            <span className="text-sm sm:text-lg font-black font-sans text-emerald-200">
              {formatINR(settledTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Shared Two-Way Udhar Ledger (I Gave vs I Borrowed) */}
      {personUdharTxs.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                Udhar Transactions ({personUdharTxs.length})
              </h3>
              <p className="text-xs text-slate-400">
                I Gave ({personUdharTxs.filter((t) => t.direction === 'gave').length}) · I Borrowed ({personUdharTxs.filter((t) => t.direction === 'took').length})
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search note, ID, amount..."
                  value={searchHistory}
                  onChange={(e) => setSearchHistory(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs w-40 sm:w-48 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold flex-wrap">
                {(['all', 'pending', 'confirmed', 'rejected', 'settled', 'given', 'received'] as const).map((fKey) => (
                  <button
                    key={fKey}
                    type="button"
                    onClick={() => setFilterType(fKey)}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      filterType === fKey
                        ? fKey === 'given'
                          ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-xs'
                          : fKey === 'received'
                            ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    {fKey === 'all'
                      ? 'All'
                      : fKey === 'pending'
                        ? `Pending (${ledgerBreakdown.pendingConfirmationCount})`
                        : fKey === 'confirmed'
                          ? 'Confirmed'
                          : fKey === 'rejected'
                            ? 'Rejected'
                            : fKey === 'settled'
                              ? 'Settled'
                              : fKey === 'given'
                                ? 'I Gave'
                                : 'I Borrowed'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {filteredUdharTxs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                No transactions match this filter.
              </p>
            ) : (
              filteredUdharTxs.map((tx) => {
                const statusInfo = getUdharSettlementStatus(tx);
                const lifecycle = normalizeUdharLifecycleStatus(tx);
                const isPendingConfirm = lifecycle === 'pending_confirmation';
                const isRejectedOrCancelled = lifecycle === 'rejected' || lifecycle === 'cancelled';
                const curBal = statusInfo.remainingAmount;
                const origAmt = statusInfo.originalAmount;
                const isGave = tx.direction === 'gave';
                const isLinked = Boolean(tx.counterpart_user_id);
                const isTxSettled = statusInfo.isSettled;
                const isDisputed = lifecycle === 'disputed';
                const isRepaymentsExpanded = Boolean(expandedRepayments[tx.id]);
                const deleteGuard = canCancelUdhar({
                  status: tx.status,
                  deleted_at: tx.deleted_at,
                  notes: tx.notes,
                  direction: tx.direction,
                  is_shared: isLinked,
                  counterpart_user_id: tx.counterpart_user_id,
                  original_amount: tx.original_amount,
                  paid_amount: tx.paid_amount,
                  current_balance: tx.current_balance,
                  settled_at: tx.settled_at,
                  repayments: tx.repayments,
                });
                const acceptGuard = canAcceptUdhar(tx, user?.id || user?.uid);
                const rejectGuard = canRejectUdhar(tx, user?.id || user?.uid);
                const senderCancelGuard = canSenderCancelUdhar(tx, user?.id || user?.uid);

                return (
                  <div
                    key={tx.id}
                    data-testid={`person-udhar-card-${tx.id}`}
                    className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-xl shrink-0 ${
                            isGave
                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                              : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {isGave ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-bold text-sm ${
                                isGave ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {isGave ? 'I Gave' : 'I Borrowed'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isRejectedOrCancelled
                                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                  : isDisputed
                                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                    : isTxSettled
                                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                      : isPendingConfirm
                                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {statusInfo.lifecycleLabel}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400" title={tx.id}>
                              ID: {tx.id}
                            </span>
                          </div>
                          {tx.description && (
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                              {tx.description}
                            </p>
                          )}
                          {isPendingConfirm && tx.is_initiator && (
                            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5">
                              Waiting for recipient confirmation
                            </p>
                          )}
                          {isRejectedOrCancelled && tx.rejection_reason && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                              Reason: {tx.rejection_reason}
                            </p>
                          )}
                          {tx.notes && <p className="text-xs text-slate-500 mt-0.5">{tx.notes}</p>}
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 flex-wrap">
                            <span>Date: {formatDisplayDate(tx.transaction_date)}</span>
                            {tx.due_date && !isRejectedOrCancelled && <span>· Due: {formatDisplayDate(tx.due_date)}</span>}
                            {statusInfo.paidAmount > 0.01 && (
                              <span>· Repaid: {formatINR(statusInfo.paidAmount)}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right sm:text-right">
                        <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                          Amount: {formatINR(origAmt)}
                        </div>
                        {isPendingConfirm ? (
                          <div className="font-bold text-xs text-amber-600 dark:text-amber-400">
                            Awaiting confirmation
                          </div>
                        ) : isRejectedOrCancelled ? (
                          <div className="font-bold text-xs text-slate-400">
                            Not in active balance
                          </div>
                        ) : statusInfo.isPartiallySettled ? (
                          <div className="font-black text-sm text-amber-600 dark:text-amber-400">
                            Remaining: {formatINR(curBal)}
                          </div>
                        ) : !isTxSettled ? (
                          <div
                            className={`font-black text-sm ${
                              isGave ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            Remaining: {formatINR(curBal)}
                          </div>
                        ) : (
                          <div className="font-bold text-xs text-emerald-600 dark:text-emerald-400">
                            Remaining: ₹0 (Settled)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions for this specific Udhar record */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => toggleRepayments(tx.id)}
                        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <span>Settlement History ({tx.repayments?.length || 0})</span>
                        {isRepaymentsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSelectedTxForDetail(tx)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                        >
                          Details
                        </button>
                        {isPendingConfirm && acceptGuard.allowed && (
                          <button
                            type="button"
                            disabled={busyTxId === tx.id}
                            onClick={() => handleAcceptRequest(tx)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            {busyTxId === tx.id ? 'Accepting...' : 'Accept'}
                          </button>
                        )}
                        {isPendingConfirm && rejectGuard.allowed && (
                          <button
                            type="button"
                            disabled={busyTxId === tx.id}
                            onClick={() => {
                              setRejectReasonInput('');
                              setPendingConfirmAction({ type: 'reject_request', tx });
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                          >
                            Reject
                          </button>
                        )}
                        {isPendingConfirm && senderCancelGuard.allowed && (
                          <button
                            type="button"
                            onClick={() => setPendingConfirmAction({ type: 'cancel_request', tx })}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                          >
                            Cancel Request
                          </button>
                        )}
                        {!isTxSettled && !isPendingConfirm && !isRejectedOrCancelled && !isDisputed && curBal > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedTxForRepay(tx)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                            >
                              Record Repayment
                            </button>
                            {isGave && (
                              <button
                                type="button"
                                onClick={() => handleSettleSingleTx(tx)}
                                data-testid={`udhar-settle-btn-${tx.id}`}
                                className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold cursor-pointer"
                                title="Settle this individual transaction (Lender only)"
                              >
                                Settle
                              </button>
                            )}
                          </>
                        )}
                        {deleteGuard.allowed && (
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleTx(tx)}
                            data-testid={`udhar-delete-btn-${tx.id}`}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-bold cursor-pointer"
                            title="Delete this individual Udhar entry"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Repayments / Settlement History */}
                    {isRepaymentsExpanded && (
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Settlement & Repayments Log
                        </p>
                        {(!tx.repayments || tx.repayments.length === 0) ? (
                          <p className="text-xs text-slate-400 italic">No partial repayments recorded yet.</p>
                        ) : (
                          <div className="space-y-1.5 divide-y divide-slate-100 dark:divide-slate-800">
                            {tx.repayments.map((rep) => {
                              const repDeleteAllowed = canDeleteRepayment({
                                isShared: isLinked,
                                direction: tx.direction,
                                actorUserId: user?.id || user?.uid,
                                repayment: rep,
                              }).allowed;
                              return (
                                <div key={rep.id} className="pt-1.5 flex items-center justify-between gap-2 text-xs">
                                  <div className="min-w-0">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {formatINR(Number(rep.amount))}
                                    </span>
                                    {rep.payment_method && (
                                      <span className="ml-1.5 text-[10px] text-slate-400">via {rep.payment_method}</span>
                                    )}
                                    {rep.notes && <span className="text-slate-400 ml-1.5">({rep.notes})</span>}
                                    {rep.status === 'pending_confirmation' && (
                                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                        Pending
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[11px] text-slate-400">
                                      {formatDisplayDate(rep.repayment_date)}
                                    </span>
                                    {repDeleteAllowed && (
                                      <button
                                        type="button"
                                        onClick={() => setPendingConfirmAction({ type: 'delete_repayment', tx, rep })}
                                        data-testid={`person-repayment-delete-btn-${rep.id}`}
                                        className="p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
                                        title="Delete this repayment"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Manual Ledger History Section (if manual non-Udhar entries exist or no Udhar entries yet) */}
      {(personUdharTxs.length === 0 || (person.transactions && person.transactions.length > 0)) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                {personUdharTxs.length > 0
                  ? `Additional Manual Entries with ${person.name}`
                  : `Transaction History with ${person.name}`}
              </h3>
              <p className="text-xs text-slate-400">
                Every given, received, or settled entry in chronological order
              </p>
            </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search history..."
                value={searchHistory}
                onChange={(e) => setSearchHistory(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs w-36 sm:w-48 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  filterType === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('given')}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  filterType === 'given' ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs' : 'text-slate-400'
                }`}
              >
                Gave
              </button>
              <button
                onClick={() => setFilterType('received')}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  filterType === 'received' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs' : 'text-slate-400'
                }`}
              >
                Got
              </button>
            </div>
          </div>
        </div>

        {filteredTxs.length === 0 ? (
          <div className="text-center py-10 space-y-2 text-slate-400 text-xs">
            <Receipt className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
            <p>No transactions found matching your criteria</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredTxs.map((tx) => {
              const isGiven = tx.subcategory === 'money_given';
              return (
                <div
                  key={tx.id}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 rounded-xl px-2 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl shrink-0 ${
                        isGiven
                          ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isGiven ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                        {tx.title}
                      </p>
                      {tx.notes && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{tx.notes}</p>
                      )}
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1 font-mono">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDisplayDate(tx.transaction_date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDisplayTime(tx.transaction_time)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div
                        className={`font-black text-sm sm:text-base font-sans ${
                          isGiven ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {isGiven ? '-' : '+'} {formatINR(tx.amount)}
                      </div>
                      <span className="text-[9.5px] uppercase font-bold text-slate-400">
                        {isGiven ? 'Given (उधार दिया)' : 'Received (वापस मिला)'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingConfirmAction({ type: 'delete_manual_tx', tx })}
                      data-testid={`manual-udhar-delete-btn-${tx.id}`}
                      className="p-2 rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
                      title="Delete this entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      )}

      {/* Settle Full Modal */}
      {isSettleModalOpen && (
        <SettleUdharModal
          isOpen={isSettleModalOpen}
          personName={person.name}
          balance={person.outstandingBalance}
          isLoading={isSettling}
          onConfirm={handleSettleConfirm}
          onClose={() => setIsSettleModalOpen(false)}
        />
      )}

      {/* Repay Udhar Modal */}
      {selectedTxForRepay && (
        <RepayUdharModal
          isOpen={Boolean(selectedTxForRepay)}
          transaction={selectedTxForRepay}
          onClose={() => setSelectedTxForRepay(null)}
          onSuccess={async () => {
            setSelectedTxForRepay(null);
            if (onRefreshUdhar) await onRefreshUdhar();
          }}
        />
      )}

      {/* Udhar Detail & Audit Modal */}
      {selectedTxForDetail && (
        <UdharDetailModal
          isOpen={Boolean(selectedTxForDetail)}
          transaction={selectedTxForDetail}
          onClose={() => setSelectedTxForDetail(null)}
          onRefreshUdhar={async () => {
            if (onRefreshUdhar) await onRefreshUdhar();
            await refreshTransactions();
          }}
        />
      )}

      {/* Recipient Profile Owner's UPI QR & Direct Payment Modal */}
      <PersonUpiQrModal
        isOpen={isUpiQrModalOpen}
        onClose={() => setIsUpiQrModalOpen(false)}
        personName={person.name}
        contactId={person.contactId}
        linkedUserId={resolvedTargetUserId}
        suggestedAmount={suggestedPaymentAmount}
      />

      {/* Styled In-App Confirmation Modal (Replaces native confirm()) */}
      {pendingConfirmAction && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setPendingConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="udhar-confirm-modal"
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {pendingConfirmAction.type === 'settle_single'
                  ? 'Settle This Udhar Transaction?'
                  : pendingConfirmAction.type === 'delete_single'
                  ? 'Delete This Udhar Transaction?'
                  : pendingConfirmAction.type === 'delete_repayment'
                  ? 'Delete This Repayment?'
                  : pendingConfirmAction.type === 'reject_request'
                  ? 'Are you sure you want to reject this Udhaar request?'
                  : pendingConfirmAction.type === 'cancel_request'
                  ? 'Cancel Pending Udhaar Request?'
                  : pendingConfirmAction.type === 'delete_manual_tx'
                  ? 'Delete This Entry?'
                  : `Clear All History for ${person.name}?`}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {pendingConfirmAction.type === 'settle_single' ? (
                  <>
                    Only this single Udhar entry of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.current_balance)) || 0)}</strong>
                    {pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes
                      ? ` (“${pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes}”)`
                      : ''}{' '}
                    will be marked as <strong>Settled</strong>. Other pending entries with {person.name} will remain unaffected.
                  </>
                ) : pendingConfirmAction.type === 'delete_single' ? (
                  <>
                    Delete this Udhar entry of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    for <strong>{person.name}</strong>
                    {pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes
                      ? ` (“${pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes}”)`
                      : ''}
                    ? Any repayments linked only to this entry will also be removed; remaining Udhar transactions with{' '}
                    {person.name} stay untouched and totals recalculate immediately.
                  </>
                ) : pendingConfirmAction.type === 'delete_manual_tx' ? (
                  <>
                    Delete this ledger entry of{' '}
                    <strong>{formatINR(Number(pendingConfirmAction.tx.amount) || 0)}</strong>{' '}
                    ({pendingConfirmAction.tx.title}) for <strong>{person.name}</strong>?
                  </>
                ) : pendingConfirmAction.type === 'delete_repayment' ? (
                  <>
                    Delete repayment of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.rep.amount)) || 0)}</strong>{' '}
                    for <strong>{person.name}</strong>
                    {pendingConfirmAction.rep.notes ? ` (“${pendingConfirmAction.rep.notes}”)` : ''}? The parent Udhar of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    will remain and its remaining balance will recalculate automatically
                    {pendingConfirmAction.rep.status === 'confirmed'
                      ? ` to ${formatINR(
                          Math.min(
                            parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0,
                            (parseFloat(String(pendingConfirmAction.tx.current_balance)) || 0) +
                              (parseFloat(String(pendingConfirmAction.rep.amount)) || 0)
                          )
                        )}`
                      : ''}
                    .
                  </>
                ) : pendingConfirmAction.type === 'reject_request' ? (
                  <>
                    Rejecting this Udhaar request of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    from <strong>{person.name}</strong> will mark it as <strong>Rejected</strong>. It will remain in
                    history for audit clarity and will never affect either account&apos;s balance.
                  </>
                ) : pendingConfirmAction.type === 'cancel_request' ? (
                  <>
                    Cancel your pending Udhaar request of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    sent to <strong>{person.name}</strong>? It will remain in history as <strong>Cancelled</strong>{' '}
                    without affecting any confirmed balance.
                  </>
                ) : (
                  <>
                    Are you sure you want to permanently remove all local financial records for{' '}
                    <strong>{person.name}</strong>? This action cannot be undone.
                  </>
                )}
              </p>
            </div>

            {pendingConfirmAction.type === 'reject_request' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Rejection Reason (Optional)
                </label>
                <input
                  type="text"
                  value={rejectReasonInput}
                  onChange={(e) => setRejectReasonInput(e.target.value)}
                  disabled={confirmBusy}
                  placeholder="e.g., Wrong amount or already settled"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmAction(null);
                  setRejectReasonInput('');
                }}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executePendingConfirmAction}
                disabled={confirmBusy}
                data-testid="udhar-confirm-action-btn"
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50 cursor-pointer ${
                  pendingConfirmAction.type === 'settle_single'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {confirmBusy
                  ? 'Processing...'
                  : pendingConfirmAction.type === 'settle_single'
                  ? 'Confirm Settlement'
                  : pendingConfirmAction.type === 'reject_request'
                  ? 'Confirm Reject'
                  : pendingConfirmAction.type === 'cancel_request'
                  ? 'Confirm Cancel'
                  : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
