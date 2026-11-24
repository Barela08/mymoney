import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Sliders,
  Save,
  CalendarClock,
  Info,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { budgetApi, recurringBillsApi, savingsGoalsApi, UserBudget, RecurringBill, SavingsGoal } from '../../lib/financialFeaturesApi';
import { aiFinanceApi } from '../../lib/aiFinanceApi';
import {
  calculateSafeToSpend,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  SafeToSpendPreferences,
} from '../../lib/financialIntelligenceEngine';
import { formatINR } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface SafeToSpendSectionProps {
  onSelectTab: (tab: NavTab) => void;
}

export const SafeToSpendSection: React.FC<SafeToSpendSectionProps> = ({ onSelectTab }) => {
  const { transactions, summary } = useExpense();
  const toast = useToast();

  const [prefs, setPrefs] = useState<SafeToSpendPreferences>(DEFAULT_SAFE_TO_SPEND_PREFS);
  const [budgets, setBudgets] = useState<UserBudget[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [prefRes, budRes, billRes, goalRes] = await Promise.all([
        aiFinanceApi.getSafeToSpendPreferences().catch(() => DEFAULT_SAFE_TO_SPEND_PREFS),
        budgetApi.getBudgets().catch(() => ({ success: true, budgets: [] })),
        recurringBillsApi.getBills().catch(() => ({ success: true, bills: [] })),
        savingsGoalsApi.getGoals().catch(() => ({ success: true, goals: [] })),
      ]);
      setPrefs(prefRes);
      setBudgets(budRes.budgets || []);
      setBills(billRes.bills || []);
      setGoals(goalRes.goals || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const result = useMemo(
    () =>
      calculateSafeToSpend({
        availableBalance: summary.availableBalance,
        transactions,
        recurringBills: bills,
        budgets,
        savingsGoals: goals,
        preferences: prefs,
      }),
    [summary.availableBalance, transactions, bills, budgets, goals, prefs]
  );

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const saved = await aiFinanceApi.saveSafeToSpendPreferences(prefs);
      setPrefs(saved);
      toast.success('Reserves updated', 'Your Safe-to-Spend calculation now reflects your protected reserves.');
    } catch (err: any) {
      toast.error('Save failed', err.message || 'Could not save Safe-to-Spend preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Safe-to-Spend Calculator
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real discretionary cash remaining after protecting unpaid upcoming bills, savings, and safety reserves
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectTab('recurring_bills')}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer self-start sm:self-auto"
        >
          <CalendarClock className="w-3.5 h-3.5 text-emerald-600" />
          <span>Manage Recurring Bills</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-44 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
      ) : !result.hasSufficientData ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-2.5">
          <Info className="w-9 h-9 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {result.insufficientReason}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {result.explanation}
          </p>
        </div>
      ) : (
        <>
          {/* Hero KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Safe-to-Spend Today</span>
                {result.status === 'healthy' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                )}
              </div>
              <p
                className={`text-3xl font-bold tabular-nums mt-2 ${
                  result.safeToSpendToday > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatINR(result.safeToSpendToday)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Daily allowance across {result.remainingDaysInMonth} remaining day(s)
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Safe-to-Spend This Week</span>
              <p className="text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-2">
                {formatINR(result.safeToSpendThisWeek)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Pro-rated for remaining days in this week
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Safe-to-Spend This Month</span>
              <p
                className={`text-2xl sm:text-3xl font-bold tabular-nums mt-2 ${
                  result.safeToSpendThisMonth >= 0
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatINR(result.safeToSpendThisMonth)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {result.remainingBudgetTotal !== null
                  ? `Remaining category budgets: ${formatINR(result.remainingBudgetTotal)}`
                  : 'Total remaining discretionary buffer'}
              </p>
            </div>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs font-medium text-rose-800 dark:text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}

          {/* Breakdown + Interactive Reserve Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Formula Breakdown */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  How Your Safe-to-Spend Is Calculated
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{result.explanation}</p>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.breakdown.map((row) => (
                  <div key={row.key} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{row.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.description}</p>
                    </div>
                    <span
                      className={`text-sm font-bold tabular-nums shrink-0 ${
                        row.amount < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {row.amount < 0 ? `−${formatINR(Math.abs(row.amount))}` : formatINR(row.amount)}
                    </span>
                  </div>
                ))}

                <div className="pt-3.5 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Safe-to-Spend Monthly Pool
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums ${
                      result.safeToSpendThisMonth >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatINR(result.safeToSpendThisMonth)}
                  </span>
                </div>
              </div>

              {/* Upcoming Unpaid Bills List */}
              {result.upcomingBillsList.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Unpaid Upcoming Bills Protected ({result.upcomingBillsList.length})
                  </p>
                  <div className="space-y-1.5">
                    {result.upcomingBillsList.map((b) => (
                      <div key={b.id} className="flex items-center justify-between text-xs py-1">
                        <span className="text-slate-600 dark:text-slate-300">
                          {b.title} · Day {b.dueDay}{' '}
                          {b.daysUntilDue < 0 ? '(Overdue)' : b.daysUntilDue === 0 ? '(Due today)' : `(in ${b.daysUntilDue}d)`}
                        </span>
                        <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatINR(b.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reserve Configuration Panel */}
            <form
              onSubmit={handleSavePreferences}
              className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <Sliders className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Protected Reserves & Settings
                </h2>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Minimum Balance Floor (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={prefs.minimumBalanceReserve}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, minimumBalanceReserve: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Emergency Reserve Buffer (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={prefs.emergencyReserve}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, emergencyReserve: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reserved Monthly Savings Target (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={prefs.savingsCommitment}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, savingsCommitment: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Essential Expenses Reserve (Groceries/Transit) (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={prefs.essentialExpenseReserve}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, essentialExpenseReserve: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold tabular-nums"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.includeExpectedIncome}
                      onChange={(e) => setPrefs((p) => ({ ...p, includeExpectedIncome: e.target.checked }))}
                      className="accent-emerald-600"
                    />
                    <span>Include Expected Remaining Income This Month</span>
                  </label>
                  {prefs.includeExpectedIncome && (
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={prefs.expectedRemainingIncome}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, expectedRemainingIncome: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      placeholder="Expected remaining income (₹)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold tabular-nums"
                    />
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving Reserves...' : 'Save Reserve Settings'}</span>
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
