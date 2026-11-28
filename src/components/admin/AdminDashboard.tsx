import React, { Suspense, lazy } from 'react';
import { ShieldAlert, ArrowLeft, RefreshCw, LogOut, Headset } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminLayout, AdminSectionKey } from './AdminLayout';
import { isAdminPortalUser } from '../../lib/portalAuth';

// Lazy-loaded Admin Tabs for fast 3G & low-end mobile initial bundle size
const AdminOverviewTab = lazy(() => import('./tabs/AdminOverviewTab').then((m) => ({ default: m.AdminOverviewTab })));
const AdminUsersTab = lazy(() => import('./tabs/AdminUsersTab').then((m) => ({ default: m.AdminUsersTab })));
const AdminSecurityTab = lazy(() => import('./tabs/AdminSecurityTab').then((m) => ({ default: m.AdminSecurityTab })));
const AdminDeletionsTab = lazy(() => import('./tabs/AdminDeletionsTab').then((m) => ({ default: m.AdminDeletionsTab })));
const AdminEmailsTab = lazy(() => import('./tabs/AdminEmailsTab').then((m) => ({ default: m.AdminEmailsTab })));
const AdminNotificationsTab = lazy(() => import('./tabs/AdminNotificationsTab').then((m) => ({ default: m.AdminNotificationsTab })));
const AdminSupportTab = lazy(() => import('./tabs/AdminSupportTab').then((m) => ({ default: m.AdminSupportTab })));
const AdminLegalTab = lazy(() => import('./tabs/AdminLegalTab').then((m) => ({ default: m.AdminLegalTab })));
const AdminAnalyticsTab = lazy(() => import('./tabs/AdminAnalyticsTab').then((m) => ({ default: m.AdminAnalyticsTab })));
const AdminSystemTab = lazy(() => import('./tabs/AdminSystemTab').then((m) => ({ default: m.AdminSystemTab })));
const AdminAuditLogsTab = lazy(() => import('./tabs/AdminAuditLogsTab').then((m) => ({ default: m.AdminAuditLogsTab })));
const AdminSettingsTab = lazy(() => import('./tabs/AdminSettingsTab').then((m) => ({ default: m.AdminSettingsTab })));
const AdminRolesTab = lazy(() => import('./tabs/AdminRolesTab').then((m) => ({ default: m.AdminRolesTab })));
const AdminFeaturesTab = lazy(() => import('./tabs/AdminFeaturesTab').then((m) => ({ default: m.AdminFeaturesTab })));
const AdminFinancialAccessTab = lazy(() => import('./tabs/AdminFinancialAccessTab').then((m) => ({ default: m.AdminFinancialAccessTab })));
const AdminAccountsTab = lazy(() => import('./tabs/AdminAccountsTab').then((m) => ({ default: m.AdminAccountsTab })));
const AdminTransactionMonitoringTab = lazy(() => import('./tabs/AdminTransactionMonitoringTab').then((m) => ({ default: m.AdminTransactionMonitoringTab })));
const AdminAiTab = lazy(() => import('./tabs/AdminAiTab').then((m) => ({ default: m.AdminAiTab })));
const AdminDatabaseTab = lazy(() => import('./tabs/AdminDatabaseTab').then((m) => ({ default: m.AdminDatabaseTab })));
const AdminInstalledDevicesTab = lazy(() => import('./tabs/AdminInstalledDevicesTab').then((m) => ({ default: m.AdminInstalledDevicesTab })));
const AdminControlCenterTab = lazy(() => import('./tabs/AdminControlCenterTab').then((m) => ({ default: m.AdminControlCenterTab })));
const AdminStaffTasksTab = lazy(() => import('./tabs/AdminStaffTasksTab').then((m) => ({ default: m.AdminStaffTasksTab })));
const AdminAppPushNotificationsTab = lazy(() => import('./tabs/AdminAppPushNotificationsTab').then((m) => ({ default: m.AdminAppPushNotificationsTab })));

const AdminTabSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse py-4">
    <div className="h-8 w-56 rounded-xl bg-slate-200 dark:bg-slate-800" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
    </div>
    <div className="h-64 rounded-3xl bg-slate-200 dark:bg-slate-800" />
  </div>
);

