import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Bell,
  CheckCheck,
  Trash2,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Settings2,
  Volume2,
  BellRing,
  AlertTriangle,
  AlertCircle,
  SlidersHorizontal,
  Moon,
  RotateCcw,
  Users,
  Megaphone,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useNotifications } from '../../context/NotificationContext';
import { useExpense } from '../../context/ExpenseContext';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';
import { ConfirmModal } from '../common/ConfirmModal';
import {
  budgetApi,
  recurringBillsApi,
  savingsGoalsApi,
  UserBudget,
  RecurringBill,
  SavingsGoal,
} from '../../lib/financialFeaturesApi';
import { udharDeletionApi } from '../../lib/udharDeletionApi';
import { aiFinanceApi } from '../../lib/aiFinanceApi';
import {
  evaluateSmartAlerts,
  DEFAULT_SMART_ALERT_PREFS,
  isWithinQuietHours,
  SmartAlertEventState,
  SmartAlertPreferences,
  UdharAlertInput,
} from '../../lib/financialIntelligenceEngine';

export type UnifiedNotificationFilter =
  | 'all'
  | 'notifications'
  | 'alerts'
  | 'reminders'
  | 'security'
  | 'transactions'
  | 'udhar'
  | 'system';

interface NotificationsSectionProps {
  onNavigate?: (tab: NavTab) => void;
  onOpenPreferences?: () => void;
  initialFilter?: UnifiedNotificationFilter;
}

interface UnifiedFeedItem {
  id: string;
  source: 'notification' | 'smart_alert';
  title: string;
  message: string;
  category: string;
  type: string;
  severity?: 'info' | 'warning' | 'critical' | 'success';
  metricValue?: string;
  isRead: boolean;
  createdAt: string;
  deepLink?: string;
  actionLabel?: string;
  dedupeKey: string;
  filterBuckets: UnifiedNotificationFilter[];
  metadata?: Record<string, any>;
}

function classifyNotificationBuckets(category: string, type: string): UnifiedNotificationFilter[] {
  const buckets: UnifiedNotificationFilter[] = ['notifications'];
  const cat = String(category || 'general').toLowerCase();
  const tp = String(type || 'info').toLowerCase();

  if (cat === 'security') {
    buckets.push('security', 'alerts');
  }
  if (cat === 'income' || cat === 'expense' || cat === 'receipt') {
    buckets.push('transactions');
  }
  if (cat === 'udhar' || cat === 'repay' || cat === 'settlement') {
    buckets.push('udhar');
  }
  if (cat === 'bill' || tp === 'reminder') {
    buckets.push('reminders');
  }
  if (cat === 'budget' || cat === 'anomaly' || cat === 'low_balance' || cat === 'savings' || tp === 'warning' || tp === 'error') {
    buckets.push('alerts');
  }
  if (cat === 'announcement' || cat === 'system' || cat === 'offer' || cat === 'feedback' || cat === 'complaint' || cat === 'support' || cat === 'general') {
    buckets.push('system');
  }

  return Array.from(new Set(buckets));
}

function classifySmartAlertBuckets(category: string): UnifiedNotificationFilter[] {
  const buckets: UnifiedNotificationFilter[] = ['alerts'];
  if (category === 'bills') {
    buckets.push('reminders');
  } else if (category === 'udhar') {
    buckets.push('udhar', 'reminders');
  } else if (category === 'spending') {
    buckets.push('transactions');
  }
  return Array.from(new Set(buckets));
}

