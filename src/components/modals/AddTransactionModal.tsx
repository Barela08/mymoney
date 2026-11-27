import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Check,
  Briefcase,
  Building2,
  Users,
  Tag,
  Laptop,
  Gift,
  RefreshCw,
  Home,
  Utensils,
  ShoppingBag,
  Compass,
  FileText,
  CreditCard,
  Activity,
  GraduationCap,
  Gamepad2,
  ShoppingCart,
  Landmark,
  Sparkles,
  Loader2,
  Clock,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import {
  TransactionCategory,
  TransactionSubcategory,
  NewTransactionPayload,
} from '../../types';
import { getCurrentISTDate, getCurrentISTTime } from '../../lib/dateUtils';

export interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: TransactionCategory;
  initialSubcategory?: TransactionSubcategory;
  initialPersonName?: string;
  initialAmount?: number | string;
  initialTitle?: string;
  initialDate?: string;
  onOpenReceiptScanner?: () => void;
}

type ModalMode = 'select' | 'receive' | 'spend';

const RECENT_CATEGORIES_KEY = 'mymoney_recent_categories';

// Category options for Receive Money (Income) - 7 categories
const RECEIVE_CATEGORIES = [
  { id: 'Salary', label: 'Salary', icon: Briefcase, subcategory: 'salary' },
  { id: 'Business', label: 'Business', icon: Building2, subcategory: 'business' },
  { id: 'Received from Person', label: 'Received from Person', icon: Users, subcategory: 'family' },
  { id: 'Freelance', label: 'Freelance', icon: Laptop, subcategory: 'freelancing' },
  { id: 'Gift', label: 'Gift', icon: Gift, subcategory: 'gift' },
  { id: 'Refund', label: 'Refund', icon: RefreshCw, subcategory: 'refund' },
  { id: 'Other Income', label: 'Other Income', icon: Tag, subcategory: 'other_income' },
] as const;

