import React, { useState, useRef, useEffect } from 'react';
import {
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
  Settings,
  ExternalLink,
  X,
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { UserNotification } from '../../lib/notificationsApi';
import { formatDisplayDate } from '../../lib/dateUtils';
import { NavTab } from '../common/Sidebar';

interface Props {
  onSelectTab: (tab: NavTab) => void;
  onOpenFullCenter: () => void;
  onOpenPreferences: () => void;
  onOpenHelpModal?: (tab?: 'help' | 'feedback' | 'complaint' | 'dpdp') => void;
}

export const NotificationBell: React.FC<Props> = ({
  onSelectTab,
  onOpenFullCenter,
  onOpenPreferences,
  onOpenHelpModal,
}) => {
  const {
    notifications,
    unreadCount,
    isPushSupported,
    pushPermission,
    enablePush,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleNotificationClick = (n: UserNotification) => {
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
      setIsOpen(false);
    }
  };

  const getCategoryIcon = (category: string, type: string) => {
    switch (category) {
      case 'income':
        return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
      case 'expense':
        return <TrendingDown className="w-3.5 h-3.5 text-rose-500" />;
      case 'udhar':
      case 'repay':
        return <Users className="w-3.5 h-3.5 text-blue-500" />;
      case 'settlement':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case 'announcement':
        return <Megaphone className="w-3.5 h-3.5 text-amber-500" />;
      case 'offer':
        return <Gift className="w-3.5 h-3.5 text-purple-500" />;
      case 'support':
      case 'complaint':
      case 'feedback':
        return <HelpCircle className="w-3.5 h-3.5 text-teal-500" />;
      default:
        return type === 'warning' ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        ) : (
          <Bell className="w-3.5 h-3.5 text-emerald-500" />
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
      if (diffMin < 60) return `${diffMin}m`;
      if (diffHours < 24) return `${diffHours}h`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d`;

      const [datePart] = isoString.split('T');
      return formatDisplayDate(datePart);
    } catch {
      return '';
    }
  };

  // Preview latest 6 notifications
  const previewList = notifications.slice(0, 6);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button (Standardized h-9 w-9, Issue 21) */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative h-9 w-9 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        title="Notifications"
        aria-label="Open notifications"
      >
        <Bell className="w-4 h-4 stroke-[1.75]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white font-medium text-xs tabular-nums flex items-center justify-center ring-2 ring-white dark:ring-slate-900 leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-40 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Dropdown Menu / Responsive Sheet */}
      {isOpen && (
        <div className="fixed inset-x-3 top-16 sm:inset-x-auto sm:absolute sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-sm sm:max-w-md mx-auto sm:mx-0 bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200/80 dark:border-slate-800 overflow-hidden z-50 animate-fade-in">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-md text-xs font-bold">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="p-1 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Read all</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenPreferences();
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Notification Preferences"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Enable External OS Alerts + Sound Prompt */}
          {isPushSupported && pushPermission === 'default' && (
            <div className="px-3.5 py-2.5 bg-emerald-50/90 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-900/50 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200 leading-snug">
                Enable desktop/mobile alerts with sound outside the app
              </p>
              <button
                type="button"
                onClick={() => void enablePush()}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                Enable
              </button>
            </div>
          )}

          {/* List */}
          <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {previewList.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <Bell className="w-6 h-6 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  No notifications right now
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Transaction and Udhar alerts will appear here
                </p>
              </div>
            ) : (
              previewList.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`group p-3 transition-colors cursor-pointer flex items-start gap-3 ${
                    !n.is_read
                      ? 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-xs">
                    {getCategoryIcon(n.category, n.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                        {n.title}
                      </p>
                      <span className="text-xs text-slate-400 shrink-0">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>

                    <div className="flex items-center justify-between mt-1 text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium capitalize">
                        {n.category}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(n.id);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenFullCenter();
              }}
              className="text-emerald-600 dark:text-emerald-400 hover:underline font-bold text-xs flex items-center gap-1 cursor-pointer"
            >
              <span>View All Notifications</span>
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenPreferences();
              }}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-semibold cursor-pointer"
            >
              Preferences
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
