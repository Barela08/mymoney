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
  Sparkles,
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
  UdharSummaryData,
} from '../../lib/udharDeletionApi';
import { MyUdharQrModal } from './MyUdharQrModal';
import { ScanQrModal } from './ScanQrModal';
import { AddUdharModal } from './AddUdharModal';
import { RepayUdharModal } from './RepayUdharModal';
import { DisputeModal } from './DisputeModal';
import { SavedPeopleManagerModal } from './SavedPeopleManagerModal';

interface PeopleSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any, personName?: string) => void;
}

export const PeopleSection: React.FC<PeopleSectionProps> = ({ onOpenAddModal }) => {
  const { summary, refreshTransactions } = useExpense();
  const { user } = useAuth();
  const toast = useToast();

  // Udhar backend state
  const [udharTransactions, setUdharTransactions] = useState<UdharTransactionItem[]>([]);
  const [udharSummary, setUdharSummary] = useState<UdharSummaryData>({
    totalLent: 0,
    totalBorrowed: 0,
    outstandingReceivable: 0,
    outstandingPayable: 0,
    settledAmount: 0,
    overdueAmount: 0,
  });
  const [isLoadingUdhar, setIsLoadingUdhar] = useState<boolean>(true);

  // Tab filter: 'all' | 'lent' | 'borrowed' | 'pending_confirmation' | 'overdue' | 'settled'
  const [activeTab, setActiveTab] = useState<
    'all' | 'lent' | 'borrowed' | 'pending_confirmation' | 'overdue' | 'settled'
  >('all');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRepayments, setExpandedRepayments] = useState<Record<string, boolean>>({});

  // Modals state
  const [isAddUdharOpen, setIsAddUdharOpen] = useState(false);
  const [isMyQrOpen, setIsMyQrOpen] = useState(false);
  const [isScanQrOpen, setIsScanQrOpen] = useState(false);
  const [isSavedPeopleOpen, setIsSavedPeopleOpen] = useState(false);
  const [selectedTxForRepay, setSelectedTxForRepay] = useState<UdharTransactionItem | null>(null);
  const [selectedTxForDispute, setSelectedTxForDispute] = useState<UdharTransactionItem | null>(null);
  const [initialPersonForAdd, setInitialPersonForAdd] = useState<string | undefined>(undefined);

  // Fetch Udhar Data from Backend
  const fetchUdharData = useCallback(async () => {
    try {
      setIsLoadingUdhar(true);
      const res = await udharDeletionApi.getUdharTransactions();
      if (res.success) {
        setUdharTransactions(res.transactions);
        setUdharSummary(res.summary);
      }
    } catch (err: any) {
      console.warn('Could not fetch udhar transactions:', err.message);
    } finally {
      setIsLoadingUdhar(false);
    }
  }, []);

  useEffect(() => {
    fetchUdharData();
  }, [fetchUdharData]);

  // Handle Confirm pending transaction
  const handleConfirmTransaction = async (id: string, personName: string) => {
    try {
      const res = await udharDeletionApi.confirmUdharTransaction(id);
      if (res.success) {
        toast.success('Confirmed', `Transaction with ${personName} confirmed.`);
        await fetchUdharData();
        await refreshTransactions();
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to confirm transaction.');
    }
  };

  const toggleRepayments = (txId: string) => {
    setExpandedRepayments((prev) => ({ ...prev, [txId]: !prev[txId] }));
  };

  // Filtered transactions
  const todayStr = new Date().toISOString().split('T')[0];

  const filteredTransactions = useMemo(() => {
    return udharTransactions
      .filter((t) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
          t.counterpart_name.toLowerCase().includes(q) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          String(t.original_amount).includes(q)
        );
      })
      .filter((t) => {
        const cur = parseFloat(String(t.current_balance)) || 0;
        const isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'settled' && cur > 0;

        if (activeTab === 'lent') return t.direction === 'gave';
        if (activeTab === 'borrowed') return t.direction === 'took';
        if (activeTab === 'pending_confirmation') return t.status === 'pending_confirmation';
        if (activeTab === 'overdue') return isOverdue;
        if (activeTab === 'settled') return t.status === 'settled';
        return true;
      });
  }, [udharTransactions, searchQuery, activeTab, todayStr]);

  // Counts for tabs
  const pendingConfirmationCount = udharTransactions.filter(
    (t) => t.status === 'pending_confirmation'
  ).length;

  const overdueCount = udharTransactions.filter((t) => {
    const cur = parseFloat(String(t.current_balance)) || 0;
    return t.due_date && t.due_date < todayStr && t.status !== 'settled' && cur > 0;
  }).length;

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-20 lg:pb-8">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 sm:p-6 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 rounded-3xl text-white shadow-xl shadow-emerald-900/10">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Smart Lend & Borrow System</span>
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-2 tracking-tight">
            Udhar & People Ledger (उधार खाता)
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/90 mt-1 font-medium">
            Two-sided synchronized balances, QR pairing, partial repayments, and dispute resolution
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setInitialPersonForAdd(undefined);
              setIsAddUdharOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-white text-emerald-700 font-extrabold text-xs shadow-md shadow-emerald-950/20 hover:bg-emerald-50 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 text-emerald-600" />
            <span>+ Add Udhar</span>
          </button>

          <button
            onClick={() => setIsMyQrOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>My QR</span>
          </button>

          <button
            onClick={() => setIsScanQrOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Smartphone className="w-4 h-4" />
            <span>Scan QR</span>
          </button>

          <button
            onClick={() => setIsSavedPeopleOpen(true)}
            className="px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Users className="w-4 h-4" />
            <span>Saved People</span>
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

      {/* Main Ledger Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-sm space-y-6">
        {/* Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          {/* Subtabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            <button
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
              onClick={() => setActiveTab('lent')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'lent'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Money I Gave (Lend)
            </button>

            <button
              onClick={() => setActiveTab('borrowed')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'borrowed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Money I Took (Borrow)
            </button>

            <button
              onClick={() => setActiveTab('pending_confirmation')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'pending_confirmation'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              <span>Pending Confirmation</span>
              {pendingConfirmationCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-500 text-white">
                  {pendingConfirmationCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('overdue')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'overdue'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              <span>Overdue</span>
              {overdueCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-red-600 text-white">
                  {overdueCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settled')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'settled'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Settled
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by person, notes, amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Transactions Feed */}
        {isLoadingUdhar ? (
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
              const isPendingConfirm = tx.status === 'pending_confirmation';
              const isDisputed = tx.status === 'disputed';
              const isSettled = tx.status === 'settled' || cur <= 0.01;
              const isOverdue = tx.due_date && tx.due_date < todayStr && !isSettled;
              const repaymentsCount = tx.repayments?.length || 0;
              const isExpanded = Boolean(expandedRepayments[tx.id]);

              return (
                <div
                  key={tx.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    isPendingConfirm
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
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

                          {/* Status Badge */}
                          {isPendingConfirm ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 animate-pulse">
                              Pending Confirmation
                            </span>
                          ) : isDisputed ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-300">
                              Disputed
                            </span>
                          ) : isSettled ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                              Fully Settled (₹0)
                            </span>
                          ) : isOverdue ? (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border border-red-300 animate-pulse">
                              Overdue
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              Confirmed
                            </span>
                          )}

                          {isLinked && (
                            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-0.5">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>2-Way Synced</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {isGave ? 'You Lent (Money Given)' : 'You Borrowed (Money Taken)'}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDisplayDate(tx.transaction_date)}</span>
                          </span>
                          {tx.due_date && (
                            <>
                              <span>•</span>
                              <span className={isOverdue ? 'text-red-600 font-bold' : 'text-slate-500'}>
                                Due: {formatDisplayDate(tx.due_date)}
                              </span>
                            </>
                          )}
                        </div>

                        {tx.notes && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                            {tx.notes}
                          </p>
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
                        {!isSettled && (
                          <p className="text-xs text-slate-500 sm:text-right font-medium">
                            Remaining:{' '}
                            <strong className={isGave ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {formatINR(cur)}
                            </strong>
                          </p>
                        )}
                      </div>

                      {/* Interactive Buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Pending Confirmation Controls: For the counterpart */}
                        {isPendingConfirm && !tx.is_initiator && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleConfirmTransaction(tx.id, tx.counterpart_name)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedTxForDispute(tx)}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                            >
                              Dispute
                            </button>
                          </>
                        )}

                        {/* Repay / Settle Action */}
                        {!isSettled && !isPendingConfirm && (
                          <button
                            type="button"
                            onClick={() => setSelectedTxForRepay(tx)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            <span>Repay / Settle</span>
                          </button>
                        )}

                        {/* Expand Repayments history */}
                        {repaymentsCount > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleRepayments(tx.id)}
                            className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
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
                        {tx.repayments.map((rep) => (
                          <div
                            key={rep.id}
                            className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="font-bold text-slate-800 dark:text-slate-200">
                                {formatINR(Number(rep.amount) || 0)}
                              </span>
                              <span className="text-slate-400">• {formatDisplayDate(rep.repayment_date)}</span>
                              {rep.notes && <span className="text-slate-500 font-medium">({rep.notes})</span>}
                            </div>
                            <span className="text-[10px] text-slate-400 font-medium">
                              Logged by {rep.recorded_by_name || 'User'}
                            </span>
                          </div>
                        ))}
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
        onClose={() => setIsScanQrOpen(false)}
        onConnected={(p) => {
          fetchUdharData();
          setInitialPersonForAdd(p.name);
          setIsAddUdharOpen(true);
        }}
      />

      <RepayUdharModal
        isOpen={Boolean(selectedTxForRepay)}
        onClose={() => setSelectedTxForRepay(null)}
        transaction={selectedTxForRepay}
        onSuccess={() => {
          fetchUdharData();
          refreshTransactions();
        }}
      />

      <DisputeModal
        isOpen={Boolean(selectedTxForDispute)}
        onClose={() => setSelectedTxForDispute(null)}
        transaction={selectedTxForDispute}
        onSuccess={() => {
          fetchUdharData();
        }}
      />

      <SavedPeopleManagerModal
        isOpen={isSavedPeopleOpen}
        onClose={() => setIsSavedPeopleOpen(false)}
        onContactsUpdated={fetchUdharData}
        onSelectPersonForUdhar={(pName) => {
          setInitialPersonForAdd(pName);
          setIsAddUdharOpen(true);
        }}
      />
    </div>
  );
};

function overdueAmountBadge(count: number): string {
  if (count <= 0) return 'No Overdue';
  return `${count} Overdue Loan${count > 1 ? 's' : ''}`;
}
