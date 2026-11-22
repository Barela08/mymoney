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
  Sparkles,
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
      {/* 1. Personalized Greeting Bar with Avatar & Notification Shortcut */}
      <div className="flex items-center justify-between px-1">
        <div
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-3 cursor-pointer group"
          title="Go to Profile & Settings"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.displayName}
              className="w-12 h-12 rounded-2xl object-cover border-2 border-emerald-500/40 shadow-md group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-lg flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
          )}

          <div>
            <p className="text-xs text-slate-400 font-semibold">{greeting},</p>
            <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
              {user?.displayName || 'Fintech User'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('notifications')}
            className="p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 shadow-xs transition-colors cursor-pointer relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Available Balance Card */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 rounded-3xl p-6 sm:p-7 text-white shadow-xl shadow-emerald-950/15 relative overflow-hidden space-y-5">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-[11px] font-bold tracking-wide uppercase text-emerald-100">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Available Balance</span>
            </span>
            <h2 className="text-3xl sm:text-4xl font-black mt-2 tracking-tight font-sans">
              {formatINR(summary.availableBalance)}
            </h2>
          </div>

          <button
            onClick={() => onOpenAddModal()}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 rounded-2xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer self-start sm:self-auto"
          >
            <PlusCircle className="w-4 h-4 text-emerald-600" />
            <span>Add Transaction</span>
          </button>
        </div>

        {/* 4 Metric Compact Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-emerald-200 flex items-center gap-1">
              <ArrowDownLeft className="w-3 h-3 text-emerald-300" /> Income
            </span>
            <span className="text-xs sm:text-sm font-black font-sans block text-white">
              {formatINR(summary.totalIncome)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-rose-200 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-rose-300" /> Expenses
            </span>
            <span className="text-xs sm:text-sm font-black font-sans block text-white">
              {formatINR(summary.totalExpenses)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-teal-200 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-teal-300" /> Net Savings
            </span>
            <span className="text-xs sm:text-sm font-black font-sans block text-white">
              {formatINR(summary.availableBalance)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-amber-200 flex items-center gap-1">
              <Users className="w-3 h-3 text-amber-300" /> Net Udhar
            </span>
            <span className="text-xs sm:text-sm font-black font-sans block text-white">
              {formatINR(summary.netPeopleBalance)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Quick Action Buttons Row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        <button
          onClick={() => onOpenAddModal()}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-emerald-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <PlusCircle className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            + Add
          </span>
        </button>

        <button
          onClick={() => onOpenScanQr ? onOpenScanQr() : onNavigate('people')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-indigo-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <ScanLine className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            Scan QR
          </span>
        </button>

        <button
          onClick={() => onNavigate('people')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-amber-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Users className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            Udhar
          </span>
        </button>

        <button
          onClick={() => onNavigate('budget')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-purple-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <PieChart className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            Budget
          </span>
        </button>

        <button
          onClick={() => onNavigate('savings_goals')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-teal-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Target className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            Goals
          </span>
        </button>

        <button
          onClick={() => onNavigate('calculator')}
          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col items-center gap-1 text-center cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Calculator className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate w-full">
            Calc
          </span>
        </button>
      </div>

      {/* 4. Monthly Financial Graph & Overview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>Monthly Financial Overview</span>
            </h3>
            <p className="text-xs text-slate-400">
              6-Month Income vs Expense Flow
            </p>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-bold">
            <span className="flex items-center gap-1 text-emerald-600">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Income
            </span>
            <span className="flex items-center gap-1 text-rose-500">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Expense
            </span>
          </div>
        </div>

        {/* Visual Bar Chart */}
        <div className="pt-2">
          <div className="grid grid-cols-6 gap-2 sm:gap-4 items-end h-36 border-b border-slate-100 dark:border-slate-800 pb-2">
            {monthlyChartData.map((item: any) => {
              const incomeHeight = Math.max(4, Math.round((item.income / maxBarValue) * 100));
              const expenseHeight = Math.max(4, Math.round((item.expense / maxBarValue) * 100));

              return (
                <div key={item.key} className="flex flex-col items-center h-full justify-end gap-1 group">
                  <div className="w-full flex items-end justify-center gap-1 h-28">
                    {/* Income Bar */}
                    <div
                      className="w-2.5 sm:w-4 bg-emerald-500 rounded-t-md transition-all group-hover:brightness-110"
                      style={{ height: `${incomeHeight}%` }}
                      title={`Income: ₹${item.income.toLocaleString('en-IN')}`}
                    />
                    {/* Expense Bar */}
                    <div
                      className="w-2.5 sm:w-4 bg-rose-400 rounded-t-md transition-all group-hover:brightness-110"
                      style={{ height: `${expenseHeight}%` }}
                      title={`Expense: ₹${item.expense.toLocaleString('en-IN')}`}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 truncate w-full text-center">
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

      {/* =========================================================================
          START KARTE HI 5 BADE BADE OPTION: Home, Room, Food, Other, People
          ========================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Main Categories</span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 px-2.5 py-0.5 rounded-full">
                5 Sections
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select any section to manage expenses or view dedicated history
            </p>
          </div>
        </div>

        {/* 5 Big Mobile-First Section Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-5">
          {/* 1. HOME SECTION (बड़ा ऑप्शन 1) */}
          <div className="group relative bg-white dark:bg-slate-900 border-2 border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-md shadow-emerald-500/10 group-hover:scale-105 transition-transform">
                  <Home className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Section 1
                </span>
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-4">
                Home Section
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Track money received from home and expenses spent for household
              </p>

              {/* Home Balance Stats */}
              <div className="mt-4 p-3 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Received From Home:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-sans">
                    {formatINR(summary.totalHomeReceived)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Home Spent:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400 font-sans">
                    {formatINR(summary.totalHomeSpent)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200/60 dark:border-emerald-800/60 font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Remaining Balance:</span>
                  <span className="text-blue-600 dark:text-blue-400 font-sans">
                    {formatINR(summary.remainingHomeBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('home')}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <span>Open Home Section</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenAddModal('home', 'received_home')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Add Home Money
              </button>
            </div>
          </div>

          {/* 2. ROOM SECTION (बड़ा ऑप्शन 2) */}
          <div className="group relative bg-white dark:bg-slate-900 border-2 border-blue-200 dark:border-blue-900/60 hover:border-blue-500 dark:hover:border-blue-500 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-md shadow-blue-500/10 group-hover:scale-105 transition-transform">
                  <DoorOpen className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Section 2
                </span>
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-4">
                Room Section
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Gas LPG cylinder, groceries, monthly room rent & electricity bills
              </p>

              {/* Room Breakdown Stats */}
              <div className="mt-4 p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-900/40 space-y-1.5 text-xs">
                <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <div>Rent: <span className="font-bold text-slate-900 dark:text-slate-200">{formatINR(summary.totalRent)}</span></div>
                  <div>Gas: <span className="font-bold text-slate-900 dark:text-slate-200">{formatINR(summary.totalGas)}</span></div>
                  <div>Grocery: <span className="font-bold text-slate-900 dark:text-slate-200">{formatINR(summary.totalGrocery)}</span></div>
                  <div>Power: <span className="font-bold text-slate-900 dark:text-slate-200">{formatINR(summary.totalElectricity)}</span></div>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-blue-200/60 dark:border-blue-800/60 font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Grand Total Room:</span>
                  <span className="text-rose-600 dark:text-rose-400 font-sans">
                    {formatINR(summary.totalRoomExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('room')}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
              >
                <span>Open Room Section</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenAddModal('room')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950 text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                + Add Room Expense
              </button>
            </div>
          </div>

          {/* 3. FOOD & DINING SECTION (बड़ा ऑप्शन 3) */}
          <div className="group relative bg-white dark:bg-slate-900 border-2 border-orange-200 dark:border-orange-900/60 hover:border-orange-500 dark:hover:border-orange-500 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 dark:bg-orange-950/80 text-orange-600 dark:text-orange-400 flex items-center justify-center shadow-md shadow-orange-500/10 group-hover:scale-105 transition-transform">
                  <Utensils className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                  Section 3
                </span>
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-4">
                Food & Dining
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Restaurant, cafe, tea/coffee, snacks, swiggy/zomato delivery & tiffin
              </p>

              {/* Food Expenses Stats */}
              <div className="mt-4 p-3 bg-orange-50/70 dark:bg-orange-950/30 rounded-2xl border border-orange-100 dark:border-orange-900/40 space-y-1.5 text-xs">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Includes: Hotel, Snacks, Chai, Zomato, Mess
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-orange-200/60 dark:border-orange-800/60 font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Total Food Spent:</span>
                  <span className="text-rose-600 dark:text-rose-400 font-sans">
                    {formatINR(summary.totalFoodExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('food')}
                className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-600/20 transition-all cursor-pointer"
              >
                <span>Open Food & Dining</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenAddModal('food')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950 text-slate-700 dark:text-slate-300 hover:text-orange-700 dark:hover:text-orange-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                + Add Food Expense
              </button>
            </div>
          </div>

          {/* 4. OTHER EXPENSES (बड़ा ऑप्शन 4) */}
          <div className="group relative bg-white dark:bg-slate-900 border-2 border-purple-200 dark:border-purple-900/60 hover:border-purple-500 dark:hover:border-purple-500 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center shadow-md shadow-purple-500/10 group-hover:scale-105 transition-transform">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  Section 4
                </span>
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-4">
                Other Expenses
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Shopping, travel, medical bills, recharges & personal spending
              </p>

              {/* Other Expenses Stats */}
              <div className="mt-4 p-3 bg-purple-50/70 dark:bg-purple-950/30 rounded-2xl border border-purple-100 dark:border-purple-900/40 space-y-1.5 text-xs">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Includes: Shopping, Travel, Health, Bills
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-purple-200/60 dark:border-purple-800/60 font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Total Other Spent:</span>
                  <span className="text-rose-600 dark:text-rose-400 font-sans">
                    {formatINR(summary.totalOtherExpenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('other')}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-purple-600/20 transition-all cursor-pointer"
              >
                <span>Open Other Expenses</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenAddModal('other')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950 text-slate-700 dark:text-slate-300 hover:text-purple-700 dark:hover:text-purple-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                + Add Other Expense
              </button>
            </div>
          </div>

          {/* 5. PEOPLE SECTION (बड़ा ऑप्शन 5) */}
          <div className="group relative bg-white dark:bg-slate-900 border-2 border-amber-200 dark:border-amber-900/60 hover:border-amber-500 dark:hover:border-amber-500 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-md shadow-amber-500/10 group-hover:scale-105 transition-transform">
                  <Users className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Section 5
                </span>
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-4">
                People Section
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                Udhar Diya (Money Given) & Udhar Liya (Money Received)
              </p>

              {/* People Stats */}
              <div className="mt-4 p-3 bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl border border-amber-100 dark:border-amber-900/40 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Given (उधार दिया):</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400 font-sans">
                    {formatINR(summary.totalMoneyGiven)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Received (वापस मिला):</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-sans">
                    {formatINR(summary.totalMoneyReceived)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-amber-200/60 dark:border-amber-800/60 font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Outstanding Net:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-sans">
                    {formatINR(summary.netPeopleBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => onNavigate('people')}
                className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all cursor-pointer"
              >
                <span>Open People Section</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenAddModal('people', 'money_given')}
                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950 text-slate-700 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Record Udhar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Utility Tool: Calculator (GST, Offer & Split) */}
      <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 dark:from-emerald-950/30 dark:via-teal-950/30 dark:to-cyan-950/30 rounded-3xl p-4 sm:p-5 border border-emerald-200/80 dark:border-emerald-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 shrink-0">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Financial Calculator
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                GST · Offer · Split
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Dynamic GST calculations, custom discount offers, and accurate per-person bill split
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={() => onNavigate('calculator')}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            <span>Open Calculator</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 8 Complete Financial Summary Cards */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Overall Financial Overview
          </h3>
          <span className="text-xs text-slate-400">Live Calculated Totals</span>
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
              subtitle={`Rem: ${formatINR(summary.remainingHomeBalance)}`}
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Recent Transactions
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest financial records with exact date, time, and category
            </p>
          </div>
          <button
            onClick={() => onNavigate('all_transactions')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
          >
            <span>View All ({transactions.length})</span>
            <Eye className="w-3.5 h-3.5" />
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
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {recentTransactions.map((tx) => {
              const isIncome = tx.transaction_type === 'income';
              const categoryBadgeColors = {
                home: 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                room: 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                food: 'bg-orange-50 dark:bg-orange-950/70 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
                other: 'bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
                people: 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
              }[tx.category] || 'bg-slate-50 dark:bg-slate-950/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800';

              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-xl px-2 sm:px-3 transition-colors group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 ${
                        isIncome
                          ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isIncome ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                          {tx.title}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border uppercase ${categoryBadgeColors}`}>
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
                          <Calendar className="w-3 h-3" />
                          {formatDisplayDate(tx.transaction_date)}
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-emerald-500" />
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
                        className={`text-base font-extrabold font-sans ${
                          isIncome
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isIncome ? '+' : '-'} {formatINR(tx.amount)}
                      </div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400">
                        {tx.transaction_type}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setTransactionToEdit(tx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors"
                        title="Edit Record"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setTransactionToDelete(tx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors"
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
