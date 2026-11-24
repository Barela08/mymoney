import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Bell,
  CheckCheck,
  SlidersHorizontal,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  X,
  ArrowRight,
  Moon,
  RotateCcw,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { budgetApi, recurringBillsApi, savingsGoalsApi, UserBudget, RecurringBill, SavingsGoal } from '../../lib/financialFeaturesApi';
import { udharDeletionApi } from '../../lib/udharDeletionApi';
import { aiFinanceApi } from '../../lib/aiFinanceApi';
import {
  evaluateSmartAlerts,
  DEFAULT_SMART_ALERT_PREFS,
  isWithinQuietHours,
  SmartAlertCategory,
  SmartAlertEventState,
  SmartAlertPreferences,
  UdharAlertInput,
} from '../../lib/financialIntelligenceEngine';
import { NavTab } from '../common/Sidebar';

interface SmartAlertsSectionProps {
  onSelectTab: (tab: NavTab) => void;
}

type FilterTab = 'all' | 'unread' | SmartAlertCategory;

export const SmartAlertsSection: React.FC<SmartAlertsSectionProps> = ({ onSelectTab }) => {
  const { transactions, summary } = useExpense();
  const toast = useToast();

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [showPreferences, setShowPreferences] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  const [budgets, setBudgets] = useState<UserBudget[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [udharRecords, setUdharRecords] = useState<UdharAlertInput[]>([]);
  const [prefs, setPrefs] = useState<SmartAlertPreferences>(DEFAULT_SMART_ALERT_PREFS);
  const [eventState, setEventState] = useState<SmartAlertEventState>({ readKeys: [], dismissedKeys: [] });

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [alertRes, budRes, billRes, goalRes, udharRes] = await Promise.all([
        aiFinanceApi.getSmartAlertsState().catch(() => null),
        budgetApi.getBudgets().catch(() => ({ success: true, budgets: [] })),
        recurringBillsApi.getBills().catch(() => ({ success: true, bills: [] })),
        savingsGoalsApi.getGoals().catch(() => ({ success: true, goals: [] })),
        udharDeletionApi.getUdharTransactions().catch(() => ({ success: false, transactions: [] })),
      ]);

      if (alertRes) {
        setPrefs(alertRes.preferences);
        setEventState(alertRes.eventState);
      }
      setBudgets(budRes.budgets || []);
      setBills(billRes.bills || []);
      setGoals(goalRes.goals || []);
      if (udharRes.success && Array.isArray(udharRes.transactions)) {
        setUdharRecords(
          udharRes.transactions.map((u: any) => ({
            id: u.id,
            counterpart_name: u.counterpart_name,
            direction: u.direction,
            current_balance: Number(u.current_balance) || 0,
            due_date: u.due_date || null,
            status: u.status,
          }))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const alerts = useMemo(
    () =>
      evaluateSmartAlerts({
        transactions,
        availableBalance: summary.availableBalance,
        budgets,
        recurringBills: bills,
        savingsGoals: goals,
        udharRecords,
        preferences: prefs,
        eventState,
      }),
    [transactions, summary.availableBalance, budgets, bills, goals, udharRecords, prefs, eventState]
  );

  const quietNow = useMemo(() => isWithinQuietHours(prefs), [prefs]);

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  const filteredAlerts = useMemo(() => {
    if (activeFilter === 'all') return alerts;
    if (activeFilter === 'unread') return alerts.filter((a) => !a.isRead);
    return alerts.filter((a) => a.category === activeFilter);
  }, [alerts, activeFilter]);

  const handleMarkRead = async (dedupeKey: string) => {
    setEventState((prev) => ({
      ...prev,
      readKeys: Array.from(new Set([...prev.readKeys, dedupeKey])),
    }));
    await aiFinanceApi.updateSmartAlertEvents({ action: 'mark_read', key: dedupeKey }).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    const keys = alerts.map((a) => a.dedupeKey);
    if (keys.length === 0) return;
    setEventState((prev) => ({
      ...prev,
      readKeys: Array.from(new Set([...prev.readKeys, ...keys])),
    }));
    await aiFinanceApi.updateSmartAlertEvents({ action: 'mark_all_read', keys }).catch(() => {});
    toast.success('All caught up', 'All active smart alerts marked as read.');
  };

  const handleDismiss = async (dedupeKey: string) => {
    setEventState((prev) => ({
      ...prev,
      dismissedKeys: Array.from(new Set([...prev.dismissedKeys, dedupeKey])),
    }));
    await aiFinanceApi.updateSmartAlertEvents({ action: 'dismiss', key: dedupeKey }).catch(() => {});
  };

  const handleRestoreDismissed = async () => {
    setEventState((prev) => ({ ...prev, dismissedKeys: [] }));
    await aiFinanceApi.updateSmartAlertEvents({ action: 'reset_dismissed' }).catch(() => {});
    toast.info('Alerts restored', 'Previously dismissed alerts are visible again.');
  };

  const handleSavePreferences = async () => {
    setIsSavingPrefs(true);
    try {
      const saved = await aiFinanceApi.saveSmartAlertPreferences(prefs);
      setPrefs(saved);
      toast.success('Preferences saved', 'Your smart alert thresholds and quiet hours are active.');
      setShowPreferences(false);
    } catch (err: any) {
      toast.error('Save failed', err.message || 'Could not update alert preferences.');
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const toggleThreshold = (val: number) => {
    setPrefs((p) => {
      const exists = p.budgetThresholds.includes(val);
      const next = exists ? p.budgetThresholds.filter((t) => t !== val) : [...p.budgetThresholds, val].sort((a, b) => a - b);
      return { ...p, budgetThresholds: next.length > 0 ? next : [100] };
    });
  };

  const toggleBillNotice = (val: number) => {
    setPrefs((p) => {
      const exists = p.billNoticeDays.includes(val);
      const next = exists ? p.billNoticeDays.filter((d) => d !== val) : [...p.billNoticeDays, val].sort((a, b) => b - a);
      return { ...p, billNoticeDays: next.length > 0 ? next : [1] };
    });
  };

  const tabs: Array<{ id: FilterTab; label: string; count?: number }> = [
    { id: 'all', label: 'All', count: alerts.length },
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'budget', label: 'Budget', count: alerts.filter((a) => a.category === 'budget').length },
    { id: 'bills', label: 'Bills', count: alerts.filter((a) => a.category === 'bills').length },
    { id: 'spending', label: 'Spending', count: alerts.filter((a) => a.category === 'spending').length },
    { id: 'savings', label: 'Savings', count: alerts.filter((a) => a.category === 'savings').length },
    { id: 'udhar', label: 'Udhar', count: alerts.filter((a) => a.category === 'udhar').length },
  ];

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Smart Financial Alerts
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time budget, bill, spending anomaly, balance, savings, and Udhar monitoring with deduplication
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {eventState.dismissedKeys.length > 0 && (
            <button
              type="button"
              onClick={handleRestoreDismissed}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore Dismissed ({eventState.dismissedKeys.length})</span>
            </button>
          )}
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Mark All Read</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPreferences((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              showPreferences
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Alert Settings</span>
          </button>
        </div>
      </div>

      {quietNow && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
          <Moon className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Quiet hours are active ({prefs.quietHoursStart} – {prefs.quietHoursEnd}). Alerts remain logged here quietly.
          </span>
        </div>
      )}

      {/* Configurable Preferences Panel */}
      {showPreferences && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Alert Preferences & Thresholds</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Customize when Smart Alerts trigger for your account</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.enabled}
                onChange={(e) => setPrefs((p) => ({ ...p, enabled: e.target.checked }))}
                className="w-4 h-4 accent-emerald-600 rounded"
              />
              <span>Master Alerts Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Budget Thresholds */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Budget Usage Alerts</span>
                <input
                  type="checkbox"
                  checked={prefs.budgetEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, budgetEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[50, 75, 90, 100].map((th) => {
                  const active = prefs.budgetThresholds.includes(th);
                  return (
                    <button
                      key={th}
                      type="button"
                      onClick={() => toggleThreshold(th)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                        active
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {th}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bill Notice Days */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Upcoming Bill Reminders</span>
                <input
                  type="checkbox"
                  checked={prefs.billsEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, billsEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[7, 3, 1, 0].map((d) => {
                  const active = prefs.billNoticeDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleBillNotice(d)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                        active
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {d === 0 ? 'Due Today' : `${d}d Before`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Low Balance Threshold */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Low Balance Alert Threshold (₹)</span>
                <input
                  type="checkbox"
                  checked={prefs.lowBalanceEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, lowBalanceEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <input
                type="number"
                min={0}
                step={500}
                value={prefs.lowBalanceThreshold}
                onChange={(e) => setPrefs((p) => ({ ...p, lowBalanceThreshold: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Quiet Hours & Other Toggles */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={prefs.spendingAnomalyEnabled}
                    onChange={(e) => setPrefs((p) => ({ ...p, spendingAnomalyEnabled: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  <span>Spikes</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={prefs.savingsMilestonesEnabled}
                    onChange={(e) => setPrefs((p) => ({ ...p, savingsMilestonesEnabled: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  <span>Savings</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={prefs.udharRemindersEnabled}
                    onChange={(e) => setPrefs((p) => ({ ...p, udharRemindersEnabled: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  <span>Udhar</span>
                </label>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.quietHoursEnabled}
                    onChange={(e) => setPrefs((p) => ({ ...p, quietHoursEnabled: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  <span>Quiet Hours</span>
                </label>
                <input
                  type="time"
                  value={prefs.quietHoursStart}
                  onChange={(e) => setPrefs((p) => ({ ...p, quietHoursStart: e.target.value }))}
                  className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="time"
                  value={prefs.quietHoursEnd}
                  onChange={(e) => setPrefs((p) => ({ ...p, quietHoursEnd: e.target.value }))}
                  className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPreferences(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSavingPrefs}
              onClick={handleSavePreferences}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
            >
              {isSavingPrefs ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const active = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                active
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Alert List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
            ))}
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              All clear in this category
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Smart Alerts only trigger on real budget thresholds, upcoming recurring bills, spending spikes, low balance, savings milestones, or due Udhar records.
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const Icon =
              alert.severity === 'critical'
                ? AlertCircle
                : alert.severity === 'warning'
                ? AlertTriangle
                : alert.severity === 'success'
                ? CheckCircle2
                : Info;

            const iconColor =
              alert.severity === 'critical'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60'
                : alert.severity === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60'
                : alert.severity === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/60';

            return (
              <div
                key={alert.id}
                className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  alert.isRead
                    ? 'border-slate-200/80 dark:border-slate-800/80 opacity-80'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${iconColor}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {alert.title}
                      </h3>
                      {!alert.isRead && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
                          New
                        </span>
                      )}
                      {alert.metricValue && (
                        <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                          · {alert.metricValue}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => {
                      handleMarkRead(alert.dedupeKey);
                      onSelectTab(alert.actionTab as NavTab);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold cursor-pointer"
                  >
                    <span>{alert.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  {!alert.isRead && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(alert.dedupeKey)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDismiss(alert.dedupeKey)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Dismiss alert"
                    aria-label="Dismiss alert"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
