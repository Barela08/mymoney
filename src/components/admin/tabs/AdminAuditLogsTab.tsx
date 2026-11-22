import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Search,
  RefreshCw,
  Filter,
  Download,
  Eye,
  ShieldAlert,
  ShieldCheck,
  Clock,
  User,
  X,
  ChevronLeft,
  ChevronRight,
  Database,
  Lock,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminAuditLogsTab: React.FC = () => {
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 25;

  // Detail Modal
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getAuditLogs({
        q: searchQuery,
        role: roleFilter,
        event_type: eventTypeFilter,
        limit,
        offset: (page - 1) * limit,
      });

      if (res.success) {
        setLogs(res.logs || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error('Audit Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [searchQuery, roleFilter, eventTypeFilter, page]);

  const handleExportCSV = () => {
    if (logs.length === 0) {
      toast.error('No Logs', 'There are no audit logs to export.');
      return;
    }

    const headers = ['ID', 'Timestamp', 'Event Type', 'Actor Email', 'Actor Role', 'IP Address', 'Details'];
    const rows = logs.map((l) => [
      `"${l.id}"`,
      `"${l.created_at}"`,
      `"${l.event_type}"`,
      `"${l.user_email || ''}"`,
      `"${l.actor_role || ''}"`,
      `"${l.ip_address || ''}"`,
      `"${JSON.stringify(l.details || {}).replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `mymoney-audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Export Ready', 'Audit trail exported to CSV.');
  };

  const getEventBadge = (type: string) => {
    if (type.includes('FAIL') || type.includes('SUSPEND') || type.includes('REVOKE') || type.includes('DELETE')) {
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (type.includes('UPDATE') || type.includes('WARNING') || type.includes('RESET')) {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="space-y-6">
      {/* Immutability Banner */}
      <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/40 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-indigo-600 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
              Tamper-Evident Immutable System Audit Log
            </p>
            <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
              All events are persisted server-side with strict append-only constraints. Records cannot be modified or deleted by ordinary administrators.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-indigo-600 text-white rounded-full">
          Append-Only Trail
        </span>
      </div>

      {/* Header Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider mb-1">
            <FileCode className="w-4 h-4" />
            Compliance & Accountability
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Administrative Audit Trail</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cryptographically stamped chronological ledger of system operations, user status alterations, and security actions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadLogs}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-100 dark:text-slate-900 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Audit Trail (CSV)
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by event type, actor email, IP or details..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Roles</option>
            <option value="superadmin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="support">Support Specialist</option>
            <option value="analyst">Analyst</option>
            <option value="system">System Daemon</option>
          </select>

          <select
            value={eventTypeFilter}
            onChange={(e) => {
              setEventTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Event Types</option>
            <option value="USER_LOGIN_SUCCESS">Login Success</option>
            <option value="USER_LOGIN_FAILED">Login Failed</option>
            <option value="USER_REGISTERED">User Registered</option>
            <option value="USER_SUSPENDED">User Suspended</option>
            <option value="USER_RESTORED">User Restored</option>
            <option value="USER_SESSIONS_REVOKED">Sessions Revoked</option>
            <option value="USER_ROLE_UPDATED">Role Updated</option>
            <option value="BROADCAST_NOTIFICATION_SENT">Notification Broadcast</option>
            <option value="LEGAL_POLICY_UPDATED">Policy Updated</option>
            <option value="APP_SETTINGS_UPDATED">Settings Updated</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Event Type</th>
                <th className="p-3.5">Actor (Role)</th>
                <th className="p-3.5">IP Address</th>
                <th className="p-3.5">Summary</th>
                <th className="p-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    Querying immutable audit logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No audit records found matching your filters.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getEventBadge(l.event_type)}`}>
                        {l.event_type}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <p className="font-bold text-slate-800 dark:text-slate-200">{l.user_email || 'System'}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {l.actor_role || 'system'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-400 text-[11px]">
                      {l.ip_address || 'Internal/Loopback'}
                    </td>
                    <td className="p-3.5 max-w-xs truncate text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {typeof l.details === 'object' ? JSON.stringify(l.details) : l.details || '-'}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => setSelectedLog(l)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong>{logs.length}</strong> of <strong>{total}</strong> recorded audit events
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(page - 1, 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(page + 1, totalPages))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* JSON Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-mono font-bold text-indigo-600 uppercase">Audit Record Inspection</span>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">{selectedLog.event_type}</h3>
              </div>
              <button onClick={() => setSelectedLog(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">Record ID:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{selectedLog.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">Timestamp:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{new Date(selectedLog.created_at).toISOString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">Actor Email:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedLog.user_email || 'System'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">Actor Role:</span>
                <span className="font-bold uppercase text-indigo-600">{selectedLog.actor_role || 'System'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">IP Address:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{selectedLog.ip_address || 'Loopback'}</span>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Payload / Details</p>
              <pre className="p-3 rounded-xl bg-slate-900 text-emerald-400 text-[11px] font-mono overflow-x-auto max-h-48">
                {JSON.stringify(selectedLog.details, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