interface AdminDashboardProps {
  onExit?: () => void;
  onGoToStaff?: () => void;
  initialSection?: AdminSectionKey;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onExit,
  onGoToStaff,
  initialSection = 'dashboard',
}) => {
  const { user, isAdmin, isStaff, isLoading, logout } = useAuth();

  // Parse initial section from URL hash (#myadmin=section_name or #admin=section_name) or prop
  const getInitialSection = (): AdminSectionKey => {
    if (typeof window !== 'undefined') {
      if (window.location.hash.startsWith('#myadmin=')) {
        const parsed = window.location.hash.replace('#myadmin=', '').split('&')[0] as AdminSectionKey;
        if (parsed) return parsed;
      }
      if (window.location.hash.startsWith('#admin=')) {
        const parsed = window.location.hash.replace('#admin=', '').split('&')[0] as AdminSectionKey;
        if (parsed) return parsed;
      }
    }
    return initialSection;
  };

  const [currentSection, setCurrentSectionState] = React.useState<AdminSectionKey>(getInitialSection);

  // Keep state in sync with URL hash for deep-linking & back/forward navigation
  React.useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash.startsWith('#myadmin=')) {
        const parsed = window.location.hash.replace('#myadmin=', '').split('&')[0] as AdminSectionKey;
        if (parsed) setCurrentSectionState(parsed);
      } else if (window.location.hash.startsWith('#admin=')) {
        const parsed = window.location.hash.replace('#admin=', '').split('&')[0] as AdminSectionKey;
        if (parsed) setCurrentSectionState(parsed);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const setCurrentSection = (section: AdminSectionKey) => {
    setCurrentSectionState(section);
    if (typeof window !== 'undefined') {
      window.location.hash = `#myadmin=${section}`;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-slate-400 text-sm font-medium">Verifying Administrative Clearance...</p>
      </div>
    );
  }

  // Strict RBAC Access Guard: /myadmin is reserved exclusively for Super Admin and Admin accounts.
  // Staff accounts (support, analyst, custom roles) belong on /mystaff.
  const hasAccess = Boolean(user && (isAdmin || isAdminPortalUser(user)));

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 mb-4 shadow-xl shadow-rose-500/10">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">
          {isStaff ? 'Staff Account Detected' : 'Administrative Clearance Required'}
        </h2>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          {isStaff
            ? 'You are signed in with a Staff role account. Staff members operate inside the dedicated Staff Portal (/mystaff), separate from Admin (/myadmin).'
            : 'This zone is restricted exclusively to authorized platform Administrators. Normal user accounts cannot access the Admin Control Center.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {isStaff && (
            <button
              type="button"
              onClick={onGoToStaff || (() => { window.location.href = '/mystaff'; })}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <Headset className="w-4 h-4" />
              Open Staff Portal (/mystaff)
            </button>
          )}
          <button
            onClick={onExit || (() => { window.location.href = '/'; })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to User Website
          </button>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out &amp; Switch to Admin
          </button>
        </div>
      </div>
    );
  }

  // Render Active Section
  const renderSectionContent = () => {
    switch (currentSection) {
      case 'dashboard':
        return <AdminOverviewTab />;
      case 'users':
        return <AdminUsersTab initialStatusFilter="all" />;
      case 'installed_devices':
        return <AdminInstalledDevicesTab />;
      case 'admins':
        return <AdminAccountsTab />;
      case 'activity':
        return <AdminUsersTab initialStatusFilter="all" />;
      case 'financial_access':
        return <AdminFinancialAccessTab />;
      case 'transactions':
        return <AdminTransactionMonitoringTab />;
      case 'security':
        return <AdminSecurityTab initialSubView="incidents" />;
      case 'login_attempts':
        return <AdminSecurityTab initialSubView="logins" />;
      case 'sessions':
        return <AdminSecurityTab initialSubView="sessions" />;
      case 'deletions':
        return <AdminDeletionsTab />;
      case 'emails':
        return <AdminEmailsTab initialSubView="logs" />;
      case 'email_templates':
        return <AdminEmailsTab initialSubView="templates" />;
      case 'notifications':
        return <AdminNotificationsTab />;
      case 'support':
        return <AdminSupportTab />;
      case 'legal':
        return <AdminLegalTab />;
      case 'analytics':
        return <AdminAnalyticsTab />;
      case 'ai':
        return <AdminAiTab />;
      case 'system':
        return <AdminSystemTab />;
      case 'database':
      case 'backups':
        return <AdminDatabaseTab />;
      case 'audit_logs':
        return <AdminAuditLogsTab />;
      case 'settings':
        return <AdminSettingsTab />;
      case 'app_management':
      case 'website_control':
        return <AdminControlCenterTab initialModule="branding" onNavigateSection={setCurrentSection} />;
      case 'app_branding':
        return <AdminControlCenterTab initialModule="branding" onNavigateSection={setCurrentSection} />;
      case 'app_pwa':
        return <AdminControlCenterTab initialModule="pwa" onNavigateSection={setCurrentSection} />;
      case 'app_push':
        return <AdminAppPushNotificationsTab />;
      case 'app_config':
        return <AdminControlCenterTab initialModule="general" onNavigateSection={setCurrentSection} />;
      case 'app_preview':
        return <AdminControlCenterTab initialModule="preview" onNavigateSection={setCurrentSection} />;
      case 'app_history':
        return <AdminControlCenterTab initialModule="history" onNavigateSection={setCurrentSection} />;
      case 'staff_tasks':
        return <AdminStaffTasksTab />;
      case 'roles':
        return <AdminRolesTab />;
      case 'features':
        return <AdminFeaturesTab />;
      default:
        return <AdminOverviewTab />;
    }
  };

  return (
    <AdminLayout
      currentSection={currentSection}
      onSelectSection={setCurrentSection}
      onExitAdmin={onExit}
    >
      <Suspense fallback={<AdminTabSkeleton />}>
        {renderSectionContent()}
      </Suspense>
    </AdminLayout>
  );
};
export default AdminDashboard;
