import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Laptop,
  Trash2,
  Mail,
  FileText,
  Bell,
  MessageSquare,
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
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowLeft,
  KeyRound,
  Bot,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { adminClient } from '../../lib/adminApi';

export type AdminSectionKey =
  | 'dashboard'
  | 'users'
  | 'admins'
  | 'activity'
  | 'financial_access'
  | 'transactions'
  | 'security'
  | 'login_attempts'
  | 'sessions'
  | 'deletions'
  | 'emails'
  | 'email_templates'
  | 'notifications'
  | 'support'
  | 'legal'
  | 'analytics'
  | 'ai'
  | 'system'
  | 'database'
  | 'backups'
  | 'audit_logs'
  | 'settings'
  | 'roles'
  | 'features';

interface NavGroup {
  label: string;
  items: {
    key: AdminSectionKey;
    label: string;
    icon: React.ElementType;
    badge?: number | string;
    requiredPermission?: string;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'analytics', label: 'Platform Analytics', icon: BarChart3, requiredPermission: 'analytics.read' },
      { key: 'system', label: 'System Health', icon: Server, requiredPermission: 'system.read' },
    ],
  },
  {
    label: 'User Management',
    items: [
      { key: 'users', label: 'All Users', icon: Users, requiredPermission: 'users.read' },
      { key: 'admins', label: 'Admin Accounts', icon: UserCheck, requiredPermission: 'admins.view' },
      { key: 'roles', label: 'Roles & Permissions', icon: Shield, requiredPermission: 'roles.read' },
      { key: 'sessions', label: 'Sessions & Devices', icon: Laptop, requiredPermission: 'security.read' },
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
    label: 'Communication',
    items: [
      { key: 'notifications', label: 'Push Notifications', icon: Bell, requiredPermission: 'notifications.manage' },
      { key: 'emails', label: 'Email Dispatch Logs', icon: Mail, requiredPermission: 'emails.read' },
      { key: 'email_templates', label: 'Email Templates', icon: FileText, requiredPermission: 'emails.templates.manage' },
      { key: 'support', label: 'Support & Feedback', icon: MessageSquare, requiredPermission: 'support.read' },
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
  onSelectSection: (section: AdminSectionKey) => void;
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
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const roleName = user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Staff';

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };

  // Load Alerts
  const loadAlerts = async () => {
    try {
      const res = await adminClient.getAdminAlerts();
      if (res.success && Array.isArray(res.alerts)) {
        setAlerts(res.alerts);
      }
    } catch {
      // Silently catch in layout
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Global Search Handler
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
      } catch (e) {
        console.warn('Search error:', e);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const activeGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.key === currentSection))?.label || 'Overview';
  const activeItem = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === currentSection)?.label || 'Dashboard';
  const unreadAlertsCount = alerts.filter((a) => a.status === 'unread').length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 h-16 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Toggle Navigation"
          >
            {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-black shadow-md shadow-emerald-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm tracking-tight text-slate-900 dark:text-slate-100">
                  My Money Control Center
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {roleName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium hidden sm:block">
                Enterprise FinTech Administrative Platform
              </p>
            </div>
          </div>
        </div>

        {/* Global Search & Quick Actions */}
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search users, tickets, incidents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {isSearching && (
              <RefreshCw className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
            )}

            {/* Global Search Results Dropdown */}
            {searchResults && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-3 z-50 max-h-96 overflow-y-auto space-y-3">
                {searchResults.users?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Users</p>
                    {searchResults.users.map((u: any) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          onSelectSection('users');
                          setSearchResults(null);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs flex justify-between items-center"
                      >
                        <div>
                          <p className="font-bold text-slate-800 dark:text-slate-200">{u.full_name}</p>
                          <p className="text-[11px] text-slate-400">{u.email}</p>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600">{u.status}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults.tickets?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Support Tickets</p>
                    {searchResults.tickets.map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          onSelectSection('support');
                          setSearchResults(null);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs flex justify-between items-center"
                      >
                        <div>
                          <p className="font-bold text-slate-800 dark:text-slate-200">{t.subject}</p>
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

          {/* System Health Dot */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Operational</span>
          </div>

          {/* Alerts Bell */}
          <div className="relative">
            <button
              onClick={() => setIsAlertsOpen(!isAlertsOpen)}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer relative"
              aria-label="Security Alerts"
            >
              <Bell className="w-5 h-5" />
              {unreadAlertsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                  {unreadAlertsCount}
                </span>
              )}
            </button>

            {/* Alerts Dropdown */}
            {isAlertsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h4 className="font-bold text-xs">Security & Platform Alerts</h4>
                  <span className="text-[10px] font-bold text-slate-400">{alerts.length} Total</span>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {alerts.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">No active alerts recorded.</p>
                  ) : (
                    alerts.slice(0, 5).map((a) => (
                      <div
                        key={a.id}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{a.title}</span>
                          <span
                            className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                              a.severity === 'critical'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {a.severity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{a.description}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Exit to Main App Button */}
          {onExitAdmin && (
            <button
              onClick={onExitAdmin}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-all cursor-pointer"
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
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {NAV_GROUPS.map((group) => {
              const isCollapsed = collapsedGroups[group.label];
              return (
                <div key={group.label} className="space-y-1">
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                  >
                    <span>{group.label}</span>
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {!isCollapsed &&
                    group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentSection === item.key;
                      return (
                        <button
                          key={item.key}
                          onClick={() => onSelectSection(item.key)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                            <span>{item.label}</span>
                          </div>
                          {item.badge && (
                            <span
                              className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                                isActive ? 'bg-white text-emerald-800' : 'bg-slate-200 dark:bg-slate-800 text-slate-600'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>

          {/* Admin User Footer Card */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                {(user?.displayName || user?.email || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                  {user?.displayName || 'Administrator'}
                </p>
                <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <button
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
            <div className="relative w-72 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col h-full overflow-y-auto space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="font-black text-sm text-emerald-600">Admin Navigation</span>
                <button
                  onClick={() => setIsMobileOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5">
                {NAV_GROUPS.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 mb-1">
                      {group.label}
                    </p>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentSection === item.key;
                      return (
                        <button
                          key={item.key}
                          onClick={() => {
                            onSelectSection(item.key);
                            setIsMobileOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold ${
                            isActive
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className="w-4 h-4" />
                            <span>{item.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {/* Breadcrumb Header */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span>Control Center</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span>{activeGroup}</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="font-bold text-slate-700 dark:text-slate-300">{activeItem}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                {activeItem}
              </h1>
            </div>
          </div>

          {/* Section View */}
          <div className="space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
