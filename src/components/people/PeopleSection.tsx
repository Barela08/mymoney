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
import { PersonDetailsView } from './PersonDetailsView';
import { AddPersonModal } from './AddPersonModal';
import { QrSuccessModal } from './QrSuccessModal';
import { UdharDetailModal } from './UdharDetailModal';

interface PeopleSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any, personName?: string) => void;
}

export const PeopleSection: React.FC<PeopleSectionProps> = ({ onOpenAddModal }) => {
  const { summary, refreshTransactions, peopleSummaries, refreshContacts } = useExpense();
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

  // Fetch Udhar Data from Backend
  const fetchUdharData = useCallback(async () => {
    try {
      setIsLoadingUdhar(true);
      const res = await udharDeletionApi.getUdharTransactions();
      if (res.success) {
        setUdharTransactions(res.transactions);
        setUdharSummary(res.summary);
      }
      await refreshContacts();
    } catch (err: any) {
      console.warn('Could not fetch udhar transactions:', err.message);
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
    }, 15000);
    return () => clearInterval(interval);
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

  // Screen 8: Individual Person Details View
  const currentSelectedPerson = useMemo(() => {
    if (!selectedPersonForDetails) return null;
    return peopleSummaries.find((p) => p.name === selectedPersonForDetails.name) || selectedPersonForDetails;
  }, [selectedPersonForDetails, peopleSummaries]);

  if (currentSelectedPerson) {
    return (
      <PersonDetailsView
        person={currentSelectedPerson}
        onBack={() => setSelectedPersonForDetails(null)}
        onOpenAddModal={onOpenAddModal}
        onEditPerson={() => setIsSavedPeopleOpen(true)}
        udharTransactions={udharTransactions}
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

        {peopleSummaries.length === 0 ? (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {peopleSummaries.map((person) => {
              const isLinked = Boolean(person.linkedUserId || person.isRegisteredUser);
              const balance = person.outstandingBalance;
              const owesYou = balance > 0;
              const youOwe = balance < 0;
              const isSettled = Math.abs(balance) < 0.01;

              return (
                <div
                  key={person.name}
                  className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all flex flex-col justify-between gap-3 group"
                >
                  <div
                    onClick={() => setSelectedPersonForDetails(person)}
                    className="flex items-start gap-3 cursor-pointer"
                  >
                    {/* Avatar with fallback */}
                    <div className="relative shrink-0">
                      {person.avatarUrl ? (
                        <img
                          src={person.avatarUrl}
                          alt={person.name}
                          className="w-10 h-10 rounded-full object-cover border-2 border-emerald-500/40"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-sm flex items-center justify-center shadow-sm">
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {isLinked && (
                        <span
                          className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[9px] shadow"
                          title="Verified Registered Connection"
                        >
                          ✓
                        </span>
                      )}
                    </div>

                    {/* Name & Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate group-hover:text-emerald-600 transition-colors">
                          {person.name}
                        </h4>
                        {isLinked && (
                          <span className="px-1.5 py-0.2 rounded text-[8.5px] font-extrabold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0">
                            2-WAY
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {person.phone || person.email || (person.relationshipType ? `${person.relationshipType}` : `${person.transactionCount} entries`)}
                      </p>
                    </div>
                  </div>

                  {/* Balance Badge */}
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-400 font-medium">Net Balance</span>
                    <span
                      className={`font-black text-xs px-2 py-0.5 rounded-full ${
                        isSettled
                          ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                          : owesYou
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {isSettled
                        ? 'Settled (₹0)'
                        : owesYou
                        ? `Owes ₹${Math.abs(balance).toLocaleString('en-IN')}`
                        : `You Owe ₹${Math.abs(balance).toLocaleString('en-IN')}`}
                    </span>
                  </div>

                  {/* Actions: Give, Take, Filter */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setInitialPersonForAdd(person.name);
                        setIsAddUdharOpen(true);
                      }}
                      className="px-2 py-1.5 rounded-xl bg-white dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] border border-slate-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3" />
                      <span>Record Udhar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPersonForDetails(person)}
                      className="px-2 py-1.5 rounded-xl bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-bold text-[11px] border border-slate-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Receipt className="w-3 h-3" />
                      <span>Ledger</span>
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
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white">
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
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-600 text-white">
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
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span>2-Way synced</span>
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
                        <button
                          type="button"
                          onClick={() => setSelectedTxForDetail(tx)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>Details</span>
                        </button>

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
          refreshContacts();
          refreshTransactions();
          setIsScanQrOpen(false);
          setConnectedSuccessPerson({
            name: p.name,
            emailMasked: undefined,
            avatarUrl: null,
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
        onPersonAdded={(pName) => {
          fetchUdharData();
          refreshContacts();
        }}
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
        }}
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
    </div>
  );
};

function overdueAmountBadge(count: number): string {
  if (count <= 0) return 'No Overdue';
  return `${count} Overdue Loan${count > 1 ? 's' : ''}`;
}
