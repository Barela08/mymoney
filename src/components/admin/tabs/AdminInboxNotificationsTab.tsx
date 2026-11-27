import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  MessageSquareWarning,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Star,
  Trash2,
  UserPlus,
  Download,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import {
  getAdminPushStatus,
  registerAdminWebPush,
  unregisterAdminWebPush,
  type AdminPushStatus,
} from '../../../lib/adminPushNotifications';
import { useAdminPwaInstall } from '../../../context/AdminPwaInstallContext';
import { useToast } from '../../../context/ToastContext';
import { subscribeAdminRealtimeEvent } from '../../../lib/useAdminRealtime';
import { mapAdminNotificationTargetToSection, type AdminSectionKey } from '../AdminAppNavigation';

type InboxCategory =
  | 'all'
  | 'new_users'
  | 'feedback'
  | 'complaints'
  | 'support'
  | 'security_alerts';

interface AdminInboxNotificationsTabProps {
  onNavigateSection: (section: AdminSectionKey, recordId?: string | null) => void;
  focusNotificationId?: string | null;
}

const CATEGORY_TABS: Array<{
  key: InboxCategory;
  label: string;
  icon: React.ElementType;
}> = [
  { key: 'all', label: 'All Notifications', icon: Bell },
  { key: 'new_users', label: 'New Users', icon: UserPlus },
  { key: 'feedback', label: 'Feedback', icon: Star },
  { key: 'complaints', label: 'Complaints', icon: MessageSquareWarning },
  { key: 'support', label: 'Help & Support', icon: HelpCircle },
  { key: 'security_alerts', label: 'Security Alerts', icon: ShieldAlert },
];

