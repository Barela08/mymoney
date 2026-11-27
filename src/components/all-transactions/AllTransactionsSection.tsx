import React, { useState, useMemo, useEffect } from 'react';
import {
  ListOrdered,
  Calendar,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Edit3,
  Trash2,
  Download,
  RotateCcw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Layers,
  X,
  Plus,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { SkeletonTable } from '../common/states/SkeletonLoaders';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { SearchVoiceBar } from '../common/SearchVoiceBar';
import { Transaction, SortOrder } from '../../types';
import {
  formatINR,
  formatDisplayDate,
  formatDisplayTime,
  getPresetDateRange,
} from '../../lib/dateUtils';
import { getDisplayCategoryLabel } from '../../lib/financialIntelligenceEngine';
import { isSafeAttachmentUrl } from '../../lib/attachmentUtils';

interface AllTransactionsSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any) => void;
  initialCategoryFilter?: string;
  initialSubcategoryFilter?: string;
}

const CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'home', label: 'Income' },
  { id: 'room', label: 'Room' },
  { id: 'food', label: 'Food & Dining' },
  { id: 'other', label: 'Other Expenses' },
  { id: 'people', label: 'People (Udhar)' },
] as const;

const SUBCATEGORY_PILLS: Record<string, Array<{ id: string; label: string }>> = {
  home: [
    { id: 'salary', label: 'Salary' },
    { id: 'business', label: 'Business' },
    { id: 'family', label: 'Person' },
    { id: 'freelancing', label: 'Freelance' },
    { id: 'gift', label: 'Gift' },
    { id: 'refund', label: 'Refund' },
    { id: 'udhar_received', label: 'Borrowed (Udhar)' },
    { id: 'other_income', label: 'Other Income' },
  ],
  room: [
    { id: 'gas', label: 'Gas' },
    { id: 'grocery', label: 'Grocery' },
    { id: 'rent', label: 'Room Rent' },
    { id: 'electricity', label: 'Electricity' },
  ],
  food: [
    { id: 'restaurant', label: 'Restaurant' },
    { id: 'snacks', label: 'Snacks' },
    { id: 'beverages', label: 'Beverages' },
    { id: 'delivery', label: 'Food Delivery' },
    { id: 'mess_tiffin', label: 'Mess / Tiffin' },
    { id: 'other_food', label: 'Other Food' },
  ],
  other: [
    { id: 'shopping', label: 'Shopping' },
    { id: 'travel', label: 'Travel' },
    { id: 'bills', label: 'Bills' },
    { id: 'health', label: 'Medical' },
    { id: 'education', label: 'Education' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'personal_care', label: 'Personal Care' },
    { id: 'emi_loan', label: 'EMI / Loan' },
    { id: 'other_expense', label: 'Other' },
  ],
};

