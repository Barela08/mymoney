import React, { useState, useEffect } from 'react';
import {
  Bell,
  CheckCheck,
  Trash2,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
  PieChart,
  CalendarClock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { notificationsApi, AppNotification } from '../../lib/financialFeaturesApi';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface NotificationsSectionProps {
  onNavigate?: (tab: NavTab) => void;
}

export const NotificationsSection: React.FC<NotificationsSectionProps> = ({ onNavigate }) => {
  const toast = useToast();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const res = await notificationsApi.getNotifications({
        category: activeCategory !== 'all' ? activeCategory : undefined,
        limit: 50,
      });
      if (res.success) {
        setNotifications(res.notifications || []);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch (err: any) {
      console.warn('Could not load notifications:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [activeCategory]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      toast.error('Failed to update', err.message);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      toast.success('Marked as Read', 'All notifications marked as read.');
    } catch (err: any) {
      toast.error('Failed to mark all read', err.message);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all notifications?')) return;
    try {
      await notificationsApi.clearAll();
      setNotifications([]);
      setUnreadCount(0);
      toast.success('Cleared', 'All notifications cleared.');
    } catch (err: any) {
      toast.error('Failed to clear', err.message);
    }
  };

  const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'udhar', label: 'Udhar' },
    { id: 'income', label: 'Income' },
    { id: 'expense', label: 'Expense' },
    { id: 'budget', label: 'Budget' },
    { id: 'bill', label: 'Bills' },
    { id: 'security', label: 'Security' },
  ];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'income':
        return <ArrowDownLeft className="w-4 h-4 text-emerald-500" />;
      case 'expense':
        return <ArrowUpRight className="w-4 h-4 text-rose-500" />;
      case 'udhar':
      case 'repay':
      case 'settlement':
        return <CheckCircle2 className="w-4 h-4 text-amber-500" />;
      case 'budget':
        return <PieChart className="w-4 h-4 text-purple-500" />;
      case 'bill':
        return <CalendarClock className="w-4 h-4 text-blue-500" />;
      case 'security':
        return <Shield className="w-4 h-4 text-indigo-500" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-4xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 rounded-3xl p-6 sm:p-7 text-white shadow-xl shadow-emerald-950/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Notification Center</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold mt-1.5">
            Notifications &amp; Activity
          </h2>
          <p className="text-xs text-emerald-100 mt-0.5">
            You have <strong className="text-white underline">{unreadCount} unread</strong> alert{unreadCount !== 1 ? 's' : ''}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer backdrop-blur-md"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read</span>
            </button>
          )}

          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer backdrop-blur-md"
              title="Clear All Notifications"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === cat.id
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3">
        {isLoading ? (
          <div className="text-center py-12 space-y-2 text-slate-400 text-xs">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-emerald-500" />
            <p>Loading notification feed...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
              <Bell className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              No notifications in this category
            </p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Budget warnings, Udhar reminders, and transaction alerts will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  if (!notif.is_read) handleMarkAsRead(notif.id);
                  if (notif.deep_link && onNavigate) onNavigate(notif.deep_link as any);
                }}
                className={`py-3.5 px-3 rounded-2xl flex items-start gap-3 transition-colors cursor-pointer ${
                  notif.is_read
                    ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 opacity-75'
                    : 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-l-4 border-emerald-500'
                }`}
              >
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0 mt-0.5">
                  {getCategoryIcon(notif.category)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                      {notif.title}
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {formatDisplayTime(notif.created_at)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {notif.message}
                  </p>

                  <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-2">
                    <span className="capitalize font-semibold text-emerald-600 dark:text-emerald-400">
                      {notif.category}
                    </span>
                    <span>•</span>
                    <span>{formatDisplayDate(notif.created_at)}</span>
                    {notif.deep_link && (
                      <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 hover:underline">
                        <span>View</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
