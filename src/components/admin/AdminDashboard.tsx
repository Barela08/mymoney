import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ArrowLeft, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminLayout } from './AdminLayout';
import {
  normalizeAdminSection,
  type AdminSectionKey,
} from './AdminAppNavigation';

// Tab Components
import { AdminOverviewTab } from './tabs/AdminOverviewTab';
import { AdminUsersTab } from './tabs/AdminUsersTab';
import { AdminSecurityTab } from './tabs/AdminSecurityTab';
import { AdminDeletionsTab } from './tabs/AdminDeletionsTab';
import { AdminEmailsTab } from './tabs/AdminEmailsTab';
import { AdminNotificationsTab } from './tabs/AdminNotificationsTab';
import { AdminInboxNotificationsTab } from './tabs/AdminInboxNotificationsTab';
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

function readLocationRoute(): { section: AdminSectionKey; recordId: string | null } {
  if (typeof window === 'undefined') {
    return { section: 'dashboard', recordId: null };
  }
  const params = new URLSearchParams(window.location.search);
  const qTab = params.get('tab');
  const qId = params.get('id');
  if (qTab) {
    return { section: normalizeAdminSection(qTab), recordId: qId || null };
  }
  if (window.location.hash.startsWith('#admin=')) {
    const raw = window.location.hash.replace('#admin=', '').split('&')[0];
    return { section: normalizeAdminSection(raw), recordId: qId || null };
  }
  return { section: 'dashboard', recordId: qId || null };
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onExit,
  initialSection = 'dashboard',
}) => {
  const { user, isAdmin, isLoading, logout } = useAuth();

  const [routeState, setRouteState] = useState<{
    section: AdminSectionKey;
    recordId: string | null;
    notificationId: string | null;
  }>(() => {
    const loc = readLocationRoute();
    return {
      section: loc.section !== 'dashboard' ? loc.section : initialSection,
      recordId: loc.recordId,
      notificationId: null,
    };
  });

  const navigateSection = useCallback((section: AdminSectionKey, recordId?: string | null) => {
    const normalized = normalizeAdminSection(section);
    const nextRecordId = recordId ?? null;
    setRouteState({
      section: normalized,
      recordId: nextRecordId,
      notificationId: null,
    });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', normalized);
      if (nextRecordId) {
        url.searchParams.set('id', nextRecordId);
      } else {
        url.searchParams.delete('id');
      }
      url.hash = `#admin=${normalized}`;
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);

  useEffect(() => {
    const handleHashOrPop = () => {
      const loc = readLocationRoute();
      setRouteState((prev) => ({
        section: loc.section,
        recordId: loc.recordId,
        notificationId: prev.notificationId,
      }));
    };

    const handleAdminNavigateEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        section?: string;
        recordId?: string | null;
        notificationId?: string | null;
      }>).detail;
      if (!detail?.section) return;
      const normalized = normalizeAdminSection(detail.section);
      setRouteState({
        section: normalized,
        recordId: detail.recordId || null,
        notificationId: detail.notificationId || null,
      });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', normalized);
      if (detail.recordId) {
        url.searchParams.set('id', detail.recordId);
      } else {
        url.searchParams.delete('id');
      }
      url.hash = `#admin=${normalized}`;
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    };

    window.addEventListener('hashchange', handleHashOrPop);
    window.addEventListener('popstate', handleHashOrPop);
    window.addEventListener('mymoney:admin-navigate', handleAdminNavigateEvent);
    return () => {
      window.removeEventListener('hashchange', handleHashOrPop);
      window.removeEventListener('popstate', handleHashOrPop);
      window.removeEventListener('mymoney:admin-navigate', handleAdminNavigateEvent);
    };
  }, []);

  const clearFocusRecord = useCallback(() => {
    setRouteState((prev) => ({ ...prev, recordId: null, notificationId: null }));
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('id');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-slate-400 text-sm font-medium">Verifying Administrative Clearance...</p>
      </div>
    );
  }

  const normalizedEmail = (user?.email || '').toLowerCase().trim();
  const isMasterAdmin = Boolean(
    normalizedEmail === 'admin@mymoney.com' || normalizedEmail === 'hackifypro@gmail.com'
  );
  const allowedRoles = ['superadmin', 'admin', 'analyst', 'support'];
  const userRole = (user?.role || '').toLowerCase().trim();
  const hasAccess = Boolean(
    user && (isMasterAdmin || isAdmin || (userRole && allowedRoles.includes(userRole)))
  );

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Administrative Clearance Required</h2>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          This zone is restricted exclusively to authorized platform administration personnel. Normal user accounts cannot access the Admin Console.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onExit || (() => { window.location.href = '/'; })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Consumer App
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out &amp; Switch to Admin
          </button>
        </div>
      </div>
    );
  }

  const renderSectionContent = () => {
    switch (routeState.section) {
      case 'dashboard':
        return <AdminOverviewTab />;
      case 'notifications':
        return (
          <AdminInboxNotificationsTab
            onNavigateSection={navigateSection}
            focusNotificationId={routeState.notificationId}
          />
        );
      case 'broadcasts':
        return <AdminNotificationsTab />;
      case 'users':
      case 'activity':
        return (
          <AdminUsersTab
            initialStatusFilter="all"
            focusUserId={routeState.recordId}
            onClearFocusUser={clearFocusRecord}
          />
        );
      case 'installed_devices':
        return <AdminInstalledDevicesTab />;
      case 'admins':
        return <AdminAccountsTab />;
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
      case 'feedback':
        return (
          <AdminSupportTab
            mode="feedback"
            focusRecordId={routeState.recordId}
            onClearFocusRecord={clearFocusRecord}
          />
        );
      case 'complaints':
        return (
          <AdminSupportTab
            mode="complaints"
            focusRecordId={routeState.recordId}
            onClearFocusRecord={clearFocusRecord}
          />
        );
      case 'support':
        return (
          <AdminSupportTab
            mode="support"
            focusRecordId={routeState.recordId}
            onClearFocusRecord={clearFocusRecord}
          />
        );
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
      currentSection={routeState.section}
      onSelectSection={navigateSection}
      onExitAdmin={onExit}
    >
      {renderSectionContent()}
    </AdminLayout>
  );
};
export default AdminDashboard;
