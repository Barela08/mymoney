import React, { useState, useMemo, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  KeyRound,
  BarChart3,
  Database,
  FileCode,
  Bell,
  Menu,
  X,
  LogOut,
  ArrowLeft,
  ChevronRight,
  Download,
  CheckCircle2,
  Headset,
  CheckCheck,
  ClipboardCheck,
  Settings,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { useToast } from '../../context/ToastContext';
import { hasPortalPermission, resolveEffectiveRoleSlug } from '../../lib/portalAuth';
import { staffClient } from '../../lib/staffApi';
import { sanitizePublicUrl } from '../../lib/siteConfigDefaults';

export type StaffSectionKey =
  | 'overview'
  | 'tasks'
  | 'support'
  | 'users'
  | 'financial_access'
  | 'analytics'
  | 'database'
  | 'audit_logs'
  | 'notifications'
  | 'staff_settings';

interface StaffNavItem {
  key: StaffSectionKey;
  label: string;
  icon: React.ElementType;
  requiredPermission?: string;
}

const STAFF_NAV_ITEMS: StaffNavItem[] = [
  { key: 'overview', label: 'Staff Workspace', icon: LayoutDashboard },
  { key: 'tasks', label: 'Assigned Tasks', icon: ClipboardCheck },
  { key: 'support', label: 'Support & Feedback', icon: MessageSquare, requiredPermission: 'support.read' },
  { key: 'users', label: 'User Directory', icon: Users, requiredPermission: 'users.read' },
  {
    key: 'financial_access',
    label: 'Financial Access Requests',
    icon: KeyRound,
    requiredPermission: 'users.financial_data.request',
  },
  { key: 'analytics', label: 'Platform Analytics', icon: BarChart3, requiredPermission: 'analytics.read' },
  { key: 'audit_logs', label: 'Audit Trail', icon: FileCode, requiredPermission: 'audit.read' },
  { key: 'database', label: 'Database Overview', icon: Database, requiredPermission: 'database.view' },
  { key: 'notifications', label: 'Staff Notifications', icon: Bell },
  { key: 'staff_settings', label: 'Staff Profile & App', icon: Settings },
];

interface StaffLayoutProps {
  currentSection: StaffSectionKey;
  onSelectSection: (section: StaffSectionKey) => void;
  onExitStaff?: () => void;
  children: React.ReactNode;
}

export const StaffLayout: React.FC<StaffLayoutProps> = ({
  currentSection,
  onSelectSection,
  onExitStaff,
  children,
}) => {
  const { user, portalPermissions, logout } = useAuth();
  const { siteConfig } = useExpense();
  const { isInstalled, canOfferInstall, triggerInstallPrompt } = usePwaInstall();
  const toast = useToast();
  const staffBrand = siteConfig.branding.staff_app;

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [staffNotifs, setStaffNotifs] = useState<any[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);

  const visibleNavItems = useMemo(
    () =>
      STAFF_NAV_ITEMS.filter((item) =>
        hasPortalPermission(portalPermissions, item.requiredPermission)
      ),
    [portalPermissions]
  );

  const effectiveRoleSlug = resolveEffectiveRoleSlug(user);
  const roleDisplayLabel = effectiveRoleSlug.replace(/[_-]+/g, ' ');
  const activeItem =
    visibleNavItems.find((i) => i.key === currentSection)?.label || 'Staff Workspace';

  const loadNotifications = async () => {
    try {
      const res = await staffClient.getNotifications();
      if (res?.success && Array.isArray(res.notifications)) {
        setStaffNotifs(res.notifications);
      }
    } catch {}
  };

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
  }, [portalPermissions]);

  const unreadCount = staffNotifs.filter((n) => !n.is_read).length;

  const handleMarkAllRead = async () => {
    try {
      await staffClient.markAllNotificationsRead();
      setStaffNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  };

  const handleInstallApp = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    try {
      const res = await triggerInstallPrompt();
      if (res.status === 'accepted') {
        toast.success('Installing Staff App', `${staffBrand.appName} is installing on your device.`);
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-indigo-200/70 dark:border-indigo-900/60 h-16 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setIsMobileOpen((o) => !o)}
            className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Toggle Staff Navigation"
          >
            {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={sanitizePublicUrl(staffBrand.logoUrl, '/staff-logo.png')}
              alt={staffBrand.appName || 'My Money Manager Staff'}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/staff-icon-192.png';
              }}
              className="w-9 h-9 rounded-xl object-cover shadow-md border border-indigo-500/40 shrink-0 bg-indigo-950"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm tracking-tight text-slate-900 dark:text-slate-100 truncate">
                  {staffBrand.appName || 'My Money Manager Staff'}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  {roleDisplayLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium hidden sm:block truncate">
                {staffBrand.tagline || 'A product of HackifyPro · Staff Operations Portal (/mystaff)'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {!isInstalled && canOfferInstall ? (
            <button
              type="button"
              onClick={handleInstallApp}
              disabled={isInstalling}
              data-testid="staff-header-install-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-sm shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download Staff App</span>
              <span className="sm:hidden">Install App</span>
            </button>
          ) : isInstalled ? (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Staff App Installed</span>
            </span>
          ) : null}

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsAlertsOpen((v) => !v)}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer relative"
              aria-label="Staff Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] font-black flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {isAlertsOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h4 className="font-bold text-xs">Staff Operations Feed</h4>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCheck className="w-3 h-3" />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2">
                  {staffNotifs.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">No notifications right now.</p>
                  ) : (
                    staffNotifs.slice(0, 8).map((n) => (
                      <div
                        key={n.id}
                        onClick={async () => {
                          try {
                            await staffClient.markNotificationRead(n.id);
                            setStaffNotifs((prev) =>
                              prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
                            );
                          } catch {}
                          onSelectSection('tasks');
                          setIsAlertsOpen(false);
                        }}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs space-y-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{n.title}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {onExitStaff && (
            <button
              type="button"
              onClick={onExitStaff}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>User Website</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop Sidebar */}
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hidden lg:flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <Headset className="w-4 h-4" />
              <span>Staff Operations</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectSection(item.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Dedicated Staff App Install Box in Sidebar */}
          {!isInstalled && canOfferInstall && (
            <div className="px-4 pb-3">
              <button
                type="button"
                onClick={handleInstallApp}
                disabled={isInstalling}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install Staff App</span>
              </button>
            </div>
          )}

          {/* Staff User Footer */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                {(user?.displayName || user?.email || 'S').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                  {user?.displayName || 'Staff Member'}
                </p>
                <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              title="Logout Staff Session"
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
            <div className="relative w-72 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col h-full overflow-y-auto space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="font-black text-sm text-indigo-600 dark:text-indigo-400">
                  Staff Navigation
                </span>
                <button
                  type="button"
                  onClick={() => setIsMobileOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 space-y-1.5">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentSection === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        onSelectSection(item.key);
                        setIsMobileOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {!isInstalled && canOfferInstall && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileOpen(false);
                      handleInstallApp();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Staff App</span>
                  </button>
                )}
                {onExitStaff && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileOpen(false);
                      onExitStaff();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>User Website</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-xs font-bold text-rose-600 dark:text-rose-400 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout Staff Session</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span>Staff Operations</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="font-bold text-slate-700 dark:text-slate-300">{activeItem}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                {activeItem}
              </h1>
            </div>
          </div>
          <div className="space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