function normalizeDeepLinkTarget(rawLink?: string): NavTab | null {
  if (!rawLink) return null;
  const clean = rawLink.trim().replace(/^\/+/, '').replace(/^#/, '');
  if (!clean) return null;
  const pathToTab: Record<string, NavTab> = {
    'smart-alerts': 'notifications',
    'safe-to-spend': 'safe_to_spend',
    'receipt-scanner': 'receipt_scanner',
    'ai-assistant': 'ai_assistant',
    'expense-calendar': 'expense_calendar',
    'net-worth': 'net_worth',
    'upi-qr': 'upi_qr',
    transactions: 'all_transactions',
  };
  if (clean.startsWith('help:')) return 'help_support';
  if (clean.startsWith('admin:')) return 'admin';
  return (pathToTab[clean] || clean) as NavTab;
}

/**
 * Unified Notifications & Alerts Center.
 * Combines persistent backend notifications and real-time Smart Financial Alerts
 * into a single deduplicated experience with full filter, read, delete, clear & preferences support.
 */
export const NotificationsSection: React.FC<NotificationsSectionProps> = ({
  onNavigate,
  onOpenPreferences,
  initialFilter = 'all',
}) => {
  const toast = useToast();
  const { transactions, summary } = useExpense();
  const {
    notifications,
    unreadCount,
    isLoading,
    isPushSupported,
    pushPermission,
    enablePush,
    testSoundAndExternalAlert,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    respondToConnectionNotification,
    setSmartAlertsUnreadCount,
  } = useNotifications();

  const [activeFilter, setActiveFilter] = useState<UnifiedNotificationFilter>(initialFilter);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isEnablingExternal, setIsEnablingExternal] = useState(false);
  const [actingNotifId, setActingNotifId] = useState<string | null>(null);

  // Smart Alert Engine state
  const [showAlertRules, setShowAlertRules] = useState(false);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(true);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [budgets, setBudgets] = useState<UserBudget[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [udharRecords, setUdharRecords] = useState<UdharAlertInput[]>([]);
  const [alertPrefs, setAlertPrefs] = useState<SmartAlertPreferences>(DEFAULT_SMART_ALERT_PREFS);
  const [eventState, setEventState] = useState<SmartAlertEventState>({ readKeys: [], dismissedKeys: [] });

  useEffect(() => {
    setActiveFilter(initialFilter);
  }, [initialFilter]);

  const loadSmartAlertsData = useCallback(async () => {
    setIsLoadingAlerts(true);
    try {
      const [alertRes, budRes, billRes, goalRes, udharRes] = await Promise.all([
        aiFinanceApi.getSmartAlertsState().catch(() => null),
        budgetApi.getBudgets().catch(() => ({ success: true, budgets: [] })),
        recurringBillsApi.getBills().catch(() => ({ success: true, bills: [] })),
        savingsGoalsApi.getGoals().catch(() => ({ success: true, goals: [] })),
        udharDeletionApi.getUdharTransactions().catch(() => ({ success: false, transactions: [] })),
      ]);

      if (alertRes) {
        setAlertPrefs(alertRes.preferences);
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
      setIsLoadingAlerts(false);
    }
  }, []);

  useEffect(() => {
    void loadSmartAlertsData();
  }, [loadSmartAlertsData]);

  const smartAlerts = useMemo(
    () =>
      evaluateSmartAlerts({
        transactions,
        availableBalance: summary.availableBalance,
        budgets,
        recurringBills: bills,
        savingsGoals: goals,
        udharRecords,
        preferences: alertPrefs,
        eventState,
      }),
    [transactions, summary.availableBalance, budgets, bills, goals, udharRecords, alertPrefs, eventState]
  );

  const smartUnreadCount = useMemo(
    () => smartAlerts.filter((a) => !a.isRead).length,
    [smartAlerts]
  );

  useEffect(() => {
    setSmartAlertsUnreadCount(smartUnreadCount);
  }, [smartUnreadCount, setSmartAlertsUnreadCount]);

  // Deduplicated merged feed preserving existing notification history + live smart alerts
  const unifiedItems = useMemo<UnifiedFeedItem[]>(() => {
    const items: UnifiedFeedItem[] = [];
    const seenDedupeKeys = new Set<string>();

    for (const n of notifications) {
      const dedupeKey = String(n.metadata?.dedupeKey || `notif:${n.id}`);
      if (seenDedupeKeys.has(dedupeKey)) continue;
      seenDedupeKeys.add(dedupeKey);

      items.push({
        id: n.id,
        source: 'notification',
        title: n.title,
        message: n.message,
        category: n.category,
        type: n.type,
        isRead: n.is_read,
        createdAt: n.created_at,
        deepLink: n.deep_link,
        dedupeKey,
        filterBuckets: classifyNotificationBuckets(n.category, n.type),
        metadata: n.metadata,
      });
    }

    for (const alert of smartAlerts) {
      if (seenDedupeKeys.has(alert.dedupeKey)) continue;
      seenDedupeKeys.add(alert.dedupeKey);

      items.push({
        id: `smart:${alert.id}`,
        source: 'smart_alert',
        title: alert.title,
        message: alert.message,
        category: alert.category,
        type: alert.severity === 'critical' ? 'error' : alert.severity,
        severity: alert.severity,
        metricValue: alert.metricValue,
        isRead: alert.isRead,
        createdAt: new Date().toISOString(),
        deepLink: alert.actionTab,
        actionLabel: alert.actionLabel,
        dedupeKey: alert.dedupeKey,
        filterBuckets: classifySmartAlertBuckets(alert.category),
      });
    }

    return items;
  }, [notifications, smartAlerts]);

  const totalUnread = unifiedItems.filter((i) => !i.isRead).length;
  const quietNow = useMemo(() => isWithinQuietHours(alertPrefs), [alertPrefs]);

  const filterTabs: Array<{ id: UnifiedNotificationFilter; label: string; count: number }> = useMemo(
    () => [
      { id: 'all', label: 'All', count: unifiedItems.length },
      {
        id: 'notifications',
        label: 'Notifications',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('notifications')).length,
      },
      {
        id: 'alerts',
        label: 'Alerts',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('alerts')).length,
      },
      {
        id: 'reminders',
        label: 'Reminders',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('reminders')).length,
      },
      {
        id: 'security',
        label: 'Security Alerts',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('security')).length,
      },
      {
        id: 'transactions',
        label: 'Transaction Updates',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('transactions')).length,
      },
      {
        id: 'udhar',
        label: 'Udhar Updates',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('udhar')).length,
      },
      {
        id: 'system',
        label: 'System Updates',
        count: unifiedItems.filter((i) => i.filterBuckets.includes('system')).length,
      },
    ],
    [unifiedItems]
  );

  const visibleItems = useMemo(() => {
    if (activeFilter === 'all') return unifiedItems;
    return unifiedItems.filter((item) => item.filterBuckets.includes(activeFilter));
  }, [unifiedItems, activeFilter]);

  const handleEnableExternalAlerts = async () => {
    setIsEnablingExternal(true);
    try {
      const res = await enablePush();
      if (res.success || res.permission === 'granted') {
        toast.success('External Alerts Enabled', 'Desktop/Mobile notifications with sound are now active.');
      } else {
        toast.warning('Permission Needed', res.error || 'Please allow notifications in browser settings.');
      }
    } finally {
      setIsEnablingExternal(false);
    }
  };

  const handleMarkItemRead = async (item: UnifiedFeedItem) => {
    if (item.isRead) return;
    if (item.source === 'notification') {
      try {
        await markAsRead(item.id);
      } catch (err: any) {
        toast.error('Failed to update', err.message);
      }
    } else {
      setEventState((prev) => ({
        ...prev,
        readKeys: Array.from(new Set([...prev.readKeys, item.dedupeKey])),
      }));
      await aiFinanceApi.updateSmartAlertEvents({ action: 'mark_read', key: item.dedupeKey }).catch(() => {});
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const smartKeys = smartAlerts.map((a) => a.dedupeKey);
      await Promise.all([
        unreadCount > 0 ? markAllAsRead() : Promise.resolve(),
        smartKeys.length > 0
          ? aiFinanceApi.updateSmartAlertEvents({ action: 'mark_all_read', keys: smartKeys }).catch(() => {})
          : Promise.resolve(),
      ]);
      if (smartKeys.length > 0) {
        setEventState((prev) => ({
          ...prev,
          readKeys: Array.from(new Set([...prev.readKeys, ...smartKeys])),
        }));
      }
      toast.success('Marked as Read', 'All notifications and alerts marked as read.');
    } catch (err: any) {
      toast.error('Failed to mark all read', err.message);
    }
  };

  const handleDeleteItem = async (e: React.MouseEvent, item: UnifiedFeedItem) => {
    e.stopPropagation();
    if (item.source === 'notification') {
      try {
        await deleteNotification(item.id);
        toast.success('Removed', 'Notification deleted from your feed.');
      } catch (err: any) {
        toast.error('Delete Failed', err?.message || 'Could not remove notification.');
      }
    } else {
      setEventState((prev) => ({
        ...prev,
        dismissedKeys: Array.from(new Set([...prev.dismissedKeys, item.dedupeKey])),
      }));
      await aiFinanceApi.updateSmartAlertEvents({ action: 'dismiss', key: item.dedupeKey }).catch(() => {});
      toast.info('Alert Dismissed', 'You can restore dismissed smart alerts anytime.');
    }
  };

  const handleConnectionNotifAction = async (
    e: React.MouseEvent,
    item: UnifiedFeedItem,
    action: 'accept' | 'reject'
  ) => {
    e.stopPropagation();
    if (actingNotifId || item.source !== 'notification') return;
    try {
      setActingNotifId(item.id);
      const res = await respondToConnectionNotification(item.id, action);
      toast.success(
        action === 'accept' ? 'Connection Accepted' : 'Request Rejected',
        res.message ||
          (action === 'accept'
            ? 'Added to your Saved People.'
            : 'Connection request declined.')
      );
    } catch (err: any) {
      toast.error('Action Failed', err?.message || 'Could not update connection request.');
    } finally {
      setActingNotifId(null);
    }
  };

  const handleRestoreDismissed = async () => {
    setEventState((prev) => ({ ...prev, dismissedKeys: [] }));
    await aiFinanceApi.updateSmartAlertEvents({ action: 'reset_dismissed' }).catch(() => {});
    toast.info('Alerts Restored', 'Previously dismissed smart alerts are visible again.');
  };

  const handleClearAllConfirm = async () => {
    setIsClearing(true);
    try {
      await clearAll();
      setConfirmClearAll(false);
      toast.success('History Cleared', 'All notification history has been cleared.');
    } catch (err: any) {
      toast.error('Failed to clear', err.message);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSaveAlertRules = async () => {
    setIsSavingRules(true);
    try {
      const saved = await aiFinanceApi.saveSmartAlertPreferences(alertPrefs);
      setAlertPrefs(saved);
      toast.success('Alert Rules Saved', 'Your threshold triggers and quiet hours are active.');
      setShowAlertRules(false);
    } catch (err: any) {
      toast.error('Save Failed', err.message || 'Could not update alert rules.');
    } finally {
      setIsSavingRules(false);
    }
  };

  const toggleThreshold = (val: number) => {
    setAlertPrefs((p) => {
      const exists = p.budgetThresholds.includes(val);
      const next = exists ? p.budgetThresholds.filter((t) => t !== val) : [...p.budgetThresholds, val].sort((a, b) => a - b);
      return { ...p, budgetThresholds: next.length > 0 ? next : [100] };
    });
  };

  const toggleBillNotice = (val: number) => {
    setAlertPrefs((p) => {
      const exists = p.billNoticeDays.includes(val);
      const next = exists ? p.billNoticeDays.filter((d) => d !== val) : [...p.billNoticeDays, val].sort((a, b) => b - a);
      return { ...p, billNoticeDays: next.length > 0 ? next : [1] };
    });
  };

  const getItemIcon = (item: UnifiedFeedItem) => {
    if (item.source === 'smart_alert') {
      if (item.severity === 'critical') return <AlertCircle className="w-4 h-4 text-rose-500" />;
      if (item.severity === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      if (item.severity === 'success') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      return <Sparkles className="w-4 h-4 text-blue-500" />;
    }

    switch (item.category) {
      case 'income':
        return <ArrowDownLeft className="w-4 h-4 text-emerald-500" />;
      case 'expense':
        return <ArrowUpRight className="w-4 h-4 text-rose-500" />;
      case 'udhar':
      case 'repay':
      case 'settlement':
        return <Users className="w-4 h-4 text-amber-500" />;
      case 'security':
        return <Shield className="w-4 h-4 text-indigo-500" />;
      case 'bill':
      case 'reminder':
        return <CalendarClock className="w-4 h-4 text-blue-500" />;
      case 'announcement':
        return <Megaphone className="w-4 h-4 text-emerald-500" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-5 pb-20 max-w-4xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 rounded-3xl p-5 sm:p-7 text-white shadow-xl shadow-emerald-950/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Unified Alert Hub</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold mt-1.5">Notifications &amp; Alerts</h2>
          <p className="text-xs text-emerald-100 mt-0.5">
            You have <strong className="text-white underline">{totalUnread} unread</strong>{' '}
            notification{totalUnread !== 1 ? 's' : ''} &amp; alert{totalUnread !== 1 ? 's' : ''}.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {eventState.dismissedKeys.length > 0 && (
            <button
              type="button"
              onClick={handleRestoreDismissed}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer backdrop-blur-md flex items-center gap-1.5"
              title="Restore dismissed smart alerts"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore ({eventState.dismissedKeys.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAlertRules((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer backdrop-blur-md flex items-center gap-1.5 ${
              showAlertRules ? 'bg-white text-emerald-800' : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Smart Alert Thresholds"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Alert Rules</span>
          </button>

          {onOpenPreferences && (
            <button
              type="button"
              onClick={onOpenPreferences}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer backdrop-blur-md"
              title="Notification & Privacy Preferences"
              aria-label="Notification preferences"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void refreshNotifications();
              void loadSmartAlertsData();
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer backdrop-blur-md"
            title="Refresh notifications and alerts"
            aria-label="Refresh notifications and alerts"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isLoadingAlerts ? 'animate-spin' : ''}`} />
          </button>

          {totalUnread > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer backdrop-blur-md"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read</span>
            </button>
          )}

          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="px-3 py-2 rounded-xl bg-rose-500/25 hover:bg-rose-500/40 text-white text-xs font-bold transition-all cursor-pointer backdrop-blur-md flex items-center gap-1.5"
              title="Clear Notification History"
              aria-label="Clear Notification History"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear History</span>
            </button>
          )}
        </div>
      </div>

      {/* Quiet Hours Notice */}
      {quietNow && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
          <Moon className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Quiet hours are active ({alertPrefs.quietHoursStart} – {alertPrefs.quietHoursEnd}). Alerts remain logged silently here.
          </span>
        </div>
      )}

      {/* Configurable Smart Alert Rules Panel */}
      {showAlertRules && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Smart Financial Alert Thresholds
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customize automatic budget, bill, low balance, and Udhar alert triggers
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={alertPrefs.enabled}
                onChange={(e) => setAlertPrefs((p) => ({ ...p, enabled: e.target.checked }))}
                className="w-4 h-4 accent-emerald-600 rounded"
              />
              <span>Alerts Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Budget Usage Alerts</span>
                <input
                  type="checkbox"
                  checked={alertPrefs.budgetEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, budgetEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[50, 75, 90, 100].map((th) => {
                  const active = alertPrefs.budgetThresholds.includes(th);
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

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Upcoming Bill Reminders</span>
                <input
                  type="checkbox"
                  checked={alertPrefs.billsEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, billsEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[7, 3, 1, 0].map((d) => {
                  const active = alertPrefs.billNoticeDays.includes(d);
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

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <span>Low Balance Threshold (₹)</span>
                <input
                  type="checkbox"
                  checked={alertPrefs.lowBalanceEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, lowBalanceEnabled: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>
              <input
                type="number"
                min={0}
                step={500}
                value={alertPrefs.lowBalanceThreshold}
                onChange={(e) =>
                  setAlertPrefs((p) => ({ ...p, lowBalanceThreshold: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={alertPrefs.spendingAnomalyEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, spendingAnomalyEnabled: e.target.checked }))}
                  className="accent-emerald-600"
                />
                <span>Spikes</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={alertPrefs.savingsMilestonesEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, savingsMilestonesEnabled: e.target.checked }))}
                  className="accent-emerald-600"
                />
                <span>Savings</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={alertPrefs.udharRemindersEnabled}
                  onChange={(e) => setAlertPrefs((p) => ({ ...p, udharRemindersEnabled: e.target.checked }))}
                  className="accent-emerald-600"
                />
                <span>Udhar</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAlertRules(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSavingRules}
              onClick={handleSaveAlertRules}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
            >
              {isSavingRules ? 'Saving...' : 'Save Alert Rules'}
            </button>
          </div>
        </div>
      )}

      {/* Mobile Notification Bar & Sound Push Banner */}
      {isPushSupported && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              {pushPermission === 'granted' ? <Volume2 className="w-4 h-4" /> : <BellRing className="w-4 h-4" />}
            </div>
            <div>
              <p className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                {pushPermission === 'granted'
                  ? 'Mobile Notification Bar & Sound Alerts Active'
                  : 'Get Alerts in Your Mobile Notification Bar with Sound'}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {pushPermission === 'granted'
                  ? 'My Money Manager push alerts appear in your mobile status bar & lock screen with privacy protection.'
                  : pushPermission === 'denied'
                    ? 'Notifications are blocked in browser settings. Enable them in your site settings to get mobile status bar alerts.'
                    : 'Allow notifications so transaction, Udhar, and budget alerts appear in your phone notification bar.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pushPermission !== 'granted' ? (
              <button
                type="button"
                onClick={handleEnableExternalAlerts}
                disabled={isEnablingExternal}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {isEnablingExternal ? 'Enabling...' : 'Enable Mobile Bar Alerts'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void testSoundAndExternalAlert()}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-xs font-bold transition-all cursor-pointer"
              >
                Test Mobile Bar &amp; Sound
              </button>
            )}
          </div>
        </div>
      )}

      {/* Unified Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
        {filterTabs.map((tab) => {
          const isSelected = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap border ${
                isSelected
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/25'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Unified Feed */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3">
        {(isLoading || isLoadingAlerts) && unifiedItems.length === 0 ? (
          <div className="text-center py-12 space-y-2 text-slate-400 text-xs">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-emerald-500" />
            <p>Loading notifications &amp; financial alerts...</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
              <Bell className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              No notifications or alerts in this tab
            </p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Budget warnings, bill reminders, security notices, Udhar updates, and transaction activity will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {visibleItems.map((item) => {
              const targetTab = normalizeDeepLinkTarget(item.deepLink);
              const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, any>;
              const isConnectionRequest =
                item.source === 'notification' && meta.actionType === 'udhar_connection_request';
              const requestStatus = String(meta.requestStatus || '').toLowerCase();
              const isPendingRequestAction =
                isConnectionRequest && (!requestStatus || requestStatus === 'pending');
              const isQrDirectConnected =
                item.source === 'notification' && meta.actionType === 'udhar_qr_connected';
              const avatarSrc = meta.initiatorAvatar || meta.requesterAvatar || null;
              const actorName = meta.initiatorName || meta.requesterName || '';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    void handleMarkItemRead(item);
                    if (targetTab && onNavigate) {
                      onNavigate(targetTab);
                    }
                  }}
                  className={`group py-3.5 px-3 rounded-2xl flex items-start gap-3 transition-colors cursor-pointer ${
                    item.isRead
                      ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 opacity-80'
                      : 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-l-4 border-emerald-500'
                  }`}
                >
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={actorName || item.title}
                      className="w-9 h-9 rounded-xl object-cover border border-emerald-500/30 shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0 mt-0.5">
                      {getItemIcon(item)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <h4 className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                          {item.title}
                        </h4>
                        {!item.isRead && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/70 px-1.5 py-0.5 rounded">
                            New
                          </span>
                        )}
                        {item.metricValue && (
                          <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                            · {item.metricValue}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {item.source === 'smart_alert' ? 'Live' : formatDisplayTime(item.createdAt)}
                        </span>
                        {!item.isRead && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMarkItemRead(item);
                            }}
                            className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 cursor-pointer"
                            title="Mark as read"
                          >
                            Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteItem(e, item)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          title={item.source === 'notification' ? 'Delete notification' : 'Dismiss alert'}
                          aria-label={item.source === 'notification' ? 'Delete notification' : 'Dismiss alert'}
                        >
                          {item.source === 'notification' ? (
                            <Trash2 className="w-3.5 h-3.5" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {item.message}
                    </p>

                    {isQrDirectConnected && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {actorName && (
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                            {actorName}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                          Method: {meta.methodLabel || (meta.connectionMethod === 'CONFIRMATION_CODE' ? 'Confirmation Code' : 'QR Code')}
                        </span>
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMarkItemRead(item);
                              onNavigate('people');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold cursor-pointer"
                          >
                            View Connection
                          </button>
                        )}
                      </div>
                    )}

                    {isConnectionRequest && (
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        {isPendingRequestAction ? (
                          <>
                            <button
                              type="button"
                              disabled={actingNotifId === item.id}
                              onClick={(e) => void handleConnectionNotifAction(e, item, 'accept')}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                            >
                              {actingNotifId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>Accept</span>
                            </button>
                            <button
                              type="button"
                              disabled={actingNotifId === item.id}
                              onClick={(e) => void handleConnectionNotifAction(e, item, 'reject')}
                              className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : (
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize ${
                              requestStatus === 'accepted'
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {requestStatus === 'accepted'
                              ? 'Accepted'
                              : requestStatus === 'cancelled'
                                ? 'Cancelled'
                                : 'Rejected'}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-2">
                      <span className="capitalize font-semibold text-emerald-600 dark:text-emerald-400">
                        {item.source === 'smart_alert' ? `Alert · ${item.category}` : item.category}
                      </span>
                      <span>•</span>
                      <span>
                        {item.source === 'smart_alert' ? 'Real-time monitor' : formatDisplayDate(item.createdAt)}
                      </span>
                      {targetTab && (
                        <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 hover:underline">
                          <span>{isQrDirectConnected ? 'View Connection' : item.actionLabel || 'Open'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmClearAll}
        title="Clear Notification History?"
        message="This will remove all stored notifications from your feed. Your financial transactions and Udhar records remain completely untouched."
        confirmLabel="Clear History"
        isDestructive
        isLoading={isClearing}
        onConfirm={() => void handleClearAllConfirm()}
        onCancel={() => setConfirmClearAll(false)}
      />
    </div>
  );
};
