import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  UserCheck,
  UserX,
  Mail,
  KeyRound,
  RotateCcw,
  Trash2,
  Activity,
  Laptop,
  Shield,
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw,
  Clock,
  Eye,
  Lock,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Wallet,
  Calendar,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';
import { formatDisplayDate, formatINR } from '../../../lib/dateUtils';
import { subscribeAdminRealtimeEvent } from '../../../lib/useAdminRealtime';

interface UserSummaryStats {
  totalUsers: number;
  newToday: number;
  newWeek: number;
  activeUsers: number;
  inactiveUsers: number;
  verifiedUsers: number;
  unverifiedUsers: number;
  suspendedUsers: number;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AdminUsersTabProps {
  initialStatusFilter?: string;
  focusUserId?: string | null;
  onClearFocusUser?: () => void;
}

const DEFAULT_SUMMARY: UserSummaryStats = {
  totalUsers: 0,
  newToday: 0,
  newWeek: 0,
  activeUsers: 0,
  inactiveUsers: 0,
  verifiedUsers: 0,
  unverifiedUsers: 0,
  suspendedUsers: 0,
};

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  initialStatusFilter = 'all',
  focusUserId = null,
  onClearFocusUser,
}) => {
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [summary, setSummary] = useState<UserSummaryStats>(DEFAULT_SUMMARY);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [verifiedFilter, setVerifiedFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [regFrom, setRegFrom] = useState<string>('');
  const [regTo, setRegTo] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Complete User Inspection Modal
  const [inspectedUser, setInspectedUser] = useState<any | null>(null);
  const [inspectionTab, setInspectionTab] = useState<'profile' | 'activity' | 'sessions' | 'financial'>('profile');
  const [userActivityLogs, setUserActivityLogs] = useState<any[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [financialData, setFinancialData] = useState<any | null>(null);
  const [financialGrantMeta, setFinancialGrantMeta] = useState<any | null>(null);
  const [financialRequiresGrant, setFinancialRequiresGrant] = useState(false);
  const [isLoadingFinancial, setIsLoadingFinancial] = useState(false);
  const [grantReason, setGrantReason] = useState('');
  const [isRequestingGrant, setIsRequestingGrant] = useState(false);

  // Status Confirmation Modal
  const [pendingStatusAction, setPendingStatusAction] = useState<{
    user: any;
    newStatus: 'active' | 'suspended' | 'deactivated';
    reason: string;
  } | null>(null);

  // Delete Confirmation Modal
  const [pendingDeleteUser, setPendingDeleteUser] = useState<{
    user: any;
    reason: string;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getUsers({
        q: debouncedQuery.trim() || undefined,
        status: statusFilter,
        verified: verifiedFilter,
        role: roleFilter,
        regFrom: regFrom || undefined,
        regTo: regTo || undefined,
        page,
        limit: 20,
      });

      if (res.success && Array.isArray(res.users)) {
        setUsers(res.users);
        if (res.summary) {
          setSummary(res.summary);
        } else {
          // Client fallback summary if Supabase fallback returned plain array
          const list = res.users;
          setSummary({
            totalUsers: list.length,
            newToday: 0,
            newWeek: 0,
            activeUsers: list.filter((u: any) => u.status === 'active').length,
            inactiveUsers: list.filter((u: any) => u.status === 'deactivated' || u.status === 'inactive').length,
            verifiedUsers: list.filter((u: any) => Boolean(u.emailVerified)).length,
            unverifiedUsers: list.filter((u: any) => !u.emailVerified).length,
            suspendedUsers: list.filter((u: any) => u.status === 'suspended').length,
          });
        }
        if (res.pagination) {
          setPagination(res.pagination);
        } else {
          setPagination({
            page: 1,
            limit: 20,
            total: res.users.length,
            totalPages: 1,
          });
        }
      }
    } catch (err: any) {
      toast.error('Query Notice', err.message || 'Unable to fetch user list.');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedQuery, statusFilter, verifiedFilter, roleFilter, regFrom, regTo, page, toast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Realtime sync on user table updates
  useEffect(() => {
    return subscribeAdminRealtimeEvent((detail) => {
      if (detail.table === 'app_users' || detail.table === 'all') {
        loadUsers();
      }
    });
  }, [loadUsers]);

  // Inspect modal data loaders
  const loadInspectionActivity = useCallback(async (userId: string) => {
    setIsLoadingActivity(true);
    try {
      const res = await adminClient.getUserActivity(userId);
      if (res.success) {
        setUserActivityLogs(res.activity || []);
      }
    } catch (err: any) {
      toast.error('Activity Error', err.message);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [toast]);

  const loadInspectionSessions = useCallback(async (userId: string) => {
    setIsLoadingSessions(true);
    try {
      const res = await adminClient.getUserSessions(userId);
      if (res.success) {
        setUserSessions(res.sessions || []);
      }
    } catch (err: any) {
      toast.error('Sessions Error', err.message);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [toast]);

  const loadInspectionFinancial = useCallback(async (userId: string) => {
    setIsLoadingFinancial(true);
    setFinancialRequiresGrant(false);
    try {
      const res = await adminClient.getUserFinancialData(userId);
      if (res.success) {
        setFinancialData(res.financialData || null);
        setFinancialGrantMeta(res.grant || null);
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('grant') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('403')) {
        setFinancialRequiresGrant(true);
        setFinancialData(null);
        setFinancialGrantMeta(null);
      } else {
        toast.error('Financial Summary Notice', msg);
      }
    } finally {
      setIsLoadingFinancial(false);
    }
  }, [toast]);

  const openUserInspector = useCallback(
    (u: any, defaultTab: 'profile' | 'activity' | 'sessions' | 'financial' = 'profile') => {
      setInspectedUser(u);
      setInspectionTab(defaultTab);
      setUserActivityLogs([]);
      setUserSessions([]);
      setFinancialData(null);
      setFinancialGrantMeta(null);
      setFinancialRequiresGrant(false);
      setGrantReason('');

      loadInspectionActivity(u.id);
      loadInspectionSessions(u.id);
      if (defaultTab === 'financial') {
        loadInspectionFinancial(u.id);
      }
    },
    [loadInspectionActivity, loadInspectionSessions, loadInspectionFinancial]
  );

  // Auto-open focused user when navigated via deep-link / notification
  useEffect(() => {
    if (!focusUserId) return;
    const match = users.find((u) => String(u.id) === String(focusUserId));
    if (match) {
      openUserInspector(match, 'profile');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await adminClient.getUsers({ q: focusUserId, limit: 10 });
        if (cancelled) return;
        const found = (res.users || []).find((u: any) => String(u.id) === String(focusUserId));
        if (found) {
          openUserInspector(found, 'profile');
        }
      } catch {
        // Ignore lookup error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusUserId, users, openUserInspector]);

  const handleCloseInspector = () => {
    setInspectedUser(null);
    onClearFocusUser?.();
  };

  const handleSwitchInspectionTab = (tab: 'profile' | 'activity' | 'sessions' | 'financial') => {
    setInspectionTab(tab);
    if (!inspectedUser) return;
    if (tab === 'activity' && userActivityLogs.length === 0) {
      loadInspectionActivity(inspectedUser.id);
    } else if (tab === 'sessions' && userSessions.length === 0) {
      loadInspectionSessions(inspectedUser.id);
    } else if (tab === 'financial' && !financialData && !financialRequiresGrant) {
      loadInspectionFinancial(inspectedUser.id);
    }
  };

  const handleRequestFinancialAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedUser || !grantReason.trim()) return;
    setIsRequestingGrant(true);
    try {
      const res = await adminClient.requestFinancialAccess({
        targetUserId: inspectedUser.id,
        reason: grantReason.trim(),
        purpose: 'Authorized support & balance inspection',
        dataScopes: ['balance', 'transactions', 'income', 'expense'],
        durationMinutes: 60,
      });
      if (res.success) {
        toast.success(
          'Access Request Submitted',
          'Super Admin approval is required before viewing financial ledger details.'
        );
        setGrantReason('');
      }
    } catch (err: any) {
      toast.error('Request Failed', err.message);
    } finally {
      setIsRequestingGrant(false);
    }
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1600);
    } catch {
      // Clipboard fallback ignored
    }
  };

  // Status Action Confirm
  const handleConfirmStatusChange = async () => {
    if (!pendingStatusAction) return;
    try {
      const res = await adminClient.updateUserStatus(
        pendingStatusAction.user.id,
        pendingStatusAction.newStatus,
        pendingStatusAction.reason
      );
      if (res.success) {
        toast.success('Status Changed', `Account status set to ${pendingStatusAction.newStatus}.`);
        setPendingStatusAction(null);
        await loadUsers();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  // Delete User Confirm
  const handleConfirmDelete = async () => {
    if (!pendingDeleteUser) return;
    try {
      const res = await adminClient.deleteUser(pendingDeleteUser.user.id, pendingDeleteUser.reason);
      if (res.success) {
        toast.success('Account Deleted', 'User account and active sessions permanently purged.');
        setPendingDeleteUser(null);
        if (inspectedUser?.id === pendingDeleteUser.user.id) {
          handleCloseInspector();
        }
        await loadUsers();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleSendResetEmail = async (u: any) => {
    try {
      const res = await adminClient.sendPasswordResetEmail(u.id);
      if (res.success) {
        toast.success('Reset Email Dispatched', `Password reset link dispatched directly to ${u.email}`);
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleForcePasswordReset = async (u: any) => {
    try {
      const res = await adminClient.forcePasswordReset(u.id);
      if (res.success) {
        toast.success('Force Reset Activated', 'User must set a new password upon next login.');
        await loadUsers();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleRevokeSessions = async (u: any) => {
    try {
      const res = await adminClient.revokeUserSessions(u.id);
      if (res.success) {
        toast.success('Sessions Terminated', 'All active devices were logged out.');
        await loadUsers();
        if (inspectedUser?.id === u.id) {
          loadInspectionSessions(u.id);
        }
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setStatusFilter('all');
    setVerifiedFilter('all');
    setRoleFilter('all');
    setRegFrom('');
    setRegTo('');
    setPage(1);
  };

  const kpiCards = [
    {
      key: 'total',
      label: 'Total Users',
      value: summary.totalUsers,
      accent: 'text-slate-900 dark:text-slate-100',
      active: statusFilter === 'all' && verifiedFilter === 'all',
      onClick: resetAllFilters,
    },
    {
      key: 'newToday',
      label: 'New Today',
      value: summary.newToday,
      accent: 'text-emerald-600 dark:text-emerald-400',
      active: false,
      onClick: () => {
        const today = new Date().toISOString().split('T')[0];
        setRegFrom(today);
        setRegTo(today);
        setPage(1);
      },
    },
    {
      key: 'newWeek',
      label: 'New This Week',
      value: summary.newWeek,
      accent: 'text-sky-600 dark:text-sky-400',
      active: false,
      onClick: () => {
        const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        setRegFrom(d);
        setRegTo('');
        setPage(1);
      },
    },
    {
      key: 'active',
      label: 'Active',
      value: summary.activeUsers,
      accent: 'text-emerald-600 dark:text-emerald-400',
      active: statusFilter === 'active',
      onClick: () => {
        setStatusFilter((prev) => (prev === 'active' ? 'all' : 'active'));
        setPage(1);
      },
    },
    {
      key: 'inactive',
      label: 'Inactive',
      value: summary.inactiveUsers,
      accent: 'text-slate-600 dark:text-slate-300',
      active: statusFilter === 'deactivated',
      onClick: () => {
        setStatusFilter((prev) => (prev === 'deactivated' ? 'all' : 'deactivated'));
        setPage(1);
      },
    },
    {
      key: 'verified',
      label: 'Verified',
      value: summary.verifiedUsers,
      accent: 'text-emerald-600 dark:text-emerald-400',
      active: verifiedFilter === 'verified',
      onClick: () => {
        setVerifiedFilter((prev) => (prev === 'verified' ? 'all' : 'verified'));
        setPage(1);
      },
    },
    {
      key: 'unverified',
      label: 'Unverified',
      value: summary.unverifiedUsers,
      accent: 'text-amber-600 dark:text-amber-400',
      active: verifiedFilter === 'unverified',
      onClick: () => {
        setVerifiedFilter((prev) => (prev === 'unverified' ? 'all' : 'unverified'));
        setPage(1);
      },
    },
    {
      key: 'suspended',
      label: 'Suspended',
      value: summary.suspendedUsers,
      accent: 'text-rose-600 dark:text-rose-400',
      active: statusFilter === 'suspended',
      onClick: () => {
        setStatusFilter((prev) => (prev === 'suspended' ? 'all' : 'suspended'));
        setPage(1);
      },
    },
  ];

  const hasActiveFilters = Boolean(
    debouncedQuery || statusFilter !== 'all' || verifiedFilter !== 'all' || roleFilter !== 'all' || regFrom || regTo
  );

  const startIndex = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endIndex = Math.min(pagination.total, pagination.page * pagination.limit);

  return (
    <div className="space-y-5">
      {/* Live KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
              card.active
                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700/60'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
              {card.label}
            </p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${card.accent}`}>
              {card.value}
            </p>
          </button>
        ))}
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, user ID, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by account status"
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Inactive / Deactivated</option>
            </select>

            <select
              value={verifiedFilter}
              onChange={(e) => {
                setVerifiedFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by verification status"
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Verification</option>
              <option value="verified">Email Verified</option>
              <option value="unverified">Unverified</option>
            </select>

            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by role"
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Roles</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
              <option value="support">Support</option>
              <option value="analyst">Analyst</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium">
              <Calendar className="w-3.5 h-3.5" />
              Registered:
            </span>
            <input
              type="date"
              value={regFrom}
              onChange={(e) => {
                setRegFrom(e.target.value);
                setPage(1);
              }}
              aria-label="Registration start date"
              className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={regTo}
              onChange={(e) => {
                setRegTo(e.target.value);
                setPage(1);
              }}
              aria-label="Registration end date"
              className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
            />
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Clear Filters
              </button>
            )}
            <button
              type="button"
              onClick={loadUsers}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Users Directory Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <Users className="w-4 h-4 text-emerald-600" />
            <span>
              Registered Users ({pagination.total} matching)
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Balances displayed only with an active approved financial access grant
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-3">Verification</th>
                <th className="py-3 px-3">Status &amp; Role</th>
                <th className="py-3 px-3">Registered</th>
                <th className="py-3 px-3">Last Active</th>
                <th className="py-3 px-3">Activity</th>
                <th className="py-3 px-3">Authorized Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    Loading user directory...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    No users match the selected search or filter criteria.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const initials = (u.fullName || u.email || 'U').charAt(0).toUpperCase();
                  const shortId = String(u.id || '').slice(0, 10);
                  const lastActiveSource = u.lastActiveAt || u.lastLoginAt;

                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* User Identity + Avatar + ID */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3 min-w-[210px]">
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt={u.fullName || u.email || 'User avatar'}
                              className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openUserInspector(u, 'profile')}
                              className="font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 truncate block text-left cursor-pointer"
                            >
                              {u.fullName || 'Unnamed User'}
                            </button>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                              {u.email}
                            </p>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                              <span className="font-mono">ID: {shortId}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyId(u.id)}
                                title="Copy full User ID"
                                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                              >
                                {copiedId === u.id ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                              {u.phone && <span>&middot; {u.phone}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Real Verification Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {u.emailVerified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verified</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Unverified</span>
                          </span>
                        )}
                      </td>

                      {/* Account Status & Role */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize ${
                              u.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : u.status === 'suspended'
                                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {u.status || 'active'}
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-medium">
                            {u.role || 'user'}
                          </p>
                        </div>
                      </td>

                      {/* Registered */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap text-[11px] tabular-nums">
                        {u.createdAt ? formatDisplayDate(String(u.createdAt).split('T')[0]) : '—'}
                      </td>

                      {/* Last Active */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap text-[11px] tabular-nums">
                        {lastActiveSource ? formatDisplayDate(String(lastActiveSource).split('T')[0]) : 'Never'}
                      </td>

                      {/* Transaction Count & Active Sessions */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                            {u.transactionCount ?? 0} txns
                          </p>
                          <button
                            type="button"
                            onClick={() => openUserInspector(u, 'sessions')}
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Laptop className="w-3 h-3" />
                            <span className="tabular-nums">{u.activeSessionsCount || 0} sessions</span>
                          </button>
                        </div>
                      </td>

                      {/* Authorized Balance */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {u.balanceAuthorized && u.availableBalance !== null && u.availableBalance !== undefined ? (
                          <button
                            type="button"
                            onClick={() => openUserInspector(u, 'financial')}
                            className="text-left font-semibold text-emerald-700 dark:text-emerald-300 hover:underline tabular-nums cursor-pointer"
                          >
                            {formatINR(Number(u.availableBalance))}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openUserInspector(u, 'financial')}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                            title="Balance requires an approved financial data access grant"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Grant required</span>
                          </button>
                        )}
                      </td>

                      {/* Administrative Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openUserInspector(u, 'profile')}
                            title="View Complete Authorized User Profile"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => openUserInspector(u, 'activity')}
                            title="View Safe User Activity History"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <Activity className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSendResetEmail(u)}
                            title="Send Password Reset Email"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleForcePasswordReset(u)}
                            title="Force Password Reset on Next Login"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-800 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRevokeSessions(u)}
                            title="Revoke All Active Sessions"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-800 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>

                          {u.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingStatusAction({
                                  user: u,
                                  newStatus: 'suspended',
                                  reason: 'Administrative suspension',
                                })
                              }
                              title="Suspend User Account"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingStatusAction({
                                  user: u,
                                  newStatus: 'active',
                                  reason: 'Administrative restoration',
                                })
                              }
                              title="Restore User Account"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-600 dark:bg-slate-800 dark:hover:bg-emerald-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setPendingDeleteUser({ user: u, reason: 'Requested by administrator' })}
                            title="Delete User Permanently"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular-nums">
            Showing {startIndex}&ndash;{endIndex} of {pagination.total} users
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-2 font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Complete Authorized User Inspection Modal */}
      {inspectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {inspectedUser.avatarUrl ? (
                  <img
                    src={inspectedUser.avatarUrl}
                    alt={inspectedUser.fullName || inspectedUser.email}
                    className="w-11 h-11 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center justify-center font-bold text-sm shrink-0">
                    {(inspectedUser.fullName || inspectedUser.email || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                    {inspectedUser.fullName || 'Unnamed User'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                    {inspectedUser.email} &middot; {inspectedUser.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseInspector}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspection Tabs */}
            <div className="px-6 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
              {[
                { key: 'profile', label: 'Profile Overview', icon: Shield },
                { key: 'activity', label: `Activity (${userActivityLogs.length})`, icon: Activity },
                { key: 'sessions', label: `Sessions (${userSessions.length || inspectedUser.activeSessionsCount || 0})`, icon: Laptop },
                { key: 'financial', label: 'Authorized Summary', icon: Wallet },
              ].map((t) => {
                const Icon = t.icon;
                const active = inspectionTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => handleSwitchInspectionTab(t.key as any)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {inspectionTab === 'profile' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Account Status</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 capitalize mt-0.5">
                      {inspectedUser.status || 'active'} &middot; Role: {inspectedUser.role || 'user'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Email Verification</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {inspectedUser.emailVerified ? 'Verified' : 'Unverified'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Registered At</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {inspectedUser.createdAt ? new Date(inspectedUser.createdAt).toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Last Active / Login</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {inspectedUser.lastActiveAt || inspectedUser.lastLoginAt
                        ? new Date(inspectedUser.lastActiveAt || inspectedUser.lastLoginAt).toLocaleString()
                        : 'Never'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Phone &amp; Failed Logins</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {inspectedUser.phone || 'Not provided'} &middot; {inspectedUser.failedLoginAttempts ?? 0} failed logins
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400">Ledger Activity &amp; Sessions</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {inspectedUser.transactionCount ?? 0} transactions &middot; {inspectedUser.activeSessionsCount ?? 0} active sessions
                    </p>
                  </div>
                </div>
              )}

              {inspectionTab === 'activity' && (
                <div className="space-y-2.5">
                  {isLoadingActivity ? (
                    <div className="p-8 text-center text-xs text-slate-400">Loading activity logs...</div>
                  ) : userActivityLogs.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">No recorded activity logs found.</p>
                  ) : (
                    userActivityLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 text-xs flex justify-between items-start gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{log.event_type}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            IP: {log.ip_address || 'Internal'} &middot; Role: {log.actor_role || 'user'}
                          </p>
                          {log.details && Object.keys(log.details).length > 0 && (
                            <p className="text-[11px] font-mono text-slate-500 mt-1 break-all">
                              {JSON.stringify(log.details)}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectionTab === 'sessions' && (
                <div className="space-y-2.5">
                  {isLoadingSessions ? (
                    <div className="p-8 text-center text-xs text-slate-400">Loading sessions...</div>
                  ) : userSessions.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">No session history found.</p>
                  ) : (
                    userSessions.map((s) => (
                      <div
                        key={s.id}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 text-xs flex justify-between items-center gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {s.user_agent || 'Web Browser Session'}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            IP: {s.ip_address || 'Unknown'} &middot; Last Active: {new Date(s.last_active_at).toLocaleString()}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0 ${
                            s.is_revoked
                              ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {s.is_revoked ? 'Revoked' : 'Active'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectionTab === 'financial' && (
                <div className="space-y-4">
                  {isLoadingFinancial ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      Checking authorized financial data grant...
                    </div>
                  ) : financialRequiresGrant ? (
                    <form
                      onSubmit={handleRequestFinancialAccess}
                      className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Financial Data Grant Required
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            User balances and transaction summaries are strictly gated. Submit a justification below to request temporary approved access.
                          </p>
                        </div>
                      </div>
                      <input
                        type="text"
                        required
                        value={grantReason}
                        onChange={(e) => setGrantReason(e.target.value)}
                        placeholder="Reason for inspection (e.g., investigating support ticket or failed payment)..."
                        className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={isRequestingGrant}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          {isRequestingGrant ? 'Submitting...' : 'Request Financial Access'}
                        </button>
                      </div>
                    </form>
                  ) : financialData ? (
                    <div className="space-y-4">
                      {financialGrantMeta && (
                        <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-xs flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                            Authorized Access Active ({financialGrantMeta.minutesRemaining ?? 60} min remaining)
                          </span>
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                            Logged in financial access audit trail
                          </span>
                        </div>
                      )}

                      {financialData.summary && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <p className="text-[11px] text-slate-400">Net Balance</p>
                            <p className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                              {formatINR(Number(financialData.summary.netBalance || 0))}
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <p className="text-[11px] text-slate-400">Total Income</p>
                            <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">
                              {formatINR(Number(financialData.summary.totalIncome || 0))}
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <p className="text-[11px] text-slate-400">Total Expense</p>
                            <p className="text-base font-bold text-rose-600 dark:text-rose-400 mt-0.5 tabular-nums">
                              {formatINR(Number(financialData.summary.totalExpense || 0))}
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <p className="text-[11px] text-slate-400">Transactions</p>
                            <p className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                              {financialData.summary.transactionCount ?? 0}
                            </p>
                          </div>
                        </div>
                      )}

                      {Array.isArray(financialData.transactions) && financialData.transactions.length > 0 && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                          <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                            Recent Authorized Transactions (up to 10 shown)
                          </div>
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {financialData.transactions.slice(0, 10).map((tx: any) => (
                              <div key={tx.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                    {tx.title || tx.category}
                                  </p>
                                  <p className="text-[11px] text-slate-400">
                                    {tx.category} &middot; {tx.transaction_date} &middot; {tx.payment_method || 'UPI'}
                                  </p>
                                </div>
                                <span
                                  className={`font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                                    tx.transaction_type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                                  }`}
                                >
                                  {tx.transaction_type === 'income' ? '+' : '-'}
                                  {formatINR(Number(tx.amount || 0))}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-6">No authorized financial records returned.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Confirmation Modal */}
      {pendingStatusAction && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Confirm Account {pendingStatusAction.newStatus === 'suspended' ? 'Suspension' : 'Restoration'}
            </h3>
            <p className="text-xs text-slate-500">
              Target:{' '}
              <span className="font-bold font-mono text-slate-800 dark:text-slate-200">
                {pendingStatusAction.user.email}
              </span>
            </p>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Administrative Reason *</label>
              <input
                type="text"
                placeholder="Reason for status change..."
                value={pendingStatusAction.reason}
                onChange={(e) =>
                  setPendingStatusAction({ ...pendingStatusAction, reason: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingStatusAction(null)}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusChange}
                className={`flex-1 py-2 rounded-xl text-white text-xs font-bold cursor-pointer ${
                  pendingStatusAction.newStatus === 'suspended' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Confirm {pendingStatusAction.newStatus === 'suspended' ? 'Suspension' : 'Restoration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {pendingDeleteUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-rose-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Permanently Delete User Account</span>
            </h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to permanently purge account{' '}
              <span className="font-mono font-bold">{pendingDeleteUser.user.email}</span>? This action is irreversible.
            </p>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Reason for Deletion *</label>
              <input
                type="text"
                placeholder="Required deletion reason for audit log..."
                value={pendingDeleteUser.reason}
                onChange={(e) =>
                  setPendingDeleteUser({ ...pendingDeleteUser, reason: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteUser(null)}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
