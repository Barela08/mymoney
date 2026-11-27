import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  UserCheck,
  UserX,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { ConfirmModal } from '../../common/ConfirmModal';

interface AdminAccount {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: string;
  role_slug?: string | null;
  status: string;
  custom_permissions?: string[];
  created_at: string;
  last_login_at?: string | null;
  avatar_url?: string | null;
  active_sessions_count: number;
}

export const AdminAccountsTab: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const isSuperAdmin = Boolean(
    user?.email &&
    (user.email.toLowerCase().trim() === 'hackifypro@gmail.com' ||
     user.email.toLowerCase().trim() === 'admin@mymoney.com' ||
     (user as any).role === 'superadmin')
  );

  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [availableRoles, setAvailableRoles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Add / Assign Admin Modal
  const [isAssignModalOpen, setIsAssignModalOpen] = useState<boolean>(false);
  const [assignEmail, setAssignEmail] = useState<string>('');
  const [assignRole, setAssignRole] = useState<string>('support');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [pendingRevokeAdmin, setPendingRevokeAdmin] = useState<AdminAccount | null>(null);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);

  const fetchAdmins = async () => {
    setIsLoading(true);
    try {
      const [admRes, roleRes] = await Promise.all([
        adminClient.getAdmins(),
        adminClient.getAdminRoles(),
      ]);

      if (admRes.success && Array.isArray(admRes.admins)) {
        setAdmins(admRes.admins);
      }
      if (roleRes.success && Array.isArray(roleRes.roles)) {
        setAvailableRoles(roleRes.roles);
      }
    } catch (err: any) {
      toast.error('Failed to load administrators', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleAssignAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignEmail.trim() || !assignEmail.includes('@')) {
      toast.error('Validation Error', 'Valid user email is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminClient.assignAdmin({
        email: assignEmail.trim(),
        role: assignRole,
      });

      if (res.success) {
        toast.success('Admin Privileges Granted', res.message);
        setIsAssignModalOpen(false);
        setAssignEmail('');
        fetchAdmins();
      }
    } catch (err: any) {
      toast.error('Assignment Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeAdmin = (adminAccount: AdminAccount) => {
    const isOwner =
      adminAccount.email.toLowerCase() === 'hackifypro@gmail.com' ||
      adminAccount.email.toLowerCase() === 'admin@mymoney.com';

    if (isOwner) {
      toast.error('Operation Blocked', 'The primary owner account cannot be demoted or revoked.');
      return;
    }

    setPendingRevokeAdmin(adminAccount);
  };

  const confirmRevokeAdmin = async () => {
    if (!pendingRevokeAdmin || isRevoking) return;
    try {
      setIsRevoking(true);
      const res = await adminClient.revokeAdmin(pendingRevokeAdmin.id);
      if (res.success) {
        toast.success('Privileges Revoked', res.message);
        setPendingRevokeAdmin(null);
        fetchAdmins();
      }
    } catch (err: any) {
      toast.error('Revocation Failed', err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  const filteredAdmins = admins.filter((a) => {
    const q = searchQuery.toLowerCase();
    return (
      a.email.toLowerCase().includes(q) ||
      (a.full_name || '').toLowerCase().includes(q) ||
      (a.role || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
              <Shield className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Multi-Admin Staff Accounts
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  {admins.length} Assigned Staff
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Configure authorized administration staff. Roles dictate module visibility and API capabilities. Super Administrator retains emergency master authority.
              </p>
            </div>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => setIsAssignModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-colors shrink-0 cursor-pointer shadow-sm shadow-emerald-600/20"
            >
              <Plus className="w-4 h-4 stroke-[2]" />
              <span>Assign Staff Role</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search admin name, email, role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <button
          onClick={fetchAdmins}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Staff Accounts Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role & Level</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Active Sessions</th>
                <th className="py-3 px-4">Last Active</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <div className="inline-flex items-center gap-2 text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                      <span>Loading admin directory...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredAdmins.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500">
                    No administrators found matching query.
                  </td>
                </tr>
              ) : (
                filteredAdmins.map((adm) => {
                  const isOwner =
                    adm.email.toLowerCase() === 'hackifypro@gmail.com' ||
                    adm.email.toLowerCase() === 'admin@mymoney.com';
                  const isSuper = adm.role === 'superadmin';

                  return (
                    <tr key={adm.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {adm.avatar_url ? (
                            <img
                              src={adm.avatar_url}
                              alt={adm.full_name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-white text-xs">
                              {(adm.full_name || adm.email).charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-white flex items-center gap-1.5">
                              {adm.full_name || 'Staff User'}
                              {isOwner && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>Owner</span>
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">{adm.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                          isSuper
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : adm.role === 'admin'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : adm.role === 'support'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          <ShieldCheck className="w-3 h-3" />
                          <span className="capitalize">{adm.role}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          adm.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {adm.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-slate-300">{adm.active_sessions_count} device(s)</span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {adm.last_login_at
                          ? new Date(adm.last_login_at).toLocaleDateString('en-IN')
                          : 'Never'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isSuperAdmin && !isOwner && adm.id !== user?.id && (
                          <button
                            onClick={() => handleRevokeAdmin(adm)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 font-medium text-xs transition-colors cursor-pointer"
                            title="Revoke Admin Access"
                          >
                            Revoke
                          </button>
                        )}
                        {isOwner && (
                          <span className="text-[11px] text-slate-500 italic">Protected</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ASSIGN ADMIN MODAL */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <span>Assign Staff Administration Role</span>
              </h3>
              <button
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Registered User Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  User must already possess an account in My Money Manager.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Administrative Role
                </label>
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="admin">Operations Administrator</option>
                  <option value="support">Customer Support Specialist</option>
                  <option value="analyst">Business Analyst (Read-Only)</option>
                  {availableRoles
                    .filter((r) => !['superadmin', 'admin', 'support', 'analyst'].includes(r.slug))
                    .map((r) => (
                      <option key={r.slug} value={r.slug}>
                        Custom: {r.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Granting...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingRevokeAdmin}
        title="Revoke Admin Privileges?"
        subtitle="Active administrative sessions will be terminated immediately."
        message={`Revoke administrative privileges for ${pendingRevokeAdmin?.email || ''}? They will return to ordinary user status and their active sessions will be terminated.`}
        confirmLabel="Revoke Access"
        isDestructive={true}
        isLoading={isRevoking}
        onConfirm={confirmRevokeAdmin}
        onCancel={() => !isRevoking && setPendingRevokeAdmin(null)}
      />
    </div>
  );
};
