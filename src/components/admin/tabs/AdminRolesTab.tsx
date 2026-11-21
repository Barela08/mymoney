import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  Lock,
  RefreshCw,
  Edit3,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

const ALL_PERMISSIONS = [
  { key: 'users.read', label: 'View User Directory', category: 'Users' },
  { key: 'users.update', label: 'Edit User Account Details', category: 'Users' },
  { key: 'users.suspend', label: 'Suspend User Access', category: 'Users' },
  { key: 'users.restore', label: 'Restore Suspended User', category: 'Users' },
  { key: 'users.sessions.revoke', label: 'Revoke User Active Sessions', category: 'Users' },
  { key: 'users.delete', label: 'Permanent Account Purge', category: 'Users' },

  { key: 'security.read', label: 'View Security Incidents & Logins', category: 'Security' },
  { key: 'security.manage', label: 'Manage & Resolve Incidents', category: 'Security' },

  { key: 'deletions.read', label: 'Monitor 24-Hour Deletions', category: 'Account Lifecycle' },
  { key: 'deletions.retry', label: 'Cancel or Retry Deletions', category: 'Account Lifecycle' },

  { key: 'emails.read', label: 'View Email Dispatch Logs', category: 'Communications' },
  { key: 'emails.templates.manage', label: 'Edit & Test Email Templates', category: 'Communications' },
  { key: 'notifications.manage', label: 'Broadcast System Announcements', category: 'Communications' },

  { key: 'support.read', label: 'Read Support Tickets & Feedback', category: 'Support' },
  { key: 'support.reply', label: 'Reply to User Inquiries', category: 'Support' },

  { key: 'legal.read', label: 'Read Compliance Policies', category: 'Compliance' },
  { key: 'legal.manage', label: 'Publish & Rollback Policies', category: 'Compliance' },

  { key: 'analytics.read', label: 'View Aggregated Metrics', category: 'Intelligence' },
  { key: 'reports.export', label: 'Export Anonymized Reports', category: 'Intelligence' },

  { key: 'system.read', label: 'Monitor System & Database Health', category: 'Infrastructure' },
  { key: 'backups.manage', label: 'Trigger Database Snapshots', category: 'Infrastructure' },

  { key: 'audit.read', label: 'Inspect Security Audit Ledger', category: 'Administration' },
  { key: 'settings.manage', label: 'Manage App Settings & Maintenance', category: 'Administration' },
  { key: 'roles.manage', label: 'Administer RBAC Roles & Permissions', category: 'Administration' },
  { key: 'features.manage', label: 'Toggle Feature Availability', category: 'Administration' },
];

export const AdminRolesTab: React.FC = () => {
  const toast = useToast();
  const [roles, setRoles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit Role Modal
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [roleDescription, setRoleDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadRoles = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getAdminRoles();
      if (res.success && Array.isArray(res.roles)) {
        setRoles(res.roles);
      }
    } catch (err: any) {
      toast.error('Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const handleOpenEdit = (role: any) => {
    setSelectedRole(role);
    setSelectedPermissions(role.permissions || []);
    setRoleDescription(role.description || '');
  };

  const handleTogglePermission = (permKey: string) => {
    if (selectedPermissions.includes(permKey)) {
      setSelectedPermissions(selectedPermissions.filter((p) => p !== permKey));
    } else {
      setSelectedPermissions([...selectedPermissions, permKey]);
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;

    setIsSaving(true);
    try {
      const res = await adminClient.updateAdminRole(selectedRole.id, {
        permissions: selectedPermissions,
        description: roleDescription,
      });

      if (res.success) {
        toast.success('Role Updated', 'Role permissions updated and recorded in audit log.');
        setSelectedRole(null);
        await loadRoles();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span>Role-Based Access Control (RBAC) Architecture</span>
          </h3>
          <p className="text-xs text-slate-400">
            Enforced server-side. Zero client-side trust or hidden button bypasses.
          </p>
        </div>

        <button
          onClick={loadRoles}
          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map((r) => {
          const isSuperAdmin = r.slug === 'superadmin';
          const permList = isSuperAdmin ? ['* (All Platform Capabilities)'] : (r.permissions || []);
          return (
            <div
              key={r.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    {r.slug}
                  </span>
                  {r.is_system && (
                    <span className="text-[10px] font-bold text-slate-400 font-mono">System Built-In</span>
                  )}
                </div>

                <h4 className="font-bold text-base text-slate-900 dark:text-slate-100 mt-2">{r.name}</h4>
                <p className="text-xs text-slate-500 mt-1">{r.description}</p>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Granted Permissions ({permList.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    {permList.map((p: string) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-slate-700 dark:text-slate-300 font-bold"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {!isSuperAdmin && (
                <button
                  onClick={() => handleOpenEdit(r)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Configure Permissions</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Permissions Edit Modal */}
      {selectedRole && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Configure Permissions: {selectedRole.name}
                </h3>
                <p className="text-xs text-slate-400">Slug: {selectedRole.slug}</p>
              </div>
              <button onClick={() => setSelectedRole(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Role Description</label>
                <input
                  type="text"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-2">
                  Granular Permissions Matrix ({selectedPermissions.length} Enabled)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-100 dark:border-slate-800 p-3 rounded-2xl max-h-72 overflow-y-auto">
                  {ALL_PERMISSIONS.map((perm) => {
                    const isChecked = selectedPermissions.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-start gap-2 p-2 rounded-xl text-xs cursor-pointer border transition-colors ${
                          isChecked
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-slate-900 dark:text-slate-100'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-transparent text-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleTogglePermission(perm.key)}
                          className="mt-0.5 rounded text-emerald-600"
                        />
                        <div>
                          <p className="font-bold font-mono text-[11px]">{perm.key}</p>
                          <p className="text-[10px] text-slate-400">{perm.label}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRole(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20"
                >
                  {isSaving ? 'Saving...' : 'Save Role Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
