import React, { useState, useMemo } from 'react';
import {
  Wallet,
  Home,
  DoorOpen,
  ShoppingBag,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  PlusCircle,
  Clock,
  Calendar,
  Trash2,
  Edit3,
  Receipt,
  Eye,
  ChevronRight,
  Flame,
  Apple,
  Building,
  Zap,
  Utensils,
  Calculator,
  ScanLine,
  PieChart,
  Target,
  Bell,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { StatCard } from '../common/StatCard';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { FirstTimeOnboarding } from '../common/FirstTimeOnboarding';
import { SkeletonCardsGrid, SkeletonTable } from '../common/states/SkeletonLoaders';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { Transaction } from '../../types';
import { formatINR, formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
  onOpenAddModal: (category?: any, subcategory?: any) => void;
  onOpenScanQr?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onOpenAddModal, onOpenScanQr }) => {
  const { transactions, summary, deleteTransaction, restoreTransaction, isLoading } = useExpense();
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Time-of-day greeting
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';

  // Last 6 months cashflow graph calculation
  const monthlyChartData = useMemo(() => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const months: Array<{ key: string; label: string; income: number; expense: number }> = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        key,
        label: `${monthNames[d.getMonth()]}`,
        income: 0,
        expense: 0,
      });
    }

    for (const tx of transactions) {
      const txMonth = tx.transaction_date.slice(0, 7);
      const bucket = months.find((m) => m.key === txMonth);
      if (bucket) {
        if (tx.transaction_type === 'income') {
          bucket.income += Number(tx.amount) || 0;
        } else {
          bucket.expense += Number(tx.amount) || 0;
        }
      }
    }

    return months;
  }, [transactions]);

  // Max value for bar chart scaling
  const maxBarValue = Math.max(
    1,
    ...monthlyChartData.map((m: any) => Math.max(m.income, m.expense))
  );

  // Recent transactions (top 8)
  const recentTransactions = transactions.slice(0, 8);

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
          toast.success('Record Restored', `"${target.title}" was restored.`);
        },
        6
      );
      setTransactionToDelete(null);
    } catch (err: any) {
      toast.error('Delete Failed', err.message || 'Could not delete transaction');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-20 lg:pb-8">
      {/* 1. Context Title & Profile Shortcut */}
      <div className="flex items-center justify-between px-1">
        <div
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-3 cursor-pointer group"
          title="Account profile and settings"
        >
          {user?.avatar_url || user?.avatarUrl ? (
            <img
              src={user?.avatar_url || user?.avatarUrl || ''}
              alt={user.displayName}
              className="w-11 h-11 rounded-xl object-cover border border-slate-200 dark:border-slate-800 transition-opacity group-hover:opacity-90"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-base flex items-center justify-center border border-slate-200 dark:border-slate-700">
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
          )}

          <div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
              {user?.displayName || 'Personal Account'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Financial Ledger · {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Master Balance Ledger Card */}
      <div className="bg-slate-950 dark:bg-slate-950 text-white rounded-2xl p-6 sm:p-7 border border-emerald-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] relative space-y-5">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Wallet className="w-3.5 h-3.5 stroke-[1.75]" />
              <span>Available balance</span>
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold mt-1 tracking-tight font-sans tabular-nums text-white">
              {formatINR(summary.availableBalance)}
            </h2>
          </div>

          <button
            onClick={() => onOpenAddModal()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer self-start sm:self-auto"
          >
            <PlusCircle className="w-4 h-4 stroke-[2]" />
            <span>Add transaction</span>
          </button>
        </div>

        {/* 4 Metric Sub-Panels */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] space-y-1">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400 stroke-[1.75]" /> Income
            </span>
            <span className="text-xs sm:text-sm font-semibold font-sans tabular-nums block text-white">
              {formatINR(summary.totalIncome)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] space-y-1">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-rose-400 stroke-[1.75]" /> Expenses
            </span>
            <span className="text-xs sm:text-sm font-semibold font-sans tabular-nums block text-white">
              {formatINR(summary.totalExpenses)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] space-y-1">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-teal-400 stroke-[1.75]" /> Net savings
            </span>
            <span className="text-xs sm:text-sm font-semibold font-sans tabular-nums block text-white">
              {formatINR(summary.availableBalance)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] space-y-1">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-amber-400 stroke-[1.75]" /> Net udhar
            </span>
            <span className="text-xs sm:text-sm font-semibold font-sans tabular-nums block text-white">
              {formatINR(summary.netPeopleBalance)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Quick Action Buttons Row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        <button
          onClick={() => onNavigate('reports')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/10">
            <BarChart3 className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            Reports
          </span>
        </button>

        <button
          onClick={() => onNavigate('people')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/10">
            <Users className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            Udhar
          </span>
        </button>

        <button
          onClick={() => onNavigate('budget')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/10">
            <PieChart className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            Budget
          </span>
        </button>

        <button
          onClick={() => onNavigate('savings_goals')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-500/10">
            <Target className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            Goals
          </span>
        </button>

        <button
          onClick={() => onNavigate('all_transactions')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-500/10">
            <Receipt className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            History
          </span>
        </button>

        <button
          onClick={() => onNavigate('calculator')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.99] transition-colors flex flex-col items-center gap-1.5 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-500/10">
            <Calculator className="w-4 h-4 stroke-[1.75]" />
          </div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate w-full">
            Calculator
          </span>
        </button>
      </div>

      {/* 4. Monthly Financial Flow Overview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
              <span>Monthly financial flow</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              6-month cashflow comparison
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Income
            </span>
            <span className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-400" /> Expense
            </span>
          </div>
        </div>

        {/* Visual Bar Chart */}
        <div className="pt-2">
          <div className="grid grid-cols-6 gap-2 sm:gap-4 items-end h-36 border-b border-slate-100 dark:border-slate-800/80 pb-2">
            {monthlyChartData.map((item: any) => {
              const incomeHeight = Math.max(4, Math.round((item.income / maxBarValue) * 100));
              const expenseHeight = Math.max(4, Math.round((item.expense / maxBarValue) * 100));

              return (
                <div key={item.key} className="flex flex-col items-center h-full justify-end gap-1.5">
                  <div className="w-full flex items-end justify-center gap-1 h-28">
                    {/* Income Bar */}
                    <div
                      className="w-2 sm:w-3 bg-emerald-500/90 rounded-t-xs transition-opacity hover:opacity-80"
                      style={{ height: `${incomeHeight}%` }}
                      title={`Income: ₹${item.income.toLocaleString('en-IN')}`}
                    />
                    {/* Expense Bar */}
                    <div
                      className="w-2 sm:w-3 bg-rose-400/90 rounded-t-xs transition-opacity hover:opacity-80"
                      style={{ height: `${expenseHeight}%` }}
                      title={`Expense: ₹${item.expense.toLocaleString('en-IN')}`}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate w-full text-center">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Admin Quick Link */}
      {isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 text-xs">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-200 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-200">
              ADMIN
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              Enterprise Security Administration is enabled for your account.
            </span>
          </div>
          <button
            onClick={() => onNavigate('admin')}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl font-bold transition-all cursor-pointer self-start sm:self-auto"
          >
            Open Admin Dashboard →
          </button>
        </div>
      )}

      {/* State 24: First-Time User Onboarding Guide (shown when 0 transactions) */}
      <FirstTimeOnboarding onOpenAddModal={onOpenAddModal} />

      {/* 5 Main Ledger Sections */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-3">
              <span>Main categories</span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full ml-1">
                5 sections
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select any section to manage expenses or view dedicated history
            </p>
          </div>
        </div>

        {/* 5 Mobile-First Section Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {/* 1. Home Section */}
          <div className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/15">
                  <Home className="w-5 h-5 stroke-[1.75]" />
                </div>
              </div>

              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3">
                Home section
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Track money received from home and expenses spent for household
              </p>

              {/* Home Balance Stats */}
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Received from home</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatINR(summary.totalHomeReceived)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Home spent</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatINR(summary.totalHomeSpent)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Remaining balance</span>
                  <span className="text-teal-600 dark:text-teal-400 tabular-nums">
                    {formatINR(summary.remainingHomeBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('home')}
                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open home</span>
                <ChevronRight className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => onOpenAddModal('home', 'received_home')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                + Add home entry
              </button>
            </div>
          </div>

          {/* 2. Room Section */}
          <div className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-500/15">
                  <DoorOpen className="w-5 h-5 stroke-[1.75]" />
                </div>
              </div>

              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3">
                Room section
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Gas LPG cylinder, groceries, room rent and electricity
              </p>

              {/* Room Breakdown Stats */}
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1.5 text-xs">
                <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <div>Rent: <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">{formatINR(summary.totalRent)}</span></div>
                  <div>Gas: <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">{formatINR(summary.totalGas)}</span></div>
                  <div>Grocery: <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">{formatINR(summary.totalGrocery)}</span></div>
                  <div>Power: <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">{formatINR(summary.totalElectricity)}</span></div>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Total room spent</span>
                  <span className="text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatINR(summary.totalRoomExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('room')}
                className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 active:scale-[0.99] rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open room</span>
                <ChevronRight className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => onOpenAddModal('room')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                + Add room expense
              </button>
            </div>
          </div>

          {/* 3. Food & Dining Section */}
          <div className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center border border-orange-500/15">
                  <Utensils className="w-5 h-5 stroke-[1.75]" />
                </div>
              </div>

              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3">
                Food & dining
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Restaurant, cafe, tea/coffee, snacks and meal delivery
              </p>

              {/* Food Expenses Stats */}
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Category entries</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">
                    {transactions.filter(t => t.category === 'food').length} entries
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Total food spent</span>
                  <span className="text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatINR(summary.totalFoodExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('food')}
                className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 active:scale-[0.99] rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open food</span>
                <ChevronRight className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => onOpenAddModal('food')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                + Add food expense
              </button>
            </div>
          </div>

          {/* 4. Other Expenses */}
          <div className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/15">
                  <ShoppingBag className="w-5 h-5 stroke-[1.75]" />
                </div>
              </div>

              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3">
                Other expenses
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Shopping, travel, medical bills, recharges and personal spending
              </p>

              {/* Other Expenses Stats */}
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Category entries</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-200 tabular-nums">
                    {transactions.filter(t => t.category === 'other').length} entries
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Total other spent</span>
                  <span className="text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatINR(summary.totalOtherExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('other')}
                className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 active:scale-[0.99] rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open other</span>
                <ChevronRight className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => onOpenAddModal('other')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                + Add other expense
              </button>
            </div>
          </div>

          {/* 5. People Section (Udhar) */}
          <div className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-5 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/15">
                  <Users className="w-5 h-5 stroke-[1.75]" />
                </div>
              </div>

              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3">
                People ledger (Udhar)
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Money lent to contacts and money borrowed from people
              </p>

              {/* People Stats */}
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Given (Lent)</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatINR(summary.totalMoneyGiven)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Received (Repaid)</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatINR(summary.totalMoneyReceived)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Outstanding net</span>
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatINR(summary.netPeopleBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('people')}
                className="w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open people</span>
                <ChevronRight className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => onOpenAddModal('people', 'money_given')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                + Add udhar record
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Calculator Utility */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-slate-200/60 dark:border-slate-700/60 shrink-0">
            <Calculator className="w-5 h-5 stroke-[1.75]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                Financial calculator
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60">
                GST · Offer · Split
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Accurate GST calculation, custom discount offers, and per-person bill split
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={() => onNavigate('calculator')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 active:scale-[0.99] text-slate-800 dark:text-slate-200 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            <span>Open calculator</span>
            <ChevronRight className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>
      </div>

      {/* 8 Complete Financial Summary Cards */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
            Overall financial overview
          </h3>
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">Live totals</span>
        </div>

        {isLoading ? (
          <SkeletonCardsGrid count={9} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              title="Total Income"
              amount={summary.totalIncome}
              subtitle="Money received"
              icon={ArrowDownLeft}
              variant="income"
              badge="Incoming Funds"
              onClick={() => onNavigate('home')}
            />
            <StatCard
              title="Home Expenses"
              amount={summary.totalHomeSpent}
              subtitle="Household & family spending"
              icon={Home}
              variant="expense"
              badge="Household"
              onClick={() => onNavigate('home')}
            />
            <StatCard
              title="Room Expenses"
              amount={summary.totalRoomExpenses}
              subtitle="Gas, Groceries, Rent, Power"
              icon={DoorOpen}
              variant="expense"
              badge="Room & Flat"
              onClick={() => onNavigate('room')}
            />
            <StatCard
              title="Food & Dining"
              amount={summary.totalFoodExpenses}
              subtitle="Restaurant, Snacks, Delivery"
              icon={Utensils}
              variant="expense"
              badge="Khana-Pina"
              onClick={() => onNavigate('food')}
            />
            <StatCard
              title="Other Expenses"
              amount={summary.totalOtherExpenses}
              subtitle="Travel, Shopping & Personal"
              icon={ShoppingBag}
              variant="expense"
              badge="Personal"
              onClick={() => onNavigate('other')}
            />
            <StatCard
              title="Money Given"
              amount={summary.totalMoneyGiven}
              subtitle="Udhar to people"
              icon={ArrowUpRight}
              variant="amber"
              badge="Udhar Diya"
              onClick={() => onNavigate('people')}
            />
            <StatCard
              title="Money Received"
              amount={summary.totalMoneyReceived}
              subtitle="Udhar collected back"
              icon={ArrowDownLeft}
              variant="income"
              badge="Udhar Liya"
              onClick={() => onNavigate('people')}
            />
            <StatCard
              title="Available Balance"
              amount={summary.availableBalance}
              subtitle="Income minus Total Expenses"
              icon={Wallet}
              variant="balance"
              badge="Net Cash Balance"
            />
            <StatCard
              title="Total Transactions"
              amount={summary.totalTransactionsCount}
              subtitle="All stored records"
              icon={Receipt}
              variant="neutral"
              badge="Records Count"
              onClick={() => onNavigate('all_transactions')}
            />
          </div>
        )}
      </div>

      {/* Recent Transactions Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent transactions
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Latest financial records with exact date, time, and category
            </p>
          </div>
          <button
            onClick={() => onNavigate('all_transactions')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <span>View all ({transactions.length})</span>
            <Eye className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>
        </div>

        {isLoading ? (
          <SkeletonTable rows={5} />
        ) : recentTransactions.length === 0 ? (
          <EmptyState
            title="No transactions recorded yet"
            description="Your cashflow and daily transactions will appear here. Start by recording your first entry."
            actionLabel="Add Transaction"
            onAction={() => onOpenAddModal()}
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {recentTransactions.map((tx) => {
              const isIncome = tx.transaction_type === 'income';
              const categoryBadgeColors = {
                home: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
                room: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-500/20',
                food: 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-500/20',
                other: 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-500/20',
                people: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-500/20',
              }[tx.category] || 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800';

              return (
                <div
                  key={tx.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-xl px-2 sm:px-3 transition-colors group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl shrink-0 ${
                        isIncome
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {isIncome ? <ArrowDownLeft className="w-4 h-4 stroke-[1.75]" /> : <ArrowUpRight className="w-4 h-4 stroke-[1.75]" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                          {tx.title}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${categoryBadgeColors}`}>
                          {tx.category} · {tx.subcategory.replace('_', ' ')}
                        </span>
                      </div>

                      {tx.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {tx.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
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
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Edit Record"
                      >
                        <Edit3 className="w-4 h-4 stroke-[1.75]" />
                      </button>
                      <button
                        onClick={() => setTransactionToDelete(tx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors"
                        title="Delete Record"
                      >
                        <Trash2 className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <EditTransactionModal
        isOpen={!!transactionToEdit}
        transaction={transactionToEdit}
        onClose={() => setTransactionToEdit(null)}
      />

      {/* Confirm Delete Modal */}
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
    </div>
  );
};