export const AllTransactionsSection: React.FC<AllTransactionsSectionProps> = ({
  onOpenAddModal,
  initialCategoryFilter,
  initialSubcategoryFilter,
}) => {
  const { transactions, summary, deleteTransaction, restoreTransaction, isLoading } = useExpense();
  const toast = useToast();

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategoryFilter || 'all');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>(initialSubcategoryFilter || 'all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [datePreset, setDatePreset] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<SortOrder>('newest');
  const [isFilterExpanded, setFilterExpanded] = useState(false);

  // Sync external filter navigation (e.g. from Dashboard category cards)
  useEffect(() => {
    if (initialCategoryFilter) {
      setSelectedCategory(initialCategoryFilter === 'received' ? 'home' : initialCategoryFilter);
      setSelectedSubcategory(initialSubcategoryFilter || 'all');
      setCurrentPage(1);
    }
  }, [initialCategoryFilter, initialSubcategoryFilter]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (selectedCategory !== 'all') count++;
    if (selectedSubcategory !== 'all') count++;
    if (selectedType !== 'all') count++;
    if (minAmount) count++;
    if (maxAmount) count++;
    if (datePreset !== 'all') count++;
    return count;
  }, [searchQuery, selectedCategory, selectedSubcategory, selectedType, minAmount, maxAmount, datePreset]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Modals
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; title: string } | null>(null);

  // Escape closes receipt lightbox
  useEffect(() => {
    if (!receiptPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReceiptPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [receiptPreview]);

  // Filter and sort execution
  const filteredList = useMemo(() => {
    let list = [...transactions];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((t) => {
        return (
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.person_name && t.person_name.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          (t.metadata?.grocery_item && t.metadata.grocery_item.toLowerCase().includes(q)) ||
          (t.metadata?.spent_at && t.metadata.spent_at.toLowerCase().includes(q)) ||
          (t.metadata?.spent_for && t.metadata.spent_for.toLowerCase().includes(q)) ||
          (t.metadata?.category_label && t.metadata.category_label.toLowerCase().includes(q)) ||
          (t.metadata?.custom_category_label && t.metadata.custom_category_label.toLowerCase().includes(q)) ||
          String(t.amount).includes(q)
        );
      });
    }

    // Category ('home' also matches legacy 'received')
    if (selectedCategory !== 'all') {
      if (selectedCategory === 'home') {
        list = list.filter((t) => t.category === 'home' || t.category === 'received');
      } else {
        list = list.filter((t) => t.category === selectedCategory);
      }
    }

    // Subcategory
    if (selectedSubcategory !== 'all') {
      list = list.filter((t) => t.subcategory === selectedSubcategory);
    }

    // Type
    if (selectedType !== 'all') {
      if (selectedType === 'transfer') {
        list = list.filter((t) => t.transaction_type === 'transfer' || t.metadata?.is_transfer);
      } else {
        list = list.filter((t) => t.transaction_type === selectedType && !t.metadata?.is_transfer);
      }
    }

    // Min Amount
    if (minAmount) {
      const min = parseFloat(minAmount);
      if (!isNaN(min)) list = list.filter((t) => t.amount >= min);
    }

    // Max Amount
    if (maxAmount) {
      const max = parseFloat(maxAmount);
      if (!isNaN(max)) list = list.filter((t) => t.amount <= max);
    }

    // Date
    if (datePreset === 'custom' && startDate && endDate) {
      list = list.filter((t) => t.transaction_date >= startDate && t.transaction_date <= endDate);
    } else if (datePreset !== 'all') {
      const range = getPresetDateRange(datePreset);
      if (range.start && range.end) {
        list = list.filter((t) => t.transaction_date >= range.start && t.transaction_date <= range.end);
      }
    }

    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return (b.transaction_date + ' ' + b.transaction_time).localeCompare(a.transaction_date + ' ' + a.transaction_time);
        case 'oldest':
          return (a.transaction_date + ' ' + a.transaction_time).localeCompare(b.transaction_date + ' ' + b.transaction_time);
        case 'highest_amount':
          return b.amount - a.amount;
        case 'lowest_amount':
          return a.amount - b.amount;
        default:
          return 0;
      }
    });

    return list;
  }, [
    transactions,
    searchQuery,
    selectedCategory,
    selectedSubcategory,
    selectedType,
    minAmount,
    maxAmount,
    datePreset,
    startDate,
    endDate,
    sortBy,
  ]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredList.length / itemsPerPage) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredList.slice(start, start + itemsPerPage);
  }, [filteredList, currentPage]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedSubcategory('all');
    setSelectedType('all');
    setMinAmount('');
    setMaxAmount('');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setSortBy('newest');
    setCurrentPage(1);
    setFilterExpanded(false);
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete) return;
    const target = transactionToDelete;
    try {
      setIsDeleting(true);
      await deleteTransaction(target.id);
      toast.showUndoToast(
        'Transaction Moved to Recycle Bin',
        `"${target.title}" (₹${target.amount.toLocaleString('en-IN')}) was removed.`,
        async () => {
          await restoreTransaction(target.id);
          toast.success('Record Restored', `"${target.title}" restored.`);
        },
        6
      );
      setTransactionToDelete(null);
    } catch (err: any) {
      toast.error('Delete Failed', err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredList.length === 0) {
      toast.error('No Data', 'No transactions to export.');
      return;
    }

    const headers = [
      'Transaction ID',
      'Date (IST)',
      'Time (IST)',
      'Category',
      'Subcategory',
      'Type',
      'Title',
      'Amount (INR)',
      'Person Name',
      'Description',
      'Notes',
    ];

    const rows = filteredList.map((t) => [
      t.id,
      t.transaction_date,
      t.transaction_time,
      t.category,
      t.subcategory,
      t.transaction_type,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      t.amount,
      `"${(t.person_name || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `All_Transactions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Export Completed', 'Transactions downloaded successfully.');
  };

  const activeSubPills = SUBCATEGORY_PILLS[selectedCategory] || [];

  return (
    <>
      <div className="space-y-5 animate-fade-in pb-16 lg:pb-8">
        {/* Top Header Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-base sm:text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ListOrdered className="w-5 h-5 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
              <span>All Transactions</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unified ledger with category filters, breakdown totals &amp; receipt previews
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[1.75]" />
              <span>Export ({filteredList.length})</span>
            </button>
            <button
              onClick={() => onOpenAddModal()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.2]" />
              <span>+ Add Transaction</span>
            </button>
          </div>
        </div>

        {/* Category Filter Tabs + Subcategory Filter Strip */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORY_TABS.map((tab) => {
              const active = selectedCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(tab.id);
                    setSelectedSubcategory('all');
                    setCurrentPage(1);
                  }}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all shrink-0 cursor-pointer ${
                    active
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeSubPills.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100 dark:border-slate-800 no-scrollbar">
              <button
                type="button"
                onClick={() => {
                  setSelectedSubcategory('all');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors shrink-0 cursor-pointer ${
                  selectedSubcategory === 'all'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                All Subcategories
              </button>
              {activeSubPills.map((sub) => {
                const active = selectedSubcategory === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      setSelectedSubcategory(sub.id);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors shrink-0 cursor-pointer ${
                      active
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Contextual Category Breakdown Strip */}
          {selectedCategory === 'home' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/60 dark:border-emerald-900/40">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Total Received</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatINR(summary.totalReceivedMoney)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Earned Income</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatINR(summary.totalEarnedIncome)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Other Income</span>
                <span className="font-bold text-teal-600 dark:text-teal-400 tabular-nums">
                  {formatINR(summary.totalOtherIncome)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/60 dark:border-amber-900/40">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Borrowed (Udhar)</span>
                <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {formatINR(summary.totalBorrowedReceived)}
                </span>
              </div>
            </div>
          )}

          {selectedCategory === 'room' && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 block">Gas</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatINR(summary.totalGas)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 block">Grocery</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatINR(summary.totalGrocery)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 block">Room Rent</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatINR(summary.totalRent)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-[11px] text-slate-500 block">Electricity</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatINR(summary.totalElectricity)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/25 border border-blue-200/60 dark:border-blue-900/40 col-span-2 sm:col-span-1">
                <span className="text-[11px] text-slate-500 block">Total Room</span>
                <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatINR(summary.totalRoomExpenses)}</span>
              </div>
            </div>
          )}

          {selectedCategory === 'food' && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50/60 dark:bg-orange-950/20 border border-orange-200/60 dark:border-orange-900/40 text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">Total Food &amp; Dining Spent</span>
              <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatINR(summary.totalFoodExpenses)}</span>
            </div>
          )}

          {selectedCategory === 'other' && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">Total Other Expenses</span>
              <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatINR(summary.totalOtherExpenses)}</span>
            </div>
          )}
        </div>

        {/* Advanced Filter Toggle */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setFilterExpanded((p) => !p)}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
            aria-label={isFilterExpanded ? 'Collapse filter panel' : 'Expand filter panel'}
          >
            <ChevronDown className={isFilterExpanded ? 'w-4 h-4 stroke-[1.75] rotate-180' : 'w-4 h-4 stroke-[1.75]'} />
            <span>
              {isFilterExpanded ? 'Hide Advanced Filters' : 'Search & Advanced Filters'}
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </span>
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
            >
              Reset ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Collapsible Filter Panel */}
        <div className={isFilterExpanded ? 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 space-y-4' : 'hidden overflow-hidden transition-all duration-300 max-h-0'}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.75]" />
              <span>Filters and search</span>
            </span>
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-xs text-rose-500 hover:underline font-medium cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 stroke-[1.75]" />
              <span>Reset filters</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <SearchVoiceBar
              value={searchQuery}
              onChange={(val) => {
                setSearchQuery(val);
                setCurrentPage(1);
              }}
              onSearch={() => setCurrentPage(1)}
              placeholder="Search title, description, person..."
            />

            <div>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setSelectedSubcategory('all');
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">All Categories</option>
                <option value="home">Income (Received)</option>
                <option value="room">Room Expenses</option>
                <option value="food">Food &amp; Dining</option>
                <option value="other">Other Expenses</option>
                <option value="people">People (Udhar)</option>
              </select>
            </div>

            <div>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">All Types (Income, Expense, Transfer)</option>
                <option value="income">Income Only (+)</option>
                <option value="expense">Expenses Only (-)</option>
                <option value="transfer">Transfers Only (⇄)</option>
              </select>
            </div>

            <div>
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="newest">Sort: Newest to Oldest</option>
                <option value="oldest">Sort: Oldest to Newest</option>
                <option value="highest_amount">Sort: Highest Amount</option>
                <option value="lowest_amount">Sort: Lowest Amount</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div>
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="this_year">This Year</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>

            {datePreset === 'custom' ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>
            ) : (
              <div />
            )}

            <div>
              <input
                type="number"
                placeholder="Min Amount (₹)"
                value={minAmount}
                onChange={(e) => {
                  setMinAmount(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <input
                type="number"
                placeholder="Max Amount (₹)"
                value={maxAmount}
                onChange={(e) => {
                  setMaxAmount(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Transactions Table & Cards */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-medium text-slate-500">
              Showing {paginatedList.length} of {filteredList.length} records
            </span>
            <span className="text-xs font-mono text-slate-400">
              Page {currentPage} of {totalPages}
            </span>
          </div>

          {isLoading ? (
            <SkeletonTable rows={8} />
          ) : paginatedList.length === 0 ? (
            <EmptyState
              isFiltered={
                Boolean(searchQuery.trim()) ||
                selectedCategory !== 'all' ||
                selectedSubcategory !== 'all' ||
                selectedType !== 'all' ||
                Boolean(minAmount) ||
                Boolean(maxAmount) ||
                datePreset !== 'all'
              }
              searchQuery={searchQuery || (selectedCategory !== 'all' ? selectedCategory : undefined)}
              title="No Transactions Found"
              description={
                transactions.length === 0
                  ? 'Your master ledger is empty. Begin by adding your first transaction.'
                  : 'No transactions match your current search and filter settings.'
              }
              actionLabel="+ Add Transaction"
              onAction={() => onOpenAddModal()}
              onClearFilters={handleResetFilters}
              icon={ListOrdered}
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {paginatedList.map((tx) => {
                const isIncome = tx.transaction_type === 'income';
                const categoryBadgeColors =
                  {
                    home: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
                    received: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
                    room: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-500/20',
                    food: 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-500/20',
                    other: 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-500/20',
                    people: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-500/20',
                  }[tx.category] || 'bg-slate-50 dark:bg-slate-950/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800';

                const subLabel =
                  tx.metadata?.custom_category_label ||
                  tx.metadata?.category_label ||
                  getDisplayCategoryLabel(tx.category, tx.subcategory);
                const hasSafeAttachment = isSafeAttachmentUrl(tx.metadata?.attachment_url);
                const batchTotal = Number(tx.metadata?.batch_total || 0);
                const batchIndex = Number(tx.metadata?.batch_index || 0);

                return (
                  <div
                    key={tx.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-xl px-2 sm:px-3 transition-colors group"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                          isIncome
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {isIncome ? <ArrowDownLeft className="w-4 h-4 stroke-[1.75]" /> : <ArrowUpRight className="w-4 h-4 stroke-[1.75]" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                            {tx.title}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${categoryBadgeColors}`}>
                            {subLabel}
                          </span>
                          {batchTotal > 1 && batchIndex > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              <Layers className="w-2.5 h-2.5" />
                              Item {batchIndex}/{batchTotal}
                            </span>
                          )}
                          {tx.metadata?.payment_method && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              {String(tx.metadata.payment_method).replace('_', ' ')}
                            </span>
                          )}
                          {hasSafeAttachment && (
                            <button
                              type="button"
                              onClick={() =>
                                setReceiptPreview({
                                  url: String(tx.metadata?.attachment_url),
                                  title: tx.title,
                                })
                              }
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                            >
                              <ImageIcon className="w-2.5 h-2.5" />
                              <span>Receipt</span>
                            </button>
                          )}
                        </div>

                        {tx.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {tx.description}
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 flex-wrap">
                          <span className="flex items-center gap-1 font-mono">
                            <Calendar className="w-3 h-3 stroke-[1.75]" />
                            {formatDisplayDate(tx.transaction_date)}
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 stroke-[1.75] text-slate-400" />
                            {formatDisplayTime(tx.transaction_time)}
                          </span>
                          {tx.person_name && (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              • {tx.person_name}
                            </span>
                          )}
                          {tx.notes && <span>• {tx.notes}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-11 sm:pl-0">
                      <div className="text-right">
                        <div
                          className={`text-base font-semibold font-sans tabular-nums ${
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isIncome ? '+' : '-'} {formatINR(tx.amount)}
                        </div>
                        <span className="text-[10px] capitalize font-medium text-slate-400">
                          {tx.transaction_type}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setTransactionToEdit(tx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 dark:hover:bg-blue-950 transition-colors cursor-pointer"
                          title="Edit Record"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setTransactionToDelete(tx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors cursor-pointer"
                          title="Delete Record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination Navigation */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>

            <span className="text-xs font-semibold text-slate-500">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Receipt Lightbox Modal */}
      {receiptPreview && isSafeAttachmentUrl(receiptPreview.url) && (
        <div
          onClick={() => setReceiptPreview(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                Receipt · {receiptPreview.title}
              </span>
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-slate-100 dark:bg-slate-950 max-h-[75vh] overflow-auto">
              <img
                src={receiptPreview.url}
                alt={receiptPreview.title}
                className="max-w-full max-h-[68vh] rounded-xl object-contain"
              />
            </div>
          </div>
        </div>
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
        title="Move to Recycle Bin"
        message="Are you sure you want to move this transaction to the Recycle Bin? You can restore it anytime within 30 days."
        confirmLabel={isDeleting ? 'Moving...' : 'Move to Recycle Bin'}
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
    </>
  );
};