import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Activity,
  ShieldAlert,
  Laptop,
  Trash2,
  Mail,
  FileText,
  Bell,
  MessageSquare,
  MessageSquareWarning,
  HelpCircle,
  Star,
  Scale,
  BarChart3,
  Server,
  Database,
  Save,
  FileCode,
  Settings,
  Sliders,
  Shield,
  Search,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  LogOut,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
  Bot,
  UserCheck,
  UserPlus,
  CheckCheck,
  Smartphone,
  Megaphone,
  Download,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAdminPwaInstall } from '../../context/AdminPwaInstallContext';
import { adminClient } from '../../lib/adminApi';
import { subscribeAdminRealtimeEvent } from '../../lib/useAdminRealtime';
import {
  mapAdminNotificationTargetToSection,
  type AdminSectionKey,
} from './AdminAppNavigation';

export type { AdminSectionKey } from './AdminAppNavigation';

interface NavGroup {
  label: string;
  items: {
    key: AdminSectionKey;
    label: string;
    icon: React.ElementType;
    requiredPermission?: string;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'notifications', label: 'Notifications Center', icon: Bell },
      { key: 'analytics', label: 'Platform Analytics', icon: BarChart3, requiredPermission: 'analytics.read' },
      { key: 'system', label: 'System Health', icon: Server, requiredPermission: 'system.read' },
    ],
  },
  {
    label: 'User Management',
    items: [
      { key: 'users', label: 'All Users', icon: Users, requiredPermission: 'users.read' },
      { key: 'installed_devices', label: 'Installed Devices / PWA', icon: Smartphone, requiredPermission: 'users.read' },
      { key: 'admins', label: 'Admin Accounts', icon: UserCheck, requiredPermission: 'admins.view' },
      { key: 'roles', label: 'Roles & Permissions', icon: Shield, requiredPermission: 'roles.read' },
      { key: 'sessions', label: 'Sessions & Devices', icon: Laptop, requiredPermission: 'security.read' },
    ],
  },
  {
    label: 'Support & Feedback',
    items: [
      { key: 'complaints', label: 'Complaints', icon: MessageSquareWarning, requiredPermission: 'support.read' },
      { key: 'support', label: 'Help & Support', icon: HelpCircle, requiredPermission: 'support.read' },
      { key: 'feedback', label: 'Feedback & Ratings', icon: Star, requiredPermission: 'support.read' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { key: 'broadcasts', label: 'Broadcast Campaigns', icon: Megaphone, requiredPermission: 'notifications.manage' },
      { key: 'emails', label: 'Email Dispatch Logs', icon: Mail, requiredPermission: 'emails.read' },
      { key: 'email_templates', label: 'Email Templates', icon: FileText, requiredPermission: 'emails.templates.manage' },
    ],
  },
  {
    label: 'Financial Monitoring',
    items: [
      { key: 'transactions', label: 'Transaction Monitoring', icon: Activity, requiredPermission: 'dashboard.view' },
      { key: 'financial_access', label: 'Financial Access Requests', icon: KeyRound, requiredPermission: 'users.financial_data.request' },
    ],
  },
  {
    label: 'Application Control',
    items: [
      { key: 'features', label: 'Feature Flags', icon: Sliders, requiredPermission: 'features.manage' },
      { key: 'ai', label: 'AI Management', icon: Bot, requiredPermission: 'ai.manage' },
      { key: 'settings', label: 'Website Settings', icon: Settings, requiredPermission: 'settings.manage' },
      { key: 'legal', label: 'Legal & Policies', icon: Scale, requiredPermission: 'legal.read' },
    ],
  },
  {
    label: 'Security & Infrastructure',
    items: [
      { key: 'security', label: 'Security Center', icon: ShieldAlert, requiredPermission: 'security.read' },
      { key: 'audit_logs', label: 'Audit Trail', icon: FileCode, requiredPermission: 'audit.read' },
      { key: 'database', label: 'Database & Storage', icon: Database, requiredPermission: 'database.view' },
      { key: 'backups', label: 'Backups & Snapshots', icon: Save, requiredPermission: 'backups.read' },
      { key: 'deletions', label: 'Deletion Requests', icon: Trash2, requiredPermission: 'deletions.read' },
    ],
  },
];

