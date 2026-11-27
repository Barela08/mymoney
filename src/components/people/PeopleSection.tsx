import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Calendar,
  Clock,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertCircle,
  X,
  Check,
  RotateCcw,
  QrCode,
  Smartphone,
  PlusCircle,
  Receipt,
  FileQuestion,
  UserPlus,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { StatCard } from '../common/StatCard';
import { SearchVoiceBar } from '../common/SearchVoiceBar';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { SkeletonCardsGrid, SkeletonTable } from '../common/states';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { Transaction, PersonSummary, SortOrder } from '../../types';
import {
  formatINR,
  formatDisplayDate,
  formatDisplayTime,
  getCurrentISTDate,
  getCurrentISTTime,
} from '../../lib/dateUtils';
import {
  udharDeletionApi,
  UdharTransactionItem,
  UdharRepayment,
  UdharSummaryData,
} from '../../lib/udharDeletionApi';
import { subscribeToSupabaseUdharRealtime } from '../../lib/supabase';
import {
  canAcceptUdhar,
  canCancelUdhar,
  canDeleteRepayment,
  canRejectUdhar,
  canSenderCancelUdhar,
  getUdharSettlementStatus,
  normalizeUdharLifecycleStatus,
} from '../../lib/sharedUdharEngine';
import { MyUdharQrModal } from './MyUdharQrModal';
import { ScanQrModal } from './ScanQrModal';
import { AddUdharModal } from './AddUdharModal';
import { RepayUdharModal } from './RepayUdharModal';
import { DisputeModal } from './DisputeModal';
import { SavedPeopleManagerModal } from './SavedPeopleManagerModal';
import { PersonDetailsView } from './PersonDetailsView';
import { AddPersonModal } from './AddPersonModal';
import { QrSuccessModal } from './QrSuccessModal';
import { UdharDetailModal } from './UdharDetailModal';
import { ConnectionRequestsPanel } from './ConnectionRequestsPanel';

interface PeopleSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any, personName?: string) => void;
}

