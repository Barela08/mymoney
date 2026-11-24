import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  PlusCircle,
  TrendingUp,
  TrendingDown,
  Edit3,
  CreditCard,
  Layers,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import {
  buildExpenseCalendarMonth,
  CalendarDaySummary,
  formatLocalDateKey,
  getDisplayCategoryLabel,
  isExpenseTransaction,
  SpendingIntensity,
} from '../../lib/financialIntelligenceEngine';
import { formatINR, formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { Transaction } from '../../types';
import { EditTransactionModal } from '../modals/EditTransactionModal';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getIntensityClasses(intensity: SpendingIntensity, isSelected: boolean): string {
  const ring = isSelected ? 'ring-2 ring-emerald-600 dark:ring-emerald-400 border-emerald-500' : '';
  switch (intensity) {
    case 'none':
      return `bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 ${ring}`;
    case 'low':
      return `bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-900/60 ${ring}`;
    case 'normal':
      return `bg-emerald-100/80 dark:bg-emerald-900/40 border-emerald-300/80 dark:border-emerald-800/70 ${ring}`;
    case 'high':
      return `bg-amber-50 dark:bg-amber-950/35 border-amber-300/80 dark:border-amber-800/70 ${ring}`;
    case 'very_high':
      return `bg-rose-50 dark:bg-rose-950/40 border-rose-300/80 dark:border-rose-800/70 ${ring}`;
  }
}

function getIntensityDot(intensity: SpendingIntensity): string {
  switch (intensity) {
    case 'none': return 'bg-slate-300 dark:bg-slate-700';
    case 'low': return 'bg-emerald-400';
    case 'normal': return 'bg-emerald-600';
    case 'high': return 'bg-amber-500';
    case 'very_high': return 'bg-rose-500';
  }
}

function compactINR(amount: number): string {
  if (amount <= 0) return '';
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(amount)}`;
}

interface ExpenseCalendarSectionProps {
  onOpenAddModalForDate?: (dateKey: string) => void;
}

export const ExpenseCalendarSection: React.FC<ExpenseCalendarSectionProps> = ({
  onOpenAddModalForDate,
}) => {
  const { transactions } = useExpense();
  const today = new Date();
  const todayKey = formatLocalDateKey(today);

  const [viewMode, setViewMode] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1); // 1-12
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const calendar = useMemo(
    () => buildExpenseCalendarMonth(transactions, currentYear, currentMonth, categoryFilter),
    [transactions, currentYear, currentMonth, categoryFilter]
  );

  const selectedDay: CalendarDaySummary = useMemo(() => {
    if (calendar.monthDaysMap[selectedDateKey]) {
      return calendar.monthDaysMap[selectedDateKey];
    }
    const firstKey = Object.keys(calendar.monthDaysMap)[0];
    return (
      calendar.monthDaysMap[firstKey] || {
        dateKey: selectedDateKey,
        dayOfMonth: 1,
        inCurrentMonth: true,
        totalExpenses: 0,
        totalIncome: 0,
        netFlow: 0,
        transactionCount: 0,
        expenseCount: 0,
        intensity: 'none',
        transactions: [],
        topCategories: [],
        paymentMethods: [],
      }
    );
  }, [calendar, selectedDateKey]);

  // Weekly view slice: the 7-day row containing selectedDateKey
  const selectedWeekDays = useMemo(() => {
    const idx = calendar.days.findIndex((d) => d.dateKey === selectedDay.dateKey);
    const rowStart = idx >= 0 ? Math.floor(idx / 7) * 7 : 0;
    return calendar.days.slice(rowStart, rowStart + 7);
  }, [calendar.days, selectedDay.dateKey]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
      setSelectedDateKey(`${currentYear - 1}-12-01`);
    } else {
      const nextM = currentMonth - 1;
      setCurrentMonth(nextM);
      setSelectedDateKey(`${currentYear}-${String(nextM).padStart(2, '0')}-01`);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
      setSelectedDateKey(`${currentYear + 1}-01-01`);
    } else {
      const nextM = currentMonth + 1;
      setCurrentMonth(nextM);
      setSelectedDateKey(`${currentYear}-${String(nextM).padStart(2, '0')}-01`);
    }
  };

  const handleJumpToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth() + 1);
    setSelectedDateKey(todayKey);
  };

  const { analytics } = calendar;

  return (
    <div className="space-y-5 pb-8">
      {/* Top Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 min-w-[155px] text-center">
              {MONTH_NAMES[currentMonth - 1]} {currentYear}
            </h1>
            <button
              type="button"
              onClick={handleNextMonth}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleJumpToday}
            className="h-9 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 px-3 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Filter calendar by category"
          >
            <option value="all">All Categories</option>
            <option value="food">Food & Dining</option>
            <option value="room">Room & Utilities</option>
            <option value="other">Other Expenses</option>
            <option value="home">Received / Home</option>
          </select>

          {/* View Mode Segmented Switch */}
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200/70 dark:border-slate-700/70">
            {(['monthly', 'weekly', 'daily'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                  viewMode === mode
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Analytics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Monthly Spending</p>
          <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {formatINR(analytics.totalExpenses)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {analytics.expenseTransactionCount} expense(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Daily Average</p>
          <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {formatINR(analytics.averageDailySpending)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {analytics.daysWithSpending} active day(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Highest Day</p>
          <p className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-1">
            {analytics.highestSpendingDay ? formatINR(analytics.highestSpendingDay.amount) : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {analytics.highestSpendingDay ? formatDisplayDate(analytics.highestSpendingDay.dateKey) : 'No spend yet'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Lowest Active Day</p>
          <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {analytics.lowestSpendingDay ? formatINR(analytics.lowestSpendingDay.amount) : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {analytics.lowestSpendingDay ? formatDisplayDate(analytics.lowestSpendingDay.dateKey) : 'No spend yet'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">vs Last Month</p>
          <div className="flex items-center gap-1 mt-1">
            {analytics.monthOverMonthDelta > 0 ? (
              <TrendingUp className="w-4 h-4 text-rose-500 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
            <p
              className={`text-lg font-bold tabular-nums ${
                analytics.monthOverMonthDelta > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {analytics.monthOverMonthPercent !== null
                ? `${analytics.monthOverMonthDelta > 0 ? '+' : ''}${analytics.monthOverMonthPercent}%`
                : 'N/A'}
            </p>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Last: {formatINR(analytics.previousMonthExpenses)}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Monthly Income</p>
          <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {formatINR(analytics.totalIncome)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Net: {formatINR(analytics.netFlow)}
          </p>
        </div>
      </div>

      {/* Main Split: Calendar Grid + Selected Date Detail Drawer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Calendar Visualization */}
        <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-5">
          {/* Intensity Legend */}
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <CalendarIcon className="w-4 h-4 text-emerald-600" />
              <span>
                {viewMode === 'monthly'
                  ? 'Monthly Spending Heatmap'
                  : viewMode === 'weekly'
                  ? 'Selected Week Breakdown'
                  : `Daily Ledger — ${formatDisplayDate(selectedDay.dateKey)}`}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
              {[
                { label: 'None', dot: 'bg-slate-300 dark:bg-slate-700' },
                { label: 'Low', dot: 'bg-emerald-400' },
                { label: 'Normal', dot: 'bg-emerald-600' },
                { label: 'High', dot: 'bg-amber-500' },
                { label: 'Very High', dot: 'bg-rose-500' },
              ].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>

          {viewMode === 'monthly' && (
            <>
              <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1.5">
                {WEEKDAYS.map((wd) => (
                  <div
                    key={wd}
                    className="text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400 py-1"
                  >
                    {wd}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {calendar.days.map((day) => {
                  const isToday = day.dateKey === todayKey;
                  const isSelected = day.dateKey === selectedDay.dateKey;
                  if (!day.inCurrentMonth) {
                    return (
                      <div
                        key={day.dateKey}
                        className="min-h-[58px] sm:min-h-[78px] rounded-xl p-1.5 bg-slate-50/50 dark:bg-slate-950/30 border border-transparent text-slate-300 dark:text-slate-700 text-xs"
                      >
                        {day.dayOfMonth}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => setSelectedDateKey(day.dateKey)}
                      className={`min-h-[58px] sm:min-h-[78px] rounded-xl p-1.5 sm:p-2 border text-left flex flex-col justify-between transition-all cursor-pointer overflow-hidden ${getIntensityClasses(
                        day.intensity,
                        isSelected
                      )}`}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span
                          className={`text-xs font-semibold tabular-nums ${
                            isToday
                              ? 'px-1.5 py-0.5 rounded-md bg-emerald-600 text-white text-[11px]'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {day.dayOfMonth}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getIntensityDot(day.intensity)}`} />
                      </div>

                      <div className="mt-1 min-w-0">
                        {day.totalExpenses > 0 ? (
                          <p className="text-[10px] sm:text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100 truncate">
                            {compactINR(day.totalExpenses)}
                          </p>
                        ) : day.totalIncome > 0 ? (
                          <p className="text-[10px] sm:text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                            +{compactINR(day.totalIncome)}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-400 dark:text-slate-600">—</p>
                        )}
                        {day.transactionCount > 0 && (
                          <p className="hidden sm:block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {day.transactionCount} tx
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {viewMode === 'weekly' && (
            <div className="space-y-2.5">
              {selectedWeekDays.map((day) => {
                const isSelected = day.dateKey === selectedDay.dateKey;
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    disabled={!day.inCurrentMonth}
                    onClick={() => day.inCurrentMonth && setSelectedDateKey(day.dateKey)}
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 ${getIntensityClasses(
                      day.intensity,
                      isSelected
                    )}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatDisplayDate(day.dateKey)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {day.transactionCount} transaction(s)
                        {day.topCategories.length > 0 ? ` · Top: ${day.topCategories[0].label}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {day.totalExpenses > 0 ? `-${formatINR(day.totalExpenses)}` : '₹0'}
                      </p>
                      {day.totalIncome > 0 && (
                        <p className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          +{formatINR(day.totalIncome)}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {viewMode === 'daily' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Switch day using the date picker or return to Monthly view.
                </p>
                <input
                  type="date"
                  value={selectedDay.dateKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const [y, m] = val.split('-').map(Number);
                    if (y && m) {
                      setCurrentYear(y);
                      setCurrentMonth(m);
                      setSelectedDateKey(val);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200"
                />
              </div>

              {selectedDay.transactions.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  No expenses or income recorded on {formatDisplayDate(selectedDay.dateKey)}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {selectedDay.transactions.map((tx) => {
                    const isExp = isExpenseTransaction(tx);
                    return (
                      <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tx.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {getDisplayCategoryLabel(tx.category, tx.subcategory)} · {formatDisplayTime(tx.transaction_time)}
                            {tx.metadata?.payment_method ? ` · ${tx.metadata.payment_method}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-sm font-bold tabular-nums ${
                              isExp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {isExp ? '-' : '+'}
                            {formatINR(tx.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingTx(tx)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Edit transaction"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected Day Detail Panel */}
        <aside className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Selected Date</p>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {formatDisplayDate(selectedDay.dateKey)}
                </h2>
              </div>
              {onOpenAddModalForDate && (
                <button
                  type="button"
                  onClick={() => onOpenAddModalForDate(selectedDay.dateKey)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add Entry</span>
                </button>
              )}
            </div>

            {/* Day Flow Summary */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Spent</p>
                <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
                  {formatINR(selectedDay.totalExpenses)}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Income</p>
                <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {formatINR(selectedDay.totalIncome)}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Net Flow</p>
                <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatINR(selectedDay.netFlow)}
                </p>
              </div>
            </div>

            {/* Categories & Payment Methods */}
            {selectedDay.topCategories.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Categories
                </p>
                <div className="space-y-1">
                  {selectedDay.topCategories.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300">{c.label}</span>
                      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatINR(c.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedDay.paymentMethods.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                <span>Methods: {selectedDay.paymentMethods.join(' · ')}</span>
              </div>
            )}

            {/* Day Transactions List */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Transactions ({selectedDay.transactions.length})
              </p>
              {selectedDay.transactions.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                  Zero transactions on this date.
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {selectedDay.transactions.map((tx) => {
                    const isExp = isExpenseTransaction(tx);
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tx.title}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {getDisplayCategoryLabel(tx.category, tx.subcategory)} · {formatDisplayTime(tx.transaction_time)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-xs font-bold tabular-nums ${
                              isExp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {isExp ? '-' : '+'}
                            {formatINR(tx.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingTx(tx)}
                            className="p-1 text-slate-400 hover:text-emerald-600 rounded cursor-pointer"
                            aria-label="Edit transaction"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {editingTx && (
        <EditTransactionModal
          isOpen={Boolean(editingTx)}
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
        />
      )}
    </div>
  );
};