interface AdminLayoutProps {
  currentSection: AdminSectionKey;
  onSelectSection: (section: AdminSectionKey, recordId?: string | null) => void;
  onExitAdmin?: () => void;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentSection,
  onSelectSection,
  onExitAdmin,
  children,
}) => {
  const { user, logout } = useAuth();
  const { isInstalled, canOfferInstall, triggerInstallPrompt } = useAdminPwaInstall();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [adminNotifs, setAdminNotifs] = useState<any[]>([]);
  const [unreadInboxCount, setUnreadInboxCount] = useState<number>(0);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const roleName =
    user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Staff';

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };

  const loadAlerts = useCallback(async () => {
    try {
      const [alertRes, notifRes] = await Promise.allSettled([
        adminClient.getAdminAlerts(),
        adminClient.getAdminNotifications({ limit: 20 }),
      ]);
      if (
        alertRes.status === 'fulfilled' &&
        alertRes.value?.success &&
        Array.isArray(alertRes.value.alerts)
      ) {
        setAlerts(alertRes.value.alerts);
      }
      if (notifRes.status === 'fulfilled' && notifRes.value?.success) {
        const list = Array.isArray(notifRes.value.notifications)
          ? notifRes.value.notifications
          : [];
        setAdminNotifs(list);
        setUnreadInboxCount(
          typeof notifRes.value.unreadCount === 'number'
            ? notifRes.value.unreadCount
            : list.filter((n: any) => !n.is_read).length
        );
      }
    } catch {
      // Silently handle in layout
    }
  }, []);

  const handleMarkNotifRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await adminClient.markAdminNotificationRead(id);
      setAdminNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      setUnreadInboxCount((prev) => Math.max(0, prev - 1));
    } catch {}
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await adminClient.markAllAdminNotificationsRead();
      setAdminNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadInboxCount(0);
    } catch {}
  };

  useEffect(() => {
    void loadAlerts();
    const interval = setInterval(() => void loadAlerts(), 30000);
    const unsubscribe = subscribeAdminRealtimeEvent(() => {
      void loadAlerts();
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadAlerts]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await adminClient.globalSearch(searchQuery.trim());
        if (res.success) {
          setSearchResults(res.results);
        }
      } catch {
        // ignore search error
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const activeGroup =
    NAV_GROUPS.find((g) => g.items.some((i) => i.key === currentSection))?.label || 'Overview';
  const activeItem =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === currentSection)?.label || 'Dashboard';

  const unreadAlertsCount =
    alerts.filter((a) => a.status === 'unread').length + unreadInboxCount;

  const mobileQuickNav: Array<{ key: AdminSectionKey; label: string; icon: React.ElementType }> = [
    { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { key: 'notifications', label: 'Alerts', icon: Bell },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'complaints', label: 'Complaints', icon: MessageSquareWarning },
    { key: 'support', label: 'Support', icon: MessageSquare },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 h-16 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            aria-label="Toggle Admin Navigation"
          >
            {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/admin-logo.png"
              alt="My Money Manager Admin"
              className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-slate-100 truncate">
                  My Money Manager Admin
                </span>
                <span className="hidden sm:inline text-xs text-slate-400">&middot;</span>
                <span className="hidden sm:inline text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {roleName}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block truncate">
                HackifyPro Administrative Console
              </p>
            </div>
          </div>
        </div>

        {/* Search, Install CTA, Bell & Consumer App Link */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="relative hidden md:block w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search users, tickets, complaints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {isSearching && (
              <RefreshCw className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
            )}

            {searchResults && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-3 z-50 max-h-96 overflow-y-auto space-y-3">
                {searchResults.users?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Users</p>
                    {searchResults.users.map((u: any) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          onSelectSection('users', u.id);
                          setSearchResults(null);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs flex justify-between items-center cursor-pointer"
                      >
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{u.full_name}</p>
                          <p className="text-[11px] text-slate-400">{u.email}</p>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600">{u.status}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults.tickets?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tickets &amp; Complaints</p>
                    {searchResults.tickets.map((t: any) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          onSelectSection(t.ticket_type === 'complaint' ? 'complaints' : 'support', t.id);
                          setSearchResults(null);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs flex justify-between items-center cursor-pointer"
                      >
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{t.subject}</p>
                          <p className="text-[11px] text-slate-400">#{t.ticket_number}</p>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-500">{t.status}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults.users?.length === 0 && searchResults.tickets?.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-2">No matching records found.</p>
                )}
              </div>
            )}
          </div>

          {!isInstalled && canOfferInstall && (
            <button
              type="button"
              onClick={() => void triggerInstallPrompt()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Install Admin App</span>
            </button>
          )}

          {/* Alerts Bell Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsAlertsOpen(!isAlertsOpen)}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer relative"
              aria-label="Admin Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadAlertsCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums flex items-center justify-center">
                  {unreadAlertsCount > 99 ? '99+' : unreadAlertsCount}
                </span>
              )}
            </button>

            {isAlertsOpen && (
              <div className="absolute right-0 mt-2 w-88 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-xs">Admin Notifications</h4>
                    {unreadAlertsCount > 0 && (
                      <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                        {unreadAlertsCount} unread
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    {adminNotifs.some((n) => !n.is_read) && (
                      <button
                        type="button"
                        onClick={handleMarkAllNotifsRead}
                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCheck className="w-3 h-3" />
                        <span>Mark all read</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSection('notifications');
                        setIsAlertsOpen(false);
                      }}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Open Center
                    </button>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-2 pr-0.5">
                  {adminNotifs.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">
                      No recent notifications yet.
                    </p>
                  ) : (
                    adminNotifs.slice(0, 8).map((n) => {
                      const target = mapAdminNotificationTargetToSection({
                        url: n.deep_link || n.metadata?.deepLink,
                        category: n.category,
                        eventType: n.event_type,
                        relatedEntityType: n.related_entity_type,
                        relatedEntityId: n.related_entity_id,
                      });
                      return (
                        <div
                          key={n.id}
                          onClick={() => {
                            void handleMarkNotifRead(n.id);
                            onSelectSection(target.section, target.recordId);
                            setIsAlertsOpen(false);
                          }}
                          className={`p-3 rounded-xl border text-xs space-y-1 transition-colors cursor-pointer ${
                            !n.is_read
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50'
                              : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {n.event_type === 'new_user' ? (
                                <UserPlus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              ) : (
                                <Bell className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              )}
                              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {n.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!n.is_read && (
                                <button
                                  type="button"
                                  onClick={(e) => void handleMarkNotifRead(n.id, e)}
                                  title="Mark as read"
                                  className="p-0.5 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <span className="text-[10px] text-slate-400 tabular-nums">
                                {new Date(n.created_at).toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug line-clamp-2">
                            {n.message}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {onExitAdmin && (
            <button
              type="button"
              onClick={onExitAdmin}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>User App</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop Sidebar */}
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hidden lg:flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {NAV_GROUPS.map((group) => {
              const isCollapsed = collapsedGroups[group.label];
              return (
                <div key={group.label} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                  >
                    <span>{group.label}</span>
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {!isCollapsed &&
                    group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentSection === item.key;
                      const showUnreadBadge = item.key === 'notifications' && unreadInboxCount > 0;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => onSelectSection(item.key)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                            <span className="truncate">{item.label}</span>
                          </div>
                          {showUnreadBadge && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              }`}
                            >
                              {unreadInboxCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                {(user?.displayName || user?.email || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {user?.displayName || 'Administrator'}
                </p>
                <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              title="Logout Session"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {isMobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
              onClick={() => setIsMobileOpen(false)}
            />
            <div className="relative w-72 max-w-[82vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col h-full overflow-y-auto space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <img src="/admin-logo.png" alt="MM Admin" className="w-7 h-7 rounded-lg object-cover" />
                  <span className="font-bold text-sm text-slate-900 dark:text-white">MM Admin</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 space-y-4">
                {NAV_GROUPS.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 mb-1">
                      {group.label}
                    </p>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentSection === item.key;
                      const showUnreadBadge = item.key === 'notifications' && unreadInboxCount > 0;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            onSelectSection(item.key);
                            setIsMobileOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                            isActive
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className="w-4 h-4" />
                            <span>{item.label}</span>
                          </div>
                          {showUnreadBadge && (
                            <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-bold tabular-nums">
                              {unreadInboxCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {!isInstalled && canOfferInstall && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileOpen(false);
                      void triggerInstallPrompt();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Install Admin App</span>
                  </button>
                )}
                {onExitAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileOpen(false);
                      onExitAdmin();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Switch to User App</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout Admin Session</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full pb-24 lg:pb-8">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <span>My Money Manager Admin</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span>{activeGroup}</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">{activeItem}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                {activeItem}
              </h1>
            </div>
          </div>

          <div className="space-y-6">{children}</div>
        </main>
      </div>

      {/* Compact Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Admin Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-1.5"
      >
        <div className="grid grid-cols-5 gap-1">
          {mobileQuickNav.map((item) => {
            const Icon = item.icon;
            const active = currentSection === item.key;
            const showBadge = item.key === 'notifications' && unreadInboxCount > 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectSection(item.key)}
                className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl text-[10px] font-semibold cursor-pointer ${
                  active
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/40'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="truncate">{item.label}</span>
                {showBadge && (
                  <span className="absolute top-1 right-3 min-w-[14px] h-3.5 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums flex items-center justify-center">
                    {unreadInboxCount > 9 ? '9+' : unreadInboxCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