// Category options for Spend Money (Expense) - 11 categories
const SPEND_CATEGORIES = [
  { id: 'Room', label: 'Room', emoji: '🏠', icon: Home, category: 'room', subcategory: 'rent' },
  { id: 'Food & Dining', label: 'Food & Dining', emoji: '🍔', icon: Utensils, category: 'food', subcategory: 'restaurant' },
  { id: 'Shopping', label: 'Shopping', emoji: '🛍️', icon: ShoppingBag, category: 'other', subcategory: 'shopping' },
  { id: 'Travel', label: 'Travel', emoji: '🚕', icon: Compass, category: 'other', subcategory: 'travel' },
  { id: 'Bills', label: 'Bills', emoji: '💡', icon: FileText, category: 'other', subcategory: 'bills' },
  { id: 'Medical', label: 'Medical', emoji: '🏥', icon: Activity, category: 'other', subcategory: 'health' },
  { id: 'Education', label: 'Education', emoji: '📚', icon: GraduationCap, category: 'other', subcategory: 'education' },
  { id: 'Entertainment', label: 'Entertainment', emoji: '🎮', icon: Gamepad2, category: 'other', subcategory: 'entertainment' },
  { id: 'Groceries', label: 'Groceries', emoji: '🛒', icon: ShoppingCart, category: 'room', subcategory: 'grocery' },
  { id: 'EMI / Loan', label: 'EMI / Loan', emoji: '💳', icon: Landmark, category: 'other', subcategory: 'bills' },
  { id: 'Other Expenses', label: 'Other Expenses', emoji: '🤝', icon: CreditCard, category: 'other', subcategory: 'other_expense' },
] as const;

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  initialCategory,
  initialSubcategory,
  initialPersonName,
  initialAmount,
  initialTitle,
  initialDate,
}) => {
  const { addTransaction } = useExpense();
  const toast = useToast();

  const [mode, setMode] = useState<ModalMode>('select');
  const [amount, setAmount] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [recentCategories, setRecentCategories] = useState<string[]>([]);

  const amountInputRef = useRef<HTMLInputElement>(null);

  // Load recent categories from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_CATEGORIES_KEY);
      if (saved) {
        setRecentCategories(JSON.parse(saved));
      }
    } catch {
      // Ignore storage errors
    }
  }, [isOpen]);

  const saveRecentCategory = (catName: string) => {
    try {
      const updated = [catName, ...recentCategories.filter((c) => c !== catName)].slice(0, 6);
      setRecentCategories(updated);
      localStorage.setItem(RECENT_CATEGORIES_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }
  };

  // Initialize modal state on open or prop change
  useEffect(() => {
    if (!isOpen) return;

    // Prefill amount and note if provided
    if (initialAmount !== undefined && initialAmount !== null) {
      setAmount(String(initialAmount));
    } else {
      setAmount('');
    }

    if (initialTitle) {
      setNote(initialTitle);
    } else {
      setNote('');
    }

    // Determine initial mode based on initialCategory
    if (initialCategory === 'home' || initialCategory === 'received') {
      setMode('receive');
      // Match subcategory or default
      if (initialSubcategory === 'salary') setSelectedCategory('Salary');
      else if (initialSubcategory === 'business') setSelectedCategory('Business');
      else if (initialSubcategory === 'freelancing') setSelectedCategory('Freelance');
      else if (initialSubcategory === 'gift') setSelectedCategory('Gift');
      else if (initialSubcategory === 'refund') setSelectedCategory('Refund');
      else if (initialSubcategory === 'family' || initialSubcategory === 'udhar_received') setSelectedCategory('Received from Person');
      else if (initialSubcategory === 'other_income') setSelectedCategory('Other Income');
      else setSelectedCategory('');
    } else if (initialCategory === 'room') {
      setMode('spend');
      if (initialSubcategory === 'grocery') setSelectedCategory('Groceries');
      else setSelectedCategory('Room');
    } else if (initialCategory === 'food') {
      setMode('spend');
      setSelectedCategory('Food & Dining');
    } else if (initialCategory === 'other') {
      setMode('spend');
      if (initialSubcategory === 'travel') setSelectedCategory('Travel');
      else if (initialSubcategory === 'bills') setSelectedCategory('Bills');
      else if (initialSubcategory === 'shopping') setSelectedCategory('Shopping');
      else if (initialSubcategory === 'health') setSelectedCategory('Medical');
      else if (initialSubcategory === 'education') setSelectedCategory('Education');
      else if (initialSubcategory === 'entertainment') setSelectedCategory('Entertainment');
      else setSelectedCategory('Other Expenses');
    } else {
      // Standard click on "+ Add Transaction" -> show selection screen
      setMode('select');
      setSelectedCategory('');
    }
  }, [isOpen, initialCategory, initialSubcategory, initialAmount, initialTitle]);

  // Auto-focus amount input when entering receive or spend form
  useEffect(() => {
    if (isOpen && mode !== 'select') {
      const timer = setTimeout(() => {
        amountInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const handleSelectReceive = () => {
    setMode('receive');
    // Pre-select most recent income category if available
    const recentIncome = recentCategories.find((c) =>
      RECEIVE_CATEGORIES.some((rc) => rc.label === c)
    );
    if (recentIncome) {
      setSelectedCategory(recentIncome);
    }
  };

  const handleSelectSpend = () => {
    setMode('spend');
    // Pre-select most recent spend category or default to Food & Dining
    const recentSpend = recentCategories.find((c) =>
      SPEND_CATEGORIES.some((sc) => sc.label === c)
    );
    setSelectedCategory(recentSpend || 'Food & Dining');
  };

  const handleBackToSelect = () => {
    setMode('select');
  };

  const handleQuickAddAmount = (delta: number) => {
    const current = parseFloat(amount) || 0;
    const next = current + delta;
    setAmount(String(next));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than ₹0');
      amountInputRef.current?.focus();
      return;
    }

    if (mode === 'spend' && !selectedCategory) {
      toast.error('Category Required', 'Please select an expense category');
      return;
    }

    setIsSubmitting(true);

    try {
      const nowISTDate = initialDate || getCurrentISTDate();
      const nowISTTime = getCurrentISTTime();

      if (mode === 'receive') {
        // Income payload
        const matched = RECEIVE_CATEGORIES.find((c) => c.label === selectedCategory);
        const subcategory: TransactionSubcategory = matched ? matched.subcategory : 'other_income';
        const displayCategory = selectedCategory || 'Income';
        const finalTitle = note.trim() || displayCategory;

        const payload: NewTransactionPayload = {
          category: 'home',
          subcategory,
          transaction_type: 'income',
          amount: parsedAmount,
          title: finalTitle,
          description: note.trim() || undefined,
          transaction_date: nowISTDate,
          transaction_time: nowISTTime,
          metadata: {
            source: 'unified_smart_add_transaction',
            category_label: displayCategory,
            associated_person: initialPersonName || undefined,
          },
        };

        await addTransaction(payload);
        if (selectedCategory) saveRecentCategory(selectedCategory);

        toast.success(
          'Money Received!',
          `₹${parsedAmount.toLocaleString('en-IN')} added to available balance.`
        );
      } else {
        // Expense payload
        const matched = SPEND_CATEGORIES.find((c) => c.label === selectedCategory);
        const category: TransactionCategory = matched ? matched.category : 'other';
        const subcategory: TransactionSubcategory = matched ? matched.subcategory : 'other_expense';
        const displayCategory = selectedCategory || 'Expense';
        const finalTitle = note.trim() || displayCategory;

        const payload: NewTransactionPayload = {
          category,
          subcategory,
          transaction_type: 'expense',
          amount: parsedAmount,
          title: finalTitle,
          description: note.trim() || undefined,
          transaction_date: nowISTDate,
          transaction_time: nowISTTime,
          metadata: {
            source: 'unified_smart_add_transaction',
            category_label: displayCategory,
            associated_person: initialPersonName || undefined,
          },
        };

        await addTransaction(payload);
        if (selectedCategory) saveRecentCategory(selectedCategory);

        toast.success(
          'Expense Saved!',
          `₹${parsedAmount.toLocaleString('en-IN')} deducted from available balance.`
        );
      }

      onClose();
    } catch (err: any) {
      toast.error('Failed to save transaction', err.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isReceive = mode === 'receive';
  const isSpend = mode === 'spend';

  // Filter recent categories relevant to current form mode
  const relevantRecent = useMemo(() => {
    if (isReceive) {
      return recentCategories.filter((c) => RECEIVE_CATEGORIES.some((rc) => rc.label === c));
    }
    if (isSpend) {
      return recentCategories.filter((c) => SPEND_CATEGORIES.some((sc) => sc.label === c));
    }
    return [];
  }, [isReceive, isSpend, recentCategories]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh] animate-slide-up"
        role="dialog"
        aria-modal="true"
      >
        {saveSuccess ? (
          <div className="p-10 flex flex-col items-center justify-center text-center space-y-3 animate-pop">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
                saveSuccess.type === 'receive'
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                  : 'bg-rose-600 text-white shadow-rose-600/30'
              }`}
            >
              <CheckCircle2 className="w-9 h-9 stroke-[2.2]" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {saveSuccess.type === 'receive' ? 'Money Received!' : 'Expense Saved!'}
            </h3>
            <p
              className={`text-2xl font-black tabular-nums ${
                saveSuccess.type === 'receive'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {saveSuccess.type === 'receive' ? '+' : '-'}₹{saveSuccess.amount.toLocaleString('en-IN')}
            </p>
          </div>
        ) : (
        <>
        {/* ================= STEP 1: SELECTION SCREEN ================= */}
        {mode === 'select' && (
          <div className="p-6 sm:p-7 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  + Add Transaction
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Select transaction type to continue
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Two Large Clean Selection Cards */}
            <div className="grid grid-cols-1 gap-4 pt-1">
              {/* Option 1: Receive Money */}
              <button
                type="button"
                onClick={handleSelectReceive}
                className="group relative flex items-center gap-4 p-5 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border-2 border-emerald-500/40 hover:border-emerald-600 dark:border-emerald-500/30 dark:hover:border-emerald-400 text-left transition-all active:scale-[0.99] cursor-pointer shadow-xs"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 shrink-0 group-hover:scale-105 transition-transform">
                  <ArrowDown className="w-7 h-7 stroke-[2.5]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                      Receive Money
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                      Income (+)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">
                    For all incoming money
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-1">
                    Salary · Business · Person · Freelance · Gift · Refund
                  </p>
                </div>
              </button>

              {/* Option 2: Spend Money */}
              <button
                type="button"
                onClick={handleSelectSpend}
                className="group relative flex items-center gap-4 p-5 rounded-2xl bg-rose-50/70 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 border-2 border-rose-500/40 hover:border-rose-600 dark:border-rose-500/30 dark:hover:border-rose-400 text-left transition-all active:scale-[0.99] cursor-pointer shadow-xs"
              >
                <div className="w-14 h-14 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-600/30 shrink-0 group-hover:scale-105 transition-transform">
                  <ArrowUp className="w-7 h-7 stroke-[2.5]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                      Spend Money
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300">
                      Expense (-)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">
                    For all outgoing money
                  </p>
                  <p className="text-[11px] text-rose-700 dark:text-rose-400 font-medium mt-1">
                    Room · Food · Shopping · Travel · Bills · Medical · More
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: COMPACT SHORT FORM (RECEIVE / SPEND) ================= */}
        {mode !== 'select' && (
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            {/* Top Navigation & Type Switcher */}
            <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleBackToSelect}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              {/* Fast 1-Tap Toggle between Receive & Spend */}
              <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
                <button
                  type="button"
                  onClick={() => {
                    setMode('receive');
                    setSelectedCategory('');
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isReceive
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Receive</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('spend');
                    if (!selectedCategory || RECEIVE_CATEGORIES.some((c) => c.label === selectedCategory)) {
                      setSelectedCategory('Food & Dining');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSpend
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Spend</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
              {/* 1. AMOUNT FIELD (Required) */}
              <div>
                <label
                  htmlFor="tx-amount-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Amount <span className="text-rose-500">*</span>
                </label>
                <div
                  className={`relative flex items-center rounded-2xl border-2 transition-all ${
                    isReceive
                      ? 'border-emerald-500/40 focus-within:border-emerald-600 bg-emerald-50/20 dark:bg-emerald-950/10'
                      : 'border-rose-500/40 focus-within:border-rose-600 bg-rose-50/20 dark:bg-rose-950/10'
                  }`}
                >
                  <span
                    className={`pl-4 text-2xl sm:text-3xl font-extrabold select-none ${
                      isReceive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    ₹
                  </span>
                  <input
                    ref={amountInputRef}
                    id="tx-amount-input"
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    autoComplete="off"
                    autoFocus
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      // Prevent multiple decimals
                      const parts = val.split('.');
                      if (parts.length > 2) return;
                      setAmount(val);
                    }}
                    placeholder="0"
                    className="w-full py-3.5 px-3 text-2xl sm:text-3xl font-bold bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 outline-none tabular-nums"
                  />
                  {amount && (
                    <button
                      type="button"
                      onClick={() => {
                        setAmount('');
                        amountInputRef.current?.focus();
                      }}
                      className="mr-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                      title="Clear amount"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Quick amount suggestion chips for minimal typing */}
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  {[100, 500, 1000, 2000, 5000].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => handleQuickAddAmount(delta)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 transition-colors cursor-pointer shrink-0"
                    >
                      +₹{delta >= 1000 ? `${delta / 1000}k` : delta}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. RECENT CATEGORIES QUICK-TAP (If any exist) */}
              {relevantRecent.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>Recently used:</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {relevantRecent.map((recentName) => {
                      const isSelected = selectedCategory === recentName;
                      return (
                        <button
                          key={recentName}
                          type="button"
                          onClick={() => setSelectedCategory(recentName)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                            isSelected
                              ? isReceive
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-rose-600 text-white border-rose-600'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {recentName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. CATEGORY SELECTABLE GRID */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Category {isReceive ? <span className="text-slate-400 font-normal">(Optional)</span> : <span className="text-rose-500">*</span>}
                  </label>
                  {selectedCategory && (
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Selected: <strong className="text-slate-900 dark:text-slate-100">{selectedCategory}</strong>
                    </span>
                  )}
                </div>

                {/* Chips Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {isReceive &&
                    sortedReceiveCategories.map((cat) => {
                      const Icon = cat.icon;
                      const isSelected = selectedCategory === cat.label;

                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(isSelected ? '' : cat.label);
                          }}
                          className={`relative flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all duration-150 active:scale-[0.97] cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-50 dark:bg-emerald-950/45 border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-sm ring-1 ring-emerald-500/30'
                              : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 ${
                              isSelected
                                ? 'bg-emerald-600 text-white scale-105'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 stroke-[2]" />
                          </div>
                          <span className="text-xs font-semibold truncate flex-1">{cat.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[2.5] animate-pop" />}
                        </button>
                      );
                    })}

                  {isSpend &&
                    (showAllCategories ? sortedSpendCategories : sortedSpendCategories.slice(0, 6)).map((cat) => {
                      const Icon = cat.icon;
                      const isSelected = selectedCategory === cat.label;

                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat.label);
                          }}
                          className={`relative flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all duration-150 active:scale-[0.97] cursor-pointer ${
                            isSelected
                              ? 'bg-rose-50 dark:bg-rose-950/45 border-rose-500 text-rose-900 dark:text-rose-200 shadow-sm ring-1 ring-rose-500/30'
                              : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 ${
                              isSelected
                                ? 'bg-rose-600 text-white scale-105'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 stroke-[2]" />
                          </div>
                          <span className="text-xs font-semibold truncate flex-1">{cat.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 stroke-[2.5] animate-pop" />}
                        </button>
                      );
                    })}
                </div>

                {isSpend && sortedSpendCategories.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllCategories((prev) => !prev)}
                    className="mt-2 w-full py-1.5 px-3 rounded-xl text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    {showAllCategories ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>Show fewer categories</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>More categories ({sortedSpendCategories.length - 6} more)</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 4. NOTE FIELD (Optional) */}
              <div>
                <label
                  htmlFor="tx-note-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Note <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  id="tx-note-input"
                  type="text"
                  maxLength={100}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    isReceive
                      ? 'e.g. November salary, freelance design, gift...'
                      : 'e.g. Dinner with friends, room rent, groceries...'
                  }
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-slate-400 dark:focus:border-slate-500 transition-colors"
                />
              </div>

              {/* Auto-set metadata notice */}
              <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                <span>Date &amp; Time: Auto-set to current IST</span>
                <span>Ledger: Instant balance sync</span>
              </div>
            </div>

            {/* Sticky Action Footer */}
            <div className="p-4 sm:p-5 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 mt-auto">
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !amount ||
                  parseFloat(amount) <= 0 ||
                  (isSpend && !selectedCategory)
                }
                className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  isReceive
                    ? 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white shadow-rose-600/20'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isReceive ? 'Saving Money...' : 'Saving Expense...'}</span>
                  </>
                ) : (
                  <span>{isReceive ? 'Save Money' : 'Save Expense'}</span>
                )}
              </button>
            </div>
          </form>
        )}
        </>
        )}
      </div>
    </div>
  );
};
