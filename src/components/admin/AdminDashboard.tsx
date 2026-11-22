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

interface AdminDashboardProps {
  onExit?: () => void;
  initialSection?: AdminSectionKey;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onExit,
  initialSection = 'dashboard',
}) => {
  const { user, isAdmin, isLoading } = useAuth();
  const [currentSection, setCurrentSection] = useState<AdminSectionKey>(initialSection);

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
  const allowedRoles = ['superadmin', 'admin', 'analyst', 'support'];
  const hasAccess = Boolean(user && (isAdmin || (user.role && allowedRoles.includes(user.role))));

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
        {onExit && (
          <button
            onClick={onExit}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Personal Workspace
          </button>
        )}
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
      case 'activity':
        return <AdminUsersTab initialStatusFilter="all" />;
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
      case 'system':
      case 'backups':
        return <AdminSystemTab />;
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
