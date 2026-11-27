import React, { useState, useEffect, useMemo } from 'react';
import {
  PieChart,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Edit3,
  Utensils,
  DoorOpen,
  ShoppingBag,
  Sparkles,
  ArrowDownLeft,
  X,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { budgetApi, UserBudget } from '../../lib/financialFeaturesApi';
import { formatINR, getCurrentMonthName, getCurrentISTDate } from '../../lib/dateUtils';
import { ConfirmModal } from '../common/ConfirmModal';

const DEFAULT_BUDGET_CATEGORIES = [
  { id: 'food', name: 'Food & Dining', icon: Utensils, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-900/50' },
  { id: 'room', name: 'Room Expenses', icon: DoorOpen, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-900/50' },
  { id: 'home', name: 'Received Money', icon: ArrowDownLeft, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-900/50' },
  { id: 'other', name: 'Other Expenses', icon: ShoppingBag, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-900/50' },
];

export const BudgetSection: React.FC = () => {
  const { transactions } = useExpense();
  const toast = useToast();

  const [budgets, setBudgets] = useState<UserBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<UserBudget | null>(null);
  const [category, setCategory] = useState<string>('food');
  const [limitAmount, setLimitAmount] = useState<string>('');
  const [alertThreshold, setAlertThreshold] = useState<number>(85);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteBudget, setPendingDeleteBudget] = useState<{ id: string; catName: string } | null>(null);
  const [isDeletingBudget, setIsDeletingBudget] = useState(false);

  // Load budgets from API
  const loadBudgets = async () => {
    try {
      setIsLoading(true);
      const res = await budgetApi.getBudgets();
      if (res.success) {
        setBudgets(res.budgets || []);
      }
    } catch (err: any) {
      toast.error('Could not load budgets', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBudgets();
  }, []);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isSaving) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isSaving]);

  // Compute current month's real spend per category (paise-safe, transfers & Udhar excluded)
  const currentMonthPrefix = getCurrentISTDate().slice(0, 7); // YYYY-MM
  const monthSpending = useMemo(() => {
    const paise: Record<string, number> = {
      food: 0,
      room: 0,
      home: 0,
      other: 0,
    };

    for (const tx of transactions) {
      if (tx.is_deleted || tx.category === 'people' || tx.transaction_type === 'transfer' || tx.metadata?.is_transfer) {
        continue;
      }
      if (tx.transaction_type === 'expense' && tx.transaction_date.startsWith(currentMonthPrefix)) {
        const rawCat = tx.category.toLowerCase();
        const cat = rawCat === 'received' ? 'home' : rawCat;
        const amtP = Math.round((Number(tx.amount) || 0) * 100);
        if (paise[cat] !== undefined) {
          paise[cat] += amtP;
        } else {
          paise['other'] += amtP;
        }
      }
    }

    return {
      food: paise.food / 100,
      room: paise.room / 100,
      home: paise.home / 100,
      other: paise.other / 100,
    } as Record<string, number>;
  }, [transactions, currentMonthPrefix]);

  // Overall totals
  const totalBudgetLimit = budgets.reduce((sum, b) => sum + Number(b.monthly_limit), 0);
  const totalBudgetSpent = Math.round(budgets.reduce((sum, b) => sum + (monthSpending[b.category] || 0), 0) * 100) / 100;
  const totalRemaining = Math.max(0, Math.round((totalBudgetLimit - totalBudgetSpent) * 100) / 100);
  const overallUtilization = totalBudgetLimit > 0 ? Math.round((totalBudgetSpent / totalBudgetLimit) * 100) : 0;

  // Open modal for add or edit
  const handleOpenAdd = (defaultCat?: string) => {
    setEditingBudget(null);
    setCategory(defaultCat || 'food');
    setLimitAmount('');
    setAlertThreshold(85);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (b: UserBudget) => {
    setEditingBudget(b);
    setCategory(b.category);
    setLimitAmount(String(b.monthly_limit));
    setAlertThreshold(b.alert_threshold || 85);
    setIsModalOpen(true);
  };

  // Save budget
  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const numLimit = Number(limitAmount);
    if (!numLimit || numLimit <= 0) {
      toast.error('Validation Error', 'Please enter a valid monthly budget limit greater than ₹0.');
      return;
    }

    try {
      setIsSaving(true);
      const res = await budgetApi.saveBudget({
        category,
        monthly_limit: numLimit,
        alert_threshold: alertThreshold,
      });

      if (res.success) {
        toast.success('Budget Saved', `Monthly budget for ${category} set to ₹${numLimit.toLocaleString('en-IN')}`);
        setIsModalOpen(false);
        loadBudgets();
      }
    } catch (err: any) {
      toast.error('Failed to save budget', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete budget
  const handleDeleteBudget = (id: string, catName: string) => {
    setPendingDeleteBudget({ id, catName });
  };

  const confirmDeleteBudget = async () => {
    if (!pendingDeleteBudget || isDeletingBudget) return;
    try {
      setIsDeletingBudget(true);
      await budgetApi.deleteBudget(pendingDeleteBudget.id);
      toast.success('Budget Removed', `Budget for ${pendingDeleteBudget.catName} deleted.`);
      setPendingDeleteBudget(null);
      loadBudgets();
    } catch (err: any) {
      toast.error('Failed to delete', err.message);
    } finally {
      setIsDeletingBudget(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-emerald-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-emerald-950/10 relative overflow-hidden">
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Monthly Budget Tracker · {getCurrentMonthName()}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-emerald-100 font-medium">Total Monthly Budget</p>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                {formatINR(totalBudgetLimit)}
              </h1>
            </div>

            <button
              onClick={() => handleOpenAdd()}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 rounded-2xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Set Budget</span>
            </button>
          </div>

          {/* Progress Bar */}
          {totalBudgetLimit > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-100">
                  Spent: {formatINR(totalBudgetSpent)} ({overallUtilization}%)
                </span>
                <span className={overallUtilization > 100 ? 'text-rose-300 font-extrabold' : 'text-emerald-100'}>
                  {overallUtilization > 100 ? `Over by ${formatINR(totalBudgetSpent - totalBudgetLimit)}` : `Remaining: ${formatINR(totalRemaining)}`}
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-black/20 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    overallUtilization > 100
                      ? 'bg-rose-400'
                      : overallUtilization > 85
                      ? 'bg-amber-400'
                      : 'bg-emerald-300'
                  }`}
                  style={{ width: `${Math.min(100, overallUtilization)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Category Budgets Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Category Budgets
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real spend tracked against your monthly targets
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-44 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200 dark:border-slate-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DEFAULT_BUDGET_CATEGORIES.map((catItem) => {
            const Icon = catItem.icon;
            const existingBudget = budgets.find((b) => b.category.toLowerCase() === catItem.id.toLowerCase());
            const spent = monthSpending[catItem.id] || 0;
            const limit = existingBudget ? Number(existingBudget.monthly_limit) : 0;
            const utilPercent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
            const isExceeded = limit > 0 && spent > limit;
            const isWarning = limit > 0 && utilPercent >= (existingBudget?.alert_threshold || 85) && !isExceeded;

            return (
              <div
                key={catItem.id}
                className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-2xl ${catItem.bg} ${catItem.color} flex items-center justify-center`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                          {catItem.name}
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          {limit > 0 ? `Limit: ${formatINR(limit)}` : 'No budget set'}
                        </p>
                      </div>
                    </div>

                    {limit > 0 && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(existingBudget!)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Edit Budget"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBudget(existingBudget!.id, catItem.name)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Delete Budget"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {limit > 0 ? (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-600 dark:text-slate-400">
                          Spent: <strong className="text-slate-900 dark:text-slate-100">{formatINR(spent)}</strong>
                        </span>
                        <span
                          className={`font-extrabold text-[11px] ${
                            isExceeded
                              ? 'text-rose-600 dark:text-rose-400'
                              : isWarning
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {utilPercent}%
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isExceeded
                              ? 'bg-rose-500'
                              : isWarning
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, utilPercent)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                        <span>
                          {isExceeded
                            ? `Exceeded by ${formatINR(spent - limit)}`
                            : `Left: ${formatINR(limit - spent)}`}
                        </span>
                        {isExceeded ? (
                          <span className="text-rose-500 font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Over Budget
                          </span>
                        ) : isWarning ? (
                          <span className="text-amber-500 font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Near Limit
                          </span>
                        ) : (
                          <span className="text-emerald-500 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> On Track
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                      <span>Spent this month: {formatINR(spent)}</span>
                      <button
                        onClick={() => handleOpenAdd(catItem.id)}
                        className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        + Set Limit
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

      {/* Add / Edit Budget Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                  <PieChart className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                  {editingBudget ? 'Edit Monthly Budget' : 'Set Category Budget'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBudget} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Expense Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={!!editingBudget}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="food">Food & Dining</option>
                  <option value="room">Room Expenses</option>
                  <option value="home">Received Money</option>
                  <option value="other">Other Expenses</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Monthly Budget Limit (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min="1"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Warning Alert Threshold (%)
                  </label>
                  <span className="font-mono font-bold text-emerald-600">{alertThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="95"
                  step="5"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  You will receive an in-app alert when spending reaches {alertThreshold}% of this budget.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingDeleteBudget}
        title="Remove Category Budget?"
        subtitle="Your expense history will not be affected."
        message={`Are you sure you want to remove the budget for ${pendingDeleteBudget?.catName || ''}?`}
        confirmLabel="Remove Budget"
        isDestructive={true}
        isLoading={isDeletingBudget}
        onConfirm={confirmDeleteBudget}
        onCancel={() => !isDeletingBudget && setPendingDeleteBudget(null)}
      />
    </div>
  );
};
