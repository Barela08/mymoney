import React, { useState } from 'react';
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
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Settings2,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useNotifications } from '../../context/NotificationContext';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';
import { ConfirmModal } from '../common/ConfirmModal';

interface NotificationsSectionProps {
  onNavigate?: (tab: NavTab) => void;
  onOpenPreferences?: () => void;
}

/**
 * Single notification history surface for the whole app.
 * Backed by NotificationContext so the bell, badge and this page share one feed.
 */
export const NotificationsSection: React.FC<NotificationsSectionProps> = ({
  onNavigate,
  onOpenPreferences,
}) => {
  const toast = useToast();
  const {
    notifications,
    unreadCount,
    isLoading,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    clearAll,
  } = useNotifications();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const handleMarkAsRead = async (id: string) => {
    try {
      await markAsRead(id);
    } catch (err: any) {
      toast.error('Failed to update', err.message);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      toast.success('Marked as Read', 'All notifications marked as read.');
    } catch (err: any) {
      toast.error('Failed to mark all read', err.message);
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAll();
      setConfirmClearAll(false);
      toast.success('Cleared', 'All notifications cleared.');
    } catch (err: any) {
      toast.error('Failed to clear', err.message);
    }
  };

  const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'announcement', label: 'Announcements' },
    { id: 'udhar', label: 'Udhar' },
    { id: 'income', label: 'Income' },
    { id: 'expense', label: 'Expense' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'security', label: 'Security' },
  ];

  const visibleNotifications =
    activeCategory === 'all'
      ? notifications
      : notifications.filter((n) => n.category === activeCategory);

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
      case 'security':
        return <Shield className="w-4 h-4 text-indigo-500" />;
      case 'reminder':
        return <CalendarClock className="w-4 h-4 text-blue-500" />;
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
          <h2 className="text-xl sm:text-2xl font-extrabold mt-1.5">Notifications &amp; Activity</h2>
          <p className="text-xs text-emerald-100 mt-0.5">
            You have <strong className="text-white underline">{unreadCount} unread</strong> alert
            {unreadCount !== 1 ? 's' : ''}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenPreferences && (
            <button
              onClick={onOpenPreferences}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer backdrop-blur-md"
              title="Notification preferences"
              aria-label="Notification preferences"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => void refreshNotifications()}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer backdrop-blur-md"
            title="Refresh notifications"
            aria-label="Refresh notifications"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

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
              onClick={() => setConfirmClearAll(true)}
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
        {isLoading && notifications.length === 0 ? (
          <div className="text-center py-12 space-y-2 text-slate-400 text-xs">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-emerald-500" />
            <p>Loading notification feed...</p>
          </div>
        ) : visibleNotifications.length === 0 ? (
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
            {visibleNotifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  if (!notif.is_read) void handleMarkAsRead(notif.id);
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

      <ConfirmModal
        isOpen={confirmClearAll}
        title="Clear all notifications?"
        message="This will remove all items from your notification feed."
        confirmLabel="Clear All"
        isDestructive
        onConfirm={() => void handleClearAll()}
        onCancel={() => setConfirmClearAll(false)}
      />
    </div>
  );
};
