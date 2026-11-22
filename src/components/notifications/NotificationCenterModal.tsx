import React, { useState } from 'react';
import {
  X,
  Bell,
  CheckCheck,
  Trash2,
  TrendingUp,
  TrendingDown,
  Users,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  Gift,
  HelpCircle,
  ExternalLink,
  Search,
  Filter,
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { UserNotification } from '../../lib/notificationsApi';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: NavTab) => void;
  onOpenPreferences: () => void;
  onOpenHelpModal?: (tab?: 'help' | 'feedback' | 'complaint' | 'dpdp') => void;
}

export const NotificationCenterModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectTab,
  onOpenPreferences,
  onOpenHelpModal,
}) => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useNotifications();

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const handleAction = (n: UserNotification) => {
    if (!n.is_read) {
      markAsRead(n.id);
    }

    if (n.deep_link) {
      const link = n.deep_link.toLowerCase();
      if (link.startsWith('help:ticket:') || link === 'help:complaint') {
        if (onOpenHelpModal) onOpenHelpModal('complaint');
      } else if (link === 'help:feedback') {
        if (onOpenHelpModal) onOpenHelpModal('feedback');
      } else if (link === 'help') {
        if (onOpenHelpModal) onOpenHelpModal('help');
      } else {
        onSelectTab(link as NavTab);
      }
      onClose();
    }
  };

  const getCategoryIcon = (category: string, type: string) => {
    switch (category) {
      case 'income':
        return <TrendingUp className="w-4 h-4 text-emerald-500" />;
      case 'expense':
        return <TrendingDown className="w-4 h-4 text-rose-500" />;
      case 'udhar':
      case 'repay':
        return <Users className="w-4 h-4 text-blue-500" />;
      case 'settlement':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'announcement':
        return <Megaphone className="w-4 h-4 text-amber-500" />;
      case 'offer':
        return <Gift className="w-4 h-4 text-purple-500" />;
      case 'support':
      case 'complaint':
      case 'feedback':
        return <HelpCircle className="w-4 h-4 text-teal-500" />;
      default:
        return type === 'warning' ? (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        ) : (
          <Bell className="w-4 h-4 text-emerald-500" />
        );
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const diffMs = Date.now() - d.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSec < 45) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      const [datePart] = isoString.split('T');
      return formatDisplayDate(datePart);
    } catch {
      return '';
    }
  };

  const filtered = notifications.filter((n) => {
    if (activeFilter === 'unread' && n.is_read) return false;
    if (activeFilter === 'transactions' && n.category !== 'income' && n.category !== 'expense') return false;
    if (activeFilter === 'udhar' && n.category !== 'udhar' && n.category !== 'repay' && n.category !== 'settlement') return false;
    if (activeFilter === 'announcements' && n.category !== 'announcement' && n.category !== 'offer') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = n.title.toLowerCase().includes(q);
      const matchMsg = n.message.toLowerCase().includes(q);
      return matchTitle || matchMsg;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100">
                  Notification Center
                </h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All transaction alerts, Udhar khata updates, announcements & offers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenPreferences}
              className="hidden sm:inline-flex px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
            >
              Settings
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="p-3 sm:px-5 sm:py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search notifications by title or text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-none">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'all', label: 'All' },
                { id: 'unread', label: `Unread (${unreadCount})` },
                { id: 'transactions', label: 'Transactions' },
                { id: 'udhar', label: 'Udhar' },
                { id: 'announcements', label: 'Announcements' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    activeFilter === tab.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-bold transition-colors cursor-pointer"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Mark All Read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to clear all notifications? (Your transactions and financial history will NOT be affected).')) {
                      clearAll();
                    }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold transition-colors cursor-pointer"
                  title="Clear all notifications"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear All</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                <Bell className="w-7 h-7" />
              </div>
              <div>
                <p className="font-extrabold text-sm text-slate-700 dark:text-slate-300">
                  No notifications found
                </p>
                <p className="text-xs text-slate-400">
                  {searchQuery ? 'Try matching different keywords.' : 'You are all caught up!'}
                </p>
              </div>
            </div>
          ) : (
            filtered.map((n) => (
              <div
                key={n.id}
                onClick={() => handleAction(n)}
                className={`group p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                  !n.is_read
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500/30 shadow-sm'
                    : 'bg-white dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-xs">
                  {getCategoryIcon(n.category, n.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-slate-400 shrink-0">
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                    {n.message}
                  </p>

                  <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase text-[9px] font-bold tracking-wider">
                        {n.category}
                      </span>
                      {n.deep_link && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 hover:underline">
                          <span>View Details</span>
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n.id);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
