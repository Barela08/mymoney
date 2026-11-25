import React, { useState } from 'react';
import { Shield, ShieldAlert, ArrowLeft, RefreshCw, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminLayout, AdminSectionKey } from './AdminLayout';

// Tab Components
import { AdminOverviewTab } from './tabs/AdminOverviewTab';
import { AdminUsersTab } from './tabs/AdminUsersTab';
import { AdminSecurityTab } from './tabs/AdminSecurityTab';
import { AdminDeletionsTab } from './tabs/AdminDeletionsTab';
import { AdminEmailsTab } from './tabs/AdminEmailsTab';
import { AdminNotificationsTab } from './tabs/AdminNotificationsTab';
import { AdminSupportTab } from './tabs/AdminSupportTab';
import { AdminLegalTab } from './tabs/AdminLegalTab';
import { AdminAnalyticsTab } from './tabs/AdminAnalyticsTab';
import { AdminSystemTab } from './tabs/AdminSystemTab';
import { AdminAuditLogsTab } from './tabs/AdminAuditLogsTab';
import { AdminSettingsTab } from './tabs/AdminSettingsTab';
import { AdminRolesTab } from './tabs/AdminRolesTab';
import { AdminFeaturesTab } from './tabs/AdminFeaturesTab';
import { AdminFinancialAccessTab } from './tabs/AdminFinancialAccessTab';
import { AdminAccountsTab } from './tabs/AdminAccountsTab';
import { AdminTransactionMonitoringTab } from './tabs/AdminTransactionMonitoringTab';
import { AdminAiTab } from './tabs/AdminAiTab';
import { AdminDatabaseTab } from './tabs/AdminDatabaseTab';
import { AdminInstalledDevicesTab } from './tabs/AdminInstalledDevicesTab';

interface AdminDashboardProps {
  onExit?: () => void;
  initialSection?: AdminSectionKey;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onExit,
  initialSection = 'dashboard',
}) => {
  const { user, isAdmin, isLoading } = useAuth();

  // Parse initial section from URL hash (#admin=section_name) or prop
  const getInitialSection = (): AdminSectionKey => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#admin=')) {
      const parsed = window.location.hash.replace('#admin=', '').split('&')[0] as AdminSectionKey;
      if (parsed) return parsed;
    }
    return initialSection;
  };

  const [currentSection, setCurrentSectionState] = React.useState<AdminSectionKey>(getInitialSection);

  // Keep state in sync with URL hash for deep-linking & back/forward navigation
  React.useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash.startsWith('#admin=')) {
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
      window.location.hash = `#admin=${section}`;
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

  // RBAC Access Guard: user must be authenticated with administrative privileges
  const isMasterAdmin = Boolean(user?.email && user.email.toLowerCase().trim() === 'admin@mymoney.com');
  const allowedRoles = ['superadmin', 'admin', 'analyst', 'support'];
  const userRole = (user?.role || '').toLowerCase().trim();
  const hasAccess = Boolean(user && (isMasterAdmin || isAdmin || (userRole && allowedRoles.includes(userRole))));

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 mb-4 shadow-xl shadow-rose-500/10">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">Administrative Clearance Required</h2>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          This zone is restricted exclusively to authorized platform administration personnel. Unauthorized access attempts are cryptographically timestamped and forwarded to security audit logs.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onExit || (() => { window.location.href = '/'; })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Personal Workspace
          </button>
          <button
            onClick={() => {
              window.location.hash = '';
              window.location.reload();
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Clearance
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
      {renderSectionContent()}
    </AdminLayout>
  );
};
export default AdminDashboard;
