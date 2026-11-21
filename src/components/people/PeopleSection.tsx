import React, { useState } from 'react';
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
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { StatCard } from '../common/StatCard';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { Transaction, PersonSummary, SortOrder } from '../../types';
import {
  formatINR,
  formatDisplayDate,
  formatDisplayTime,
  getCurrentISTDate,
  getCurrentISTTime,
} from '../../lib/dateUtils';

interface PeopleSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any, personName?: string) => void;
}

export const PeopleSection: React.FC<PeopleSectionProps> = ({ onOpenAddModal }) => {
  const {
    summary,
    peopleSummaries,
    addTransaction,
    deleteTransaction,
    restoreTransaction,
    settlePersonUdhar,
    clearPersonTransactions,
  } = useExpense();
  const toast = useToast();

  // Tab filter: 'all' | 'pending' | 'settled'
  const [peopleTab, setPeopleTab] = useState<'all' | 'pending' | 'settled'>('all');

  // Selected person for detailed ledger drill-down
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);

  // Form type: 'given' or 'received'
  const [formMode, setFormMode] = useState<'given' | 'received'>('given');
  const [personName, setPersonName] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(getCurrentISTDate());
  const [time, setTime] = useState(getCurrentISTTime());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter
  const [searchPersonQuery, setSearchPersonQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOrder>('newest');

  // Modals
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Settle Udhar Modal state
  const [personToSettle, setPersonToSettle] = useState<PersonSummary | null>(null);
  const [settleNotes, setSettleNotes] = useState('');
  const [isSettling, setIsSettling] = useState(false);

  // Clear Person History Modal state
  const [personToClearHistory, setPersonToClearHistory] = useState<PersonSummary | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  // Counts for tabs
  const pendingCount = peopleSummaries.filter((p) => Math.abs(p.outstandingBalance) >= 0.01).length;
  const settledCount = peopleSummaries.filter((p) => Math.abs(p.outstandingBalance) < 0.01).length;

  // Filtered people list
  const filteredPeople = peopleSummaries
    .filter((p) => p.name.toLowerCase().includes(searchPersonQuery.toLowerCase().trim()))
    .filter((p) => {
      if (peopleTab === 'pending') return Math.abs(p.outstandingBalance) >= 0.01;
      if (peopleTab === 'settled') return Math.abs(p.outstandingBalance) < 0.01;
      return true;
    });

  // Get active selected person's detailed summary if one is selected
  const activePersonData = selectedPerson
    ? peopleSummaries.find((p) => p.name.toLowerCase() === selectedPerson.toLowerCase()) || null
    : null;

  // Handle in-line form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return toast.error('Invalid Amount', 'Please enter a valid amount.');
    if (!personName.trim()) return toast.error("Person's Name Required", 'Please enter the name of the person.');
    if (!reason.trim()) return toast.error('Reason Required', 'Please enter purpose/reason for this transaction.');

    const isGiven = formMode === 'given';
    const subcategory = isGiven ? 'money_given' : 'money_received';
    const type = isGiven ? 'expense' : 'income';
    const title = isGiven ? `Udhar Given to ${personName.trim()}` : `Money Received from ${personName.trim()}`;

    try {
      setIsSubmitting(true);
      await addTransaction({
        category: 'people',
        subcategory,
        transaction_type: type,
        amount: amt,
        title,
        description: reason.trim(),
        person_name: personName.trim(),
        transaction_date: date,
        transaction_time: time,
        notes: notes.trim() || undefined,
      });

      toast.success(
        isGiven ? 'Money Given Recorded' : 'Money Received Recorded',
        `₹${amt.toLocaleString('en-IN')} with ${personName.trim()} saved.`
      );

      setAmount('');
      setReason('');
      setNotes('');
      setDate(getCurrentISTDate());
      setTime(getCurrentISTTime());
    } catch (err: any) {
      toast.error('Failed to record transaction', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete) return;
    const target = transactionToDelete;
    try {
      setIsDeleting(true);
      await deleteTransaction(target.id);
      toast.showUndoToast(
        'Udhar Record Moved to Recycle Bin',
        `"${target.title}" (₹${target.amount.toLocaleString('en-IN')}) was removed.`,
        async () => {
          await restoreTransaction(target.id);
          toast.success('Udhar Record Restored', `"${target.title}" restored.`);
        },
        6
      );
      setTransactionToDelete(null);
    } catch (err: any) {
      toast.error('Delete failed', err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Confirm Full Udhar Settlement (उधार चुकता करें)
  const handleConfirmSettle = async () => {
    if (!personToSettle) return;
    try {
      setIsSettling(true);
      await settlePersonUdhar(personToSettle.name, settleNotes.trim() || undefined);
      toast.success(
        'Udhar Cleared! (हिसाब चुकता)',
        `${personToSettle.name}'s balance has been settled to ₹0.`
      );
      setPersonToSettle(null);
      setSettleNotes('');
    } catch (err: any) {
      toast.error('Failed to clear udhar', err.message);
    } finally {
      setIsSettling(false);
    }
  };

  // Confirm Clear All Records for Person (खाता हटाएं)
  const handleConfirmClearHistory = async () => {
    if (!personToClearHistory) return;
    try {
      setIsClearingHistory(true);
      await clearPersonTransactions(personToClearHistory.name);
      toast.success(
        'Ledger Cleared',
        `All records for ${personToClearHistory.name} have been moved to Recycle Bin.`
      );
      if (selectedPerson?.toLowerCase() === personToClearHistory.name.toLowerCase()) {
        setSelectedPerson(null);
      }
      setPersonToClearHistory(null);
    } catch (err: any) {
      toast.error('Failed to clear ledger', err.message);
    } finally {
      setIsClearingHistory(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-16 lg:pb-8">
      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Money Given (Udhar Diya)"
          amount={summary.totalMoneyGiven}
          subtitle="Money lent to people"
          icon={ArrowUpRight}
          variant="amber"
          badge="Given / Lent"
        />

        <StatCard
          title="Total Money Received"
          amount={summary.totalMoneyReceived}
          subtitle="Udhar returned or borrowed"
          icon={ArrowDownLeft}
          variant="income"
          badge="Received / Returned"
        />

        <StatCard
          title="Net Outstanding Balance"
          amount={summary.netPeopleBalance}
          subtitle="Total Given minus Total Received"
          icon={Users}
          variant={summary.netPeopleBalance >= 0 ? 'balance' : 'expense'}
          badge={summary.netPeopleBalance >= 0 ? 'You are owed' : 'You owe'}
        />
      </div>

      {/* Form & People Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column (Form): Record Money Given or Received */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-500" />
              <span>Record Person Transaction</span>
            </h3>
          </div>

          {/* Form Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 mt-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setFormMode('given')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                formMode === 'given'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/25'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>A. Money Given</span>
            </button>
            <button
              type="button"
              onClick={() => setFormMode('received')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                formMode === 'received'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>B. Money Received</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Person's Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="e.g. Rahul Verma, Rohit, Sister"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Amount (₹ INR) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 font-bold">
                  ₹
                </span>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-base focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Purpose / Reason <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={formMode === 'given' ? 'e.g. Exam fee urgent help' : 'e.g. Returned first installment'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Date (Auto IST)</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Time (Auto IST)</label>
                <input
                  type="time"
                  step="1"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Optional Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Promised to return by 15th"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-2.5 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer ${
                formMode === 'given'
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
              }`}
            >
              {isSubmitting
                ? 'Saving...'
                : formMode === 'given'
                ? '+ Record Udhar Given'
                : '+ Record Money Received'}
            </button>
          </form>
        </div>

        {/* Right column (People Directory & Ledger cards): */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  People Directory & Balance Ledger ({peopleSummaries.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Click on any person to inspect their complete transaction ledger
                </p>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchPersonQuery}
                  onChange={(e) => setSearchPersonQuery(e.target.value)}
                  placeholder="Search person..."
                  className="pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 w-44"
                />
              </div>
            </div>

            {/* Filter Tabs: All, Pending, Cleared */}
            <div className="flex items-center gap-1.5 mt-3 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl">
              <button
                type="button"
                onClick={() => setPeopleTab('all')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  peopleTab === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                All ({peopleSummaries.length})
              </button>
              <button
                type="button"
                onClick={() => setPeopleTab('pending')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  peopleTab === 'pending'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <span>Pending Udhar</span>
                {pendingCount > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      peopleTab === 'pending'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPeopleTab('settled')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  peopleTab === 'settled'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <span>Cleared / चुकता</span>
                {settledCount > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      peopleTab === 'settled'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {settledCount}
                  </span>
                )}
              </button>
            </div>

            {/* People Cards Grid */}
            {filteredPeople.length === 0 ? (
              <EmptyState
                isFiltered={peopleSummaries.length > 0}
                title={
                  peopleTab === 'pending'
                    ? 'All Udhar Accounts Settled!'
                    : peopleTab === 'settled'
                    ? 'No Cleared Udhar Records'
                    : 'No People Accounts Recorded Yet'
                }
                description={
                  peopleTab === 'pending'
                    ? 'Awesome! You have no pending money to give or collect from anyone.'
                    : 'Track money given (उधार दिया) and money received (उधार लिया) person by person.'
                }
                actionLabel="+ Record Person Udhar"
                onAction={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onClearFilters={() => setPeopleTab('all')}
                icon={Users}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
                {filteredPeople.map((p) => {
                  const isOwed = p.outstandingBalance > 0.005;
                  const isOwing = p.outstandingBalance < -0.005;
                  const isSettled = !isOwed && !isOwing;

                  return (
                    <div
                      key={p.name}
                      onClick={() => setSelectedPerson(p.name)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        selectedPerson?.toLowerCase() === p.name.toLowerCase()
                          ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/20 dark:bg-amber-950/20'
                          : isSettled
                          ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/15 dark:bg-emerald-950/10 hover:border-emerald-300'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-xl font-bold flex items-center justify-center text-xs shrink-0 ${
                                isSettled
                                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {p.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {p.name}
                              </h4>
                              <p className="text-[11px] text-slate-400">
                                {p.transactionCount} transaction{p.transactionCount !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                              isOwed
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : isOwing
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1'
                            }`}
                          >
                            {isOwed ? 'They Owe' : isOwing ? 'You Owe' : '✓ Cleared'}
                          </span>
                        </div>

                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-1 text-xs">
                          <div className="flex justify-between text-slate-500">
                            <span>Given:</span>
                            <span className="font-semibold text-rose-600">{formatINR(p.totalGiven)}</span>
                          </div>
                          <div className="flex justify-between text-slate-500">
                            <span>Received:</span>
                            <span className="font-semibold text-emerald-600">{formatINR(p.totalReceived)}</span>
                          </div>
                          <div className="flex justify-between font-bold pt-1 border-t border-slate-100 dark:border-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300">Balance:</span>
                            <span
                              className={
                                isOwed
                                  ? 'text-amber-600 dark:text-amber-400 font-extrabold'
                                  : isOwing
                                  ? 'text-rose-600 dark:text-rose-400 font-extrabold'
                                  : 'text-emerald-600 dark:text-emerald-400 font-bold'
                              }
                            >
                              {isSettled ? '₹0.00 (Cleared)' : formatINR(Math.abs(p.outstandingBalance))}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action Button: Clear Udhar OR Clear History */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                        {!isSettled ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPersonToSettle(p);
                              setSettleNotes(`Full udhar cleared with ${p.name}`);
                            }}
                            className="w-full py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>Clear Udhar (चुकता करें)</span>
                          </button>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Udhar Complete</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPersonToClearHistory(p);
                              }}
                              className="py-1 px-2.5 text-[10px] font-bold text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer"
                              title="Clear all records for this person from active directory"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Clear History</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Individual Person Ledger Drawer / View (If a person is selected) */}
          {activePersonData && (
            <div className="bg-white dark:bg-slate-900 border-2 border-amber-300 dark:border-amber-800/60 rounded-3xl p-5 sm:p-6 shadow-md space-y-4 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500 text-white font-bold flex items-center justify-center text-sm shadow-md">
                    {activePersonData.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                      {activePersonData.name}'s Ledger History
                    </h3>
                    <p className="text-xs text-slate-500">
                      Outstanding:{' '}
                      <span
                        className={`font-bold ${
                          Math.abs(activePersonData.outstandingBalance) < 0.01
                            ? 'text-emerald-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {Math.abs(activePersonData.outstandingBalance) < 0.01
                          ? '₹0.00 (Cleared)'
                          : formatINR(activePersonData.outstandingBalance)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {Math.abs(activePersonData.outstandingBalance) >= 0.01 ? (
                    <button
                      onClick={() => {
                        setPersonToSettle(activePersonData);
                        setSettleNotes(`Full udhar cleared with ${activePersonData.name}`);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Clear Udhar (चुकता करें)</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setPersonToClearHistory(activePersonData)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950 text-slate-700 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear History</span>
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedPerson(null)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Outstanding / Cleared Status Banner in Drawer */}
              {Math.abs(activePersonData.outstandingBalance) < 0.01 ? (
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-bold">All Udhar Cleared! (पूरा हिसाब चुकता हो चुका है)</p>
                    <p className="text-[11px] opacity-80 mt-0.5">
                      No pending amount with {activePersonData.name}. All given and received amounts are balanced.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {activePersonData.outstandingBalance > 0
                        ? `${activePersonData.name} owes you ${formatINR(activePersonData.outstandingBalance)}`
                        : `You owe ${activePersonData.name} ${formatINR(Math.abs(activePersonData.outstandingBalance))}`}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setPersonToSettle(activePersonData);
                      setSettleNotes(`Full udhar cleared with ${activePersonData.name}`);
                    }}
                    className="font-bold text-xs underline text-amber-700 dark:text-amber-300 cursor-pointer"
                  >
                    Settle Now &rarr;
                  </button>
                </div>
              )}

              {/* Transactions with this person */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {activePersonData.transactions.map((tx) => {
                  const isGiven = tx.subcategory === 'money_given';
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                            isGiven
                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-600'
                              : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600'
                          }`}
                        >
                          {isGiven ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {tx.title}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>{formatDisplayDate(tx.transaction_date)}</span>
                            <span>•</span>
                            <span>{formatDisplayTime(tx.transaction_time)}</span>
                            {tx.notes && <span>• {tx.notes}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className={`text-sm font-bold font-sans ${isGiven ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {isGiven ? '-' : '+'} {formatINR(tx.amount)}
                          </div>
                          <span className="text-[9px] uppercase font-bold text-slate-400">
                            {isGiven ? 'Given' : 'Received'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setTransactionToEdit(tx)}
                            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setTransactionToDelete(tx)}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settle Udhar Confirmation Modal */}
      {personToSettle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-600">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Clear Udhar (उधार चुकता करें)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Settling account with <strong className="text-slate-700 dark:text-slate-300">{personToSettle.name}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPersonToSettle(null)}
                disabled={isSettling}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-500">
                <span>Current Outstanding:</span>
                <span className="text-base font-black text-amber-600 dark:text-amber-400 font-sans">
                  {formatINR(Math.abs(personToSettle.outstandingBalance))}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-500">
                <span>Settlement Action:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {personToSettle.outstandingBalance > 0
                    ? `Record ₹${Math.abs(personToSettle.outstandingBalance).toLocaleString('en-IN')} Received`
                    : `Record ₹${Math.abs(personToSettle.outstandingBalance).toLocaleString('en-IN')} Given/Paid`}
                </span>
              </div>
              <div className="flex justify-between items-center font-bold pt-2 border-t border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                <span>New Balance After Settle:</span>
                <span className="text-emerald-600 font-bold">₹0.00 (Cleared)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Settlement Note (Optional)
              </label>
              <input
                type="text"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                placeholder="e.g. Udhar complete ho gaya (चुकता)"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPersonToSettle(null)}
                disabled={isSettling}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSettle}
                disabled={isSettling}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-xl shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {isSettling ? 'Settling...' : '✓ Settle & Clear (चुकता करें)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Person History Confirmation Modal */}
      {personToClearHistory && (
        <ConfirmModal
          isOpen={Boolean(personToClearHistory)}
          title={`Clear All Records for ${personToClearHistory.name}?`}
          message={`Are you sure you want to clear all ${personToClearHistory.transactionCount} transaction(s) for ${personToClearHistory.name}? All records will be moved to the Recycle Bin so this person no longer appears in your active list.`}
          confirmLabel={isClearingHistory ? 'Clearing...' : 'Clear All Records'}
          cancelLabel="Keep in Directory"
          isLoading={isClearingHistory}
          onConfirm={handleConfirmClearHistory}
          onCancel={() => setPersonToClearHistory(null)}
        />
      )}

      {/* Edit Modal */}
      <EditTransactionModal
        isOpen={!!transactionToEdit}
        transaction={transactionToEdit}
        onClose={() => setTransactionToEdit(null)}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!transactionToDelete}
        title="Delete Person Record"
        message="Are you sure you want to delete this record? Outstanding balance for this person will be recalculated automatically."
        itemDetails={
          transactionToDelete
            ? {
                title: transactionToDelete.title,
                amount: `₹${transactionToDelete.amount.toLocaleString('en-IN')}`,
                date: `${formatDisplayDate(transactionToDelete.transaction_date)} at ${formatDisplayTime(transactionToDelete.transaction_time)}`,
              }
            : undefined
        }
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setTransactionToDelete(null)}
      />
    </div>
  );
};