export const PeopleSection: React.FC<PeopleSectionProps> = ({ onOpenAddModal }) => {
  const {
    refreshTransactions,
    peopleSummaries,
    savedContacts,
    refreshContacts,
    isLoadingContacts,
    contactsError,
    refreshNotifications,
  } = useExpense();
  const { user } = useAuth();
  const toast = useToast();

  // Udhar backend state
  const [udharTransactions, setUdharTransactions] = useState<UdharTransactionItem[]>([]);
  const [udharSummary, setUdharSummary] = useState<UdharSummaryData>({
    totalLent: 0,
    totalBorrowed: 0,
    outstandingReceivable: 0,
    outstandingPayable: 0,
    netBalance: 0,
    settledAmount: 0,
    overdueAmount: 0,
  });
  const [isLoadingUdhar, setIsLoadingUdhar] = useState<boolean>(true);
  const [hasLoadedUdhar, setHasLoadedUdhar] = useState<boolean>(false);
  const [udharError, setUdharError] = useState<string | null>(null);
  const [requestsRefreshKey, setRequestsRefreshKey] = useState<number>(0);

  // Unified lifecycle + direction filters
  const [activeTab, setActiveTab] = useState<
    | 'all'
    | 'pending_confirmation'
    | 'confirmed'
    | 'rejected'
    | 'settled'
    | 'lent'
    | 'borrowed'
    | 'overdue'
  >('all');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRepayments, setExpandedRepayments] = useState<Record<string, boolean>>({});
  const [busyTxId, setBusyTxId] = useState<string | null>(null);

  // Modals state
  const [isAddUdharOpen, setIsAddUdharOpen] = useState(false);
  const [isMyQrOpen, setIsMyQrOpen] = useState(false);
  const [isScanQrOpen, setIsScanQrOpen] = useState(false);
  const [isSavedPeopleOpen, setIsSavedPeopleOpen] = useState(false);
  const [isAddPersonModalOpen, setIsAddPersonModalOpen] = useState(false);
  const [selectedTxForRepay, setSelectedTxForRepay] = useState<UdharTransactionItem | null>(null);
  const [selectedTxForDispute, setSelectedTxForDispute] = useState<UdharTransactionItem | null>(null);
  const [selectedTxForDetail, setSelectedTxForDetail] = useState<UdharTransactionItem | null>(null);
  const [initialPersonForAdd, setInitialPersonForAdd] = useState<string | undefined>(undefined);
  const [selectedPersonForDetails, setSelectedPersonForDetails] = useState<PersonSummary | null>(null);
  const [connectedSuccessPerson, setConnectedSuccessPerson] = useState<{
    name: string;
    emailMasked?: string;
    avatarUrl?: string | null;
  } | null>(null);

  const [pendingConfirmAction, setPendingConfirmAction] = useState<
    | { type: 'settle_single'; tx: UdharTransactionItem }
    | { type: 'delete_single'; tx: UdharTransactionItem }
    | { type: 'delete_repayment'; tx: UdharTransactionItem; rep: UdharRepayment }
    | { type: 'reject_request'; tx: UdharTransactionItem }
    | { type: 'cancel_request'; tx: UdharTransactionItem }
    | null
  >(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pendingRemovePerson, setPendingRemovePerson] = useState<PersonSummary | null>(null);
  const [isRemovingPerson, setIsRemovingPerson] = useState(false);

  // Fetch Udhar Data from Backend
  const fetchUdharData = useCallback(async () => {
    try {
      setIsLoadingUdhar(true);
      setUdharError(null);
      const res = await udharDeletionApi.getUdharTransactions();
      if (res.success) {
        setUdharTransactions(res.transactions || []);
        setUdharSummary(res.summary);
        setHasLoadedUdhar(true);
      } else {
        setUdharError('Could not load Udhar transactions.');
      }
      await refreshContacts();
    } catch (err: any) {
      console.warn('Could not fetch udhar transactions:', err.message);
      setUdharError(err?.message || 'Unable to sync People ledger right now. Please retry.');
    } finally {
      setIsLoadingUdhar(false);
    }
  }, [refreshContacts]);

  useEffect(() => {
    fetchUdharData();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchUdharData();
      }
    }, 10000);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchUdharData();
        refreshTransactions();
        refreshNotifications();
        setRequestsRefreshKey((k) => k + 1);
      }, 250);
    };

    const unsubscribeRealtime = subscribeToSupabaseUdharRealtime(scheduleSync);
    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        scheduleSync();
      }
    };
    const handleUdharUpdated = () => {
      scheduleSync();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('mymoney:udhar-updated', handleUdharUpdated);
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    return () => {
      clearInterval(interval);
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeRealtime();
      if (typeof window !== 'undefined') {
        window.removeEventListener('mymoney:udhar-updated', handleUdharUpdated);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
    };
  }, [fetchUdharData, refreshTransactions, refreshNotifications]);

  const executePendingConfirmAction = async () => {
    if (!pendingConfirmAction || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (pendingConfirmAction.type === 'settle_single') {
        const res = await udharDeletionApi.settleUdharTransaction(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.success('Transaction Settled', res.message || 'This Udhar entry is now marked settled.');
          await fetchUdharData();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'delete_single') {
        const res = await udharDeletionApi.cancelUdharTransaction(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.success('Transaction Deleted', res.message || 'Udhar entry deleted and totals recalculated.');
          await fetchUdharData();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'delete_repayment') {
        const res = await udharDeletionApi.deleteRepayment(pendingConfirmAction.rep.id);
        if (res.success) {
          toast.success('Repayment Deleted', res.message || 'Repayment deleted and Udhar balance recalculated.');
          await fetchUdharData();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'reject_request') {
        const res = await udharDeletionApi.rejectUdharTransaction(
          pendingConfirmAction.tx.id,
          rejectReasonInput.trim() || undefined
        );
        if (res.success) {
          toast.info('Request Rejected', res.message || 'Udhar request rejected.');
          setRejectReasonInput('');
          await fetchUdharData();
          await refreshTransactions();
          await refreshNotifications();
        }
      } else if (pendingConfirmAction.type === 'cancel_request') {
        const res = await udharDeletionApi.cancelUdharRequest(pendingConfirmAction.tx.id);
        if (res.success) {
          toast.info('Request Cancelled', res.message || 'Pending Udhar request cancelled.');
          await fetchUdharData();
          await refreshTransactions();
          await refreshNotifications();
        }
      }
      setPendingConfirmAction(null);
    } catch (err: any) {
      toast.error('Action Failed', err?.message || 'Unable to complete this action.');
    } finally {
      setConfirmBusy(false);
    }
  };

  // Handle Accept pending transaction
  const handleConfirmTransaction = async (id: string, personName: string) => {
    if (busyTxId) return;
    setBusyTxId(id);
    try {
      const res = await udharDeletionApi.confirmUdharTransaction(id);
      if (res.success) {
        toast.success('Request Accepted', `Udhar with ${personName} is now confirmed.`);
        await fetchUdharData();
        await refreshTransactions();
        await refreshNotifications();
      }
    } catch (err: any) {
      toast.error('Confirmation Failed', err.message || 'Failed to accept Udhar request.');
    } finally {
      setBusyTxId(null);
    }
  };

  const confirmRemovePersonConnection = async () => {
    if (!pendingRemovePerson || isRemovingPerson) return;
    const person = pendingRemovePerson;
    try {
      setIsRemovingPerson(true);
      const normName = person.name.trim().toLowerCase();
      const matchingContact = savedContacts.find(
        (c) =>
          (person.linkedUserId && c.linked_user_id === person.linkedUserId) ||
          c.name.trim().toLowerCase() === normName
      );
      let targetId =
        person.contactId ||
        matchingContact?.id ||
        (person.linkedUserId ? `conn_${person.linkedUserId}` : null);

      if (!targetId) {
        const freshRes = await udharDeletionApi.getContacts().catch(() => null);
        const freshMatch = freshRes?.contacts?.find(
          (c) =>
            (person.linkedUserId && c.linked_user_id === person.linkedUserId) ||
            c.name.trim().toLowerCase() === normName
        );
        targetId = freshMatch?.id || null;
      }

      if (!targetId) {
        toast.error('Delete Failed', 'Could not locate saved connection identifier.');
        return;
      }

      const res = await udharDeletionApi.removeSavedConnection(targetId);
      if (res.success) {
        toast.info(
          'Connection Removed',
          res.message || `${person.name} has been removed from Saved People. Existing Udhaar records remain intact.`
        );
        if (
          selectedPersonForDetails &&
          ((person.linkedUserId && selectedPersonForDetails.linkedUserId === person.linkedUserId) ||
            selectedPersonForDetails.name.trim().toLowerCase() === normName)
        ) {
          setSelectedPersonForDetails(null);
        }
        setPendingRemovePerson(null);
        await Promise.all([fetchUdharData(), refreshContacts(), refreshNotifications()]);
        setRequestsRefreshKey((k) => k + 1);
      }
    } catch (err: any) {
      toast.error('Remove Failed', err?.message || 'Could not remove this saved connection.');
    } finally {
      setIsRemovingPerson(false);
    }
  };

  const toggleRepayments = (txId: string) => {
    setExpandedRepayments((prev) => ({ ...prev, [txId]: !prev[txId] }));
  };

  // Filtered transactions
  const todayStr = new Date().toISOString().split('T')[0];

  const pendingConfirmationItems = useMemo(
    () =>
      udharTransactions.filter(
        (t) => normalizeUdharLifecycleStatus(t) === 'pending_confirmation'
      ),
    [udharTransactions]
  );

  const rejectedOrCancelledCount = useMemo(
    () =>
      udharTransactions.filter((t) => {
        const lc = normalizeUdharLifecycleStatus(t);
        return lc === 'rejected' || lc === 'cancelled';
      }).length,
    [udharTransactions]
  );

  const confirmedActiveCount = useMemo(
    () =>
      udharTransactions.filter((t) => {
        const lc = normalizeUdharLifecycleStatus(t);
        return lc === 'confirmed' || lc === 'disputed';
      }).length,
    [udharTransactions]
  );

  const filteredTransactions = useMemo(() => {
    return udharTransactions
      .filter((t) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
          t.counterpart_name.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          String(t.original_amount).includes(q)
        );
      })
      .filter((t) => {
        const lifecycle = normalizeUdharLifecycleStatus(t);
        const cur = parseFloat(String(t.current_balance)) || 0;
        const isConfirmedActive = lifecycle === 'confirmed' || lifecycle === 'disputed';
        const isOverdue =
          Boolean(t.due_date && t.due_date < todayStr) &&
          isConfirmedActive &&
          cur > 0;

        if (activeTab === 'lent') return t.direction === 'gave';
        if (activeTab === 'borrowed') return t.direction === 'took';
        if (activeTab === 'pending_confirmation') return lifecycle === 'pending_confirmation';
        if (activeTab === 'confirmed') return isConfirmedActive;
        if (activeTab === 'rejected') return lifecycle === 'rejected' || lifecycle === 'cancelled';
        if (activeTab === 'overdue') return isOverdue;
        if (activeTab === 'settled') return lifecycle === 'settled';
        return true;
      });
  }, [udharTransactions, searchQuery, activeTab, todayStr]);

  const pendingConfirmationCount = pendingConfirmationItems.length;

  const pendingTotalAmount = useMemo(
    () =>
      pendingConfirmationItems.reduce(
        (sum, t) => sum + (parseFloat(String(t.original_amount)) || 0),
        0
      ),
    [pendingConfirmationItems]
  );

  const overdueCount = udharTransactions.filter((t) => {
    const lifecycle = normalizeUdharLifecycleStatus(t);
    const cur = parseFloat(String(t.current_balance)) || 0;
    return (
      Boolean(t.due_date && t.due_date < todayStr) &&
      (lifecycle === 'confirmed' || lifecycle === 'disputed') &&
      cur > 0
    );
  }).length;

  // Screen 8: Individual Person Details View
  const currentSelectedPerson = useMemo(() => {
    if (!selectedPersonForDetails) return null;
    return (
      peopleSummaries.find(
        (p) =>
          (selectedPersonForDetails.linkedUserId && p.linkedUserId === selectedPersonForDetails.linkedUserId) ||
          p.name.trim().toLowerCase() === selectedPersonForDetails.name.trim().toLowerCase()
      ) || selectedPersonForDetails
    );
  }, [selectedPersonForDetails, peopleSummaries]);

  if (currentSelectedPerson) {
    return (
      <PersonDetailsView
        person={currentSelectedPerson}
        onBack={() => setSelectedPersonForDetails(null)}
        onOpenAddModal={onOpenAddModal}
        onEditPerson={() => setIsSavedPeopleOpen(true)}
        udharTransactions={udharTransactions}
        udharLoaded={hasLoadedUdhar}
        onRefreshUdhar={fetchUdharData}
      />
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-20 lg:pb-8">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 sm:p-6 bg-slate-950 dark:bg-slate-950 text-white rounded-2xl border border-emerald-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <Users className="w-3.5 h-3.5 stroke-[1.75]" />
            <span>Two-way synchronized ledger</span>
          </span>
          <h2 className="text-xl sm:text-2xl font-semibold mt-1 tracking-tight text-white">
            People ledger (Udhar)
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 font-medium">
            Synchronized balances, QR pairing, partial repayments and settlement tracking
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setInitialPersonForAdd(undefined);
              setIsAddUdharOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium text-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-[0.99]"
          >
            <PlusCircle className="w-4 h-4 stroke-[2]" />
            <span>Add Udhar</span>
          </button>

          <button
            onClick={() => setIsMyQrOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 font-medium text-xs border border-white/[0.08] transition-colors flex items-center gap-1.5 cursor-pointer active:scale-[0.99]"
          >
            <QrCode className="w-4 h-4 stroke-[1.75]" />
            <span>My QR</span>
          </button>

          <button
            onClick={() => setIsScanQrOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 font-medium text-xs border border-white/[0.08] transition-colors flex items-center gap-1.5 cursor-pointer active:scale-[0.99]"
          >
            <Smartphone className="w-4 h-4 stroke-[1.75]" />
            <span>Scan QR</span>
          </button>

          <button
            onClick={() => setIsSavedPeopleOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 font-medium text-xs border border-white/[0.08] transition-colors flex items-center gap-1.5 cursor-pointer active:scale-[0.99]"
          >
            <Users className="w-4 h-4 stroke-[1.75]" />
            <span>Saved people</span>
          </button>
        </div>
      </div>

      {/* 6 Dynamic Summary Cards (Requirement 7) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {/* 1. Total Lent */}
        <StatCard
          title="Total Lent (दिए गए)"
          amount={udharSummary.totalLent}
          variant="expense"
          icon={ArrowUpRight}
          badge="Cumulative"
        />

        {/* 2. Total Borrowed */}
        <StatCard
          title="Total Borrowed (लिए गए)"
          amount={udharSummary.totalBorrowed}
          variant="income"
          icon={ArrowDownLeft}
          badge="Cumulative"
        />

        {/* 3. Outstanding Receivable (You are owed) */}
        <StatCard
          title="Receivable (वापस मिलने हैं)"
          amount={udharSummary.outstandingReceivable}
          variant="income"
          icon={ArrowDownLeft}
          badge="They Owe You"
        />

        {/* 4. Outstanding Payable (You owe) */}
        <StatCard
          title="Payable (वापस देने हैं)"
          amount={udharSummary.outstandingPayable}
          variant="expense"
          icon={ArrowUpRight}
          badge="You Owe"
        />

        {/* 5. Settled Amount */}
        <StatCard
          title="Settled (चुकता किया)"
          amount={udharSummary.settledAmount}
          variant="balance"
          icon={CheckCircle2}
          badge="Settled"
        />

        {/* 6. Overdue Amount */}
        <StatCard
          title="Overdue (अवधि समाप्त)"
          amount={udharSummary.overdueAmount}
          variant="amber"
          icon={AlertTriangle}
          badge={overdueAmountBadge(overdueCount)}
        />
      </div>

      {/* Consent-based pairing requests (accept / reject) */}
      <ConnectionRequestsPanel
        refreshKey={requestsRefreshKey}
        onChanged={() => {
          fetchUdharData();
          refreshContacts();
          refreshTransactions();
        }}
      />

      {/* Pending Udhar Confirmation Requests Panel (Method A) */}
      {pendingConfirmationItems.length > 0 && (
        <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/70 rounded-3xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm sm:text-base font-black text-amber-950 dark:text-amber-100">
                  Pending Udhar Requests ({pendingConfirmationItems.length})
                </h3>
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Total awaiting confirmation: <strong>{formatINR(pendingTotalAmount)}</strong> — excluded from confirmed totals until accepted.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('pending_confirmation')}
              className="self-start sm:self-auto px-3 py-1 rounded-xl bg-amber-600/15 hover:bg-amber-600/25 text-amber-900 dark:text-amber-200 text-xs font-bold cursor-pointer"
            >
              Filter Pending
            </button>
          </div>

          <div className="space-y-2">
            {pendingConfirmationItems.map((tx) => {
              const isSender = Boolean(tx.is_initiator);
              const amt = parseFloat(String(tx.original_amount)) || 0;
              const isRowBusy = busyTxId === tx.id;
              return (
                <div
                  key={`pending-${tx.id}`}
                  className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          isSender
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200'
                            : 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200'
                        }`}
                      >
                        {isSender ? 'Pending Confirmation' : 'New Udhar Request'}
                      </span>
                      <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                        {tx.counterpart_name}
                      </span>
                      <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                        {formatINR(amt)}
                      </span>
                      <span
                        className={`text-[11px] font-bold ${
                          tx.direction === 'gave'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        ({tx.direction === 'gave' ? 'I Gave' : 'I Borrowed'})
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isSender
                        ? 'Waiting for recipient confirmation'
                        : `Sent by ${tx.counterpart_name} on ${formatDisplayDate(tx.transaction_date)}${
                            tx.description ? ` · ${tx.description}` : ''
                          }`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSelectedTxForDetail(tx)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                    >
                      View Details
                    </button>

                    {!isSender ? (
                      <>
                        <button
                          type="button"
                          disabled={isRowBusy}
                          onClick={() => handleConfirmTransaction(tx.id, tx.counterpart_name)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isRowBusy ? 'Accepting...' : 'Accept'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isRowBusy}
                          onClick={() => {
                            setRejectReasonInput('');
                            setPendingConfirmAction({ type: 'reject_request', tx });
                          }}
                          className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold cursor-pointer"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingConfirmAction({ type: 'cancel_request', tx })}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold cursor-pointer"
                      >
                        Cancel Request
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Connected & Saved People Directory */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Connected & Saved People ({peopleSummaries.length})
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              People paired via QR code or saved in your ledger with live 2-way sync
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddPersonModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-bold text-xs shadow hover:bg-emerald-700 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Person</span>
            </button>
            <button
              onClick={() => setIsScanQrOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Pair QR</span>
            </button>
            <button
              onClick={() => setIsSavedPeopleOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-200 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Manage People</span>
            </button>
          </div>
        </div>

        {contactsError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{contactsError}</span>
            </div>
            <button
              type="button"
              onClick={() => refreshContacts()}
              className="px-3 py-1 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 cursor-pointer shrink-0 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {(isLoadingContacts || isLoadingUdhar) && peopleSummaries.length === 0 ? (
          <SkeletonCardsGrid count={3} />
        ) : peopleSummaries.length === 0 ? (
          <div className="p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700">
            <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              No connected or saved people yet
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Scan a friend's QR code or add a contact to start 2-way synchronized lending and borrowing.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => setIsScanQrOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Scan Friend's QR</span>
              </button>
              <button
                onClick={() => setIsAddPersonModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 cursor-pointer"
              >
                + Add Manually
              </button>
            </div>
          </div>
        ) : (
          /* Compact person rows (name, avatar, connection status, balance) */
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            {peopleSummaries.map((person) => {
              const isLinked = Boolean(person.linkedUserId || person.isRegisteredUser);
              const balance = person.outstandingBalance;
              const owesYou = balance > 0;
              const isSettled = Math.abs(balance) < 0.01;
              const matchingTxs = udharTransactions.filter(
                (t) =>
                  (person.linkedUserId && t.counterpart_user_id === person.linkedUserId) ||
                  t.counterpart_name.trim().toLowerCase() === person.name.trim().toLowerCase()
              );
              const livePending = matchingTxs.filter(
                (t) => normalizeUdharLifecycleStatus(t) === 'pending_confirmation'
              );
              const personPendingCount =
                livePending.length > 0 ? livePending.length : person.pendingRequestsCount || 0;
              const personPendingAmt =
                livePending.length > 0
                  ? livePending.reduce((s, t) => s + (parseFloat(String(t.original_amount)) || 0), 0)
                  : person.pendingRequestsAmount || 0;

              return (
                <div
                  key={person.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPersonForDetails(person)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedPersonForDetails(person);
                    }
                  }}
                  className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      {person.avatarUrl ? (
                        <img
                          src={person.avatarUrl}
                          alt={person.name}
                          className="w-9 h-9 rounded-full object-cover border border-emerald-500/40"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center justify-center">
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {isLinked && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[8px] border border-white dark:border-slate-900"
                          title="Verified registered connection"
                        >
                          ✓
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                          {person.name}
                        </p>
                        {isLinked && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0">
                            2-WAY
                          </span>
                        )}
                        {personPendingCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 shrink-0">
                            {personPendingCount} Pending ({formatINR(personPendingAmt)})
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Confirmed Gave {formatINR(person.totalGiven)} · Borrowed {formatINR(person.totalReceived)}
                        {person.lastTransactionDate ? ` · ${formatDisplayDate(person.lastTransactionDate)}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <span
                      className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                        isSettled
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          : owesYou
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {isSettled
                        ? 'Settled'
                        : owesYou
                          ? `Owes ₹${Math.abs(balance).toLocaleString('en-IN')}`
                          : `You owe ₹${Math.abs(balance).toLocaleString('en-IN')}`}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInitialPersonForAdd(person.name);
                        setIsAddUdharOpen(true);
                      }}
                      className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                      title="Record Udhar with this person"
                    >
                      + Udhar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingRemovePerson(person);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                      title="Remove Connection"
                      aria-label={`Delete ${person.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* Main Ledger Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-sm space-y-6">
        {/* Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          {/* Subtabs: Lifecycle & Direction Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              All ({udharTransactions.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pending_confirmation')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'pending_confirmation'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              <span>Pending</span>
              {pendingConfirmationCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white">
                  {pendingConfirmationCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('confirmed')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'confirmed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Confirmed ({confirmedActiveCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('rejected')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'rejected'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Rejected ({rejectedOrCancelledCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settled')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'settled'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Settled
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('lent')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'lent'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              I Gave ({udharTransactions.filter((t) => t.direction === 'gave').length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('borrowed')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'borrowed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              I Borrowed ({udharTransactions.filter((t) => t.direction === 'took').length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('overdue')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'overdue'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              <span>Overdue</span>
              {overdueCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-600 text-white">
                  {overdueCount}
                </span>
              )}
            </button>
          </div>

          {/* Search Box with Voice Mic & Search Button */}
          <SearchVoiceBar
            value={searchQuery}
            onChange={(val) => setSearchQuery(val)}
            onSearch={(val) => setSearchQuery(val)}
            placeholder="Search by person, notes, amount..."
            className="w-full sm:w-auto sm:min-w-[280px]"
          />
        </div>

        {/* Transactions Feed */}
        {udharError && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{udharError}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchUdharData()}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 cursor-pointer shrink-0 flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoadingUdhar && !hasLoadedUdhar ? (
          <SkeletonTable rows={5} />
        ) : filteredTransactions.length === 0 ? (
          <EmptyState
            title="No Udhar records found"
            description="You don't have any transactions under this view. Click '+ Add Udhar' to record money lent or borrowed."
            actionLabel="+ Add Udhar"
            onAction={() => setIsAddUdharOpen(true)}
          />
        ) : (
          <div className="space-y-3">
            {filteredTransactions.map((tx) => {
              const orig = parseFloat(String(tx.original_amount)) || 0;
              const cur = parseFloat(String(tx.current_balance)) || 0;
              const isGave = tx.direction === 'gave';
              const isLinked = Boolean(tx.counterpart_user_id);
              const lifecycle = normalizeUdharLifecycleStatus(tx);
              const isPendingConfirm = lifecycle === 'pending_confirmation';
              const isRejectedOrCancelled = lifecycle === 'rejected' || lifecycle === 'cancelled';
              const isDisputed = lifecycle === 'disputed';
              const statusInfo = getUdharSettlementStatus(tx);
              const isSettled = statusInfo.isSettled;
              const isOverdue = Boolean(
                tx.due_date &&
                  tx.due_date < todayStr &&
                  !isSettled &&
                  !isPendingConfirm &&
                  !isRejectedOrCancelled
              );
              const acceptGuard = canAcceptUdhar(tx, user?.id || user?.uid);
              const rejectGuard = canRejectUdhar(tx, user?.id || user?.uid);
              const senderCancelGuard = canSenderCancelUdhar(tx, user?.id || user?.uid);
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
              const repaymentsCount = tx.repayments?.length || 0;
              const isExpanded = Boolean(expandedRepayments[tx.id]);

              return (
                <div
                  key={tx.id}
                  data-testid={`udhar-feed-card-${tx.id}`}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    isPendingConfirm
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
                      : isRejectedOrCancelled
                      ? 'bg-slate-50/70 dark:bg-slate-900/50 border-rose-200/80 dark:border-rose-900/50 opacity-85'
                      : isDisputed
                      ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                      : isSettled
                      ? 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-80'
                      : isOverdue
                      ? 'bg-red-50/40 dark:bg-red-950/20 border-red-300 dark:border-red-900'
                      : 'bg-white dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 shadow-sm'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Left: Person & Details */}
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 ${
                          isGave
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                            : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {isGave ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                            {tx.counterpart_name}
                          </h4>

                          {/* Lifecycle / Settlement Status Badge */}
                          {isRejectedOrCancelled ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              {statusInfo.lifecycleLabel}
                            </span>
                          ) : isDisputed ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-300">
                              Disputed
                            </span>
                          ) : isPendingConfirm ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300">
                              Pending Confirmation
                            </span>
                          ) : isSettled ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              Settled
                            </span>
                          ) : statusInfo.isPartiallySettled ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300">
                              Partially Settled
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              Confirmed
                            </span>
                          )}

                          {tx.creation_method === 'qr' && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70">
                              QR Verified
                            </span>
                          )}
                          {tx.creation_method === 'code' && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70">
                              Code Verified
                            </span>
                          )}

                          {isOverdue && (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border border-red-300">
                              Overdue
                            </span>
                          )}

                          {isLinked && !isRejectedOrCancelled && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span>2-Way synced</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                          <span className={`font-bold ${isGave ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {isGave ? 'I Gave' : 'I Borrowed'}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDisplayDate(tx.transaction_date)}</span>
                          </span>
                          <span>•</span>
                          <span className="font-mono text-[10px] text-slate-400" title={tx.id}>
                            ID: {tx.id.slice(0, 8)}
                          </span>
                          {tx.due_date && !isRejectedOrCancelled && (
                            <>
                              <span>•</span>
                              <span className={isOverdue ? 'text-red-600 font-bold' : 'text-slate-500'}>
                                Due: {formatDisplayDate(tx.due_date)}
                              </span>
                            </>
                          )}
                        </div>

                        {isPendingConfirm && tx.is_initiator && (
                          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            Waiting for recipient confirmation (excluded from confirmed totals)
                          </p>
                        )}
                        {isPendingConfirm && !tx.is_initiator && (
                          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            New Udhaar Request — review and accept or reject before it enters active balance.
                          </p>
                        )}
                        {isRejectedOrCancelled && tx.rejection_reason && (
                          <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                            Reason: {tx.rejection_reason}
                          </p>
                        )}

                        {(tx.description || tx.notes) && (
                          <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-0.5">
                            {tx.description && <p className="font-semibold text-slate-800 dark:text-slate-200">{tx.description}</p>}
                            {tx.notes && <p>{tx.notes}</p>}
                          </div>
                        )}

                        {isDisputed && tx.dispute_reason && (
                          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 rounded-xl border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
                            <strong>Dispute Reason:</strong> {tx.dispute_reason}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Amounts & Actions */}
                    <div className="flex flex-col sm:items-end justify-between gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 font-sans">
                          {formatINR(orig)}
                        </div>
                        {isPendingConfirm ? (
                          <p className="text-xs text-amber-700 dark:text-amber-300 sm:text-right font-semibold">
                            Awaiting confirmation
                          </p>
                        ) : isRejectedOrCancelled ? (
                          <p className="text-xs text-slate-400 sm:text-right font-medium">
                            Not in active balance
                          </p>
                        ) : !isSettled ? (
                          <p className="text-xs text-slate-500 sm:text-right font-medium">
                            Remaining:{' '}
                            <strong className={isGave ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {formatINR(cur)}
                            </strong>
                          </p>
                        ) : (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 sm:text-right font-semibold">
                            Settled (₹0 due)
                          </p>
                        )}
                      </div>

                      {/* Interactive Buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSelectedTxForDetail(tx)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>View Details</span>
                        </button>

                        {/* Pending Confirmation Controls */}
                        {isPendingConfirm && acceptGuard.allowed && (
                          <button
                            type="button"
                            disabled={busyTxId === tx.id}
                            onClick={() => handleConfirmTransaction(tx.id, tx.counterpart_name)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{busyTxId === tx.id ? 'Accepting...' : 'Accept'}</span>
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
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Reject
                          </button>
                        )}

                        {isPendingConfirm && senderCancelGuard.allowed && (
                          <button
                            type="button"
                            onClick={() => setPendingConfirmAction({ type: 'cancel_request', tx })}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                          >
                            Cancel Request
                          </button>
                        )}

                        {/* Record Repayment & Lender-Only Settle */}
                        {!isSettled && !isPendingConfirm && !isRejectedOrCancelled && !isDisputed && (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedTxForRepay(tx)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              <span>{isGave ? 'Record Payment' : 'Request Repayment'}</span>
                            </button>

                            {isGave && (
                              <button
                                type="button"
                                onClick={() => setPendingConfirmAction({ type: 'settle_single', tx })}
                                data-testid={`udhar-feed-settle-btn-${tx.id}`}
                                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                title="Mark only this Udhar entry as settled (Lender only)"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Settle</span>
                              </button>
                            )}
                          </>
                        )}

                        {!isPendingConfirm && deleteGuard.allowed && (
                          <button
                            type="button"
                            onClick={() => setPendingConfirmAction({ type: 'delete_single', tx })}
                            data-testid={`udhar-feed-delete-btn-${tx.id}`}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                            title="Delete this Udhar entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}

                        {/* Expand Repayments history */}
                        {repaymentsCount > 0 && !isPendingConfirm && !isRejectedOrCancelled && (
                          <button
                            type="button"
                            onClick={() => toggleRepayments(tx.id)}
                            className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <span>{repaymentsCount} repayment{repaymentsCount > 1 ? 's' : ''}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Repayments History Sub-table */}
                  {isExpanded && tx.repayments && tx.repayments.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 animate-fade-in">
                      <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                        Repayments Ledger:
                      </h5>
                      <div className="space-y-1.5">
                        {tx.repayments.map((rep) => {
                          const repDeleteAllowed = canDeleteRepayment({
                            isShared: Boolean(tx.counterpart_user_id),
                            direction: tx.direction,
                            actorUserId: user?.id || user?.uid,
                            repayment: rep,
                          }).allowed;
                          return (
                            <div
                              key={rep.id}
                              className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <CheckCircle2
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    rep.status === 'pending_confirmation'
                                      ? 'text-amber-500'
                                      : rep.status === 'rejected'
                                      ? 'text-rose-500'
                                      : 'text-emerald-500'
                                  }`}
                                />
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                  {formatINR(Number(rep.amount) || 0)}
                                </span>
                                <span className="text-slate-400">• {formatDisplayDate(rep.repayment_date)}</span>
                                {rep.notes && <span className="text-slate-500 font-medium truncate">({rep.notes})</span>}
                                {rep.status === 'pending_confirmation' && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                    Pending
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
                                  Logged by {rep.recorded_by_name || 'User'}
                                </span>
                                {repDeleteAllowed && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingConfirmAction({ type: 'delete_repayment', tx, rep })}
                                    data-testid={`udhar-feed-repayment-delete-btn-${rep.id}`}
                                    className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <AddUdharModal
        isOpen={isAddUdharOpen}
        onClose={() => setIsAddUdharOpen(false)}
        initialPersonName={initialPersonForAdd}
        onSuccess={() => {
          fetchUdharData();
          refreshTransactions();
        }}
        onOpenScanner={() => setIsScanQrOpen(true)}
      />

      <MyUdharQrModal
        isOpen={isMyQrOpen}
        onClose={() => setIsMyQrOpen(false)}
        onOpenScanner={() => setIsScanQrOpen(true)}
      />

      <ScanQrModal
        isOpen={isScanQrOpen}
        onClose={() => {
          setIsScanQrOpen(false);
          // A scan may have created a pending request.
          setRequestsRefreshKey((k) => k + 1);
        }}
        onInstantUdharCreated={() => {
          fetchUdharData();
          refreshContacts();
          refreshTransactions();
          refreshNotifications();
        }}
        onConnected={(p) => {
          fetchUdharData();
          refreshContacts();
          refreshTransactions();
          refreshNotifications();
          setIsScanQrOpen(false);
          setConnectedSuccessPerson({
            name: p.name,
            emailMasked: p.emailMasked,
            avatarUrl: p.avatarUrl || null,
          });
        }}
      />

      {/* Screen 7: QR Connection Success Modal */}
      {connectedSuccessPerson && (
        <QrSuccessModal
          isOpen={Boolean(connectedSuccessPerson)}
          onClose={() => setConnectedSuccessPerson(null)}
          connectedPerson={connectedSuccessPerson}
          onViewProfile={(pName) => {
            const found = peopleSummaries.find((x) => x.name === pName);
            if (found) setSelectedPersonForDetails(found);
            setConnectedSuccessPerson(null);
          }}
          onAddUdhar={(pName) => {
            setConnectedSuccessPerson(null);
            setInitialPersonForAdd(pName);
            setIsAddUdharOpen(true);
          }}
        />
      )}

      {/* Screen 5: Dedicated Add Person Modal */}
      <AddPersonModal
        isOpen={isAddPersonModalOpen}
        onClose={() => setIsAddPersonModalOpen(false)}
        onPersonAdded={() => {
          fetchUdharData();
          refreshContacts();
          setRequestsRefreshKey((k) => k + 1);
        }}
        onRequestSent={() => setRequestsRefreshKey((k) => k + 1)}
      />

      <RepayUdharModal
        isOpen={Boolean(selectedTxForRepay)}
        onClose={() => setSelectedTxForRepay(null)}
        transaction={selectedTxForRepay}
        onSuccess={() => {
          fetchUdharData();
          refreshContacts();
          refreshTransactions();
        }}
      />

      <DisputeModal
        isOpen={Boolean(selectedTxForDispute)}
        onClose={() => setSelectedTxForDispute(null)}
        transaction={selectedTxForDispute}
        onSuccess={() => {
          fetchUdharData();
          refreshContacts();
        }}
      />

      <SavedPeopleManagerModal
        isOpen={isSavedPeopleOpen}
        onClose={() => setIsSavedPeopleOpen(false)}
        onContactsUpdated={() => {
          fetchUdharData();
          refreshContacts();
          setRequestsRefreshKey((k) => k + 1);
        }}
        onRequestsUpdated={() => setRequestsRefreshKey((k) => k + 1)}
        onSelectPersonForUdhar={(pName) => {
          setInitialPersonForAdd(pName);
          setIsAddUdharOpen(true);
        }}
      />

      <UdharDetailModal
        isOpen={Boolean(selectedTxForDetail)}
        onClose={() => setSelectedTxForDetail(null)}
        transaction={selectedTxForDetail}
        onRefreshUdhar={fetchUdharData}
      />

      <ConfirmModal
        isOpen={Boolean(pendingRemovePerson)}
        title="Remove Connection?"
        subtitle="Existing Udhaar transactions and balances remain completely intact."
        message="Are you sure you want to remove this person from your saved connections?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isRemovingPerson}
        onConfirm={() => void confirmRemovePersonConnection()}
        onCancel={() => !isRemovingPerson && setPendingRemovePerson(null)}
      />

      {pendingConfirmAction && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setPendingConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="udhar-feed-confirm-modal"
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {pendingConfirmAction.type === 'settle_single'
                  ? 'Settle This Udhar Transaction?'
                  : pendingConfirmAction.type === 'reject_request'
                    ? 'Are you sure you want to reject this Udhaar request?'
                    : pendingConfirmAction.type === 'cancel_request'
                      ? 'Cancel Pending Udhar Request?'
                      : pendingConfirmAction.type === 'delete_single'
                        ? 'Delete This Udhar Transaction?'
                        : 'Delete This Repayment?'}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {pendingConfirmAction.type === 'settle_single' ? (
                  <>
                    Only this single Udhar entry of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.current_balance)) || 0)}</strong>{' '}
                    with <strong>{pendingConfirmAction.tx.counterpart_name}</strong>
                    {pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes
                      ? ` (“${pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes}”)`
                      : ''}{' '}
                    will be marked as <strong>Settled</strong>. Other pending entries will stay untouched.
                  </>
                ) : pendingConfirmAction.type === 'reject_request' ? (
                  <>
                    You are rejecting the manual Udhar request of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    from <strong>{pendingConfirmAction.tx.counterpart_name}</strong>. It will remain marked as{' '}
                    <strong>Rejected</strong> in request history and will never affect your confirmed balance.
                  </>
                ) : pendingConfirmAction.type === 'cancel_request' ? (
                  <>
                    Cancel your unconfirmed Udhar request of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    to <strong>{pendingConfirmAction.tx.counterpart_name}</strong>?
                  </>
                ) : pendingConfirmAction.type === 'delete_single' ? (
                  <>
                    Delete this Udhar entry of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.tx.original_amount)) || 0)}</strong>{' '}
                    with <strong>{pendingConfirmAction.tx.counterpart_name}</strong>
                    {pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes
                      ? ` (“${pendingConfirmAction.tx.description || pendingConfirmAction.tx.notes}”)`
                      : ''}
                    ? Any repayments linked to this entry will also be removed; all other Udhar transactions remain untouched and totals recalculate immediately.
                  </>
                ) : (
                  <>
                    Delete repayment of{' '}
                    <strong>{formatINR(parseFloat(String(pendingConfirmAction.rep.amount)) || 0)}</strong>{' '}
                    for <strong>{pendingConfirmAction.tx.counterpart_name}</strong>
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
                )}
              </p>

              {pendingConfirmAction.type === 'reject_request' && (
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Reason for rejecting (optional)..."
                    value={rejectReasonInput}
                    disabled={confirmBusy}
                    onChange={(e) => setRejectReasonInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingConfirmAction(null)}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executePendingConfirmAction}
                disabled={confirmBusy}
                data-testid="udhar-feed-confirm-action-btn"
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
                        ? 'Cancel Request'
                        : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function overdueAmountBadge(count: number): string {
  if (count <= 0) return 'No Overdue';
  return `${count} Overdue Loan${count > 1 ? 's' : ''}`;
}
