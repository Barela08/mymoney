import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
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
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';
import { formatDisplayDate } from '../../../lib/dateUtils';

interface AdminUsersTabProps {
  initialStatusFilter?: string;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({ initialStatusFilter = 'all' }) => {
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [roleFilter, setRoleFilter] = useState<string>('all');

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  // Modals
  const [selectedUserForActivity, setSelectedUserForActivity] = useState<any>(null);
  const [userActivityLogs, setUserActivityLogs] = useState<any[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);

  const [selectedUserForSessions, setSelectedUserForSessions] = useState<any>(null);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

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

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getUsers(searchQuery, statusFilter);
      if (res.success && Array.isArray(res.users)) {
        setUsers(res.users);
      }
    } catch (err: any) {
      toast.error('Query Notice', err.message || 'Unable to fetch user list.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [statusFilter]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        u.email?.toLowerCase().includes(q) ||
        u.fullName?.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q);

      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  // Open Activity Modal
  const handleOpenActivity = async (u: any) => {
    setSelectedUserForActivity(u);
    setIsLoadingActivity(true);
    try {
      const res = await adminClient.getUserActivity(u.id);
      if (res.success) {
        setUserActivityLogs(res.activity || []);
      }
    } catch (err: any) {
      toast.error('Activity Error', err.message);
    } finally {
      setIsLoadingActivity(false);
    }
  };

  // Open Sessions Modal
  const handleOpenSessions = async (u: any) => {
    setSelectedUserForSessions(u);
    setIsLoadingSessions(true);
    try {
      const res = await adminClient.getUserSessions(u.id);
      if (res.success) {
        setUserSessions(res.sessions || []);
      }
    } catch (err: any) {
      toast.error('Sessions Error', err.message);
    } finally {
      setIsLoadingSessions(false);
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
        await loadUsers();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  // Send Reset Email
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

  // Force Password Reset
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

  // Revoke Sessions
  const handleRevokeSessions = async (u: any) => {
    try {
      const res = await adminClient.revokeUserSessions(u.id);
      if (res.success) {
        toast.success('Sessions Terminated', 'All active devices were logged out.');
        await loadUsers();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Filters Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by full name, registered email address, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Accounts</option>
              <option value="suspended">Suspended Accounts</option>
              <option value="deactivated">Deactivated Accounts</option>
            </select>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            >
              <option value="all">All Roles</option>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
              <option value="superadmin">Super Administrator</option>
              <option value="support">Support Specialist</option>
              <option value="analyst">Analyst</option>
            </select>

            <button
              onClick={loadUsers}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
              title="Refresh User Directory"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-bold text-slate-700 dark:text-slate-300">
            Registered Users Directory ({filteredUsers.length} Found)
          </span>
          <span className="text-[11px] text-slate-400">Financial privacy enforced (Zero ledger leaks)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3.5">User Identity</th>
                <th className="p-3.5">Role & Status</th>
                <th className="p-3.5">Verification</th>
                <th className="p-3.5">Registered</th>
                <th className="p-3.5">Last Login</th>
                <th className="p-3.5">Active Sessions</th>
                <th className="p-3.5 text-right">Administrative Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No users matching criteria found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                          {(u.fullName || u.email || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-800 dark:text-slate-200">{u.fullName || 'User'}</p>
                          <p className="text-[11px] font-mono text-slate-400">{u.email}</p>
                          {u.phone && <p className="text-[10px] text-slate-400">{u.phone}</p>}
                        </div>
                      </div>
                    </td>

                    <td className="p-3.5">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            u.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          ● {u.status}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">{u.role}</span>
                      </div>
                    </td>

                    <td className="p-3.5">
                      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Verified</span>
                      </span>
                    </td>

                    <td className="p-3.5 text-slate-500 whitespace-nowrap text-[11px]">
                      {u.createdAt ? formatDisplayDate(u.createdAt.split('T')[0]) : 'Recent'}
                    </td>

                    <td className="p-3.5 text-slate-500 whitespace-nowrap text-[11px]">
                      {u.lastLoginAt ? formatDisplayDate(u.lastLoginAt.split('T')[0]) : 'Never'}
                    </td>

                    <td className="p-3.5">
                      <button
                        onClick={() => handleOpenSessions(u)}
                        className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <Laptop className="w-3.5 h-3.5" />
                        <span>{u.activeSessionsCount || 0} Sessions</span>
                      </button>
                    </td>

                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Activity */}
                        <button
                          onClick={() => handleOpenActivity(u)}
                          title="View Safe User Activity History"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          <Activity className="w-3.5 h-3.5" />
                        </button>

                        {/* Send Reset Email */}
                        <button
                          onClick={() => handleSendResetEmail(u)}
                          title="Dispatch Password Reset Email to User"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>

                        {/* Force Password Reset */}
                        <button
                          onClick={() => handleForcePasswordReset(u)}
                          title="Flag Force Password Reset (Revokes Sessions)"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-800 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        {/* Revoke Sessions */}
                        <button
                          onClick={() => handleRevokeSessions(u)}
                          title="Revoke All User Sessions Immediately"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-800 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>

                        {/* Suspend / Restore */}
                        {u.status === 'active' ? (
                          <button
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

                        {/* Delete User */}
                        <button
                          onClick={() => setPendingDeleteUser({ user: u, reason: 'Requested by administrator' })}
                          title="Delete User Permanently"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Activity Modal */}
      {selectedUserForActivity && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  User Safe Activity History
                </h3>
                <p className="text-xs text-slate-400 font-mono">{selectedUserForActivity.email}</p>
              </div>
              <button
                onClick={() => setSelectedUserForActivity(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {isLoadingActivity ? (
                <div className="p-8 text-center text-xs text-slate-400 animate-pulse">Loading activity trail...</div>
              ) : userActivityLogs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No recorded activity logs found.</p>
              ) : (
                userActivityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs flex justify-between items-start"
                  >
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">{log.event_type}</p>
                      <p className="text-[11px] text-slate-400">IP: {log.ip_address || 'Internal'}</p>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <p className="text-[10px] font-mono text-slate-500 mt-1">{JSON.stringify(log.details)}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Sessions Modal */}
      {selectedUserForSessions && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Active & Historical Sessions</h3>
                <p className="text-xs text-slate-400 font-mono">{selectedUserForSessions.email}</p>
              </div>
              <button
                onClick={() => setSelectedUserForSessions(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {isLoadingSessions ? (
                <div className="p-8 text-center text-xs text-slate-400 animate-pulse">Loading sessions...</div>
              ) : userSessions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No active sessions found.</p>
              ) : (
                userSessions.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs flex justify-between items-center"
                  >
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {s.user_agent ? s.user_agent.slice(0, 40) + '...' : 'Web Browser Session'}
                      </p>
                      <p className="text-[11px] text-slate-400">IP: {s.ip_address || 'Unknown'}</p>
                      <p className="text-[10px] text-slate-400">
                        Last Active: {new Date(s.last_active_at).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.is_revoked ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {s.is_revoked ? 'Revoked' : 'Active'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Confirmation Modal */}
      {pendingStatusAction && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Confirm Account {pendingStatusAction.newStatus === 'suspended' ? 'Suspension' : 'Restoration'}
            </h3>
            <p className="text-xs text-slate-500">
              Target: <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{pendingStatusAction.user.email}</span>
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
                onClick={() => setPendingStatusAction(null)}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmStatusChange}
                className={`flex-1 py-2 rounded-xl text-white text-xs font-bold ${
                  pendingStatusAction.newStatus === 'suspended' ? 'bg-rose-600' : 'bg-emerald-600'
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
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-rose-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Permanently Delete User Account</span>
            </h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to permanently purge account <span className="font-mono font-bold">{pendingDeleteUser.user.email}</span>? This action is irreversible.
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
                onClick={() => setPendingDeleteUser(null)}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20"
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
