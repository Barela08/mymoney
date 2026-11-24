import React, { useState, useMemo } from 'react';
import {
  ArrowDownLeft,
  PlusCircle,
  Search,
  Filter,
  Calendar,
  Clock,
  Trash2,
  Edit3,
  SlidersHorizontal,
  FileText,
  RotateCcw,
  TrendingUp,
  PieChart as PieChartIcon,
  CreditCard,
  Building2,
  Banknote,
  QrCode,
  Wallet,
  Sparkles,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { StatCard } from '../common/StatCard';
import { ConfirmModal } from '../common/ConfirmModal';
import { SearchVoiceBar } from '../common/SearchVoiceBar';
import { EmptyState } from '../common/EmptyState';
import { SkeletonTable } from '../common/states';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { AddReceivedMoneyModal } from './AddReceivedMoneyModal';
import { ReceivedTransactionDetailModal } from './ReceivedTransactionDetailModal';
import { Transaction, SortOrder } from '../../types';
import {
  RECEIVED_CATEGORIES,
  PAYMENT_METHODS,
  getReceivedCategoryConfig,
  classifyFinancialTransaction,
} from '../../lib/receivedMoneyCategories';
import {
  formatINR,
  formatDisplayDate,
  formatDisplayTime,
  getCurrentISTDate,
  getCurrentISTTime,
} from '../../lib/dateUtils';

interface HomeSectionProps {
  onOpenAddModal?: (category?: any, subcategory?: any) => void;
}

export const HomeSection: React.FC<HomeSectionProps> = ({ onOpenAddModal }) => {
  const { transactions, summary, deleteTransaction, restoreTransaction, isLoading } = useExpense();
  const toast = useToast();

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedTxForDetail, setSelectedTxForDetail] = useState<Transaction | null>(null);
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [dateFilterPreset, setDateFilterPreset] = useState<'all' | 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<SortOrder>('newest');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Received Money transactions: category === 'home' or category === 'received'
  // (Filter out legacy 'home_expense' if any existed, keeping pure received money)
  const receivedTransactions = useMemo(() => {
    return transactions.filter(
      (t) => (t.category === 'home' || t.category === 'received') && t.subcategory !== 'home_expense'
    );
  }, [transactions]);

  // Today & This Month calculations
  const todayStr = getCurrentISTDate();
  const currentYearMonth = todayStr.slice(0, 7); // YYYY-MM

  const receivedThisMonth = useMemo(() => {
    return receivedTransactions
      .filter((t) => t.transaction_date.startsWith(currentYearMonth))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }, [receivedTransactions, currentYearMonth]);

  const receivedToday = useMemo(() => {
    return receivedTransactions
      .filter((t) => t.transaction_date === todayStr)
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }, [receivedTransactions, todayStr]);

  // Category breakdown metrics
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const tx of receivedTransactions) {
      const cat = tx.subcategory || 'other_income';
      const existing = map.get(cat) || { count: 0, total: 0 };
      existing.count += 1;
      existing.total += Number(tx.amount) || 0;
      map.set(cat, existing);
    }

    const totalSum = Array.from(map.values()).reduce((acc, v) => acc + v.total, 0) || 1;

    return Array.from(map.entries())
      .map(([catId, data]) => {
        const config = getReceivedCategoryConfig(catId);
        return {
          id: catId,
          config,
          count: data.count,
          total: data.total,
          percentage: Math.round((data.total / totalSum) * 100),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [receivedTransactions]);

  // Filtered & Sorted Transactions
  const filteredTransactions = useMemo(() => {
    return receivedTransactions.filter((tx) => {
      // Category filter
      if (categoryFilter !== 'all') {
        if (categoryFilter === 'family' && tx.subcategory === 'received_home') {
          // match legacy received_home as family
        } else if (tx.subcategory !== categoryFilter) {
          return false;
        }
      }

      // Payment method filter
      if (paymentMethodFilter !== 'all') {
        if (tx.metadata?.payment_method !== paymentMethodFilter) {
          return false;
        }
      }

      // Date Presets
      if (dateFilterPreset === 'today' && tx.transaction_date !== todayStr) {
        return false;
      }
      if (dateFilterPreset === 'this_month' && !tx.transaction_date.startsWith(currentYearMonth)) {
        return false;
      }
      if (dateFilterPreset === 'this_year' && !tx.transaction_date.startsWith(todayStr.slice(0, 4))) {
        return false;
      }
      if (dateFilterPreset === 'this_week') {
        const txDate = new Date(tx.transaction_date);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0 || diffDays > 7) return false;
      }
      if (dateFilterPreset === 'custom') {
        if (startDate && tx.transaction_date < startDate) return false;
        if (endDate && tx.transaction_date > endDate) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const sourceMatch = (tx.person_name || tx.metadata?.received_from || '').toLowerCase().includes(q);
        const titleMatch = (tx.title || '').toLowerCase().includes(q);
        const descMatch = (tx.description || '').toLowerCase().includes(q);
        const notesMatch = (tx.notes || '').toLowerCase().includes(q);
        const amountMatch = String(tx.amount).includes(q);
        const utrMatch = (tx.metadata?.utr || '').toLowerCase().includes(q);

        if (!sourceMatch && !titleMatch && !descMatch && !notesMatch && !amountMatch && !utrMatch) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'newest') {
        return (b.transaction_date + (b.transaction_time || '')).localeCompare(a.transaction_date + (a.transaction_time || ''));
      }
      if (sortBy === 'oldest') {
        return (a.transaction_date + (a.transaction_time || '')).localeCompare(b.transaction_date + (b.transaction_time || ''));
      }
      if (sortBy === 'highest_amount') return b.amount - a.amount;
      if (sortBy === 'lowest_amount') return a.amount - b.amount;
      return 0;
    });
  }, [receivedTransactions, categoryFilter, paymentMethodFilter, dateFilterPreset, todayStr, currentYearMonth, startDate, endDate, searchQuery, sortBy]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setPaymentMethodFilter('all');
    setDateFilterPreset('all');
    setStartDate('');
    setEndDate('');
    setSortBy('newest');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    categoryFilter !== 'all' ||
    paymentMethodFilter !== 'all' ||
    dateFilterPreset !== 'all' ||
    sortBy !== 'newest';

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!transactionToDelete) return;
    const target = transactionToDelete;
    try {
      setIsDeleting(true);
      await deleteTransaction(target.id);
      toast.showUndoToast(
        'Transaction Deleted',
        `"${target.title}" moved to Recycle Bin.`,
        async () => {
          await restoreTransaction(target.id);
          toast.success('Restored', `"${target.title}" was restored.`);
        }
      );
      setTransactionToDelete(null);
    } catch (err: any) {
      toast.error('Delete Failed', err.message || 'Could not delete transaction.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20 shrink-0">
            <ArrowDownLeft className="w-6 h-6 stroke-[2.25]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                Received Money
              </h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                Inflow & Income
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Track salary, business payments, freelancing, gifts, family support & all money received
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer shrink-0"
        >
          <PlusCircle className="w-4 h-4 stroke-[2.5]" />
          <span>+ Add Money Received</span>
        </button>
      </div>

      {/* 2. Top Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Received This Month"
          amount={receivedThisMonth}
          variant="income"
          icon={TrendingUp}
        />
        <StatCard
          title="Total Received Today"
          amount={receivedToday}
          variant="neutral"
          icon={Calendar}
        />
        <StatCard
          title="All-Time Total Received"
          amount={summary.totalReceivedMoney || summary.totalHomeReceived}
          variant="income"
          icon={ArrowDownLeft}
        />
      </div>

      {/* 3. Category Breakdown Quick Chips */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Inflow By Category
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              {receivedTransactions.length} Total Transactions
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {categoryBreakdown.slice(0, 6).map((item) => {
              const Icon = item.config.icon;
              const isSelected = categoryFilter === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCategoryFilter(isSelected ? 'all' : item.id)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? `${item.config.color.bg} ${item.config.color.border} ring-2 ring-emerald-500/30`
                      : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${item.config.color.iconBg}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">{item.percentage}%</span>
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{item.config.label}</p>
                  <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {formatINR(item.total)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Search & Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input with Voice Mic & Search Button */}
          <SearchVoiceBar
            value={searchQuery}
            onChange={(val) => setSearchQuery(val)}
            onSearch={(val) => setSearchQuery(val)}
            placeholder="Search by source, description, amount, or UTR..."
            className="flex-1"
          />

          {/* Quick Date Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {[
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'this_week', label: 'This Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'this_year', label: 'This Year' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => setDateFilterPreset(preset.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  dateFilterPreset === preset.id
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}

            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`p-2 rounded-xl border text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                showAdvancedFilters || hasActiveFilters
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
              title="Filter Options"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Filters</span>
            </button>
          </div>
        </div>

        {/* Advanced Filters Expandable Drawer */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 animate-fade-in">
            {/* Category Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="all">All Categories</option>
                {RECEIVED_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Method Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Payment Method</label>
              <select
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="all">All Payment Methods</option>
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Order */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOrder)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest_amount">Highest Amount</option>
                <option value="lowest_amount">Lowest Amount</option>
              </select>
            </div>

            {/* Reset Actions */}
            <div className="flex items-end">
              <button
                onClick={handleResetFilters}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 transition-colors cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Received Transactions History List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Received Transactions History
            </h2>
            <span className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {filteredTransactions.length}
            </span>
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Loading state */}
        {isLoading ? (
          <SkeletonTable rows={5} />
        ) : filteredTransactions.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'No Matching Inflows Found' : 'No Received Money Records Yet'}
            description={
              hasActiveFilters
                ? 'Try adjusting your search keywords, category, or date range filters.'
                : 'Record your first salary, business earnings, gift, or freelancing payment in just 5 seconds.'
            }
            actionLabel={hasActiveFilters ? 'Reset Filters' : '+ Add Money Received'}
            onAction={hasActiveFilters ? handleResetFilters : () => setIsAddModalOpen(true)}
            icon={ArrowDownLeft}
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTransactions.map((tx) => {
              const catConfig = getReceivedCategoryConfig(tx.subcategory);
              const classification = classifyFinancialTransaction(tx.subcategory);
              const Icon = catConfig.icon;

              const sourceDisplay = tx.person_name || tx.metadata?.received_from || 'Direct';
              const paymentMethod = tx.metadata?.payment_method
                ? String(tx.metadata.payment_method).toUpperCase()
                : null;

              return (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTxForDetail(tx)}
                  className="py-3.5 px-3 -mx-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                >
                  {/* Left: Icon & Details */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${catConfig.color.iconBg}`}>
                      <Icon className="w-5 h-5 stroke-[2]" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                          {tx.title}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.2 rounded-full border ${catConfig.color.badge}`}>
                          {catConfig.label}
                        </span>
                        {classification === 'borrowed' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300">
                            Borrowed
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        <span>From: <strong className="text-slate-700 dark:text-slate-300 font-semibold">{sourceDisplay}</strong></span>
                        {paymentMethod && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px]">{paymentMethod}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatDisplayDate(tx.transaction_date)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Quick Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 font-sans">
                        + {formatINR(tx.amount)}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {formatDisplayTime(tx.transaction_time)}
                      </p>
                    </div>

                    {/* Desktop Hover Quick Action Buttons */}
                    <div
                      className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => setTransactionToEdit(tx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        title="Edit Record"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setTransactionToDelete(tx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors cursor-pointer"
                        title="Delete Record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Received Money Dedicated Fast Modal */}
      <AddReceivedMoneyModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      {/* Transaction Details Modal */}
      <ReceivedTransactionDetailModal
        transaction={selectedTxForDetail}
        isOpen={Boolean(selectedTxForDetail)}
        onClose={() => setSelectedTxForDetail(null)}
        onEdit={(tx) => {
          setSelectedTxForDetail(null);
          setTransactionToEdit(tx);
        }}
      />

      {/* Edit Modal */}
      <EditTransactionModal
        isOpen={Boolean(transactionToEdit)}
        transaction={transactionToEdit}
        onClose={() => setTransactionToEdit(null)}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(transactionToDelete)}
        title="Move to Recycle Bin?"
        message="Are you sure you want to delete this received money transaction? It can be restored anytime within 30 days from the Recycle Bin."
        confirmLabel={isDeleting ? 'Moving...' : 'Move to Recycle Bin'}
        itemDetails={
          transactionToDelete
            ? {
                title: transactionToDelete.title,
                amount: formatINR(transactionToDelete.amount),
                date: `${formatDisplayDate(transactionToDelete.transaction_date)} at ${formatDisplayTime(
                  transactionToDelete.transaction_time
                )}`,
              }
            : undefined
        }
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setTransactionToDelete(null)}
      />
    </div>
  );
};

export const ReceivedMoneySection = HomeSection;
export default HomeSection;