export const AdminInboxNotificationsTab: React.FC<AdminInboxNotificationsTabProps> = ({
  onNavigateSection,
  focusNotificationId,
}) => {
  const toast = useToast();
  const { isInstalled, canOfferInstall, openInstallModal, triggerInstallPrompt } =
    useAdminPwaInstall();

  const [category, setCategory] = useState<InboxCategory>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [countsByCategory, setCountsByCategory] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pushStatus, setPushStatus] = useState<AdminPushStatus | null>(null);
  const [pushDevices, setPushDevices] = useState<any[]>([]);
  const [isPushBusy, setIsPushBusy] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [pushFeedbackBanner, setPushFeedbackBanner] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await adminClient.getAdminNotifications({
        category,
        priority: priorityFilter,
        unreadOnly,
        q: searchQuery.trim() || undefined,
        limit: 120,
      });
      if (res?.success) {
        setNotifications(Array.isArray(res.notifications) ? res.notifications : []);
        setUnreadCount(Number(res.unreadCount || 0));
        setCountsByCategory(res.countsByCategory || {});
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to load admin notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [category, priorityFilter, unreadOnly, searchQuery]);

  const loadPushDevicesAndStatus = useCallback(async () => {
    try {
      const [status, subsRes] = await Promise.all([
        getAdminPushStatus(),
        adminClient.getPushSubscriptions().catch(() => ({ success: false, subscriptions: [] })),
      ]);
      setPushStatus(status);
      if (subsRes?.success && Array.isArray(subsRes.subscriptions)) {
        setPushDevices(subsRes.subscriptions);
      }
    } catch {
      // Keep non-fatal fallback state
    }
  }, []);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    loadPushDevicesAndStatus();
  }, [loadPushDevicesAndStatus]);

  useEffect(() => {
    return subscribeAdminRealtimeEvent((detail) => {
      if (
        detail.table === 'admin_notifications' ||
        detail.table === 'app_users' ||
        detail.table === 'feedbacks' ||
        detail.table === 'support_tickets' ||
        detail.table === 'security_incidents' ||
        detail.table === 'all'
      ) {
        void loadInbox();
      }
    });
  }, [loadInbox]);

  const handleEnablePushClick = async () => {
    setIsPushBusy(true);
    setPushFeedbackBanner(null);
    try {
      const result = await registerAdminWebPush({ interactive: true });
      setPushFeedbackBanner(result.message);
      if (result.success) {
        toast.success('Push Enabled', result.message);
      } else {
        toast.error('Push Setup Notice', result.message);
      }
      await loadPushDevicesAndStatus();
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleDisablePushClick = async () => {
    setIsPushBusy(true);
    try {
      const ok = await unregisterAdminWebPush();
      if (ok) {
        toast.success('Push Disabled', 'This browser will no longer receive Web Push alerts.');
      }
      await loadPushDevicesAndStatus();
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleDeleteDevice = async (id: string) => {
    try {
      const res = await adminClient.deletePushSubscription(id);
      if (res?.success) {
        toast.success('Device Removed', 'Push subscription deleted for that device.');
        setPushDevices((prev) => prev.filter((d) => d.id !== id));
      }
    } catch (err: any) {
      toast.error('Remove Failed', err?.message || 'Unable to remove device subscription.');
    }
  };

  const handleSendTestPush = async () => {
    setIsSendingTest(true);
    try {
      const res = await adminClient.sendTestNotification({
        title: 'Admin Alert Delivery Check',
        message:
          'Web Push delivery test from My Money Manager Admin Console. Tapping opens your notification inbox.',
        deep_link: 'admin:notifications',
      });
      if (res?.success) {
        const delivered = Number(res.pushDelivered || 0);
        const devices = Number(res.deviceCount || 0);
        toast.success(
          'Test Notification Sent',
          devices > 0
            ? `Delivered Web Push to ${delivered} of ${devices} registered device(s) and recorded in inbox.`
            : 'Recorded in Admin Inbox. Enable Web Push on a device to test lock-screen delivery.'
        );
        await loadInbox();
      } else {
        toast.error('Test Failed', res?.message || 'Could not send test notification.');
      }
    } catch (err: any) {
      toast.error('Test Failed', err?.message || 'Could not send test notification.');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await adminClient.markAdminNotificationRead(id);
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await adminClient.markAllAdminNotificationsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
      setCountsByCategory((prev) =>
        Object.keys(prev).reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<string, number>)
      );
      toast.success('Inbox Cleared', 'All admin notifications marked as read.');
    } catch (err: any) {
      toast.error('Update Failed', err?.message || 'Could not mark all notifications as read.');
    }
  };

  const handleOpenRecord = async (item: any) => {
    if (!item.is_read) {
      void handleMarkRead(item.id);
    }
    const target = mapAdminNotificationTargetToSection({
      url: item.deep_link || item.metadata?.deepLink,
      category: item.category,
      eventType: item.event_type,
      relatedEntityType: item.related_entity_type,
      relatedEntityId: item.related_entity_id,
    });
    onNavigateSection(target.section, target.recordId);
  };

  const priorityLabelStyles = (priority: string) => {
    switch ((priority || 'normal').toLowerCase()) {
      case 'urgent':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300';
      case 'high':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300';
      case 'low':
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
      default:
        return 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300';
    }
  };

  const renderEventIcon = (eventType: string, categoryVal: string) => {
    const key = `${eventType || ''} ${categoryVal || ''}`.toLowerCase();
    if (key.includes('user')) return <UserPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
    if (key.includes('feedback')) return <Star className="w-4 h-4 text-amber-500" />;
    if (key.includes('complaint')) return <MessageSquareWarning className="w-4 h-4 text-rose-500" />;
    if (key.includes('support') || key.includes('ticket'))
      return <HelpCircle className="w-4 h-4 text-indigo-500" />;
    return <ShieldAlert className="w-4 h-4 text-rose-500" />;
  };

  const visibleCount = useMemo(() => notifications.length, [notifications]);

  return (
    <div className="space-y-6">
      {/* Mobile Web Push Setup & Registered Admin Devices */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Admin Mobile Web Push Notifications
              </h2>
              <span className="text-xs text-slate-400 tabular-nums">
                &middot; {pushDevices.length} active device{pushDevices.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Receive real-time mobile lock-screen alerts for new user registrations, user complaints, help tickets, feedback, failed payment checks, and security warnings even when the Admin Console is closed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {pushStatus?.requiresHomeScreenInstall ? (
              <button
                type="button"
                onClick={openInstallModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Add to iOS Home Screen for Push</span>
              </button>
            ) : pushStatus?.subscribed ? (
              <button
                type="button"
                onClick={handleDisablePushClick}
                disabled={isPushBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>{isPushBusy ? 'Updating...' : 'Disable on This Device'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEnablePushClick}
                disabled={isPushBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{isPushBusy ? 'Enabling...' : 'Enable Mobile Push Notifications'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSendTestPush}
              disabled={isSendingTest}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingTest ? 'Sending...' : 'Send Test Push'}</span>
            </button>

            {!isInstalled && canOfferInstall && (
              <button
                type="button"
                onClick={() => void triggerInstallPrompt()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install Admin App</span>
              </button>
            )}
          </div>
        </div>

        {/* Permission State / Fallback Explanation */}
        {pushStatus?.permission === 'denied' && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-800 dark:text-rose-200">
            <strong>Browser Notification Permission Blocked:</strong> Mobile Web Push notifications are currently blocked in your browser site settings. Open your browser&apos;s site permissions for this domain and set Notifications to <strong>Allow</strong>, then click &ldquo;Enable Mobile Push Notifications&rdquo;. Until enabled, real-time in-app notifications in this Admin Console remain active as your fallback.
          </div>
        )}

        {pushStatus && !pushStatus.supported && !pushStatus.requiresHomeScreenInstall && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-200">
            {pushStatus.reason || 'Web Push is unavailable in this browser. Real-time in-app alerts remain active.'}
          </div>
        )}

        {pushFeedbackBanner && (
          <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
            {pushFeedbackBanner}
          </p>
        )}

        {/* Per-Admin Registered Device Subscriptions */}
        {pushDevices.length > 0 && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Registered Admin Push Devices
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {pushDevices.map((dev) => (
                <div
                  key={dev.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {dev.device_name || dev.browser || 'Admin Browser Device'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Last active {dev.last_used_at ? new Date(dev.last_used_at).toLocaleDateString() : 'Recently'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteDevice(dev.id)}
                    title="Revoke device subscription"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = category === tab.key;
          const tabUnread =
            tab.key === 'all' ? unreadCount : Number(countsByCategory[tab.key] || 0);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setCategory(tab.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
              {tabUnread > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  }`}
                >
                  {tabUnread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notifications, user emails, ticket or complaint IDs..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="rounded text-emerald-600"
            />
            <span>Unread only</span>
          </label>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 cursor-pointer whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadInbox()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            Notification History ({visibleCount})
          </span>
          <span className="tabular-nums">{unreadCount} unread across all channels</span>
        </div>

        {loadError && (
          <div className="p-6 text-center text-xs text-rose-600 dark:text-rose-400">
            {loadError}
          </div>
        )}

        {!loadError && isLoading && notifications.length === 0 && (
          <div className="p-10 text-center text-xs text-slate-400">
            Loading notifications...
          </div>
        )}

        {!loadError && !isLoading && notifications.length === 0 && (
          <div className="p-12 text-center space-y-2">
            <Bell className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              No notifications match your filters
            </p>
            <p className="text-xs text-slate-400">
              Critical user registrations, feedback, complaints, help requests, and security alerts appear here automatically.
            </p>
          </div>
        )}

        {notifications.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.map((item) => {
              const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
              const isFocused = Boolean(focusNotificationId && item.id === focusNotificationId);
              const priority = (item.priority || 'normal').toLowerCase();
              const target = mapAdminNotificationTargetToSection({
                url: item.deep_link || meta.deepLink,
                category: item.category,
                eventType: item.event_type,
                relatedEntityType: item.related_entity_type,
                relatedEntityId: item.related_entity_id,
              });

              const openLabel =
                target.section === 'users'
                  ? 'Open User Details'
                  : target.section === 'feedback'
                  ? 'Open Feedback'
                  : target.section === 'complaints'
                  ? 'Open Complaint'
                  : target.section === 'support'
                  ? 'Open Support Request'
                  : target.section === 'security'
                  ? 'Open Security Center'
                  : 'Inspect Details';

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:p-5 transition-colors flex flex-col md:flex-row md:items-start justify-between gap-4 ${
                    isFocused
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                      : !item.is_read
                      ? 'bg-slate-50/70 dark:bg-slate-800/35'
                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                      {renderEventIcon(item.event_type, item.category)}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${priorityLabelStyles(
                            priority
                          )}`}
                        >
                          {priority}
                        </span>
                        {!item.is_read && (
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            Unread
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {item.message}
                      </p>

                      {/* Unboxed structured metadata row */}
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="tabular-nums">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : 'Just now'}
                        </span>
                        {(item.user_name || meta.userName) && (
                          <span>&middot; {item.user_name || meta.userName}</span>
                        )}
                        {(item.user_email || meta.userEmail) && (
                          <span className="font-mono">&middot; {item.user_email || meta.userEmail}</span>
                        )}
                        {(item.user_id || meta.userId) && (
                          <span className="font-mono">&middot; ID {(item.user_id || meta.userId).slice(0, 12)}</span>
                        )}
                        {meta.verificationStatus && (
                          <span>&middot; Verification: {meta.verificationStatus}</span>
                        )}
                        {(meta.ticketNumber || meta.complaintNumber) && (
                          <span className="font-mono font-semibold">
                            &middot; #{meta.ticketNumber || meta.complaintNumber}
                          </span>
                        )}
                        {meta.rating && <span>&middot; {meta.rating} / 5 Stars</span>}
                        {meta.feedbackCategory && <span>&middot; {meta.feedbackCategory}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    {!item.is_read && (
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(item.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Mark Read</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleOpenRecord(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>{openLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
