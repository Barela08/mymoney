import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
  LogOut,
  Headset,
  Users,
  MessageSquare,
  BarChart3,
  KeyRound,
  Download,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { StaffLayout, StaffSectionKey } from './StaffLayout';
import { hasPortalPermission, resolveEffectiveRoleSlug } from '../../lib/portalAuth';
import { adminClient } from '../../lib/adminApi';

// Reuse live-database operational modules scoped by staff RBAC permissions
import { AdminUsersTab } from '../admin/tabs/AdminUsersTab';
import { AdminSupportTab } from '../admin/tabs/AdminSupportTab';
import { AdminFinancialAccessTab } from '../admin/tabs/AdminFinancialAccessTab';
import { AdminAnalyticsTab } from '../admin/tabs/AdminAnalyticsTab';
import { AdminAuditLogsTab } from '../admin/tabs/AdminAuditLogsTab';
import { AdminDatabaseTab } from '../admin/tabs/AdminDatabaseTab';
import { AdminNotificationsTab } from '../admin/tabs/AdminNotificationsTab';

interface StaffDashboardProps {
  onExit?: () => void;
  onGoToAdmin?: () => void;
  initialSection?: StaffSectionKey;
}

const StaffOverviewWorkspace: React.FC<{
  onSelectSection: (section: StaffSectionKey) => void;
}> = ({ onSelectSection }) => {
  const { user, portalPermissions } = useAuth();
  const { isInstalled, triggerInstallPrompt } = usePwaInstall();
  const [ticketCount, setTicketCount] = useState<number | null>(null);
  const [openTicketCount, setOpenTicketCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const effectiveRoleSlug = resolveEffectiveRoleSlug(user);

  useEffect(() => {
    let cancelled = false;
    const loadSummary = async () => {
      setIsLoadingData(true);
      try {
        const tasks: Promise<void>[] = [];
        if (hasPortalPermission(portalPermissions, 'support.read')) {
          tasks.push(
            adminClient
              .getSupportTickets()
              .then((res) => {
                if (cancelled || !res?.success) return;
                const list = Array.isArray(res.tickets) ? res.tickets : [];
                setTicketCount(list.length);
                setOpenTicketCount(
                  list.filter((t: any) => t.status === 'open' || t.status === 'pending' || t.status === 'in_progress').length
                );
              })
              .catch(() => {})
          );
        }
        if (hasPortalPermission(portalPermissions, 'users.read')) {
          tasks.push(
            adminClient
              .getUsers()
              .then((res: any) => {
                if (cancelled || !res?.success) return;
                const list = Array.isArray(res.users) ? res.users : [];
                setUserCount(list.length);
              })
              .catch(() => {})
          );
        }
        await Promise.allSettled(tasks);
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    };
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [portalPermissions]);

  return (
    <div className="space-y-6">
      {/* Staff Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 border border-indigo-800/60 p-6 text-white shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
              <Headset className="w-3.5 h-3.5" />
              Staff Role: {effectiveRoleSlug.toUpperCase()}
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">
              Welcome, {user?.displayName || user?.full_name || 'Staff Member'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              You are signed in to the dedicated <strong>My Money Manager Staff</strong> portal (`/mystaff`) by HackifyPro.
              Your workspace tools are scoped automatically to your assigned role permissions.
            </p>
          </div>

          {!isInstalled ? (
            <button
              type="button"
              onClick={() => triggerInstallPrompt()}
              className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold shadow-lg shadow-indigo-900/40 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Staff App</span>
            </button>
          ) : (
            <div className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Standalone Staff App Active</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Quick Operational Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {hasPortalPermission(portalPermissions, 'support.read') && (
          <button
            type="button"
            onClick={() => onSelectSection('support')}
            className="text-left p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all shadow-sm space-y-2 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Support Desk
              </span>
              <MessageSquare className="w-4 h-4 text-indigo-500" />
            </div>
            <p className="text-2xl font-black text-slate-900 dark:text-white">
              {isLoadingData ? '...' : openTicketCount ?? ticketCount ?? 0}
            </p>
            <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              {ticketCount !== null ? `${ticketCount} total tickets · Open Queue →` : 'Open Support Desk →'}
            </p>
          </button>
        )}

        {hasPortalPermission(portalPermissions, 'users.read') && (
          <button
            type="button"
            onClick={() => onSelectSection('users')}
            className="text-left p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all shadow-sm space-y-2 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Registered Users
              </span>
              <Users className="w-4 h-4 text-cyan-500" />
            </div>
            <p className="text-2xl font-black text-slate-900 dark:text-white">
              {isLoadingData ? '...' : userCount ?? 0}
            </p>
            <p className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400">
              View User Directory →
            </p>
          </button>
        )}

        {hasPortalPermission(portalPermissions, 'users.financial_data.request') && (
          <button
            type="button"
            onClick={() => onSelectSection('financial_access')}
            className="text-left p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all shadow-sm space-y-2 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Data Privacy Gate
              </span>
              <KeyRound className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-sm font-black text-slate-900 dark:text-white">Scoped Access</p>
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              Request User Audit Access →
            </p>
          </button>
        )}

        {hasPortalPermission(portalPermissions, 'analytics.read') && (
          <button
            type="button"
            onClick={() => onSelectSection('analytics')}
            className="text-left p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all shadow-sm space-y-2 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Analytics & Reports
              </span>
              <BarChart3 className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-sm font-black text-slate-900 dark:text-white">Live Telemetry</p>
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              Open Platform Analytics →
            </p>
          </button>
        )}
      </div>

      {/* Active Assigned Permissions Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-500" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Active Staff Clearances ({portalPermissions.length})
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {portalPermissions.map((perm) => (
            <span
              key={perm}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300"
            >
              {perm}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export const StaffDashboard: React.FC<StaffDashboardProps> = ({
  onExit,
  onGoToAdmin,
  initialSection = 'overview',
}) => {
  const { user, isStaff, isAdmin, portalPermissions, isLoading, logout } = useAuth();

  const getInitialSection = (): StaffSectionKey => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#mystaff=')) {
      const parsed = window.location.hash.replace('#mystaff=', '').split('&')[0] as StaffSectionKey;
      if (parsed) return parsed;
    }
    return initialSection;
  };

  const [currentSection, setCurrentSectionState] = useState<StaffSectionKey>(getInitialSection);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash.startsWith('#mystaff=')) {
        const parsed = window.location.hash.replace('#mystaff=', '').split('&')[0] as StaffSectionKey;
        if (parsed) setCurrentSectionState(parsed);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const setCurrentSection = (section: StaffSectionKey) => {
    setCurrentSectionState(section);
    if (typeof window !== 'undefined') {
      window.location.hash = `#mystaff=${section}`;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <p className="text-slate-400 text-sm font-medium">Verifying Staff Portal Session...</p>
      </div>
    );
  }

  // Strict Staff Portal Guard: Admins use /myadmin, normal users use /
  if (!user || !isStaff) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 mb-4 shadow-xl">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">
          {isAdmin ? 'Administrator Account Detected' : 'Staff Clearance Required'}
        </h2>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          {isAdmin
            ? 'You are currently signed in with an Administrator account. Administrators operate in the dedicated Admin Portal (/myadmin), separate from Staff (/mystaff).'
            : 'This portal is restricted strictly to authorized My Money Manager staff accounts.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {isAdmin && (
            <button
              type="button"
              onClick={onGoToAdmin || (() => { window.location.href = '/myadmin'; })}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
            >
              Open Admin Portal (/myadmin)
            </button>
          )}
          <button
            type="button"
            onClick={onExit || (() => { window.location.href = '/'; })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to User Website
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out &amp; Login as Staff
          </button>
        </div>
      </div>
    );
  }

  const permittedSectionMap: Record<StaffSectionKey, string | undefined> = {
    overview: undefined,
    support: 'support.read',
    users: 'users.read',
    financial_access: 'users.financial_data.request',
    analytics: 'analytics.read',
    database: 'database.view',
    audit_logs: 'audit.read',
    notifications: 'notifications.view',
  };

  const renderSection = () => {
    const reqPerm = permittedSectionMap[currentSection];
    if (reqPerm && !hasPortalPermission(portalPermissions, reqPerm)) {
      return <StaffOverviewWorkspace onSelectSection={setCurrentSection} />;
    }

    switch (currentSection) {
      case 'support':
        return <AdminSupportTab />;
      case 'users':
        return <AdminUsersTab initialStatusFilter="all" />;
      case 'financial_access':
        return <AdminFinancialAccessTab />;
      case 'analytics':
        return <AdminAnalyticsTab />;
      case 'audit_logs':
        return <AdminAuditLogsTab />;
      case 'database':
        return <AdminDatabaseTab />;
      case 'notifications':
        return <AdminNotificationsTab />;
      case 'overview':
      default:
        return <StaffOverviewWorkspace onSelectSection={setCurrentSection} />;
    }
  };

  return (
    <StaffLayout
      currentSection={currentSection}
      onSelectSection={setCurrentSection}
      onExitStaff={onExit}
    >
      {renderSection()}
    </StaffLayout>
  );
};

export default StaffDashboard;
